import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshBase, login, moveBatch, prisma, registerBatch, type Session } from './helpers.js';

let manufacturer: Session;
let distributor: Session;
let wholesaler: Session;
let pharmacy: Session;
let oakwood: Session;

beforeAll(async () => {
  await freshBase();
  [manufacturer, distributor, wholesaler, pharmacy, oakwood] = await Promise.all(
    ['manufacturer', 'distributor', 'wholesaler', 'pharmacy', 'oakwood'].map((u) => login(u)),
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function batchAtPharmacy(quantity = 500) {
  const b = await registerBatch(manufacturer, { quantity });
  await moveBatch(manufacturer, distributor, b.id);
  await moveBatch(distributor, wholesaler, b.id);
  await moveBatch(wholesaler, pharmacy, b.id);
  return b;
}

const onHand = async (id: string) => (await prisma.medicineBatch.findUniqueOrThrow({ where: { id } })).quantityOnHand;

describe('POST /api/batches/:id/dispense', () => {
  it('decreases quantityOnHand and records a DISPENSED event', async () => {
    const b = await batchAtPharmacy(500);
    const r1 = await pharmacy.post(`/api/batches/${b.id}/dispense`, { quantity: 120 });
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ quantityOnHand: 380 });
    const r2 = await pharmacy.post(`/api/batches/${b.id}/dispense`, { quantity: 80 });
    expect(r2.body).toEqual({ quantityOnHand: 300 });
    const row = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: b.id } });
    expect(row.quantityOnHand).toBe(300);
    expect(row.quantity).toBe(500);
    const evs = await prisma.supplyChainEvent.findMany({ where: { batchId: b.id, type: 'DISPENSED' }, orderBy: { sequence: 'asc' } });
    expect(evs.map((e) => e.data)).toEqual([
      { quantity: 120, remaining: 380 },
      { quantity: 80, remaining: 300 },
    ]);
    // dispensing keeps the record verifiable
    const v = await pharmacy.get(`/api/batches/${b.id}`);
    expect(v.body.assessment.result).toBe('VERIFIED');
  });

  it('dispensing the exact remaining stock brings it to zero; then nothing more can be dispensed', async () => {
    const b = await batchAtPharmacy(50);
    expect((await pharmacy.post(`/api/batches/${b.id}/dispense`, { quantity: 50 })).body).toEqual({ quantityOnHand: 0 });
    const res = await pharmacy.post(`/api/batches/${b.id}/dispense`, { quantity: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(b.id)).toBe(0);
  });

  it('dispensing more than on hand → 422 INSUFFICIENT_STOCK and quantity unchanged', async () => {
    const b = await batchAtPharmacy(100);
    await pharmacy.post(`/api/batches/${b.id}/dispense`, { quantity: 30 });
    const res = await pharmacy.post(`/api/batches/${b.id}/dispense`, { quantity: 71 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(b.id)).toBe(70);
    expect(await prisma.supplyChainEvent.count({ where: { batchId: b.id, type: 'DISPENSED' } })).toBe(1);
  });

  it('parallel dispenses cannot oversell', async () => {
    const b = await batchAtPharmacy(100);
    const results = await Promise.all(Array.from({ length: 5 }, () => pharmacy.post(`/api/batches/${b.id}/dispense`, { quantity: 30 })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(3);
    expect(results.filter((r) => r.status === 422)).toHaveLength(2);
    expect(await onHand(b.id)).toBe(10);
  });

  it.each([0, -5, 2.5, 'abc'])('rejects quantity %s (400)', async (quantity) => {
    const b = await batchAtPharmacy(10);
    const res = await pharmacy.post(`/api/batches/${b.id}/dispense`, { quantity });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await onHand(b.id)).toBe(10);
  });

  it('only the pharmacy holding the batch can dispense', async () => {
    const b = await batchAtPharmacy(10);
    // other pharmacy cannot even see it
    expect((await oakwood.post(`/api/batches/${b.id}/dispense`, { quantity: 1 })).status).toBe(404);
    // non-pharmacy roles are forbidden
    expect((await wholesaler.post(`/api/batches/${b.id}/dispense`, { quantity: 1 })).status).toBe(403);
    expect((await manufacturer.post(`/api/batches/${b.id}/dispense`, { quantity: 1 })).status).toBe(403);
    expect(await onHand(b.id)).toBe(10);
  });

  it('a partially dispensed batch cannot be transferred as a whole (422 PARTIAL_BATCH)', async () => {
    // Only pharmacies (the final stage) dispense, so a partial batch upstream can only be produced directly in the DB.
    const b = await registerBatch(manufacturer, { quantity: 10 });
    await prisma.medicineBatch.update({ where: { id: b.id }, data: { quantityOnHand: 9 } });
    const res = await manufacturer.post('/api/transfers', { batchId: b.id, toOrgId: distributor.user.organization.id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PARTIAL_BATCH');
  });
});

describe('database stock constraints', () => {
  it('a CHECK constraint prevents negative quantityOnHand even via direct prisma update', async () => {
    const b = await registerBatch(manufacturer, { quantity: 10 });
    await expect(prisma.medicineBatch.update({ where: { id: b.id }, data: { quantityOnHand: -1 } })).rejects.toThrow(/MedicineBatch_on_hand_range|check constraint/i);
    expect(await onHand(b.id)).toBe(10);
  });

  it('quantityOnHand can never exceed the produced quantity', async () => {
    const b = await registerBatch(manufacturer, { quantity: 10 });
    await expect(prisma.medicineBatch.update({ where: { id: b.id }, data: { quantityOnHand: 11 } })).rejects.toThrow(/MedicineBatch_on_hand_range|check constraint/i);
    await expect(prisma.medicineBatch.update({ where: { id: b.id }, data: { quantity: 0, quantityOnHand: 0 } })).rejects.toThrow(/check constraint/i);
    await expect(prisma.medicineBatch.update({ where: { id: b.id }, data: { expiryDate: new Date('2000-01-01') } })).rejects.toThrow(/MedicineBatch_dates_valid|check constraint/i);
    expect(await onHand(b.id)).toBe(10);
  });
});
