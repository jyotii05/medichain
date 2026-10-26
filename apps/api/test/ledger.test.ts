import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, freshBase, login, moveBatch, prisma, registerBatch, type Session } from './helpers.js';
import { ledgerEntryHash } from '../src/blockchain/simulation.js';

let regulator: Session;
let manufacturer: Session;
let distributor: Session;
let summit: Session;

beforeAll(async () => {
  await freshBase();
  [regulator, manufacturer, distributor, summit] = await Promise.all(['regulator', 'manufacturer', 'distributor', 'summit'].map((u) => login(u)));
  const b1 = await registerBatch(manufacturer);
  await moveBatch(manufacturer, distributor, b1.id);
  const b2 = await registerBatch(manufacturer);
  await manufacturer.post('/api/transfers', { batchId: b2.id, toOrgId: summit.user.organization.id });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const GENESIS = `0x${'0'.repeat(64)}`;

describe('simulated ledger', () => {
  it('entries are sequential, hash-linked and labelled as simulated', async () => {
    const rows = await prisma.blockchainTransaction.findMany({ where: { mode: 'SIMULATION' }, orderBy: { ledgerSequence: 'asc' } });
    expect(rows.length).toBe(5); // REGISTERED, INITIATED, ACCEPTED + REGISTERED, INITIATED
    rows.forEach((r, i) => {
      expect(r.ledgerSequence).toBe(i + 1);
      expect(r.prevLedgerHash).toBe(i === 0 ? GENESIS : rows[i - 1].ledgerHash);
      expect(r.ledgerHash).toBe(
        ledgerEntryHash({ sequence: r.ledgerSequence!, prevLedgerHash: r.prevLedgerHash!, operation: r.operation, payloadHash: r.payloadHash }),
      );
      expect(r.simulatedRef).toBe(`SIM-${String(i + 1).padStart(6, '0')}-${r.ledgerHash!.slice(2, 10).toUpperCase()}`);
      expect(r.txHash).toBeNull();
      expect(r.blockNumber).toBeNull();
      expect(r.status).toBe('CONFIRMED');
    });
    expect(rows.map((r) => r.operation)).toEqual(['REGISTER_BATCH', 'INITIATE_TRANSFER', 'ACCEPT_TRANSFER', 'REGISTER_BATCH', 'INITIATE_TRANSFER']);
  });

  it('GET /api/blockchain/ledger/verify (regulator) → ok: true', async () => {
    const res = await regulator.get('/api/blockchain/ledger/verify');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, checked: 5, problems: [], lastSequence: 5 });
  });

  it('ledger/verify is regulator-only', async () => {
    expect((await manufacturer.get('/api/blockchain/ledger/verify')).status).toBe(403);
    expect((await request(app).get('/api/blockchain/ledger/verify')).status).toBe(401);
  });

  it('public status endpoint reports simulation mode and an intact ledger', async () => {
    const res = await request(app).get('/api/blockchain/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: 'SIMULATION', connected: true, ledger: { entries: 5, lastSequence: 5, intact: true } });
    expect(res.body.label).toMatch(/not a real blockchain/i);
  });

  it('parallel writes keep the ledger gap-free', async () => {
    await Promise.all(Array.from({ length: 6 }, () => registerBatch(manufacturer)));
    const res = await regulator.get('/api/blockchain/ledger/verify');
    expect(res.body).toMatchObject({ ok: true, checked: 11, lastSequence: 11 });
  });

  it('POST /api/blockchain/transactions/:id/verify → verified: true for an intact entry', async () => {
    const t = await prisma.blockchainTransaction.findFirstOrThrow({ where: { ledgerSequence: 2 } });
    const res = await regulator.post(`/api/blockchain/transactions/${t.id}/verify`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: 'SIMULATION', verified: true });
    // the manufacturer that owns the batch may verify it too; an unrelated distributor may not see it
    expect((await manufacturer.post(`/api/blockchain/transactions/${t.id}/verify`)).body.verified).toBe(true);
    const other = await login('riverside');
    expect((await other.post(`/api/blockchain/transactions/${t.id}/verify`)).status).toBe(404);
  });

  it('GET /api/blockchain/transactions is scoped for partners', async () => {
    const reg = await regulator.get('/api/blockchain/transactions?pageSize=100');
    expect(reg.body.total).toBe(11);
    expect(reg.body.mode).toBe('SIMULATION');
    const sm = await summit.get('/api/blockchain/transactions?pageSize=100');
    // summit only received one pending shipment: that batch's REGISTERED + INITIATED entries
    expect(sm.body.total).toBe(2);
  });

  it('tampering with a ledgerHash makes ledger/verify ok:false and the entry fails verification', async () => {
    const t = await prisma.blockchainTransaction.findFirstOrThrow({ where: { ledgerSequence: 3 } });
    await prisma.blockchainTransaction.update({ where: { id: t.id }, data: { ledgerHash: `0x${'f'.repeat(64)}` } });

    const res = await regulator.get('/api/blockchain/ledger/verify');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.problems.some((p: string) => p.includes(t.simulatedRef!) && /hash mismatch/.test(p))).toBe(true);
    // the next entry no longer links to it
    const next = await prisma.blockchainTransaction.findFirstOrThrow({ where: { ledgerSequence: 4 } });
    expect(res.body.problems.some((p: string) => p.includes(next.simulatedRef!) && /not linked/.test(p))).toBe(true);

    const single = await regulator.post(`/api/blockchain/transactions/${t.id}/verify`);
    expect(single.body.verified).toBe(false);
    const nextCheck = await regulator.post(`/api/blockchain/transactions/${next.id}/verify`);
    expect(nextCheck.body.verified).toBe(false);

    // and the affected batch is no longer VERIFIED
    const batch = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: t.batchId! } });
    const v = await request(app).get(`/api/verify/${batch.publicId}`);
    expect(v.body.result).toBe('SUSPICIOUS');
    expect(v.body.chain.consistent).toBe(false);

    // restore
    await prisma.blockchainTransaction.update({ where: { id: t.id }, data: { ledgerHash: t.ledgerHash } });
    expect((await regulator.get('/api/blockchain/ledger/verify')).body.ok).toBe(true);
  });

  it('changing the anchored payload hash is detected by the single-entry check', async () => {
    const t = await prisma.blockchainTransaction.findFirstOrThrow({ where: { ledgerSequence: 1 } });
    await prisma.blockchainTransaction.update({ where: { id: t.id }, data: { payloadHash: `0x${'1'.repeat(64)}` } });
    const res = await regulator.post(`/api/blockchain/transactions/${t.id}/verify`);
    expect(res.body.verified).toBe(false);
    expect((await regulator.get('/api/blockchain/ledger/verify')).body.ok).toBe(false);
    await prisma.blockchainTransaction.update({ where: { id: t.id }, data: { payloadHash: t.payloadHash } });
  });
});
