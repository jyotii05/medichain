import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, batchPayload, freshBase, LICENSE, login, orgByLicense, prisma, registerBatch, type Session } from './helpers.js';

let manufacturer: Session;
let distributor: Session;
let wholesaler: Session;
let pharmacy: Session;
let regulator: Session;
let batch: { id: string; publicId: string };

beforeAll(async () => {
  await freshBase();
  [manufacturer, distributor, wholesaler, pharmacy, regulator] = await Promise.all(
    ['manufacturer', 'distributor', 'wholesaler', 'pharmacy', 'regulator'].map((u) => login(u)),
  );
  batch = await registerBatch(manufacturer);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('batch registration is restricted to approved manufacturers', () => {
  it.each(['distributor', 'pharmacy', 'regulator', 'wholesaler'])('%s cannot POST /api/batches (403 FORBIDDEN)', async (who) => {
    const s = await login(who);
    const before = await prisma.medicineBatch.count();
    const res = await s.post('/api/batches', batchPayload());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.medicineBatch.count()).toBe(before);
  });

  it('a PENDING manufacturer (Crestline) gets 403 ORGANIZATION_NOT_APPROVED', async () => {
    const s = await login('crestline');
    expect(s.user.organization.status).toBe('PENDING');
    const res = await s.post('/api/batches', batchPayload({ manufacturerLicense: LICENSE.crestline }));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ORGANIZATION_NOT_APPROVED');
    const crg = await orgByLicense(LICENSE.crestline);
    expect(await prisma.medicineBatch.count({ where: { manufacturerId: crg.id } })).toBe(0);
  });

  it('anonymous users get 401', async () => {
    const res = await request(app).post('/api/batches').send(batchPayload());
    expect(res.status).toBe(401);
  });
});

describe('regulator-only endpoints', () => {
  const nonRegulators = () => [
    ['manufacturer', manufacturer],
    ['distributor', distributor],
    ['wholesaler', wholesaler],
    ['pharmacy', pharmacy],
  ] as const;

  it('non-regulators cannot POST /api/recalls', async () => {
    for (const [, s] of nonRegulators()) {
      const res = await s.post('/api/recalls', { batchId: batch.id, classification: 'CLASS_II', reason: 'Trying to recall without authority' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect(await prisma.recallRecord.count()).toBe(0);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: batch.id } })).status).toBe('ACTIVE');
  });

  it('non-regulators cannot GET /api/users, /api/audit-logs or /api/flags', async () => {
    for (const [, s] of nonRegulators()) {
      for (const url of ['/api/users', '/api/audit-logs', '/api/flags']) {
        const res = await s.get(url);
        expect(res.status, `${s.user.email} GET ${url}`).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    }
  });

  it('non-regulators cannot PATCH /api/organizations/:id/status', async () => {
    const target = await orgByLicense(LICENSE.crestline);
    for (const [, s] of nonRegulators()) {
      const res = await s.patch(`/api/organizations/${target.id}/status`, { status: 'APPROVED' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
    expect((await orgByLicense(LICENSE.crestline)).status).toBe('PENDING');
  });

  it('the regulator CAN reach those endpoints', async () => {
    for (const url of ['/api/users', '/api/audit-logs', '/api/flags']) {
      expect((await regulator.get(url)).status, url).toBe(200);
    }
  });
});

describe('batch visibility is scoped to partners that handled the batch', () => {
  it('a distributor that never handled a batch gets 404 on GET /api/batches/:id and does not see it in the list', async () => {
    const byId = await distributor.get(`/api/batches/${batch.id}`);
    expect(byId.status).toBe(404);
    expect(byId.body.error.code).toBe('NOT_FOUND');
    const byPublicId = await distributor.get(`/api/batches/${batch.publicId}`);
    expect(byPublicId.status).toBe(404);
    const qr = await distributor.get(`/api/batches/${batch.id}/qr`);
    expect(qr.status).toBe(404);

    const list = await distributor.get('/api/batches');
    expect(list.status).toBe(200);
    expect(list.body.items.map((b: { id: string }) => b.id)).not.toContain(batch.id);
    expect(list.body.total).toBe(0);
  });

  it('a pharmacy cannot see it either, but the manufacturer and regulator can', async () => {
    expect((await pharmacy.get(`/api/batches/${batch.id}`)).status).toBe(404);
    expect((await manufacturer.get(`/api/batches/${batch.id}`)).status).toBe(200);
    expect((await regulator.get(`/api/batches/${batch.id}`)).status).toBe(200);
    const regList = await regulator.get('/api/batches');
    expect(regList.body.items.map((b: { id: string }) => b.id)).toContain(batch.id);
  });

  it('once shipped to a distributor, that distributor (but not another one) can see it', async () => {
    const b = await registerBatch(manufacturer);
    const t = await manufacturer.post('/api/transfers', { batchId: b.id, toOrgId: distributor.user.organization.id });
    expect(t.status).toBe(201);
    expect((await distributor.get(`/api/batches/${b.id}`)).status).toBe(200);
    const summit = await login('summit');
    expect((await summit.get(`/api/batches/${b.id}`)).status).toBe(404);
    // and the other distributor cannot read the transfer either
    expect((await summit.get(`/api/transfers/${t.body.transfer.id}`)).status).toBe(404);
  });
});

describe('transfer acceptance by role', () => {
  it('a manufacturer cannot accept transfers (403)', async () => {
    const b = await registerBatch(manufacturer);
    const t = await manufacturer.post('/api/transfers', { batchId: b.id, toOrgId: distributor.user.organization.id });
    expect(t.status).toBe(201);
    const res = await manufacturer.post(`/api/transfers/${t.body.transfer.id}/accept`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const row = await prisma.custodyTransfer.findUniqueOrThrow({ where: { id: t.body.transfer.id } });
    expect(row.status).toBe('PENDING');
  });

  it('a regulator cannot accept transfers (403)', async () => {
    const pendingT = await prisma.custodyTransfer.findFirstOrThrow({ where: { status: 'PENDING' } });
    const res = await regulator.post(`/api/transfers/${pendingT.id}/accept`);
    expect(res.status).toBe(403);
  });

  it('pharmacies and regulators cannot initiate transfers (403)', async () => {
    for (const s of [pharmacy, regulator]) {
      const res = await s.post('/api/transfers', { batchId: batch.id, toOrgId: distributor.user.organization.id });
      expect(res.status).toBe(403);
    }
  });
});
