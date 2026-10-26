import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { body, query, param, actorFrom, inTransaction } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { paged, pageArgs, paginationSchema } from '../lib/pagination.js';
import { auth, requireAuth, requireRole } from '../middleware/auth.js';
import { recallBatch } from '../services/recalls.js';
import { resolveFlag } from '../services/batches.js';
import { audit } from '../services/audit.js';
import { orgRef } from '../lib/serializers.js';

export const recallsRouter = Router();
recallsRouter.use(requireAuth);

const recallInclude = {
  batch: { include: { medicine: true, manufacturer: true, currentCustodian: true } },
  initiatedBy: { select: { fullName: true } },
} satisfies Prisma.RecallRecordInclude;

type RecallWithBatch = Prisma.RecallRecordGetPayload<{ include: typeof recallInclude }>;

const recallRow = (r: RecallWithBatch) => ({
  id: r.id,
  reference: r.reference,
  action: r.action,
  classification: r.classification,
  reason: r.reason,
  createdAt: r.createdAt,
  initiatedBy: r.initiatedBy.fullName,
  batch: {
    id: r.batch.id,
    publicId: r.batch.publicId,
    batchNumber: r.batch.batchNumber,
    medicineName: r.batch.medicine.name,
    strength: r.batch.medicine.strength,
    quantity: r.batch.quantity,
    unit: r.batch.unit,
    manufacturer: orgRef(r.batch.manufacturer),
    currentCustodian: orgRef(r.batch.currentCustodian),
  },
});

/** Partners see recalls affecting batches they made or hold; regulators see all. */
function recallScope(req: Parameters<typeof auth>[0]): Prisma.RecallRecordWhereInput {
  const a = auth(req);
  if (a.user.role === 'REGULATOR') return {};
  return {
    batch: {
      OR: [
        { manufacturerId: a.org.id },
        { currentCustodianId: a.org.id },
        { transfers: { some: { OR: [{ fromOrgId: a.org.id }, { toOrgId: a.org.id }] } } },
      ],
    },
  };
}

recallsRouter.get('/', async (req, res) => {
  const q = query(req, paginationSchema.extend({ action: z.enum(['RECALL', 'BLOCK']).optional() }));
  const and: Prisma.RecallRecordWhereInput[] = [recallScope(req)];
  if (q.action) and.push({ action: q.action });
  if (q.search) {
    and.push({
      OR: [
        { reference: { contains: q.search, mode: 'insensitive' } },
        { reason: { contains: q.search, mode: 'insensitive' } },
        { batch: { batchNumber: { contains: q.search, mode: 'insensitive' } } },
        { batch: { publicId: { contains: q.search, mode: 'insensitive' } } },
        { batch: { medicine: { name: { contains: q.search, mode: 'insensitive' } } } },
      ],
    });
  }
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.recallRecord.findMany({ where, include: recallInclude, orderBy: { createdAt: q.order }, ...pageArgs(q) }),
    prisma.recallRecord.count({ where }),
  ]);
  res.json(paged(items.map(recallRow), total, q));
});

recallsRouter.get('/:id', async (req, res) => {
  const r = await prisma.recallRecord.findFirst({ where: { AND: [{ id: param(req, 'id') }, recallScope(req)] }, include: recallInclude });
  if (!r) throw notFound('Recall');
  res.json({ recall: recallRow(r) });
});

const createSchema = z.object({
  batchId: z.string().trim().min(1).max(40),
  action: z.enum(['RECALL', 'BLOCK']).default('RECALL'),
  classification: z.enum(['CLASS_I', 'CLASS_II', 'CLASS_III']),
  reason: z.string().trim().min(10, 'Please describe the reason (at least 10 characters)').max(1000),
});

recallsRouter.post('/', requireRole('REGULATOR'), async (req, res) => {
  const input = body(req, createSchema);
  const recall = await inTransaction(async (tx) => {
    const r = await recallBatch(tx, input, actorFrom(req));
    await audit(tx, req, input.action === 'BLOCK' ? 'batch.blocked' : 'batch.recalled', 'MedicineBatch', input.batchId, {
      reference: r.reference,
      classification: r.classification,
    });
    return r;
  });
  const full = await prisma.recallRecord.findUniqueOrThrow({ where: { id: recall.id }, include: recallInclude });
  res.status(201).json({ recall: recallRow(full) });
});

// ---------------- Suspicion flags (review by regulators) ----------------
export const flagsRouter = Router();
flagsRouter.use(requireAuth, requireRole('REGULATOR'));

flagsRouter.get('/', async (req, res) => {
  const q = query(req, paginationSchema.extend({ status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED']).optional() }));
  const where: Prisma.BatchFlagWhereInput = q.status ? { status: q.status } : {};
  const [items, total] = await Promise.all([
    prisma.batchFlag.findMany({
      where,
      include: { batch: { include: { medicine: true } }, org: true, raisedBy: { select: { fullName: true } }, resolvedBy: { select: { fullName: true } } },
      orderBy: { createdAt: q.order },
      ...pageArgs(q),
    }),
    prisma.batchFlag.count({ where }),
  ]);
  res.json(
    paged(
      items.map((f) => ({
        id: f.id,
        reason: f.reason,
        status: f.status,
        resolution: f.resolution,
        createdAt: f.createdAt,
        resolvedAt: f.resolvedAt,
        org: orgRef(f.org),
        raisedBy: f.raisedBy.fullName,
        resolvedBy: f.resolvedBy?.fullName ?? null,
        batch: { id: f.batch.id, publicId: f.batch.publicId, batchNumber: f.batch.batchNumber, medicineName: f.batch.medicine.name, status: f.batch.status },
      })),
      total,
      q,
    ),
  );
});

flagsRouter.post('/:id/resolve', async (req, res) => {
  const input = body(
    req,
    z.object({ outcome: z.enum(['RESOLVED', 'DISMISSED']), resolution: z.string().trim().min(5, 'Please add a short resolution note').max(1000) }),
  );
  const id = param(req, 'id');
  const flag = await inTransaction(async (tx) => {
    const f = await resolveFlag(tx, id, input.outcome, input.resolution, actorFrom(req));
    await audit(tx, req, 'flag.resolved', 'BatchFlag', id, { outcome: input.outcome });
    return f;
  });
  res.json({ flag });
});
