import type { BlockchainTransaction, ChainOperation } from '@prisma/client';
import type { Db, Tx } from '../lib/prisma.js';
import { canonicalJson, GENESIS_HASH, sha256Hex } from '../lib/hash.js';

/**
 * SIMULATION MODE — a tamper-evident, hash-chained ledger stored in PostgreSQL.
 *
 * Every entry commits to the previous entry's hash, so editing or deleting any historical entry
 * breaks every later link. This demonstrates the integrity property of a blockchain, but it is NOT
 * a blockchain: there is no consensus, no independent nodes and the database operator could rebuild
 * the whole chain. Entries are therefore labelled with a "SIM-" reference and never with a tx hash.
 */
const LEDGER_LOCK_KEY = 724_001;

export function ledgerEntryHash(e: { sequence: number; prevLedgerHash: string; operation: ChainOperation; payloadHash: string }) {
  return sha256Hex(
    canonicalJson({ sequence: e.sequence, prev: e.prevLedgerHash, operation: e.operation, payload: e.payloadHash }),
  );
}

export async function appendSimulatedEntry(
  tx: Tx,
  input: { operation: ChainOperation; payloadHash: string; batchId?: string | null; eventId?: string | null; organizationId?: string | null },
) {
  // Serialise ledger appends across concurrent transactions.
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);
  const last = await tx.blockchainTransaction.findFirst({
    where: { mode: 'SIMULATION', ledgerSequence: { not: null } },
    orderBy: { ledgerSequence: 'desc' },
    select: { ledgerSequence: true, ledgerHash: true },
  });
  const sequence = (last?.ledgerSequence ?? 0) + 1;
  const prevLedgerHash = last?.ledgerHash ?? GENESIS_HASH;
  const ledgerHash = ledgerEntryHash({ sequence, prevLedgerHash, operation: input.operation, payloadHash: input.payloadHash });
  return tx.blockchainTransaction.create({
    data: {
      mode: 'SIMULATION',
      operation: input.operation,
      status: 'CONFIRMED',
      batchId: input.batchId ?? null,
      eventId: input.eventId ?? null,
      organizationId: input.organizationId ?? null,
      payloadHash: input.payloadHash,
      ledgerSequence: sequence,
      prevLedgerHash,
      ledgerHash,
      simulatedRef: `SIM-${String(sequence).padStart(6, '0')}-${ledgerHash.slice(2, 10).toUpperCase()}`,
      confirmedAt: new Date(),
    },
  });
}

export interface LedgerCheck {
  ok: boolean;
  checked: number;
  problems: string[];
}

/** Re-computes the given simulated entries and checks they link to their predecessors. */
export async function verifySimulatedEntries(db: Db, entries: BlockchainTransaction[]): Promise<LedgerCheck> {
  const problems: string[] = [];
  for (const e of entries) {
    if (e.mode !== 'SIMULATION' || e.ledgerSequence == null || !e.ledgerHash || !e.prevLedgerHash) continue;
    const expected = ledgerEntryHash({
      sequence: e.ledgerSequence,
      prevLedgerHash: e.prevLedgerHash,
      operation: e.operation,
      payloadHash: e.payloadHash,
    });
    if (expected !== e.ledgerHash) problems.push(`Ledger entry ${e.simulatedRef} does not match its recorded hash`);
    const prev =
      e.ledgerSequence === 1
        ? { ledgerHash: GENESIS_HASH }
        : await db.blockchainTransaction.findUnique({ where: { ledgerSequence: e.ledgerSequence - 1 }, select: { ledgerHash: true } });
    if (!prev || prev.ledgerHash !== e.prevLedgerHash) problems.push(`Ledger entry ${e.simulatedRef} is not linked to its predecessor`);
  }
  return { ok: problems.length === 0, checked: entries.length, problems };
}

/** Full-ledger integrity scan (used by the blockchain status page). */
export async function verifyWholeLedger(db: Db): Promise<LedgerCheck & { lastSequence: number }> {
  const rows = await db.blockchainTransaction.findMany({
    where: { mode: 'SIMULATION', ledgerSequence: { not: null } },
    orderBy: { ledgerSequence: 'asc' },
    select: { ledgerSequence: true, prevLedgerHash: true, ledgerHash: true, operation: true, payloadHash: true, simulatedRef: true },
  });
  const problems: string[] = [];
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  for (const r of rows) {
    if (r.ledgerSequence !== expectedSeq) problems.push(`Gap in ledger before entry ${r.simulatedRef}`);
    if (r.prevLedgerHash !== prevHash) problems.push(`Entry ${r.simulatedRef} is not linked to the previous entry`);
    const h = ledgerEntryHash({ sequence: r.ledgerSequence!, prevLedgerHash: r.prevLedgerHash!, operation: r.operation, payloadHash: r.payloadHash });
    if (h !== r.ledgerHash) problems.push(`Entry ${r.simulatedRef} hash mismatch`);
    prevHash = r.ledgerHash ?? '';
    expectedSeq = (r.ledgerSequence ?? 0) + 1;
  }
  return { ok: problems.length === 0, checked: rows.length, problems: problems.slice(0, 20), lastSequence: expectedSeq - 1 };
}
