import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { auth, requireAuth } from '../middleware/auth.js';
import { batchScope, startOfTodayUtc } from '../services/batches.js';
import { batchRow, chainTxRow, transferRow } from '../lib/serializers.js';
import { chainMode } from '../blockchain/index.js';
import { env } from '../config/env.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const DAY = 86_400_000;

dashboardRouter.get('/', async (req, res) => {
  const a = auth(req);
  const isReg = a.user.role === 'REGULATOR';
  const scope = batchScope(a);
  const today = startOfTodayUtc();
  const in90 = new Date(today.getTime() + 90 * DAY);
  const since30 = new Date(today.getTime() - 29 * DAY);
  const w = (extra: Prisma.MedicineBatchWhereInput): Prisma.MedicineBatchWhereInput => ({ AND: [scope, extra] });

  const transferScope: Prisma.CustodyTransferWhereInput = isReg ? {} : { OR: [{ toOrgId: a.org.id }, { fromOrgId: a.org.id }] };
  const verificationScope: Prisma.VerificationAttemptWhereInput = isReg ? {} : { batch: scope };

  const [
    total,
    inTransit,
    recalled,
    blocked,
    expired,
    expiringSoon,
    activeAll,
    inCustody,
    pendingIncoming,
    pendingOutgoing,
    pendingAll,
    suspiciousVerifications,
    openFlags,
    pendingOrgs,
    systemBatchCount,
  ] = await Promise.all([
    prisma.medicineBatch.count({ where: scope }),
    prisma.medicineBatch.count({ where: w({ status: 'ACTIVE', expiryDate: { gte: today }, transfers: { some: { status: 'PENDING' } } }) }),
    prisma.medicineBatch.count({ where: w({ status: 'RECALLED' }) }),
    prisma.medicineBatch.count({ where: w({ status: 'BLOCKED' }) }),
    prisma.medicineBatch.count({ where: w({ status: 'ACTIVE', expiryDate: { lt: today } }) }),
    prisma.medicineBatch.count({ where: w({ status: 'ACTIVE', expiryDate: { gte: today, lte: in90 } }) }),
    prisma.medicineBatch.count({ where: w({ status: 'ACTIVE', expiryDate: { gte: today } }) }),
    prisma.medicineBatch.count({ where: { currentCustodianId: a.org.id } }),
    prisma.custodyTransfer.count({ where: { toOrgId: a.org.id, status: 'PENDING' } }),
    prisma.custodyTransfer.count({ where: { fromOrgId: a.org.id, status: 'PENDING' } }),
    prisma.custodyTransfer.count({ where: { ...transferScope, status: 'PENDING' } }),
    prisma.verificationAttempt.count({
      where: { ...verificationScope, result: { in: isReg ? ['SUSPICIOUS', 'UNKNOWN'] : ['SUSPICIOUS'] }, createdAt: { gte: since30 } },
    }),
    isReg ? prisma.batchFlag.count({ where: { status: 'OPEN' } }) : prisma.batchFlag.count({ where: { orgId: a.org.id, status: 'OPEN' } }),
    isReg ? prisma.organization.count({ where: { status: 'PENDING' } }) : Promise.resolve(0),
    prisma.medicineBatch.count(),
  ]);

  // ---- 30-day activity series (from the event log) ----
  const [events, verifications] = await Promise.all([
    prisma.supplyChainEvent.findMany({
      where: { createdAt: { gte: since30 }, type: { in: ['REGISTERED', 'TRANSFER_ACCEPTED', 'TRANSFER_INITIATED', 'RECALLED', 'BLOCKED'] }, batch: scope },
      select: { type: true, createdAt: true },
      take: 50_000,
    }),
    prisma.verificationAttempt.findMany({ where: { ...verificationScope, createdAt: { gte: since30 } }, select: { createdAt: true }, take: 50_000 }),
  ]);
  const series = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(since30.getTime() + i * DAY);
    return { date: d.toISOString().slice(0, 10), registrations: 0, shipments: 0, deliveries: 0, recalls: 0, verifications: 0 };
  });
  const idx = (d: Date) => Math.floor((d.getTime() - since30.getTime()) / DAY);
  for (const e of events) {
    const s = series[idx(e.createdAt)];
    if (!s) continue;
    if (e.type === 'REGISTERED') s.registrations++;
    else if (e.type === 'TRANSFER_INITIATED') s.shipments++;
    else if (e.type === 'TRANSFER_ACCEPTED') s.deliveries++;
    else s.recalls++;
  }
  for (const v of verifications) {
    const s = series[idx(v.createdAt)];
    if (s) s.verifications++;
  }

  const batchInclude = { medicine: true, manufacturer: true, currentCustodian: true, transfers: { where: { status: 'PENDING' as const } } };
  const transferInclude = { fromOrg: true, toOrg: true, batch: { include: { medicine: true } } };
  const [recentBatches, recentTransfers, pendingApprovals, alerts, chainTxs] = await Promise.all([
    prisma.medicineBatch.findMany({ where: scope, include: batchInclude, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.custodyTransfer.findMany({ where: transferScope, include: transferInclude, orderBy: { createdAt: 'desc' }, take: 6 }),
    prisma.custodyTransfer.findMany({
      where: isReg ? { status: 'PENDING' } : { toOrgId: a.org.id, status: 'PENDING' },
      include: transferInclude,
      orderBy: { createdAt: 'asc' },
      take: 5,
    }),
    prisma.notification.findMany({ where: { userId: a.user.id }, orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.blockchainTransaction.findMany({
      where: { mode: chainMode, ...(isReg ? {} : { batch: scope }) },
      include: { batch: { select: { publicId: true, batchNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
  ]);

  res.json({
    role: a.user.role,
    stats: {
      totalBatches: total,
      activeBatches: activeAll - inTransit,
      inTransit,
      pendingTransfers: isReg ? pendingAll : pendingIncoming + pendingOutgoing,
      pendingIncoming,
      pendingOutgoing,
      recalledBatches: recalled + blocked,
      expiredBatches: expired,
      expiringSoon,
      suspiciousVerifications,
      openFlags,
      pendingOrganizations: pendingOrgs,
      inCustody,
    },
    statusDistribution: [
      { status: 'ACTIVE', count: activeAll - inTransit },
      { status: 'IN_TRANSIT', count: inTransit },
      { status: 'EXPIRED', count: expired },
      { status: 'RECALLED', count: recalled },
      { status: 'BLOCKED', count: blocked },
    ],
    activity: series,
    recentBatches: recentBatches.map(batchRow),
    recentTransfers: recentTransfers.map(transferRow),
    pendingApprovals: pendingApprovals.map(transferRow),
    alerts,
    chain: { mode: chainMode, recent: chainTxs.map(chainTxRow) },
    onboarding: { systemIsEmpty: systemBatchCount === 0, demoSeedEnabled: env.demoSeedEnabled && isReg },
  });
});
