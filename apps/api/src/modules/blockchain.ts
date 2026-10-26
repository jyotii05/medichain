import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { query, param } from '../lib/http.js';
import { notFound, badRequest } from '../lib/errors.js';
import { paged, pageArgs, paginationSchema } from '../lib/pagination.js';
import { auth, requireAuth, requireRole } from '../middleware/auth.js';
import { batchScope } from '../services/batches.js';
import { chainMode, chainStatus, flushChainQueue, verifyTransactionLog } from '../blockchain/index.js';
import { verifySimulatedEntries, verifyWholeLedger } from '../blockchain/simulation.js';
import { shortError } from '../blockchain/onchain.js';
import { chainTxRow } from '../lib/serializers.js';
import { audit } from '../services/audit.js';

export const blockchainRouter = Router();

/** Public: which mode is active and whether the chain is reachable (no secrets). */
blockchainRouter.get('/status', async (_req, res) => {
  res.json(await chainStatus());
});

blockchainRouter.use(requireAuth);

const txScope = (req: Parameters<typeof auth>[0]): Prisma.BlockchainTransactionWhereInput => {
  const a = auth(req);
  return a.user.role === 'REGULATOR' ? {} : { batch: batchScope(a) };
};

blockchainRouter.get('/transactions', async (req, res) => {
  const q = query(
    req,
    paginationSchema.extend({
      status: z.enum(['PENDING', 'CONFIRMED', 'FAILED']).optional(),
      operation: z.string().max(40).optional(),
      batchId: z.string().max(40).optional(),
    }),
  );
  const and: Prisma.BlockchainTransactionWhereInput[] = [{ mode: chainMode }, txScope(req)];
  if (q.status) and.push({ status: q.status });
  if (q.operation) and.push({ operation: q.operation as 'REGISTER_BATCH' });
  if (q.batchId) and.push({ batchId: q.batchId });
  if (q.search) {
    const ci = { contains: q.search, mode: 'insensitive' as const };
    and.push({ OR: [{ txHash: ci }, { simulatedRef: ci }, { payloadHash: ci }, { batch: { batchNumber: ci } }, { batch: { publicId: ci } }] });
  }
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.blockchainTransaction.findMany({
      where,
      include: { batch: { select: { publicId: true, batchNumber: true } } },
      orderBy: { createdAt: q.order },
      ...pageArgs(q),
    }),
    prisma.blockchainTransaction.count({ where }),
  ]);
  res.json({ ...paged(items.map(chainTxRow), total, q), mode: chainMode });
});

async function loadTx(req: Parameters<typeof auth>[0]) {
  const t = await prisma.blockchainTransaction.findFirst({
    where: { AND: [{ id: param(req, 'id') }, txScope(req)] },
    include: { batch: { select: { publicId: true, batchNumber: true } }, event: true },
  });
  if (!t) throw notFound('Blockchain record');
  return t;
}

blockchainRouter.get('/transactions/:id', async (req, res) => {
  const t = await loadTx(req);
  res.json({
    transaction: chainTxRow(t),
    event: t.event ? { id: t.event.id, type: t.event.type, sequence: t.event.sequence, hash: t.event.hash, prevHash: t.event.prevHash, createdAt: t.event.createdAt } : null,
  });
});

/** Re-verifies one record: simulated entries are re-hashed; on-chain ones are checked against the tx receipt logs. */
blockchainRouter.post('/transactions/:id/verify', async (req, res) => {
  const t = await loadTx(req);
  const eventMatches = t.event ? t.event.hash === t.payloadHash : null;
  if (t.mode === 'SIMULATION') {
    const r = await verifySimulatedEntries(prisma, [t]);
    return res.json({
      mode: t.mode,
      verified: r.ok && eventMatches !== false,
      message: r.ok
        ? eventMatches === false
          ? 'Ledger entry is intact, but the linked event record has changed since it was anchored'
          : 'Ledger entry hash and link to the previous entry are intact (simulated ledger)'
        : r.problems.join('; '),
    });
  }
  if (!t.txHash) return res.json({ mode: t.mode, verified: false, message: `No transaction hash — status is ${t.status.toLowerCase()}${t.error ? `: ${t.error}` : ''}` });
  try {
    const r = await verifyTransactionLog(t.txHash, t.payloadHash);
    res.json({ mode: t.mode, verified: r.matches && eventMatches !== false, message: eventMatches === false ? 'On-chain log found, but the database event no longer matches the anchored hash' : r.message, blockNumber: r.blockNumber });
  } catch (e) {
    res.json({ mode: t.mode, verified: false, unavailable: true, message: `Blockchain verification unavailable: ${shortError(e)}` });
  }
});

blockchainRouter.get('/ledger/verify', requireRole('REGULATOR'), async (_req, res) => {
  if (chainMode !== 'SIMULATION') throw badRequest('The simulated ledger is only used in simulation mode');
  res.json(await verifyWholeLedger(prisma));
});

/** Regulators can re-queue failed on-chain writes (e.g. after the node was restarted). */
blockchainRouter.post('/retry', requireRole('REGULATOR'), async (req, res) => {
  if (chainMode !== 'ONCHAIN') throw badRequest('Retries only apply in on-chain mode');
  const r = await prisma.blockchainTransaction.updateMany({ where: { mode: 'ONCHAIN', status: 'FAILED', eventId: { not: null } }, data: { status: 'PENDING', error: null } });
  await audit(prisma, req, 'blockchain.retry', 'BlockchainTransaction', null, { count: r.count });
  flushChainQueue();
  res.json({ requeued: r.count });
});

// ---------------- Audit log (regulators) ----------------
export const auditRouter = Router();
auditRouter.use(requireAuth, requireRole('REGULATOR'));

auditRouter.get('/', async (req, res) => {
  const q = query(req, paginationSchema.extend({ entityType: z.string().max(40).optional() }));
  const and: Prisma.AuditLogWhereInput[] = [];
  if (q.entityType) and.push({ entityType: q.entityType });
  if (q.search) {
    const ci = { contains: q.search, mode: 'insensitive' as const };
    and.push({ OR: [{ action: ci }, { entityId: ci }, { actor: { email: ci } }, { actorOrg: { name: ci } }] });
  }
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { fullName: true, email: true } }, actorOrg: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      ...pageArgs(q),
    }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(
    paged(
      items.map((l) => ({
        id: l.id,
        action: l.action,
        entityType: l.entityType,
        entityId: l.entityId,
        metadata: l.metadata,
        createdAt: l.createdAt,
        actor: l.actor ? { name: l.actor.fullName, email: l.actor.email } : null,
        organization: l.actorOrg?.name ?? null,
      })),
      total,
      q,
    ),
  );
});
