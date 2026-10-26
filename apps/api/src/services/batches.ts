import type { BatchStatus, MedicineBatch, Organization, Prisma } from '@prisma/client';
import type { AuthContext } from '../middleware/auth.js';
import type { Tx } from '../lib/prisma.js';
import { canonicalJson, batchChainRef, keccakText, newPublicBatchId } from '../lib/hash.js';
import { AppError, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { appendEvent, lockBatch } from './events.js';
import { notifyOrg, notifyRegulators } from './notifications.js';

export type DisplayStatus = 'ACTIVE' | 'IN_TRANSIT' | 'RECALLED' | 'BLOCKED' | 'EXPIRED';

export function startOfTodayUtc(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function isExpired(expiryDate: Date, now = new Date()) {
  // A batch is usable through its expiry date and expired from the following day.
  return expiryDate.getTime() < startOfTodayUtc(now).getTime();
}

export function displayStatus(b: { status: BatchStatus; expiryDate: Date }, hasPendingTransfer: boolean, now = new Date()): DisplayStatus {
  if (b.status === 'RECALLED') return 'RECALLED';
  if (b.status === 'BLOCKED') return 'BLOCKED';
  if (isExpired(b.expiryDate, now)) return 'EXPIRED';
  if (hasPendingTransfer) return 'IN_TRANSIT';
  return 'ACTIVE';
}

/** Which batches a user may see. Regulators see everything; partners see batches they made, hold or handled. */
export function batchScope(a: AuthContext): Prisma.MedicineBatchWhereInput {
  if (a.user.role === 'REGULATOR') return {};
  const org = a.org.id;
  return {
    OR: [
      { manufacturerId: org },
      { currentCustodianId: org },
      { transfers: { some: { OR: [{ fromOrgId: org }, { toOrgId: org }] } } },
    ],
  };
}

export function batchDataHash(b: {
  publicId: string;
  batchNumber: string;
  manufacturerId: string;
  manufacturerLicense: string;
  medicine: { name: string; genericName: string; strength: string };
  manufactureDate: Date;
  expiryDate: Date;
  quantity: number;
  unit: string;
}) {
  return keccakText(
    canonicalJson({
      publicId: b.publicId,
      batchNumber: b.batchNumber,
      manufacturer: b.manufacturerId,
      license: b.manufacturerLicense,
      medicine: b.medicine,
      manufactureDate: b.manufactureDate.toISOString().slice(0, 10),
      expiryDate: b.expiryDate.toISOString().slice(0, 10),
      quantity: b.quantity,
      unit: b.unit,
    }),
  );
}

export interface RegisterBatchInput {
  medicine: {
    name: string;
    genericName: string;
    category: string;
    dosageForm?: string | null;
    strength?: string | null;
    description?: string | null;
    packagingRef?: string | null;
  };
  batchNumber: string;
  manufacturerLicense: string;
  manufactureDate: Date;
  expiryDate: Date;
  quantity: number;
  unit: string;
  storageConditions: string;
  notes?: string | null;
}

export interface Actor {
  userId: string;
  org: Pick<Organization, 'id' | 'type' | 'status' | 'licenseNumber' | 'name'>;
}

/** Core batch registration (business rules shared by the API and the seed script). */
export async function registerBatch(tx: Tx, input: RegisterBatchInput, actor: Actor, opts: { createdAt?: Date; isDemo?: boolean } = {}) {
  if (actor.org.type !== 'MANUFACTURER') throw forbidden('Only manufacturers can register medicine batches');
  if (actor.org.status !== 'APPROVED') {
    throw new AppError(403, 'ORGANIZATION_NOT_APPROVED', 'Your manufacturer registration must be approved by the regulator first');
  }
  if (input.manufacturerLicense.trim().toUpperCase() !== actor.org.licenseNumber.toUpperCase()) {
    throw unprocessable('LICENSE_MISMATCH', 'The manufacturer licence does not match the licence on record for your organization');
  }
  if (input.expiryDate <= input.manufactureDate) {
    throw unprocessable('INVALID_DATES', 'Expiry date must be after the manufacturing date');
  }
  const batchNumber = input.batchNumber.trim().toUpperCase();
  const duplicate = await tx.medicineBatch.findUnique({
    where: { manufacturerId_batchNumber: { manufacturerId: actor.org.id, batchNumber } },
    select: { id: true },
  });
  if (duplicate) throw new AppError(409, 'DUPLICATE_BATCH', `Batch number ${batchNumber} is already registered by your organization`);

  const m = input.medicine;
  const strength = m.strength?.trim() ?? '';
  const medicine = await tx.medicine.upsert({
    where: {
      manufacturerId_name_genericName_strength: { manufacturerId: actor.org.id, name: m.name.trim(), genericName: m.genericName.trim(), strength },
    },
    update: {
      category: m.category,
      dosageForm: m.dosageForm ?? undefined,
      description: m.description ?? undefined,
      packagingRef: m.packagingRef ?? undefined,
    },
    create: {
      manufacturerId: actor.org.id,
      name: m.name.trim(),
      genericName: m.genericName.trim(),
      strength,
      category: m.category,
      dosageForm: m.dosageForm ?? null,
      description: m.description ?? null,
      packagingRef: m.packagingRef ?? null,
    },
  });

  // Collision on a 60-bit random id is astronomically unlikely, but retry defensively.
  let publicId = newPublicBatchId();
  for (let i = 0; i < 3 && (await tx.medicineBatch.findUnique({ where: { publicId }, select: { id: true } })); i++) publicId = newPublicBatchId();

  const dataHash = batchDataHash({
    publicId,
    batchNumber,
    manufacturerId: actor.org.id,
    manufacturerLicense: actor.org.licenseNumber,
    medicine: { name: medicine.name, genericName: medicine.genericName, strength: medicine.strength },
    manufactureDate: input.manufactureDate,
    expiryDate: input.expiryDate,
    quantity: input.quantity,
    unit: input.unit,
  });

  const batch = await tx.medicineBatch.create({
    data: {
      publicId,
      batchNumber,
      medicineId: medicine.id,
      manufacturerId: actor.org.id,
      manufacturerLicense: actor.org.licenseNumber,
      manufactureDate: input.manufactureDate,
      expiryDate: input.expiryDate,
      quantity: input.quantity,
      quantityOnHand: input.quantity,
      unit: input.unit,
      storageConditions: input.storageConditions,
      notes: input.notes ?? null,
      currentCustodianId: actor.org.id,
      registeredById: actor.userId,
      chainRef: batchChainRef(publicId),
      dataHash,
      isDemo: opts.isDemo ?? false,
      createdAt: opts.createdAt,
    },
  });

  await appendEvent(tx, {
    batch,
    type: 'REGISTERED',
    actorUserId: actor.userId,
    actorOrgId: actor.org.id,
    toOrgId: actor.org.id,
    data: { batchNumber, quantity: input.quantity, unit: input.unit, dataHash },
    createdAt: opts.createdAt,
  });
  return batch;
}

/** Pharmacy records units dispensed to patients. Never allows negative stock. */
export async function dispenseFromBatch(tx: Tx, batchId: string, quantity: number, actor: Actor) {
  await lockBatch(tx, batchId);
  const batch = await tx.medicineBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound('Batch');
  if (actor.org.type !== 'PHARMACY') throw forbidden('Only pharmacies record dispensing');
  if (batch.currentCustodianId !== actor.org.id) throw forbidden('This batch is not in your custody');
  if (batch.status !== 'ACTIVE') throw unprocessable('BATCH_RECALLED', 'This batch has been recalled or blocked and must not be dispensed');
  if (isExpired(batch.expiryDate)) throw unprocessable('BATCH_EXPIRED', 'This batch has expired and must not be dispensed');
  if (quantity > batch.quantityOnHand) {
    throw unprocessable('INSUFFICIENT_STOCK', `Only ${batch.quantityOnHand} ${batch.unit} remain in this batch`);
  }
  const remaining = batch.quantityOnHand - quantity;
  const updated = await tx.medicineBatch.update({ where: { id: batchId }, data: { quantityOnHand: remaining } });
  await appendEvent(tx, {
    batch,
    type: 'DISPENSED',
    actorUserId: actor.userId,
    actorOrgId: actor.org.id,
    data: { quantity, remaining },
  });
  return updated;
}

/** Any partner that has handled a batch can flag it for regulatory review. */
export async function flagBatch(tx: Tx, batch: MedicineBatch, reason: string, actor: Actor) {
  await lockBatch(tx, batch.id);
  const existing = await tx.batchFlag.findFirst({ where: { batchId: batch.id, orgId: actor.org.id, status: 'OPEN' } });
  if (existing) throw new AppError(409, 'FLAG_EXISTS', 'Your organization already has an open flag on this batch');
  const flag = await tx.batchFlag.create({ data: { batchId: batch.id, raisedById: actor.userId, orgId: actor.org.id, reason } });
  await appendEvent(tx, {
    batch,
    type: 'FLAGGED',
    actorUserId: actor.userId,
    actorOrgId: actor.org.id,
    data: { flagId: flag.id, reasonHash: keccakText(reason) },
  });
  await notifyRegulators(tx, {
    severity: 'WARNING',
    title: 'Batch flagged as suspicious',
    message: `${actor.org.name} flagged batch ${batch.batchNumber} (${batch.publicId}) for review.`,
    link: `/app/batches/${batch.id}`,
  });
  return flag;
}

export async function resolveFlag(tx: Tx, flagId: string, outcome: 'RESOLVED' | 'DISMISSED', resolution: string, actor: Actor) {
  const flag = await tx.batchFlag.findUnique({ where: { id: flagId }, include: { batch: true } });
  if (!flag) throw notFound('Flag');
  await lockBatch(tx, flag.batchId);
  if (flag.status !== 'OPEN') throw new AppError(409, 'FLAG_CLOSED', 'This flag has already been closed');
  const updated = await tx.batchFlag.update({
    where: { id: flagId },
    data: { status: outcome, resolution, resolvedById: actor.userId, resolvedAt: new Date() },
  });
  await appendEvent(tx, {
    batch: flag.batch,
    type: 'FLAG_RESOLVED',
    actorUserId: actor.userId,
    actorOrgId: actor.org.id,
    data: { flagId, outcome },
  });
  await notifyOrg(tx, flag.orgId, {
    severity: 'INFO',
    title: `Flag ${outcome.toLowerCase()}`,
    message: `The regulator ${outcome.toLowerCase()} your flag on batch ${flag.batch.batchNumber}: ${resolution}`,
    link: `/app/batches/${flag.batchId}`,
  });
  return updated;
}
