import type { Tx } from '../lib/prisma.js';
import { newReference } from '../lib/hash.js';
import { AppError, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { appendEvent, isValidRoute, lockBatch, NEXT_STAGE } from './events.js';
import { isExpired, type Actor } from './batches.js';
import { notifyOrg } from './notifications.js';

const ROLE_LABEL: Record<string, string> = {
  MANUFACTURER: 'manufacturer',
  DISTRIBUTOR: 'distributor',
  WHOLESALER: 'wholesaler',
  PHARMACY: 'pharmacy',
  REGULATOR: 'regulator',
};

/**
 * Starts a whole-batch custody transfer. Only the current custodian may initiate it, only to an
 * approved organization of the next stage, and only one transfer per batch may be pending.
 */
export async function initiateTransfer(
  tx: Tx,
  input: { batchId: string; toOrgId: string; notes?: string | null },
  actor: Actor,
  opts: { createdAt?: Date } = {},
) {
  await lockBatch(tx, input.batchId);
  const batch = await tx.medicineBatch.findUnique({ where: { id: input.batchId } });
  if (!batch) throw notFound('Batch');
  if (actor.org.status !== 'APPROVED') throw new AppError(403, 'ORGANIZATION_NOT_APPROVED', 'Your organization is not approved');
  if (batch.currentCustodianId !== actor.org.id) {
    throw new AppError(403, 'NOT_CUSTODIAN', 'Only the current recorded custodian can transfer this batch');
  }
  if (batch.status !== 'ACTIVE') {
    throw unprocessable('BATCH_RECALLED', 'Recalled or blocked batches cannot be transferred through the ordinary workflow');
  }
  // expiry is judged at the time of the event (the seed script records historical events)
  if (isExpired(batch.expiryDate, opts.createdAt)) throw unprocessable('BATCH_EXPIRED', 'Expired batches cannot be transferred');
  if (batch.quantityOnHand !== batch.quantity) {
    throw unprocessable('PARTIAL_BATCH', 'Only complete batches can be transferred (part of this batch has been dispensed)');
  }
  const pending = await tx.custodyTransfer.findFirst({ where: { batchId: batch.id, status: 'PENDING' }, select: { reference: true } });
  if (pending) throw new AppError(409, 'TRANSFER_PENDING', `Transfer ${pending.reference} is already pending for this batch`);

  const toOrg = await tx.organization.findUnique({ where: { id: input.toOrgId } });
  if (!toOrg) throw notFound('Recipient organization');
  if (toOrg.id === actor.org.id) throw unprocessable('INVALID_RECIPIENT', 'You cannot transfer a batch to your own organization');
  if (toOrg.status !== 'APPROVED') throw unprocessable('RECIPIENT_NOT_AUTHORIZED', `${toOrg.name} is not an approved supply-chain partner`);
  if (!isValidRoute(actor.org.type, toOrg.type)) {
    const next = NEXT_STAGE[actor.org.type];
    throw unprocessable(
      'INVALID_ROUTE',
      next
        ? `A ${ROLE_LABEL[actor.org.type]} can only transfer to a ${ROLE_LABEL[next]}`
        : `A ${ROLE_LABEL[actor.org.type]} is the final stage and cannot transfer batches onward`,
    );
  }

  const transfer = await tx.custodyTransfer.create({
    data: {
      reference: newReference('SHP'),
      batchId: batch.id,
      fromOrgId: actor.org.id,
      toOrgId: toOrg.id,
      quantity: batch.quantityOnHand,
      notes: input.notes ?? null,
      initiatedById: actor.userId,
      createdAt: opts.createdAt,
    },
  });
  await appendEvent(tx, {
    batch,
    type: 'TRANSFER_INITIATED',
    actorUserId: actor.userId,
    actorOrgId: actor.org.id,
    fromOrgId: actor.org.id,
    toOrgId: toOrg.id,
    transferId: transfer.id,
    data: { reference: transfer.reference, quantity: transfer.quantity },
    createdAt: opts.createdAt,
  });
  await notifyOrg(tx, toOrg.id, {
    severity: 'INFO',
    title: 'Incoming shipment awaiting acceptance',
    message: `${actor.org.name} sent batch ${batch.batchNumber} (${transfer.quantity} ${batch.unit}) — shipment ${transfer.reference}.`,
    link: '/app/transfers?tab=incoming',
  });
  return transfer;
}

/** Accept or reject a pending transfer. Only the intended recipient may respond, exactly once. */
export async function respondToTransfer(
  tx: Tx,
  input: { transferId: string; accept: boolean; note?: string | null },
  actor: Actor,
  opts: { createdAt?: Date } = {},
) {
  const found = await tx.custodyTransfer.findUnique({ where: { id: input.transferId }, select: { batchId: true } });
  if (!found) throw notFound('Transfer');
  await lockBatch(tx, found.batchId);
  // re-read under the lock
  const transfer = await tx.custodyTransfer.findUniqueOrThrow({ where: { id: input.transferId }, include: { batch: true, fromOrg: true } });
  if (transfer.toOrgId !== actor.org.id) throw forbidden('Only the intended recipient can respond to this transfer');
  if (actor.org.status !== 'APPROVED') throw new AppError(403, 'ORGANIZATION_NOT_APPROVED', 'Your organization is not approved');
  if (transfer.status !== 'PENDING') {
    throw new AppError(409, 'TRANSFER_ALREADY_RESOLVED', `This transfer has already been ${transfer.status.toLowerCase()}`);
  }
  const { batch } = transfer;
  if (input.accept) {
    if (batch.status !== 'ACTIVE') throw unprocessable('BATCH_RECALLED', 'This batch has been recalled or blocked and cannot be accepted');
    if (batch.currentCustodianId !== transfer.fromOrgId) {
      throw new AppError(409, 'CUSTODY_CHANGED', 'Custody of this batch changed after the transfer was created');
    }
  }
  const respondedAt = opts.createdAt ?? new Date();
  const res = await tx.custodyTransfer.updateMany({
    where: { id: transfer.id, status: 'PENDING' },
    data: {
      status: input.accept ? 'ACCEPTED' : 'REJECTED',
      respondedById: actor.userId,
      respondedAt,
      responseNote: input.note ?? null,
    },
  });
  if (res.count !== 1) throw new AppError(409, 'TRANSFER_ALREADY_RESOLVED', 'This transfer was resolved by another request');

  if (input.accept) {
    await tx.medicineBatch.update({ where: { id: batch.id }, data: { currentCustodianId: actor.org.id } });
  }
  await appendEvent(tx, {
    batch,
    type: input.accept ? 'TRANSFER_ACCEPTED' : 'TRANSFER_REJECTED',
    actorUserId: actor.userId,
    actorOrgId: actor.org.id,
    fromOrgId: transfer.fromOrgId,
    toOrgId: actor.org.id,
    transferId: transfer.id,
    data: { reference: transfer.reference, ...(input.note ? { note: input.note } : {}) },
    createdAt: opts.createdAt,
  });
  await notifyOrg(tx, transfer.fromOrgId, {
    severity: input.accept ? 'SUCCESS' : 'WARNING',
    title: input.accept ? 'Shipment accepted' : 'Shipment rejected',
    message: input.accept
      ? `${actor.org.name} accepted shipment ${transfer.reference} (batch ${batch.batchNumber}).`
      : `${actor.org.name} rejected shipment ${transfer.reference} (batch ${batch.batchNumber})${input.note ? `: ${input.note}` : '.'}`,
    link: '/app/transfers?tab=outgoing',
  });
  return tx.custodyTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
}
