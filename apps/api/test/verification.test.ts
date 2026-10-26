import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, login, moveBatch, prisma, registerBatch, resetDb, seedDemoSamples, type Session } from './helpers.js';

let manufacturer: Session;
let distributor: Session;
let wholesaler: Session;
let pharmacy: Session;

beforeAll(async () => {
  await resetDb();
  const r = await seedDemoSamples();
  expect(r.skipped).toBe(false);
  [manufacturer, distributor, wholesaler, pharmacy] = await Promise.all(['manufacturer', 'distributor', 'wholesaler', 'pharmacy'].map((u) => login(u)));
});

afterAll(async () => {
  await prisma.$disconnect();
});

const verify = (code: string) => request(app).get(`/api/verify/${encodeURIComponent(code)}`);
const sampleBatch = (batchNumber: string) => prisma.medicineBatch.findFirstOrThrow({ where: { batchNumber } });

/** A freshly registered batch that has travelled the full, valid route to a pharmacy. */
async function deliveredBatch() {
  const b = await registerBatch(manufacturer);
  await moveBatch(manufacturer, distributor, b.id);
  await moveBatch(distributor, wholesaler, b.id);
  await moveBatch(wholesaler, pharmacy, b.id);
  return b;
}

describe('GET /api/verify/:code (public)', () => {
  it('a consistent batch → VERIFIED with journey and no reasons', async () => {
    const b = await deliveredBatch();
    const res = await verify(b.publicId);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('VERIFIED');
    expect(res.body.reasons).toEqual([]);
    expect(res.body.queriedId).toBe(b.publicId);
    expect(res.body.batch).toMatchObject({ publicId: b.publicId, status: 'ACTIVE', currentCustodian: { type: 'PHARMACY' } });
    expect(res.body.journey.map((s: { role: string; status: string }) => `${s.role}:${s.status}`)).toEqual([
      'MANUFACTURER:completed',
      'DISTRIBUTOR:completed',
      'WHOLESALER:completed',
      'PHARMACY:current',
    ]);
    expect(res.body.journey.every((s: { anchor: { kind: string } | null }) => s.anchor?.kind === 'SIMULATED_REF')).toBe(true);
    expect(res.body.checks.every((c: { status: string }) => c.status === 'pass')).toBe(true);
    expect(res.body.chain).toMatchObject({ mode: 'SIMULATION', consistent: true });
    expect(res.body.recall).toBeNull();
    expect(res.body.disclaimer).toBeTruthy();
  });

  it('accepts a lower-case identifier', async () => {
    const b = await registerBatch(manufacturer);
    const res = await verify(b.publicId.toLowerCase());
    expect(res.body.result).toBe('VERIFIED');
    expect(res.body.queriedId).toBe(b.publicId);
  });

  it('accepts a full verification URL', async () => {
    const b = await registerBatch(manufacturer);
    const res = await verify(`http://x/verify/${b.publicId}`);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('VERIFIED');
    expect(res.body.queriedId).toBe(b.publicId);
    const res2 = await verify(`https://medichain.example/verify/${b.publicId}?src=qr`);
    expect(res2.body.result).toBe('VERIFIED');
  });

  it('an unknown but well-formed id → UNKNOWN (never VERIFIED)', async () => {
    const res = await verify('MC-0000-0000-0000');
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('UNKNOWN');
    expect(res.body.batch).toBeNull();
    expect(res.body.reasons[0]).toMatch(/No batch/);
  });

  it.each(['hello', 'AMX-2026-0915', "'; DROP TABLE x; --", 'MC-IIII-OOOO-LLLL', 'x'.repeat(200)])('a malformed id %s → UNKNOWN', async (code) => {
    const res = await verify(code);
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('UNKNOWN');
    expect(res.body.batch).toBeNull();
  });

  it('an expired batch → EXPIRED', async () => {
    const metf = await sampleBatch('MTF-2023-0611');
    const res = await verify(metf.publicId);
    expect(res.body.result).toBe('EXPIRED');
    expect(res.body.batch.displayStatus).toBe('EXPIRED');
    expect(res.body.reasons.some((r: string) => /Expiry date: Expired on/.test(r))).toBe(true);
  });

  it('a recalled batch → RECALLED with recall information', async () => {
    const ator = await sampleBatch('ATV-2026-0420');
    const res = await verify(ator.publicId);
    expect(res.body.result).toBe('RECALLED');
    expect(res.body.recall).toMatchObject({
      reference: expect.stringMatching(/^RCL-\d{4}-/),
      action: 'RECALL',
      classification: 'CLASS_II',
      reason: expect.stringContaining('dissolution'),
    });
  });

  it('a regulator-blocked batch → RECALLED with action BLOCK', async () => {
    const losa = await sampleBatch('LOS-2026-0218');
    const res = await verify(losa.publicId);
    expect(res.body.result).toBe('RECALLED');
    expect(res.body.batch.status).toBe('BLOCKED');
    expect(res.body.recall.action).toBe('BLOCK');
  });

  it('a batch with an open partner flag → SUSPICIOUS (seeded and via the API)', async () => {
    const cipro = await sampleBatch('CIP-2026-0505');
    const seeded = await verify(cipro.publicId);
    expect(seeded.body.result).toBe('SUSPICIOUS');
    expect(seeded.body.reasons.some((r: string) => r.startsWith('Partner reports'))).toBe(true);

    const b = await deliveredBatch();
    expect((await verify(b.publicId)).body.result).toBe('VERIFIED');
    const flag = await pharmacy.post(`/api/batches/${b.id}/flags`, { reason: 'Tablets look different from the reference pack' });
    expect(flag.status).toBe(201);
    const res = await verify(b.publicId);
    expect(res.body.result).toBe('SUSPICIOUS');
    expect(res.body.reasons.some((r: string) => r.startsWith('Partner reports'))).toBe(true);
  });

  it('the seeded "incomplete journey" batch → SUSPICIOUS with a custody reason and missing stage', async () => {
    const insu = await sampleBatch('INS-2026-0077');
    const res = await verify(insu.publicId);
    expect(res.body.result).toBe('SUSPICIOUS');
    expect(res.body.reasons.some((r: string) => r.startsWith('Custody history'))).toBe(true);
    expect(res.body.journey.some((s: { status: string; role: string }) => s.status === 'missing' && s.role === 'WHOLESALER')).toBe(true);
  });
});

describe('tamper detection', () => {
  it('changing currentCustodianId directly in the DB → SUSPICIOUS with a custody reason', async () => {
    const b = await registerBatch(manufacturer);
    await moveBatch(manufacturer, distributor, b.id);
    expect((await verify(b.publicId)).body.result).toBe('VERIFIED');

    await prisma.medicineBatch.update({ where: { id: b.id }, data: { currentCustodianId: pharmacy.user.organization.id } });
    const res = await verify(b.publicId);
    expect(res.body.result).toBe('SUSPICIOUS');
    expect(res.body.reasons.some((r: string) => r.startsWith('Custody history') && /not supported by the recorded transfer history/.test(r))).toBe(true);
    expect(res.body.journey.some((s: { status: string }) => s.status === 'unrecorded')).toBe(true);
  });

  it('supply-chain events are append-only: UPDATE and DELETE are rejected by the database', async () => {
    const b = await registerBatch(manufacturer);
    const ev = await prisma.supplyChainEvent.findFirstOrThrow({ where: { batchId: b.id } });
    await expect(prisma.supplyChainEvent.update({ where: { id: ev.id }, data: { data: { quantity: 1 } } })).rejects.toThrow(/append-only/);
    await expect(prisma.supplyChainEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`UPDATE "SupplyChainEvent" SET "data" = '{}' WHERE id = $1`, ev.id)).rejects.toThrow(/append-only/);
    const after = await prisma.supplyChainEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect(after).toEqual(ev);
    // audit log too
    const log = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: 'tampered' } })).rejects.toThrow(/append-only/);
  });

  it('editing an event payload (with the trigger bypassed) → SUSPICIOUS with a record-integrity reason', async () => {
    const b = await deliveredBatch();
    expect((await verify(b.publicId)).body.result).toBe('VERIFIED');
    const ev = await prisma.supplyChainEvent.findFirstOrThrow({ where: { batchId: b.id, sequence: 1 } });

    // Simulate an attacker with table-owner rights who disables the append-only trigger.
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`ALTER TABLE "SupplyChainEvent" DISABLE TRIGGER "SupplyChainEvent_append_only"`),
      prisma.$executeRawUnsafe(`UPDATE "SupplyChainEvent" SET "data" = jsonb_set("data", '{quantity}', '999999') WHERE id = $1`, ev.id),
      prisma.$executeRawUnsafe(`ALTER TABLE "SupplyChainEvent" ENABLE TRIGGER "SupplyChainEvent_append_only"`),
    ]);
    const tampered = await prisma.supplyChainEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect((tampered.data as { quantity: number }).quantity).toBe(999999);
    // trigger is active again
    await expect(prisma.supplyChainEvent.update({ where: { id: ev.id }, data: { data: {} } })).rejects.toThrow(/append-only/);

    const res = await verify(b.publicId);
    expect(res.body.result).toBe('SUSPICIOUS');
    expect(res.body.reasons.some((r: string) => r.startsWith('Record integrity') && /#1 has been altered/.test(r))).toBe(true);
    expect(res.body.checks.find((c: { key: string }) => c.key === 'integrity').status).toBe('fail');
  });

  it('rewriting an event hash breaks the link and the ledger anchor → SUSPICIOUS', async () => {
    const b = await registerBatch(manufacturer);
    await moveBatch(manufacturer, distributor, b.id);
    const ev = await prisma.supplyChainEvent.findFirstOrThrow({ where: { batchId: b.id, sequence: 2 } });
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`ALTER TABLE "SupplyChainEvent" DISABLE TRIGGER "SupplyChainEvent_append_only"`),
      prisma.$executeRawUnsafe(`UPDATE "SupplyChainEvent" SET "hash" = $1 WHERE id = $2`, `0x${'ab'.repeat(32)}`, ev.id),
      prisma.$executeRawUnsafe(`ALTER TABLE "SupplyChainEvent" ENABLE TRIGGER "SupplyChainEvent_append_only"`),
    ]);
    const res = await verify(b.publicId);
    expect(res.body.result).toBe('SUSPICIOUS');
    expect(res.body.reasons.some((r: string) => r.startsWith('Record integrity'))).toBe(true);
    expect(res.body.chain.consistent).toBe(false);
  });

  it('a code checked suspiciously often (possible cloning) → SUSPICIOUS', async () => {
    const b = await registerBatch(manufacturer);
    await prisma.verificationAttempt.createMany({
      data: Array.from({ length: 50 }, () => ({ batchId: b.id, queriedId: b.publicId, result: 'VERIFIED' as const, channel: 'PUBLIC' as const })),
    });
    const res = await verify(b.publicId);
    expect(res.body.result).toBe('SUSPICIOUS');
    expect(res.body.reasons.some((r: string) => r.startsWith('Duplicate-use indicators'))).toBe(true);
  });

  it('a public SUSPICIOUS result alerts regulators (throttled to one alert per batch per hour)', async () => {
    const insu = await sampleBatch('INS-2026-0077');
    const regUser = await prisma.user.findUniqueOrThrow({ where: { email: 'regulator@medichain.demo' } });
    const count = () => prisma.notification.count({ where: { userId: regUser.id, title: 'Suspicious verification result', message: { contains: insu.publicId } } });
    await verify(insu.publicId);
    expect(await count()).toBe(1);
    await verify(insu.publicId);
    expect(await count()).toBe(1);
  });
});

describe('privacy', () => {
  it('every verification call records a VerificationAttempt without a raw IP', async () => {
    const b = await registerBatch(manufacturer);
    const before = await prisma.verificationAttempt.count();
    await verify(b.publicId);
    await verify('MC-ZZZZ-ZZZZ-ZZZZ');
    await verify('garbage');
    expect(await prisma.verificationAttempt.count()).toBe(before + 3);

    // (the sample seed back-dates its own attempts, some of them to later today, so select by queried id)
    const rows = await prisma.verificationAttempt.findMany({ where: { queriedId: { in: [b.publicId, 'MC-ZZZZ-ZZZZ-ZZZZ', 'GARBAGE'] } } });
    expect(rows).toHaveLength(3);
    const byQuery = Object.fromEntries(rows.map((r) => [r.queriedId, r]));
    expect(byQuery[b.publicId]).toMatchObject({ batchId: b.id, result: 'VERIFIED', channel: 'PUBLIC', userId: null });
    expect(byQuery['MC-ZZZZ-ZZZZ-ZZZZ']).toMatchObject({ batchId: null, result: 'UNKNOWN' });
    expect(byQuery['GARBAGE']).toMatchObject({ batchId: null, result: 'UNKNOWN' });
    for (const r of rows) {
      if (r.clientHash !== null) expect(r.clientHash).toMatch(/^[0-9a-f]{16}$/);
      const json = JSON.stringify(r);
      expect(json).not.toMatch(/127\.0\.0\.1|::1|::ffff/);
      expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['ip']));
    }
  });

  it('a signed-in partner verification is logged as PARTNER with the user id', async () => {
    const b = await registerBatch(manufacturer);
    const res = await manufacturer.get(`/api/verify/${b.publicId}`);
    expect(res.status).toBe(200);
    const row = await prisma.verificationAttempt.findFirstOrThrow({ where: { batchId: b.id }, orderBy: { createdAt: 'desc' } });
    expect(row.channel).toBe('PARTNER');
    expect(row.userId).toBe(manufacturer.user.id);
  });

  it('the public response does not leak user names, emails, internal ids or free-text notes', async () => {
    const b = await registerBatch(manufacturer);
    const t = await manufacturer.post('/api/transfers', { batchId: b.id, toOrgId: distributor.user.organization.id, notes: 'Private handling note' });
    await distributor.post(`/api/transfers/${t.body.transfer.id}/accept`, { note: 'Secret acceptance note' });
    const users = await prisma.user.findMany({ select: { id: true, fullName: true, email: true } });

    for (const code of [b.publicId, (await sampleBatch('INS-2026-0077')).publicId, (await sampleBatch('ATV-2026-0420')).publicId]) {
      const res = await verify(code);
      const json = JSON.stringify(res.body);
      expect(json).not.toContain('@medichain.demo');
      expect(json).not.toContain('Secret acceptance note');
      expect(json).not.toContain('Private handling note');
      for (const u of users) {
        expect(json).not.toContain(u.fullName);
        expect(json).not.toContain(u.id);
      }
      expect(json).not.toContain(b.id);
    }
  });
});
