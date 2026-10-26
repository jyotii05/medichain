import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { body, query, param, actorFrom, inTransaction } from '../lib/http.js';
import { notFound, forbidden } from '../lib/errors.js';
import { paged, pageArgs, paginationSchema, sortKey } from '../lib/pagination.js';
import { auth, requireApprovedOrg, requireAuth, requireRole } from '../middleware/auth.js';
import { batchScope, dispenseFromBatch, flagBatch, registerBatch, startOfTodayUtc } from '../services/batches.js';
import { initiateTransfer } from '../services/transfers.js';
import { assessBatch, loadBatchForAssessment } from '../services/assessment.js';
import { batchRow, eventRows, orgRef, transferRow } from '../lib/serializers.js';
import { audit } from '../services/audit.js';
import { env } from '../config/env.js';

export const batchesRouter = Router();
batchesRouter.use(requireAuth);

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');

const text = (max: number) => z.string().trim().min(1, 'Required').max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const createBatchSchema = z
  .object({
    medicine: z.object({
      name: text(120),
      genericName: text(120),
      category: text(60),
      dosageForm: optionalText(60),
      strength: optionalText(60),
      description: optionalText(1000),
      packagingRef: optionalText(120),
    }),
    batchNumber: z
      .string()
      .trim()
      .min(3, 'Batch number must be at least 3 characters')
      .max(40)
      .regex(/^[A-Za-z0-9][A-Za-z0-9\-/.]*$/, 'Use letters, numbers, dashes, dots or slashes only'),
    manufacturerLicense: text(60),
    manufactureDate: dateString,
    expiryDate: dateString,
    quantity: z.coerce.number().int('Quantity must be a whole number').positive('Quantity must be greater than zero').max(100_000_000),
    unit: text(30),
    storageConditions: text(200),
    notes: optionalText(1000),
    initialRecipientId: z.string().trim().max(40).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    const today = startOfTodayUtc();
    if (v.manufactureDate > today) ctx.addIssue({ code: 'custom', path: ['manufactureDate'], message: 'Manufacturing date cannot be in the future' });
    if (v.expiryDate <= v.manufactureDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry date must be after the manufacturing date' });
    if (v.expiryDate <= today) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Cannot register a batch that has already expired' });
  });

const listSchema = paginationSchema.extend({
  status: z.enum(['ACTIVE', 'IN_TRANSIT', 'RECALLED', 'BLOCKED', 'EXPIRED', 'EXPIRING']).optional(),
  scope: z.enum(['all', 'custody']).default('all'),
});

function statusFilter(status: z.infer<typeof listSchema>['status']): Prisma.MedicineBatchWhereInput {
  const today = startOfTodayUtc();
  switch (status) {
    case 'RECALLED':
      return { status: 'RECALLED' };
    case 'BLOCKED':
      return { status: 'BLOCKED' };
    case 'EXPIRED':
      return { status: 'ACTIVE', expiryDate: { lt: today } };
    case 'EXPIRING':
      return { status: 'ACTIVE', expiryDate: { gte: today, lte: new Date(today.getTime() + 90 * 86400_000) } };
    case 'IN_TRANSIT':
      return { status: 'ACTIVE', expiryDate: { gte: today }, transfers: { some: { status: 'PENDING' } } };
    case 'ACTIVE':
      return { status: 'ACTIVE', expiryDate: { gte: today }, transfers: { none: { status: 'PENDING' } } };
    default:
      return {};
  }
}

const batchInclude = {
  medicine: true,
  manufacturer: true,
  currentCustodian: true,
  transfers: { where: { status: 'PENDING' as const } },
} satisfies Prisma.MedicineBatchInclude;

batchesRouter.get('/', async (req, res) => {
  const q = query(req, listSchema);
  const a = auth(req);
  const and: Prisma.MedicineBatchWhereInput[] = [batchScope(a), statusFilter(q.status)];
  if (q.scope === 'custody') and.push({ currentCustodianId: a.org.id });
  if (q.search) {
    and.push({
      OR: [
        { publicId: { contains: q.search, mode: 'insensitive' } },
        { batchNumber: { contains: q.search, mode: 'insensitive' } },
        { medicine: { name: { contains: q.search, mode: 'insensitive' } } },
        { medicine: { genericName: { contains: q.search, mode: 'insensitive' } } },
        { manufacturer: { name: { contains: q.search, mode: 'insensitive' } } },
      ],
    });
  }
  const where: Prisma.MedicineBatchWhereInput = { AND: and };
  const sort = sortKey(q.sort, ['createdAt', 'expiryDate', 'batchNumber', 'medicine', 'quantity'] as const, 'createdAt');
  const orderBy: Prisma.MedicineBatchOrderByWithRelationInput =
    sort === 'medicine' ? { medicine: { name: q.order } } : { [sort]: q.order };
  const [items, total] = await Promise.all([
    prisma.medicineBatch.findMany({ where, include: batchInclude, orderBy, ...pageArgs(q) }),
    prisma.medicineBatch.count({ where }),
  ]);
  res.json(paged(items.map(batchRow), total, q));
});

batchesRouter.post('/', requireRole('MANUFACTURER'), requireApprovedOrg, async (req, res) => {
  const input = body(req, createBatchSchema);
  const actor = actorFrom(req);
  const result = await inTransaction(async (tx) => {
    const batch = await registerBatch(tx, input, actor);
    let transfer = null;
    if (input.initialRecipientId) {
      transfer = await initiateTransfer(tx, { batchId: batch.id, toOrgId: input.initialRecipientId, notes: 'Initial distribution' }, actor);
    }
    await audit(tx, req, 'batch.registered', 'MedicineBatch', batch.id, { publicId: batch.publicId, batchNumber: batch.batchNumber });
    return { batch, transfer };
  });
  const full = await prisma.medicineBatch.findUniqueOrThrow({ where: { id: result.batch.id }, include: batchInclude });
  res.status(201).json({
    batch: batchRow(full),
    verificationUrl: `${env.PUBLIC_APP_URL}/verify/${full.publicId}`,
    transfer: result.transfer ? { id: result.transfer.id, reference: result.transfer.reference } : null,
  });
});

async function loadVisibleBatch(req: Parameters<typeof auth>[0]) {
  const id = param(req, 'id');
  const a = auth(req);
  const found = await prisma.medicineBatch.findFirst({
    where: { AND: [{ OR: [{ id }, { publicId: id.toUpperCase() }] }, batchScope(a)] },
    select: { id: true },
  });
  if (!found) throw notFound('Batch');
  return found.id;
}

batchesRouter.get('/:id', async (req, res) => {
  const id = await loadVisibleBatch(req);
  const a = auth(req);
  const batch = await loadBatchForAssessment({ id });
  if (!batch) throw notFound('Batch');
  const assessment = await assessBatch(batch);
  const [recentTransfers, flags] = await Promise.all([
    prisma.custodyTransfer.findMany({
      where: { batchId: id },
      orderBy: { createdAt: 'desc' },
      include: { fromOrg: true, toOrg: true, batch: { include: { medicine: true } }, initiatedBy: true, respondedBy: true },
    }),
    prisma.batchFlag.findMany({ where: { batchId: id }, orderBy: { createdAt: 'desc' }, include: { org: true, raisedBy: true } }),
  ]);
  const isCustodian = batch.currentCustodianId === a.org.id;
  const pending = batch.transfers[0];
  res.json({
    batch: {
      ...batchRow(batch),
      manufacturerLicense: batch.manufacturerLicense,
      storageConditions: batch.storageConditions,
      notes: batch.notes,
      medicine: { ...batch.medicine },
      chainRef: batch.chainRef,
      dataHash: batch.dataHash,
      verificationUrl: `${env.PUBLIC_APP_URL}/verify/${batch.publicId}`,
    },
    assessment: {
      result: assessment.result,
      headline: assessment.headline,
      reasons: assessment.reasons,
      checks: assessment.checks,
      chain: assessment.chain,
    },
    journey: assessment.journey,
    events: eventRows(assessment, 'partner'),
    transfers: recentTransfers.map(transferRow),
    recalls: batch.recalls,
    flags: flags.map((f) => ({
      id: f.id,
      reason: f.reason,
      status: f.status,
      resolution: f.resolution,
      createdAt: f.createdAt,
      resolvedAt: f.resolvedAt,
      org: orgRef(f.org),
      raisedBy: f.raisedBy.fullName,
    })),
    permissions: {
      canTransfer: isCustodian && batch.status === 'ACTIVE' && !pending && a.org.type !== 'PHARMACY' && a.org.status === 'APPROVED' && assessment.displayStatus !== 'EXPIRED',
      canDispense: isCustodian && a.org.type === 'PHARMACY' && batch.status === 'ACTIVE' && assessment.displayStatus !== 'EXPIRED' && batch.quantityOnHand > 0,
      canFlag: a.org.type !== 'REGULATOR',
      canRecall: a.user.role === 'REGULATOR' && batch.status === 'ACTIVE',
    },
  });
});

batchesRouter.get('/:id/qr', async (req, res) => {
  const id = await loadVisibleBatch(req);
  const batch = await prisma.medicineBatch.findUniqueOrThrow({ where: { id }, select: { publicId: true } });
  // The QR code contains only the public verification URL with the opaque identifier.
  const url = `${env.PUBLIC_APP_URL}/verify/${batch.publicId}`;
  const format = req.query.format === 'svg' ? 'svg' : 'png';
  if (format === 'svg') {
    res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 }));
  } else {
    res.type('image/png').send(await QRCode.toBuffer(url, { errorCorrectionLevel: 'M', margin: 2, width: 512 }));
  }
});

batchesRouter.post('/:id/dispense', requireRole('PHARMACY'), requireApprovedOrg, async (req, res) => {
  const id = await loadVisibleBatch(req);
  const { quantity } = body(req, z.object({ quantity: z.coerce.number().int().positive('Quantity must be greater than zero').max(100_000_000) }));
  const updated = await inTransaction(async (tx) => {
    const b = await dispenseFromBatch(tx, id, quantity, actorFrom(req));
    await audit(tx, req, 'batch.dispensed', 'MedicineBatch', id, { quantity });
    return b;
  });
  res.json({ quantityOnHand: updated.quantityOnHand });
});

batchesRouter.post('/:id/flags', requireApprovedOrg, async (req, res) => {
  const a = auth(req);
  if (a.org.type === 'REGULATOR') throw forbidden('Regulators review flags rather than raising them — use a recall instead');
  const id = await loadVisibleBatch(req);
  const { reason } = body(req, z.object({ reason: z.string().trim().min(10, 'Please describe the concern (at least 10 characters)').max(1000) }));
  const flag = await inTransaction(async (tx) => {
    const batch = await tx.medicineBatch.findUniqueOrThrow({ where: { id } });
    const f = await flagBatch(tx, batch, reason, actorFrom(req));
    await audit(tx, req, 'batch.flagged', 'MedicineBatch', id, { flagId: f.id });
    return f;
  });
  res.status(201).json({ flag });
});
