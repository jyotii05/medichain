import type { BlockchainTransaction, MedicineBatch, Organization, SupplyChainEvent } from '@prisma/client';
import { env } from '../config/env.js';
import type { Tx } from '../lib/prisma.js';
import { prisma } from '../lib/prisma.js';
import { ONCHAIN_OPERATION, simulatedOperation } from './operations.js';
import { appendSimulatedEntry, verifySimulatedEntries, verifyWholeLedger } from './simulation.js';
import { dispatchPending, onchainStatus, readBatch, shortError, verifyTransactionLog } from './onchain.js';

export const chainMode: 'SIMULATION' | 'ONCHAIN' = env.BLOCKCHAIN_MODE === 'onchain' ? 'ONCHAIN' : 'SIMULATION';

/**
 * Records the blockchain counterpart of a supply-chain event inside the caller's DB transaction.
 * - SIMULATION: appends a confirmed entry to the hash-chained simulated ledger.
 * - ONCHAIN: queues a PENDING row; the relayer submits it after commit (see flushChainQueue()).
 */
export async function anchorEvent(tx: Tx, event: SupplyChainEvent) {
  if (chainMode === 'SIMULATION') {
    return appendSimulatedEntry(tx, {
      operation: simulatedOperation(event.type),
      payloadHash: event.hash,
      batchId: event.batchId,
      eventId: event.id,
    });
  }
  const operation = ONCHAIN_OPERATION[event.type];
  if (!operation) return null; // stays off-chain (still covered by the DB hash chain)
  return tx.blockchainTransaction.create({
    data: { mode: 'ONCHAIN', operation, status: 'PENDING', batchId: event.batchId, eventId: event.id, payloadHash: event.hash },
  });
}

/** Call after a DB transaction that may have queued on-chain writes has committed. */
export function flushChainQueue() {
  if (chainMode === 'ONCHAIN') void dispatchPending().catch((e) => console.error('[blockchain] dispatch failed', e));
}

export async function chainStatus() {
  const counts = await prisma.blockchainTransaction.groupBy({ by: ['status'], where: { mode: chainMode }, _count: true });
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  const totals = { confirmed: byStatus.CONFIRMED ?? 0, pending: byStatus.PENDING ?? 0, failed: byStatus.FAILED ?? 0 };
  if (chainMode === 'SIMULATION') {
    const ledger = await verifyWholeLedger(prisma);
    return {
      mode: chainMode,
      connected: true,
      label: 'Simulation mode — tamper-evident ledger (not a real blockchain)',
      message:
        'Events are recorded in a hash-chained ledger inside PostgreSQL. This demonstrates tamper evidence but provides no decentralised consensus. Switch BLOCKCHAIN_MODE to "onchain" to anchor events to the smart contract.',
      totals,
      ledger: { entries: ledger.checked, lastSequence: ledger.lastSequence, intact: ledger.ok, problems: ledger.problems },
    };
  }
  const s = await onchainStatus();
  return {
    mode: chainMode,
    connected: s.connected,
    label: s.connected ? 'On-chain mode — MediChainRegistry smart contract' : 'On-chain mode — blockchain unavailable',
    message: s.message,
    network: s.connected ? { chainId: s.chainId, name: s.networkName, blockNumber: s.blockNumber } : undefined,
    contractAddress: s.contractAddress,
    relayerAddress: s.relayerAddress,
    relayerHasRoles: s.relayerHasRoles,
    rpcUrl: env.CHAIN_RPC_URL,
    totals,
  };
}

export interface ChainCheck {
  mode: 'SIMULATION' | 'ONCHAIN';
  available: boolean;
  /** true = consistent, false = mismatch found, null = could not be determined */
  consistent: boolean | null;
  summary: string;
  problems: string[];
  notes: string[];
  anchored: number;
  pending: number;
  failed: number;
  latest?: {
    reference: string;
    kind: 'TX_HASH' | 'SIMULATED_REF';
    blockNumber?: number | null;
    confirmedAt?: Date | null;
    logCheck?: string;
  };
}

type BatchWithCustodian = MedicineBatch & { currentCustodian: Organization };

/** Cross-checks a batch's DB event history against its blockchain / simulated-ledger anchors. */
export async function verifyBatchAnchors(batch: BatchWithCustodian, events: SupplyChainEvent[]): Promise<ChainCheck> {
  const txs = await prisma.blockchainTransaction.findMany({ where: { batchId: batch.id, mode: chainMode }, orderBy: { createdAt: 'asc' } });
  const byEvent = new Map<string, BlockchainTransaction>();
  for (const t of txs) if (t.eventId) byEvent.set(t.eventId, t);
  const problems: string[] = [];
  const notes: string[] = [];
  const pending = txs.filter((t) => t.status === 'PENDING').length;
  const failed = txs.filter((t) => t.status === 'FAILED').length;
  const anchored = txs.filter((t) => t.status === 'CONFIRMED').length;

  // Every anchor must commit to the exact hash of its event.
  for (const ev of events) {
    const t = byEvent.get(ev.id);
    if (t && t.payloadHash !== ev.hash) problems.push(`Anchored hash for event #${ev.sequence} does not match the event record`);
  }

  if (chainMode === 'SIMULATION') {
    for (const ev of events) if (!byEvent.has(ev.id)) problems.push(`Event #${ev.sequence} has no ledger entry`);
    const ledger = await verifySimulatedEntries(prisma, txs);
    problems.push(...ledger.problems);
    const last = [...txs].reverse().find((t) => t.status === 'CONFIRMED');
    return {
      mode: chainMode,
      available: true,
      consistent: problems.length === 0,
      summary: problems.length === 0 ? 'Simulated ledger entries are intact and match the event history' : 'Simulated ledger does not match the event history',
      problems,
      notes: ['Simulation mode: integrity is checked against a hash-chained ledger in PostgreSQL, not a public blockchain.'],
      anchored,
      pending,
      failed,
      latest: last ? { reference: last.simulatedRef!, kind: 'SIMULATED_REF', confirmedAt: last.confirmedAt } : undefined,
    };
  }

  // ---- ONCHAIN ----
  const anchorable = events.filter((e) => ONCHAIN_OPERATION[e.type]);
  const confirmedEvents = anchorable.filter((e) => byEvent.get(e.id)?.status === 'CONFIRMED');
  const latestConfirmed = confirmedEvents[confirmedEvents.length - 1];
  if (pending) notes.push(`${pending} event(s) are waiting to be written to the blockchain`);
  if (failed) notes.push(`${failed} blockchain write(s) failed and need a retry by a regulator`);
  const missing = anchorable.filter((e) => !byEvent.has(e.id));
  if (missing.length) notes.push(`${missing.length} event(s) were recorded before on-chain mode was enabled and have no on-chain anchor`);

  let state;
  try {
    state = await readBatch(batch.chainRef);
  } catch (e) {
    return {
      mode: chainMode,
      available: false,
      consistent: null,
      summary: 'Blockchain verification unavailable — the node or contract could not be reached',
      problems,
      notes: [...notes, shortError(e)],
      anchored,
      pending,
      failed,
    };
  }

  if (!latestConfirmed) {
    if (state.registered) problems.push('Batch is registered on-chain but no confirmed anchor exists in the database');
    return {
      mode: chainMode,
      available: true,
      consistent: problems.length ? false : null,
      summary: problems.length ? 'On-chain record does not match' : 'This batch has not been anchored on-chain yet',
      problems,
      notes,
      anchored,
      pending,
      failed,
    };
  }

  if (!state.registered) problems.push('Batch is not registered on-chain although a confirmed anchor is recorded');
  if (state.lastEventHash.toLowerCase() !== latestConfirmed.hash.toLowerCase()) {
    problems.push('Latest on-chain event hash differs from the latest anchored event in the database');
  }
  if (state.dataHash.toLowerCase() !== batch.dataHash.toLowerCase()) problems.push('On-chain batch data hash differs from the database record');
  const allAnchored = anchorable.every((e) => byEvent.get(e.id)?.status === 'CONFIRMED');
  if (allAnchored && state.custodian.toLowerCase() !== batch.currentCustodian.chainRef.toLowerCase()) {
    problems.push('On-chain custodian differs from the recorded current custodian');
  }
  if (allAnchored && (batch.status === 'RECALLED' || batch.status === 'BLOCKED') !== (state.status === 'RECALLED')) {
    problems.push('On-chain recall status differs from the database');
  }

  const latestTx = byEvent.get(latestConfirmed.id)!;
  let logCheck: string | undefined;
  if (latestTx.txHash) {
    try {
      const r = await verifyTransactionLog(latestTx.txHash, latestConfirmed.hash);
      logCheck = r.message;
      if (r.found && !r.matches) problems.push('Latest transaction log does not carry the expected event hash');
    } catch (e) {
      notes.push(`Could not re-read transaction log: ${shortError(e)}`);
    }
  }

  return {
    mode: chainMode,
    available: true,
    consistent: problems.length === 0,
    summary: problems.length === 0 ? 'On-chain record matches the recorded custody history' : 'On-chain record does not match the database',
    problems,
    notes,
    anchored,
    pending,
    failed,
    latest: { reference: latestTx.txHash!, kind: 'TX_HASH', blockNumber: latestTx.blockNumber, confirmedAt: latestTx.confirmedAt, logCheck },
  };
}

export { verifyTransactionLog };
