import type { EventType, OrganizationType, Prisma, SupplyChainEvent } from '@prisma/client';
import type { Tx } from '../lib/prisma.js';
import { canonicalJson, GENESIS_HASH, sha256Hex } from '../lib/hash.js';
import { anchorEvent } from '../blockchain/index.js';

/** Allowed custody routes (whole-batch transfers). */
export const NEXT_STAGE: Partial<Record<OrganizationType, OrganizationType>> = {
  MANUFACTURER: 'DISTRIBUTOR',
  DISTRIBUTOR: 'WHOLESALER',
  WHOLESALER: 'PHARMACY',
};

export const STAGE_ORDER: OrganizationType[] = ['MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY'];

export function isValidRoute(from: OrganizationType, to: OrganizationType) {
  return NEXT_STAGE[from] === to;
}

interface HashableEvent {
  batchPublicId: string;
  sequence: number;
  type: EventType;
  actorUserId: string | null;
  actorOrgId: string | null;
  fromOrgId: string | null;
  toOrgId: string | null;
  transferId: string | null;
  recallId: string | null;
  data: unknown;
  createdAt: Date;
  prevHash: string;
}

/** SHA-256 over the canonical JSON of every meaningful field — any edit changes the hash. */
export function computeEventHash(e: HashableEvent): string {
  return sha256Hex(
    canonicalJson({
      batch: e.batchPublicId,
      sequence: e.sequence,
      type: e.type,
      actorUser: e.actorUserId,
      actorOrg: e.actorOrgId,
      from: e.fromOrgId,
      to: e.toOrgId,
      transfer: e.transferId,
      recall: e.recallId,
      data: e.data ?? {},
      createdAt: e.createdAt.toISOString(),
      prev: e.prevHash,
    }),
  );
}

export interface AppendEventInput {
  batch: { id: string; publicId: string };
  type: EventType;
  actorUserId?: string | null;
  actorOrgId?: string | null;
  fromOrgId?: string | null;
  toOrgId?: string | null;
  transferId?: string | null;
  recallId?: string | null;
  data?: Prisma.InputJsonObject;
  createdAt?: Date;
}

/**
 * Appends a hash-chained event to a batch's history and anchors it (simulated ledger or on-chain queue).
 * Callers must hold a row lock on the batch (lockBatch) so sequence numbers cannot race.
 */
export async function appendEvent(tx: Tx, input: AppendEventInput): Promise<SupplyChainEvent> {
  const last = await tx.supplyChainEvent.findFirst({
    where: { batchId: input.batch.id },
    orderBy: { sequence: 'desc' },
    select: { sequence: true, hash: true },
  });
  const sequence = (last?.sequence ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  // Postgres stores microseconds, JS Dates milliseconds — keep ms precision so re-hashing is exact.
  const createdAt = input.createdAt ?? new Date();
  const fields = {
    sequence,
    type: input.type,
    actorUserId: input.actorUserId ?? null,
    actorOrgId: input.actorOrgId ?? null,
    fromOrgId: input.fromOrgId ?? null,
    toOrgId: input.toOrgId ?? null,
    transferId: input.transferId ?? null,
    recallId: input.recallId ?? null,
    data: input.data ?? {},
    createdAt,
    prevHash,
  };
  const hash = computeEventHash({ ...fields, batchPublicId: input.batch.publicId });
  const event = await tx.supplyChainEvent.create({ data: { ...fields, batchId: input.batch.id, hash } });
  await anchorEvent(tx, event);
  return event;
}

/** SELECT … FOR UPDATE on the batch row: serialises all custody-changing operations per batch. */
export async function lockBatch(tx: Tx, batchId: string) {
  await tx.$queryRaw`SELECT id FROM "MedicineBatch" WHERE id = ${batchId} FOR UPDATE`;
}

export interface ChainIntegrity {
  ok: boolean;
  problems: string[];
}

/** Recomputes every event hash and link for a batch. */
export function verifyEventChain(publicId: string, events: SupplyChainEvent[]): ChainIntegrity {
  const problems: string[] = [];
  let prev = GENESIS_HASH;
  events.forEach((e, i) => {
    if (e.sequence !== i + 1) problems.push(`Event sequence gap before event #${e.sequence}`);
    if (e.prevHash !== prev) problems.push(`Event #${e.sequence} is not linked to the previous record`);
    const expected = computeEventHash({ ...e, batchPublicId: publicId });
    if (expected !== e.hash) problems.push(`Event #${e.sequence} has been altered after it was recorded`);
    prev = e.hash;
  });
  return { ok: problems.length === 0, problems };
}
