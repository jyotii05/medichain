import type { ChainOperation, EventType } from '@prisma/client';

/**
 * Which smart-contract operation anchors a given supply-chain event.
 * Events that have no contract counterpart (flags, dispensing, transfer cancellation caused by a recall)
 * are recorded only in the simulated ledger (SIMULATION mode) and stay off-chain in ONCHAIN mode —
 * they are still protected by the per-batch hash chain in PostgreSQL.
 */
export const ONCHAIN_OPERATION: Partial<Record<EventType, ChainOperation>> = {
  REGISTERED: 'REGISTER_BATCH',
  TRANSFER_INITIATED: 'INITIATE_TRANSFER',
  TRANSFER_ACCEPTED: 'ACCEPT_TRANSFER',
  TRANSFER_REJECTED: 'REJECT_TRANSFER',
  RECALLED: 'RECALL_BATCH',
  BLOCKED: 'RECALL_BATCH',
};

export function simulatedOperation(type: EventType): ChainOperation {
  return ONCHAIN_OPERATION[type] ?? 'LOG_EVENT';
}
