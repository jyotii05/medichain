import type { RecallAction, RecallClass } from '@prisma/client';
import type { Tx } from '../lib/prisma.js';
import { keccakText, newReference } from '../lib/hash.js';
import { AppError, forbidden, notFound } from '../lib/errors.js';
import { appendEvent, lockBatch } from './events.js';
import type { Actor } from './batches.js';
import { notifyOrg } from './notifications.js';

/**
 * Regulatory recall / block. Cancels any pending transfer, marks the batch, records a hash-chained
 * event and alerts every organization involved. Regulators only.
 */
export async function recallBatch(
  tx: Tx,
  input: { batchId: string; action: RecallAction; classification: RecallClass; reason: string },
  actor: Actor,
  opts: { createdAt?: Date } = {},
) {
  if (actor.org.type !== 'REGULATOR') throw forbidden('Only regulators can issue recalls');
  await lockBatch(tx, input.batchId);
  const batch = await tx.medicineBatch.findUnique({ where: { id: input.batchId } });
  if (!batch) throw notFound('Batch');
  if (batch.status !== 'ACTIVE') {
    throw new AppError(409, 'ALREADY_RECALLED', `This batch is already ${batch.status.toLowerCase()}`);
  }

  const recall = await tx.recallRecord.create({
    data: {
      reference: newReference('RCL'),
      batchId: batch.id,
      action: input.action,
      classification: input.classification,
      reason: input.reason,
      initiatedById: actor.userId,
      createdAt: opts.createdAt,
    },
  });

  const pending = await tx.custodyTransfer.findFirst({ where: { batchId: batch.id, status: 'PENDING' } });
  if (pending) {
    await tx.custodyTransfer.update({
      where: { id: pending.id },
      data: { status: 'CANCELLED', respondedAt: opts.createdAt ?? new Date(), responseNote: `Cancelled by recall ${recall.reference}` },
    });
    await appendEvent(tx, {
      batch,
      type: 'TRANSFER_CANCELLED',
      actorUserId: actor.userId,
      actorOrgId: actor.org.id,
      fromOrgId: pending.fromOrgId,
      toOrgId: pending.toOrgId,
      transferId: pending.id,
      recallId: recall.id,
      data: { reference: pending.reference, cause: recall.reference },
      createdAt: opts.createdAt,
    });
  }

  await tx.medicineBatch.update({ where: { id: batch.id }, data: { status: input.action === 'BLOCK' ? 'BLOCKED' : 'RECALLED' } });
  await appendEvent(tx, {
    batch,
    type: input.action === 'BLOCK' ? 'BLOCKED' : 'RECALLED',
    actorUserId: actor.userId,
    actorOrgId: actor.org.id,
    recallId: recall.id,
    // only a hash of the reason is anchored; the readable reason stays in the database
    data: { reference: recall.reference, classification: input.classification, reasonHash: keccakText(`${input.action}:${input.reason}`) },
    createdAt: opts.createdAt,
  });

  const orgs = new Set([batch.manufacturerId, batch.currentCustodianId, ...(pending ? [pending.toOrgId] : [])]);
  for (const orgId of orgs) {
    await notifyOrg(tx, orgId, {
      severity: 'CRITICAL',
      title: input.action === 'BLOCK' ? 'Batch blocked by regulator' : 'Batch recalled',
      message: `Batch ${batch.batchNumber} (${batch.publicId}) — ${recall.reference}: ${input.reason}`,
      link: `/app/batches/${batch.id}`,
    });
  }
  return recall;
}
