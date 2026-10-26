import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshBase, login, moveBatch, prisma, registerBatch, type Session } from './helpers.js';
import { keccakText } from '../src/lib/hash.js';

let regulator: Session;
let manufacturer: Session;
let distributor: Session;
let wholesaler: Session;
let pharmacy: Session;

beforeAll(async () => {
  await freshBase();
  [regulator, manufacturer, distributor, wholesaler, pharmacy] = await Promise.all(
    ['regulator', 'manufacturer', 'distributor', 'wholesaler', 'pharmacy'].map((u) => login(u)),
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

const REASON = 'Out-of-specification dissolution results in stability testing';

describe('POST /api/recalls', () => {
  it('regulator recall: batch RECALLED, RecallRecord, RECALLED event with reasonHash, notifications to manufacturer + custodian', async () => {
    const b = await registerBatch(manufacturer);
    await moveBatch(manufacturer, distributor, b.id);
    const notesBefore = await prisma.notification.count({ where: { title: 'Batch recalled' } });

    const res = await regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_II', reason: REASON });
    expect(res.status).toBe(201);
    expect(res.body.recall).toMatchObject({
      reference: expect.stringMatching(/^RCL-\d{4}-[0-9A-Z]{6}$/),
      action: 'RECALL',
      classification: 'CLASS_II',
      reason: REASON,
      initiatedBy: 'Dr. Amara Okafor',
      batch: { id: b.id, publicId: b.publicId },
    });

    const batch = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect(batch.status).toBe('RECALLED');

    const records = await prisma.recallRecord.findMany({ where: { batchId: b.id } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: 'RECALL', classification: 'CLASS_II', reason: REASON, initiatedById: regulator.user.id });

    const ev = await prisma.supplyChainEvent.findFirstOrThrow({ where: { batchId: b.id }, orderBy: { sequence: 'desc' } });
    expect(ev.type).toBe('RECALLED');
    expect(ev.recallId).toBe(records[0].id);
    const data = ev.data as { reference: string; classification: string; reasonHash: string };
    expect(data.reference).toBe(records[0].reference);
    expect(data.reasonHash).toBe(keccakText(`RECALL:${REASON}`));
    // the readable reason is NOT anchored in the event / ledger
    expect(JSON.stringify(ev.data)).not.toContain('dissolution');
    const anchor = await prisma.blockchainTransaction.findFirstOrThrow({ where: { eventId: ev.id } });
    expect(anchor).toMatchObject({ operation: 'RECALL_BATCH', status: 'CONFIRMED', payloadHash: ev.hash });

    // notifications: every active member of the manufacturer and the current custodian
    const mfgUser = await prisma.user.findUniqueOrThrow({ where: { email: 'manufacturer@medichain.demo' } });
    const distUser = await prisma.user.findUniqueOrThrow({ where: { email: 'distributor@medichain.demo' } });
    for (const u of [mfgUser, distUser]) {
      const n = await prisma.notification.findMany({ where: { userId: u.id, title: 'Batch recalled', message: { contains: b.publicId } } });
      expect(n).toHaveLength(1);
      expect(n[0].severity).toBe('CRITICAL');
    }
    expect(await prisma.notification.count({ where: { title: 'Batch recalled' } })).toBe(notesBefore + 2);

    expect(await prisma.auditLog.count({ where: { action: 'batch.recalled', entityId: b.id } })).toBe(1);

    // the regulator's batch view no longer offers a recall
    const detail = await regulator.get(`/api/batches/${b.id}`);
    expect(detail.body.permissions.canRecall).toBe(false);
    expect(detail.body.assessment.result).toBe('RECALLED');
  });

  it('a second recall → 409 ALREADY_RECALLED, no extra record', async () => {
    const b = await registerBatch(manufacturer);
    expect((await regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_III', reason: REASON })).status).toBe(201);
    const again = await regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_I', reason: REASON });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_RECALLED');
    const block = await regulator.post('/api/recalls', { batchId: b.id, action: 'BLOCK', classification: 'CLASS_I', reason: REASON });
    expect(block.status).toBe(409);
    expect(await prisma.recallRecord.count({ where: { batchId: b.id } })).toBe(1);
    expect(await prisma.supplyChainEvent.count({ where: { batchId: b.id, type: { in: ['RECALLED', 'BLOCKED'] } } })).toBe(1);
  });

  it('parallel recalls of the same batch → exactly one succeeds', async () => {
    const b = await registerBatch(manufacturer);
    const results = await Promise.all([
      regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_II', reason: REASON }),
      regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_II', reason: REASON }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.recallRecord.count({ where: { batchId: b.id } })).toBe(1);
  });

  it('BLOCK action → status BLOCKED and a BLOCKED event', async () => {
    const b = await registerBatch(manufacturer);
    const res = await regulator.post('/api/recalls', { batchId: b.id, action: 'BLOCK', classification: 'CLASS_I', reason: 'Precautionary hold pending investigation' });
    expect(res.status).toBe(201);
    expect(res.body.recall.action).toBe('BLOCK');
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('BLOCKED');
    const ev = await prisma.supplyChainEvent.findFirstOrThrow({ where: { batchId: b.id }, orderBy: { sequence: 'desc' } });
    expect(ev.type).toBe('BLOCKED');
    const mfgUser = await prisma.user.findUniqueOrThrow({ where: { email: 'manufacturer@medichain.demo' } });
    expect(await prisma.notification.count({ where: { userId: mfgUser.id, title: 'Batch blocked by regulator', message: { contains: b.publicId } } })).toBe(1);
  });

  it('requires a reason of at least 10 characters and a valid classification', async () => {
    const b = await registerBatch(manufacturer);
    const short = await regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_II', reason: 'too short' });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
    expect(short.body.error.details.map((d: { path: string }) => d.path)).toContain('reason');
    const blank = await regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_II', reason: '            ' });
    expect(blank.status).toBe(400);
    const badClass = await regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_IV', reason: REASON });
    expect(badClass.status).toBe(400);
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('ACTIVE');
    expect(await prisma.recallRecord.count({ where: { batchId: b.id } })).toBe(0);
  });

  it('unknown batch → 404', async () => {
    const res = await regulator.post('/api/recalls', { batchId: 'nope', classification: 'CLASS_II', reason: REASON });
    expect(res.status).toBe(404);
  });

  it('a pharmacy cannot dispense a recalled batch (422 BATCH_RECALLED), stock unchanged', async () => {
    const b = await registerBatch(manufacturer);
    await moveBatch(manufacturer, distributor, b.id);
    await moveBatch(distributor, wholesaler, b.id);
    await moveBatch(wholesaler, pharmacy, b.id);
    expect((await pharmacy.post(`/api/batches/${b.id}/dispense`, { quantity: 10 })).status).toBe(200);

    expect((await regulator.post('/api/recalls', { batchId: b.id, classification: 'CLASS_I', reason: REASON })).status).toBe(201);
    // the pharmacy (current custodian) was notified
    const phUser = await prisma.user.findUniqueOrThrow({ where: { email: 'pharmacy@medichain.demo' } });
    expect(await prisma.notification.count({ where: { userId: phUser.id, title: 'Batch recalled', message: { contains: b.publicId } } })).toBe(1);

    const res = await pharmacy.post(`/api/batches/${b.id}/dispense`, { quantity: 10 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BATCH_RECALLED');
    expect((await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } })).quantityOnHand).toBe(990);
  });
});

describe('GET /api/recalls scoping', () => {
  it('partners only see recalls for batches they handled; the regulator sees all', async () => {
    const all = await regulator.get('/api/recalls?pageSize=100');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(await prisma.recallRecord.count());

    const summit = await login('summit');
    const none = await summit.get('/api/recalls');
    expect(none.body.total).toBe(0);

    const mine = await pharmacy.get('/api/recalls');
    expect(mine.body.total).toBe(1);
  });
});
