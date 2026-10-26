import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshBase, LICENSE, login, moveBatch, orgByLicense, prisma, registerBatch, type Session } from './helpers.js';

let manufacturer: Session;
let distributor: Session;
let summit: Session;
let wholesaler: Session;
let pharmacy: Session;
let regulator: Session;

beforeAll(async () => {
  await freshBase();
  [manufacturer, distributor, summit, wholesaler, pharmacy, regulator] = await Promise.all(
    ['manufacturer', 'distributor', 'summit', 'wholesaler', 'pharmacy', 'regulator'].map((u) => login(u)),
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

const orgId = (s: Session) => s.user.organization.id;
const ship = (from: Session, batchId: string, to: Session | string) =>
  from.post('/api/transfers', { batchId, toOrgId: typeof to === 'string' ? to : orgId(to) });

describe('happy path: manufacturer → distributor → wholesaler → pharmacy', () => {
  it('moves custody stage by stage with events, journey and notifications', async () => {
    const b = await registerBatch(manufacturer);

    // manufacturer → distributor
    const t1 = await ship(manufacturer, b.id, distributor);
    expect(t1.status).toBe(201);
    expect(t1.body.transfer).toMatchObject({ status: 'PENDING', quantity: 1000, fromOrg: { id: orgId(manufacturer) }, toOrg: { id: orgId(distributor) } });
    // custody does not move until acceptance
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } })).currentCustodianId).toBe(orgId(manufacturer));
    const incoming = await distributor.get('/api/transfers?direction=incoming&status=PENDING');
    expect(incoming.body.items.map((t: { id: string }) => t.id)).toContain(t1.body.transfer.id);

    const a1 = await distributor.post(`/api/transfers/${t1.body.transfer.id}/accept`, { note: 'Received in good condition' });
    expect(a1.status).toBe(200);
    expect(a1.body.transfer).toMatchObject({ status: 'ACCEPTED', responseNote: 'Received in good condition' });
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } })).currentCustodianId).toBe(orgId(distributor));

    // distributor → wholesaler → pharmacy
    await moveBatch(distributor, wholesaler, b.id);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } })).currentCustodianId).toBe(orgId(wholesaler));
    await moveBatch(wholesaler, pharmacy, b.id);
    const final = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect(final.currentCustodianId).toBe(orgId(pharmacy));
    expect(final.quantityOnHand).toBe(1000);

    const events = await prisma.supplyChainEvent.findMany({ where: { batchId: b.id }, orderBy: { sequence: 'asc' } });
    expect(events.map((e) => e.type)).toEqual([
      'REGISTERED',
      'TRANSFER_INITIATED',
      'TRANSFER_ACCEPTED',
      'TRANSFER_INITIATED',
      'TRANSFER_ACCEPTED',
      'TRANSFER_INITIATED',
      'TRANSFER_ACCEPTED',
    ]);
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (let i = 1; i < events.length; i++) expect(events[i].prevHash).toBe(events[i - 1].hash);
    // every event is anchored in the simulated ledger
    expect(await prisma.blockchainTransaction.count({ where: { batchId: b.id, mode: 'SIMULATION', status: 'CONFIRMED' } })).toBe(7);

    const detail = await pharmacy.get(`/api/batches/${b.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.assessment.result).toBe('VERIFIED');
    const journey = detail.body.journey as { role: string; status: string; org: { name: string } | null }[];
    expect(journey.map((s) => [s.role, s.status])).toEqual([
      ['MANUFACTURER', 'completed'],
      ['DISTRIBUTOR', 'completed'],
      ['WHOLESALER', 'completed'],
      ['PHARMACY', 'current'],
    ]);
    expect(journey.map((s) => s.org?.name)).toEqual([
      'Aurelia Pharmaceuticals Ltd.',
      'Harbourline Distribution Co.',
      'Greenfield Medical Wholesale',
      'CityCare Pharmacy — Central',
    ]);
    expect(detail.body.permissions).toMatchObject({ canTransfer: false, canDispense: true });

    // sender was notified of each acceptance
    const mfgUser = await prisma.user.findUniqueOrThrow({ where: { email: 'manufacturer@medichain.demo' } });
    expect(await prisma.notification.count({ where: { userId: mfgUser.id, title: 'Shipment accepted' } })).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/transfers/recipients lists only approved orgs of the next stage', async () => {
    const res = await manufacturer.get('/api/transfers/recipients');
    expect(res.body.nextStage).toBe('DISTRIBUTOR');
    expect(res.body.items.map((o: { name: string }) => o.name).sort()).toEqual(['Harbourline Distribution Co.', 'Summit Pharma Logistics']);
    const ph = await pharmacy.get('/api/transfers/recipients');
    expect(ph.body).toEqual({ items: [], nextStage: null });
  });
});

describe('business-rule violations', () => {
  it('a non-custodian cannot initiate a transfer (403 NOT_CUSTODIAN)', async () => {
    const b = await registerBatch(manufacturer);
    await moveBatch(manufacturer, distributor, b.id);
    // manufacturer no longer holds it
    const res = await ship(manufacturer, b.id, summit);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_CUSTODIAN');
    // a different distributor that never held it
    const res2 = await ship(summit, b.id, wholesaler);
    expect(res2.status).toBe(403);
    expect(res2.body.error.code).toBe('NOT_CUSTODIAN');
    expect(await prisma.custodyTransfer.count({ where: { batchId: b.id, status: 'PENDING' } })).toBe(0);
  });

  it('rejects an invalid route manufacturer → pharmacy (422 INVALID_ROUTE)', async () => {
    const b = await registerBatch(manufacturer);
    const res = await ship(manufacturer, b.id, pharmacy);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_ROUTE');
    const res2 = await ship(manufacturer, b.id, wholesaler);
    expect(res2.status).toBe(422);
    expect(res2.body.error.code).toBe('INVALID_ROUTE');
    expect(await prisma.custodyTransfer.count({ where: { batchId: b.id } })).toBe(0);
  });

  it('rejects transfer to own organization', async () => {
    const b = await registerBatch(manufacturer);
    const res = await ship(manufacturer, b.id, manufacturer);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_RECIPIENT');
  });

  it('a pharmacy cannot transfer onward', async () => {
    const b = await registerBatch(manufacturer);
    await moveBatch(manufacturer, distributor, b.id);
    await moveBatch(distributor, wholesaler, b.id);
    await moveBatch(wholesaler, pharmacy, b.id);
    const oakwood = await orgByLicense(LICENSE.oakwood);
    const res = await ship(pharmacy, b.id, oakwood.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.custodyTransfer.count({ where: { batchId: b.id, status: 'PENDING' } })).toBe(0);
  });

  it('a second transfer while one is pending → 409 TRANSFER_PENDING', async () => {
    const b = await registerBatch(manufacturer);
    expect((await ship(manufacturer, b.id, distributor)).status).toBe(201);
    const res = await ship(manufacturer, b.id, summit);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRANSFER_PENDING');
    expect(await prisma.custodyTransfer.count({ where: { batchId: b.id } })).toBe(1);
  });

  it('a wrong recipient cannot accept (403) and the transfer stays PENDING', async () => {
    const b = await registerBatch(manufacturer);
    const t = await ship(manufacturer, b.id, distributor);
    const res = await summit.post(`/api/transfers/${t.body.transfer.id}/accept`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    const row = await prisma.custodyTransfer.findUniqueOrThrow({ where: { id: t.body.transfer.id } });
    expect(row.status).toBe('PENDING');
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } })).currentCustodianId).toBe(orgId(manufacturer));
  });

  it('a duplicate acceptance → 409 TRANSFER_ALREADY_RESOLVED', async () => {
    const b = await registerBatch(manufacturer);
    const t = await ship(manufacturer, b.id, distributor);
    expect((await distributor.post(`/api/transfers/${t.body.transfer.id}/accept`)).status).toBe(200);
    const again = await distributor.post(`/api/transfers/${t.body.transfer.id}/accept`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('TRANSFER_ALREADY_RESOLVED');
    const reject = await distributor.post(`/api/transfers/${t.body.transfer.id}/reject`, { reason: 'Changed my mind' });
    expect(reject.status).toBe(409);
    expect(await prisma.supplyChainEvent.count({ where: { batchId: b.id, type: 'TRANSFER_ACCEPTED' } })).toBe(1);
  });

  it('reject requires a reason and leaves the custodian unchanged', async () => {
    const b = await registerBatch(manufacturer);
    const t = await ship(manufacturer, b.id, distributor);
    const noReason = await distributor.post(`/api/transfers/${t.body.transfer.id}/reject`, {});
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe('VALIDATION_ERROR');
    const tooShort = await distributor.post(`/api/transfers/${t.body.transfer.id}/reject`, { reason: 'no' });
    expect(tooShort.status).toBe(400);
    expect((await prisma.custodyTransfer.findUniqueOrThrow({ where: { id: t.body.transfer.id } })).status).toBe('PENDING');

    const res = await distributor.post(`/api/transfers/${t.body.transfer.id}/reject`, { reason: 'Cartons damaged in transit' });
    expect(res.status).toBe(200);
    expect(res.body.transfer).toMatchObject({ status: 'REJECTED', responseNote: 'Cartons damaged in transit' });
    const batch = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect(batch.currentCustodianId).toBe(orgId(manufacturer));
    const last = await prisma.supplyChainEvent.findFirstOrThrow({ where: { batchId: b.id }, orderBy: { sequence: 'desc' } });
    expect(last.type).toBe('TRANSFER_REJECTED');
    // after a rejection the manufacturer can re-route the batch
    expect((await ship(manufacturer, b.id, summit)).status).toBe(201);
  });

  it('transfer to a SUSPENDED organization → 422 RECIPIENT_NOT_AUTHORIZED', async () => {
    const spl = await orgByLicense(LICENSE.summit);
    const s = await regulator.patch(`/api/organizations/${spl.id}/status`, { status: 'SUSPENDED', reason: 'Licence under review' });
    expect(s.status).toBe(200);
    try {
      const b = await registerBatch(manufacturer);
      const res = await ship(manufacturer, b.id, spl.id);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('RECIPIENT_NOT_AUTHORIZED');
      expect(await prisma.custodyTransfer.count({ where: { batchId: b.id } })).toBe(0);
    } finally {
      expect((await regulator.patch(`/api/organizations/${spl.id}/status`, { status: 'APPROVED' })).status).toBe(200);
    }
  });

  it('transfer to a PENDING organization → 422 RECIPIENT_NOT_AUTHORIZED', async () => {
    const b = await registerBatch(manufacturer);
    // Crestline is a pending manufacturer (wrong type too, but authorization is checked first)
    const crg = await orgByLicense(LICENSE.crestline);
    const res = await ship(manufacturer, b.id, crg.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('RECIPIENT_NOT_AUTHORIZED');
  });

  it('unknown batch / recipient → 404', async () => {
    const b = await registerBatch(manufacturer);
    expect((await ship(manufacturer, 'does-not-exist', distributor)).status).toBe(404);
    expect((await ship(manufacturer, b.id, 'does-not-exist')).status).toBe(404);
  });
});

describe('concurrency', () => {
  it('two parallel accepts of the same transfer → exactly one 200 and one 409, one TRANSFER_ACCEPTED event', async () => {
    const b = await registerBatch(manufacturer);
    const t = await ship(manufacturer, b.id, distributor);
    const id = t.body.transfer.id;
    // two independent sessions of the same recipient organization
    const d2 = await login('distributor');
    const results = await Promise.all([
      distributor.post(`/api/transfers/${id}/accept`),
      d2.post(`/api/transfers/${id}/accept`),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('TRANSFER_ALREADY_RESOLVED');

    expect(await prisma.supplyChainEvent.count({ where: { batchId: b.id, type: 'TRANSFER_ACCEPTED' } })).toBe(1);
    const events = await prisma.supplyChainEvent.findMany({ where: { batchId: b.id }, orderBy: { sequence: 'asc' } });
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3]);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } })).currentCustodianId).toBe(orgId(distributor));
  });

  it('parallel accept and reject of the same transfer → exactly one wins', async () => {
    const b = await registerBatch(manufacturer);
    const t = await ship(manufacturer, b.id, distributor);
    const id = t.body.transfer.id;
    const results = await Promise.all([
      distributor.post(`/api/transfers/${id}/accept`),
      distributor.post(`/api/transfers/${id}/reject`, { reason: 'Parallel rejection attempt' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const responses = await prisma.supplyChainEvent.count({ where: { batchId: b.id, type: { in: ['TRANSFER_ACCEPTED', 'TRANSFER_REJECTED'] } } });
    expect(responses).toBe(1);
  });

  it('two parallel initiate requests for the same batch → exactly one 201', async () => {
    const b = await registerBatch(manufacturer);
    const results = await Promise.all([ship(manufacturer, b.id, distributor), ship(manufacturer, b.id, summit)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('TRANSFER_PENDING');
    expect(await prisma.custodyTransfer.count({ where: { batchId: b.id, status: 'PENDING' } })).toBe(1);
    expect(await prisma.supplyChainEvent.count({ where: { batchId: b.id, type: 'TRANSFER_INITIATED' } })).toBe(1);
  });

  it('many parallel initiates still create exactly one pending transfer', async () => {
    const b = await registerBatch(manufacturer);
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => ship(manufacturer, b.id, i % 2 ? distributor : summit)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await prisma.custodyTransfer.count({ where: { batchId: b.id } })).toBe(1);
  });

  it('the DB partial unique index rejects a second PENDING transfer even via direct insert (P2002)', async () => {
    const b = await registerBatch(manufacturer);
    const t = await ship(manufacturer, b.id, distributor);
    expect(t.status).toBe(201);
    const mfgUser = await prisma.user.findUniqueOrThrow({ where: { email: 'manufacturer@medichain.demo' } });
    const err = await prisma.custodyTransfer
      .create({
        data: {
          reference: `SHP-TEST-${Date.now()}`,
          batchId: b.id,
          fromOrgId: orgId(manufacturer),
          toOrgId: orgId(summit),
          quantity: 1000,
          status: 'PENDING',
          initiatedById: mfgUser.id,
        },
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((err as Prisma.PrismaClientKnownRequestError).code).toBe('P2002');
    expect(await prisma.custodyTransfer.count({ where: { batchId: b.id, status: 'PENDING' } })).toBe(1);
  });
});

describe('recall interaction', () => {
  it('a recalled batch cannot be transferred (422 BATCH_RECALLED)', async () => {
    const b = await registerBatch(manufacturer);
    const r = await regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_I', reason: 'Contamination detected in retained samples' });
    expect(r.status).toBe(201);
    const res = await ship(manufacturer, b.id, distributor);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BATCH_RECALLED');
    expect(await prisma.custodyTransfer.count({ where: { batchId: b.id } })).toBe(0);
  });

  it('a recall cancels the pending transfer, which can then no longer be accepted', async () => {
    const b = await registerBatch(manufacturer);
    const t = await ship(manufacturer, b.id, distributor);
    const r = await regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_II', reason: 'Out-of-specification assay results' });
    expect(r.status).toBe(201);
    const row = await prisma.custodyTransfer.findUniqueOrThrow({ where: { id: t.body.transfer.id } });
    expect(row.status).toBe('CANCELLED');
    expect(row.responseNote).toContain(r.body.recall.reference);
    const types = (await prisma.supplyChainEvent.findMany({ where: { batchId: b.id }, orderBy: { sequence: 'asc' } })).map((e) => e.type);
    expect(types).toEqual(['REGISTERED', 'TRANSFER_INITIATED', 'TRANSFER_CANCELLED', 'RECALLED']);

    const acc = await distributor.post(`/api/transfers/${t.body.transfer.id}/accept`);
    expect(acc.status).toBe(409);
    expect(acc.body.error.code).toBe('TRANSFER_ALREADY_RESOLVED');
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } })).currentCustodianId).toBe(orgId(manufacturer));
    // the intended recipient was notified too
    const dUser = await prisma.user.findUniqueOrThrow({ where: { email: 'distributor@medichain.demo' } });
    expect(await prisma.notification.count({ where: { userId: dUser.id, title: 'Batch recalled', message: { contains: b.publicId } } })).toBe(1);
  });
});
