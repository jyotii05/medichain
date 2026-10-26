import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { batchPayload, freshBase, isoDay, LICENSE, login, orgByLicense, prisma, registerBatch, type Session } from './helpers.js';

let manufacturer: Session;
let northwind: Session;
let distributor: Session;

beforeAll(async () => {
  await freshBase();
  [manufacturer, northwind, distributor] = await Promise.all([login('manufacturer'), login('northwind'), login('distributor')]);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/batches — registration', () => {
  it('registers a batch with an opaque public id, a REGISTERED event and a confirmed simulated ledger entry', async () => {
    const payload = batchPayload({ batchNumber: 'amx-2026-0001' });
    const res = await manufacturer.post('/api/batches', payload);
    expect(res.status).toBe(201);
    const b = res.body.batch;
    expect(b.publicId).toMatch(/^MC-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(b.batchNumber).toBe('AMX-2026-0001'); // normalised to upper case
    expect(b).toMatchObject({
      status: 'ACTIVE',
      displayStatus: 'ACTIVE',
      quantity: 1000,
      quantityOnHand: 1000,
      manufactureDate: payload.manufactureDate,
      expiryDate: payload.expiryDate,
      manufacturer: { name: 'Aurelia Pharmaceuticals Ltd.' },
      currentCustodian: { name: 'Aurelia Pharmaceuticals Ltd.' },
      hasPendingTransfer: false,
    });
    expect(res.body.verificationUrl).toMatch(new RegExp(`/verify/${b.publicId}$`));
    expect(res.body.transfer).toBeNull();

    const row = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } });
    const aur = await orgByLicense(LICENSE.aurelia);
    expect(row.manufacturerId).toBe(aur.id);
    expect(row.currentCustodianId).toBe(aur.id);
    expect(row.manufacturerLicense).toBe(LICENSE.aurelia);
    expect(row.chainRef).toMatch(/^0x[0-9a-f]{64}$/);
    expect(row.dataHash).toMatch(/^0x[0-9a-f]{64}$/);

    const events = await prisma.supplyChainEvent.findMany({ where: { batchId: b.id }, orderBy: { sequence: 'asc' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'REGISTERED', sequence: 1, actorOrgId: aur.id, toOrgId: aur.id });
    expect(events[0].prevHash).toBe(`0x${'0'.repeat(64)}`);

    const txs = await prisma.blockchainTransaction.findMany({ where: { batchId: b.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      mode: 'SIMULATION',
      status: 'CONFIRMED',
      operation: 'REGISTER_BATCH',
      eventId: events[0].id,
      payloadHash: events[0].hash,
      txHash: null,
      blockNumber: null,
    });
    expect(txs[0].simulatedRef).toMatch(/^SIM-/);
    expect(txs[0].confirmedAt).not.toBeNull();

    expect(await prisma.auditLog.count({ where: { action: 'batch.registered', entityId: b.id } })).toBe(1);
  });

  it('rejects a duplicate batch number from the same manufacturer with 409 DUPLICATE_BATCH (case-insensitive)', async () => {
    await registerBatch(manufacturer, { batchNumber: 'DUP-0001' });
    const before = await prisma.medicineBatch.count();
    const res = await manufacturer.post('/api/batches', batchPayload({ batchNumber: 'dup-0001' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_BATCH');
    expect(await prisma.medicineBatch.count()).toBe(before);
  });

  it('allows the same batch number for a different manufacturer', async () => {
    await registerBatch(manufacturer, { batchNumber: 'SHARED-77' });
    const res = await northwind.post('/api/batches', batchPayload({ batchNumber: 'SHARED-77', manufacturerLicense: LICENSE.northwind }));
    expect(res.status).toBe(201);
    expect(await prisma.medicineBatch.count({ where: { batchNumber: 'SHARED-77' } })).toBe(2);
  });

  it('rejects an expiry date before the manufacture date (400 VALIDATION_ERROR)', async () => {
    const res = await manufacturer.post('/api/batches', batchPayload({ manufactureDate: isoDay(-5), expiryDate: isoDay(-30) }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('expiryDate');
  });

  it('rejects an expiry date equal to the manufacture date', async () => {
    const res = await manufacturer.post('/api/batches', batchPayload({ manufactureDate: isoDay(-5), expiryDate: isoDay(-5) }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an already-expired batch (400)', async () => {
    const res = await manufacturer.post('/api/batches', batchPayload({ manufactureDate: isoDay(-400), expiryDate: isoDay(-1) }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d: { path: string; message: string }) => d.path === 'expiryDate' && /expired/i.test(d.message))).toBe(true);
  });

  it('rejects a manufacture date in the future (400)', async () => {
    const res = await manufacturer.post('/api/batches', batchPayload({ manufactureDate: isoDay(3) }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('manufactureDate');
  });

  it('rejects badly formatted dates (400)', async () => {
    const res = await manufacturer.post('/api/batches', batchPayload({ expiryDate: '31/12/2030' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it.each([0, -5, 1.5])('rejects quantity %s (400)', async (quantity) => {
    const before = await prisma.medicineBatch.count();
    const res = await manufacturer.post('/api/batches', batchPayload({ quantity }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('quantity');
    expect(await prisma.medicineBatch.count()).toBe(before);
  });

  it('rejects missing required fields and an invalid batch number', async () => {
    const res = await manufacturer.post('/api/batches', { ...batchPayload({ batchNumber: '<script>' }), unit: '' });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['batchNumber', 'unit']));
  });

  it('rejects a licence that does not match the organization record (422 LICENSE_MISMATCH)', async () => {
    const before = await prisma.medicineBatch.count();
    const res = await manufacturer.post('/api/batches', batchPayload({ manufacturerLicense: LICENSE.northwind }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('LICENSE_MISMATCH');
    expect(await prisma.medicineBatch.count()).toBe(before);
  });

  it('with initialRecipientId creates the batch AND a pending transfer to that distributor', async () => {
    const hbl = await orgByLicense(LICENSE.harbourline);
    const res = await manufacturer.post('/api/batches', batchPayload({ initialRecipientId: hbl.id }));
    expect(res.status).toBe(201);
    expect(res.body.transfer).toMatchObject({ id: expect.any(String), reference: expect.stringMatching(/^SHP-\d{4}-/) });
    expect(res.body.batch.hasPendingTransfer).toBe(true);
    expect(res.body.batch.displayStatus).toBe('IN_TRANSIT');
    const t = await prisma.custodyTransfer.findUniqueOrThrow({ where: { id: res.body.transfer.id } });
    expect(t).toMatchObject({ status: 'PENDING', toOrgId: hbl.id, batchId: res.body.batch.id, quantity: 1000 });
    const events = await prisma.supplyChainEvent.findMany({ where: { batchId: res.body.batch.id }, orderBy: { sequence: 'asc' } });
    expect(events.map((e) => e.type)).toEqual(['REGISTERED', 'TRANSFER_INITIATED']);
    // distributor gets notified
    const hblUser = await prisma.user.findUniqueOrThrow({ where: { email: 'distributor@medichain.demo' } });
    expect(await prisma.notification.count({ where: { userId: hblUser.id, title: 'Incoming shipment awaiting acceptance' } })).toBeGreaterThan(0);
  });

  it('an invalid initialRecipientId rolls back the whole registration (atomic)', async () => {
    const ccp = await orgByLicense(LICENSE.citycare); // pharmacy: invalid route for a manufacturer
    const before = await prisma.medicineBatch.count();
    const res = await manufacturer.post('/api/batches', batchPayload({ batchNumber: 'ATOMIC-1', initialRecipientId: ccp.id }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_ROUTE');
    expect(await prisma.medicineBatch.count()).toBe(before);
    expect(await prisma.medicineBatch.findFirst({ where: { batchNumber: 'ATOMIC-1' } })).toBeNull();
  });
});

describe('GET /api/batches/:id/qr', () => {
  it('returns a PNG by default and an SVG on request', async () => {
    const b = await registerBatch(manufacturer);
    const png = await manufacturer.agent.get(`/api/batches/${b.id}/qr`).buffer(true);
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toMatch(/^image\/png/);
    const buf = png.body as Buffer;
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);

    const svg = await manufacturer.agent
      .get(`/api/batches/${b.id}/qr?format=svg`)
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (data += c));
        res.on('end', () => cb(null, data));
      });
    expect(svg.status).toBe(200);
    expect(svg.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(String(svg.body)).toContain('<svg');
  });
});

describe('GET /api/batches — list, search and filters', () => {
  let ibu: { id: string; publicId: string };
  let inTransit: { id: string };

  beforeAll(async () => {
    ibu = await registerBatch(manufacturer, { batchNumber: 'SRCH-IBU-1', medicine: { name: 'Ibuprofenix', genericName: 'Ibuprofen', category: 'Analgesic', strength: '400 mg' } });
    inTransit = await registerBatch(manufacturer, { batchNumber: 'SRCH-TRANSIT-1' });
    const t = await manufacturer.post('/api/transfers', { batchId: inTransit.id, toOrgId: distributor.user.organization.id });
    expect(t.status).toBe(201);
  });

  it('searches by medicine name, batch number and public id (case-insensitive)', async () => {
    for (const q of ['ibuprofenix', 'srch-ibu', ibu.publicId.toLowerCase()]) {
      const res = await manufacturer.get(`/api/batches?search=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((b: { id: string }) => b.id), q).toEqual([ibu.id]);
      expect(res.body.total).toBe(1);
    }
  });

  it('filters by status IN_TRANSIT / ACTIVE', async () => {
    const transit = await manufacturer.get('/api/batches?status=IN_TRANSIT&pageSize=100');
    expect(transit.status).toBe(200);
    const ids = transit.body.items.map((b: { id: string }) => b.id);
    expect(ids).toContain(inTransit.id);
    expect(ids).not.toContain(ibu.id);
    expect(transit.body.items.every((b: { displayStatus: string }) => b.displayStatus === 'IN_TRANSIT')).toBe(true);

    const active = await manufacturer.get('/api/batches?status=ACTIVE&pageSize=100');
    const activeIds = active.body.items.map((b: { id: string }) => b.id);
    expect(activeIds).toContain(ibu.id);
    expect(activeIds).not.toContain(inTransit.id);
    expect(active.body.items.every((b: { displayStatus: string }) => b.displayStatus === 'ACTIVE')).toBe(true);
  });

  it('filters by RECALLED status', async () => {
    const regulator = await login('regulator');
    const r = await regulator.post('/api/recalls', { batchId: ibu.id, classification: 'CLASS_III', reason: 'Labelling error found during audit' });
    expect(r.status).toBe(201);
    const res = await manufacturer.get('/api/batches?status=RECALLED');
    expect(res.body.items.map((b: { id: string }) => b.id)).toEqual([ibu.id]);
  });

  it('rejects an unknown status filter', async () => {
    const res = await manufacturer.get('/api/batches?status=NOPE');
    expect(res.status).toBe(400);
  });

  it('paginates', async () => {
    const total = await prisma.medicineBatch.count({ where: { manufacturer: { licenseNumber: LICENSE.aurelia } } });
    const res = await manufacturer.get('/api/batches?pageSize=2&page=1');
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(total);
    expect(res.body.totalPages).toBe(Math.ceil(total / 2));
  });
});
