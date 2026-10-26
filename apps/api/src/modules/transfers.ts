import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { body, query, param, actorFrom, inTransaction } from '../lib/http.js';
import { notFound, forbidden } from '../lib/errors.js';
import { paged, pageArgs, paginationSchema } from '../lib/pagination.js';
import { auth, requireApprovedOrg, requireAuth, requireRole } from '../middleware/auth.js';
import { initiateTransfer, respondToTransfer } from '../services/transfers.js';
import { transferRow } from '../lib/serializers.js';
import { audit } from '../services/audit.js';
import { NEXT_STAGE } from '../services/events.js';

export const transfersRouter = Router();
transfersRouter.use(requireAuth);

const include = {
  fromOrg: true,
  toOrg: true,
  batch: { include: { medicine: true } },
  initiatedBy: { select: { fullName: true } },
  respondedBy: { select: { fullName: true } },
} satisfies Prisma.CustodyTransferInclude;

const listSchema = paginationSchema.extend({
  direction: z.enum(['incoming', 'outgoing', 'all']).default('all'),
  status: z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED']).optional(),
});

transfersRouter.get('/', async (req, res) => {
  const q = query(req, listSchema);
  const a = auth(req);
  const and: Prisma.CustodyTransferWhereInput[] = [];
  if (a.user.role !== 'REGULATOR' || q.direction !== 'all') {
    if (q.direction === 'incoming') and.push({ toOrgId: a.org.id });
    else if (q.direction === 'outgoing') and.push({ fromOrgId: a.org.id });
    else and.push({ OR: [{ toOrgId: a.org.id }, { fromOrgId: a.org.id }] });
  }
  if (q.status) and.push({ status: q.status });
  if (q.search) {
    and.push({
      OR: [
        { reference: { contains: q.search, mode: 'insensitive' } },
        { batch: { batchNumber: { contains: q.search, mode: 'insensitive' } } },
        { batch: { publicId: { contains: q.search, mode: 'insensitive' } } },
        { batch: { medicine: { name: { contains: q.search, mode: 'insensitive' } } } },
        { fromOrg: { name: { contains: q.search, mode: 'insensitive' } } },
        { toOrg: { name: { contains: q.search, mode: 'insensitive' } } },
      ],
    });
  }
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.custodyTransfer.findMany({ where, include, orderBy: { createdAt: q.order }, ...pageArgs(q) }),
    prisma.custodyTransfer.count({ where }),
  ]);
  res.json(paged(items.map(transferRow), total, q));
});

/** Organizations the current user may ship to (the next stage, approved only). */
transfersRouter.get('/recipients', async (req, res) => {
  const a = auth(req);
  const next = NEXT_STAGE[a.org.type];
  if (!next) return res.json({ items: [], nextStage: null });
  const items = await prisma.organization.findMany({
    where: { type: next, status: 'APPROVED' },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, type: true, city: true, country: true, licenseNumber: true },
  });
  res.json({ items, nextStage: next });
});

const createSchema = z.object({
  batchId: z.string().trim().min(1).max(40),
  toOrgId: z.string().trim().min(1, 'Choose a recipient').max(40),
  notes: z.string().trim().max(500).optional().nullable(),
});

transfersRouter.post('/', requireRole('MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER'), requireApprovedOrg, async (req, res) => {
  const input = body(req, createSchema);
  const transfer = await inTransaction(async (tx) => {
    const t = await initiateTransfer(tx, input, actorFrom(req));
    await audit(tx, req, 'transfer.initiated', 'CustodyTransfer', t.id, { reference: t.reference, batchId: t.batchId, toOrgId: t.toOrgId });
    return t;
  });
  const full = await prisma.custodyTransfer.findUniqueOrThrow({ where: { id: transfer.id }, include });
  res.status(201).json({ transfer: transferRow(full) });
});

transfersRouter.get('/:id', async (req, res) => {
  const a = auth(req);
  const t = await prisma.custodyTransfer.findUnique({ where: { id: param(req, 'id') }, include });
  if (!t) throw notFound('Transfer');
  if (a.user.role !== 'REGULATOR' && t.fromOrgId !== a.org.id && t.toOrgId !== a.org.id) throw notFound('Transfer');
  res.json({ transfer: transferRow(t) });
});

async function respond(req: Parameters<typeof auth>[0], accept: boolean, note: string | null) {
  const a = auth(req);
  if (a.user.role === 'REGULATOR' || a.user.role === 'MANUFACTURER') throw forbidden('Your role cannot receive custody transfers');
  const id = param(req, 'id');
  const t = await inTransaction(async (tx) => {
    const r = await respondToTransfer(tx, { transferId: id, accept, note }, actorFrom(req));
    await audit(tx, req, accept ? 'transfer.accepted' : 'transfer.rejected', 'CustodyTransfer', id, { reference: r.reference });
    return r;
  });
  return prisma.custodyTransfer.findUniqueOrThrow({ where: { id: t.id }, include });
}

transfersRouter.post('/:id/accept', requireApprovedOrg, async (req, res) => {
  const { note } = body(req, z.object({ note: z.string().trim().max(500).optional().nullable() }));
  res.json({ transfer: transferRow(await respond(req, true, note ?? null)) });
});

transfersRouter.post('/:id/reject', requireApprovedOrg, async (req, res) => {
  const { reason } = body(req, z.object({ reason: z.string().trim().min(5, 'Please give a reason (at least 5 characters)').max(500) }));
  res.json({ transfer: transferRow(await respond(req, false, reason)) });
});
