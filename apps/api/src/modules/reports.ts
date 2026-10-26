import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { query } from '../lib/http.js';
import { auth, requireAuth, type AuthContext } from '../middleware/auth.js';
import { batchScope, displayStatus, startOfTodayUtc } from '../services/batches.js';
import { chainMode } from '../blockchain/index.js';
import { audit } from '../services/audit.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const DAY = 86_400_000;
const REPORT_TYPES = ['batches', 'expiring', 'expired', 'recalls', 'transfers', 'verifications', 'organizations', 'blockchain'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

const filtersSchema = z.object({
  type: z.enum(REPORT_TYPES).default('batches'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.string().trim().max(30).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(15),
});
type Filters = z.infer<typeof filtersSchema>;

function range(f: Filters): Prisma.DateTimeFilter | undefined {
  if (!f.from && !f.to) return undefined;
  return {
    ...(f.from ? { gte: new Date(`${f.from}T00:00:00.000Z`) } : {}),
    ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + DAY) } : {}),
  };
}

const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : '');
const dt = (x: Date | null | undefined) => (x ? x.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '');

interface Report {
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
  total: number;
}

/** Builds report rows. `limit` null = everything (CSV export, capped). Results are always scoped to the caller. */
async function buildReport(a: AuthContext, f: Filters, paging: { skip: number; take: number }): Promise<Report> {
  const isReg = a.user.role === 'REGULATOR';
  const scope = batchScope(a);
  const today = startOfTodayUtc();
  const created = range(f);
  const s = f.search;
  const ci = (v: string) => ({ contains: v, mode: 'insensitive' as const });

  switch (f.type as ReportType) {
    case 'batches':
    case 'expiring':
    case 'expired': {
      const and: Prisma.MedicineBatchWhereInput[] = [scope];
      if (f.type === 'batches' && created) and.push({ createdAt: created });
      if (f.type === 'expiring') and.push({ status: 'ACTIVE', expiryDate: { gte: today, lte: new Date(today.getTime() + 90 * DAY) } });
      if (f.type === 'expired') and.push({ expiryDate: { lt: today } });
      if (f.type === 'batches' && f.status) {
        if (f.status === 'EXPIRED') and.push({ status: 'ACTIVE', expiryDate: { lt: today } });
        else if (['ACTIVE', 'RECALLED', 'BLOCKED'].includes(f.status)) and.push({ status: f.status as 'ACTIVE' });
      }
      if (s) and.push({ OR: [{ batchNumber: ci(s) }, { publicId: ci(s) }, { medicine: { name: ci(s) } }, { manufacturer: { name: ci(s) } }] });
      const where = { AND: and };
      const [items, total] = await Promise.all([
        prisma.medicineBatch.findMany({
          where,
          include: { medicine: true, manufacturer: true, currentCustodian: true, transfers: { where: { status: 'PENDING' } } },
          orderBy: f.type === 'batches' ? { createdAt: 'desc' } : { expiryDate: 'asc' },
          ...paging,
        }),
        prisma.medicineBatch.count({ where }),
      ]);
      return {
        total,
        columns: [
          { key: 'publicId', label: 'Batch ID' },
          { key: 'batchNumber', label: 'Batch number' },
          { key: 'medicine', label: 'Medicine' },
          { key: 'manufacturer', label: 'Manufacturer' },
          { key: 'custodian', label: 'Current custodian' },
          { key: 'quantity', label: 'Quantity' },
          { key: 'expiryDate', label: 'Expiry date' },
          { key: 'daysToExpiry', label: 'Days to expiry' },
          { key: 'status', label: 'Status' },
          { key: 'registeredAt', label: 'Registered' },
        ],
        rows: items.map((b) => ({
          publicId: b.publicId,
          batchNumber: b.batchNumber,
          medicine: `${b.medicine.name}${b.medicine.strength ? ` ${b.medicine.strength}` : ''}`,
          manufacturer: b.manufacturer.name,
          custodian: b.currentCustodian.name,
          quantity: `${b.quantityOnHand} / ${b.quantity} ${b.unit}`,
          expiryDate: d(b.expiryDate),
          daysToExpiry: Math.round((b.expiryDate.getTime() - today.getTime()) / DAY),
          status: displayStatus(b, b.transfers.length > 0),
          registeredAt: d(b.createdAt),
        })),
      };
    }
    case 'recalls': {
      const and: Prisma.RecallRecordWhereInput[] = [isReg ? {} : { batch: scope }];
      if (created) and.push({ createdAt: created });
      if (f.status === 'RECALL' || f.status === 'BLOCK') and.push({ action: f.status });
      if (s) and.push({ OR: [{ reference: ci(s) }, { reason: ci(s) }, { batch: { batchNumber: ci(s) } }, { batch: { medicine: { name: ci(s) } } }] });
      const where = { AND: and };
      const [items, total] = await Promise.all([
        prisma.recallRecord.findMany({
          where,
          include: { batch: { include: { medicine: true, manufacturer: true } }, initiatedBy: { select: { fullName: true } } },
          orderBy: { createdAt: 'desc' },
          ...paging,
        }),
        prisma.recallRecord.count({ where }),
      ]);
      return {
        total,
        columns: [
          { key: 'reference', label: 'Reference' },
          { key: 'action', label: 'Action' },
          { key: 'classification', label: 'Class' },
          { key: 'batch', label: 'Batch' },
          { key: 'medicine', label: 'Medicine' },
          { key: 'manufacturer', label: 'Manufacturer' },
          { key: 'reason', label: 'Reason' },
          { key: 'issuedBy', label: 'Issued by' },
          { key: 'issuedAt', label: 'Issued at' },
        ],
        rows: items.map((r) => ({
          reference: r.reference,
          action: r.action,
          classification: r.classification.replace('_', ' '),
          batch: r.batch.batchNumber,
          medicine: r.batch.medicine.name,
          manufacturer: r.batch.manufacturer.name,
          reason: r.reason,
          issuedBy: r.initiatedBy.fullName,
          issuedAt: dt(r.createdAt),
        })),
      };
    }
    case 'transfers': {
      const and: Prisma.CustodyTransferWhereInput[] = [isReg ? {} : { OR: [{ fromOrgId: a.org.id }, { toOrgId: a.org.id }] }];
      if (created) and.push({ createdAt: created });
      if (f.status && ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'].includes(f.status)) and.push({ status: f.status as 'PENDING' });
      if (s) and.push({ OR: [{ reference: ci(s) }, { batch: { batchNumber: ci(s) } }, { fromOrg: { name: ci(s) } }, { toOrg: { name: ci(s) } }] });
      const where = { AND: and };
      const [items, total] = await Promise.all([
        prisma.custodyTransfer.findMany({ where, include: { fromOrg: true, toOrg: true, batch: { include: { medicine: true } } }, orderBy: { createdAt: 'desc' }, ...paging }),
        prisma.custodyTransfer.count({ where }),
      ]);
      return {
        total,
        columns: [
          { key: 'reference', label: 'Shipment' },
          { key: 'batch', label: 'Batch' },
          { key: 'medicine', label: 'Medicine' },
          { key: 'from', label: 'From' },
          { key: 'to', label: 'To' },
          { key: 'quantity', label: 'Quantity' },
          { key: 'status', label: 'Status' },
          { key: 'createdAt', label: 'Sent' },
          { key: 'respondedAt', label: 'Responded' },
        ],
        rows: items.map((t) => ({
          reference: t.reference,
          batch: t.batch.batchNumber,
          medicine: t.batch.medicine.name,
          from: t.fromOrg.name,
          to: t.toOrg.name,
          quantity: `${t.quantity} ${t.batch.unit}`,
          status: t.status,
          createdAt: dt(t.createdAt),
          respondedAt: dt(t.respondedAt),
        })),
      };
    }
    case 'verifications': {
      const and: Prisma.VerificationAttemptWhereInput[] = [isReg ? {} : { batch: scope }];
      if (created) and.push({ createdAt: created });
      if (f.status && ['VERIFIED', 'SUSPICIOUS', 'UNKNOWN', 'RECALLED', 'EXPIRED'].includes(f.status)) and.push({ result: f.status as 'VERIFIED' });
      if (s) and.push({ OR: [{ queriedId: ci(s) }, { batch: { batchNumber: ci(s) } }] });
      const where = { AND: and };
      const [items, total] = await Promise.all([
        prisma.verificationAttempt.findMany({ where, include: { batch: { include: { medicine: true } } }, orderBy: { createdAt: 'desc' }, ...paging }),
        prisma.verificationAttempt.count({ where }),
      ]);
      return {
        total,
        columns: [
          { key: 'createdAt', label: 'Checked at' },
          { key: 'queriedId', label: 'Identifier queried' },
          { key: 'medicine', label: 'Medicine' },
          { key: 'result', label: 'Result' },
          { key: 'channel', label: 'Channel' },
          { key: 'reasons', label: 'Reasons' },
        ],
        rows: items.map((v) => ({
          createdAt: dt(v.createdAt),
          queriedId: v.queriedId,
          medicine: v.batch ? `${v.batch.medicine.name} (${v.batch.batchNumber})` : '—',
          result: v.result,
          channel: v.channel,
          reasons: Array.isArray(v.reasons) ? (v.reasons as string[]).join(' | ') : '',
        })),
      };
    }
    case 'organizations': {
      const where: Prisma.OrganizationWhereInput = {
        AND: [
          isReg ? {} : { id: a.org.id },
          f.status && ['PENDING', 'APPROVED', 'SUSPENDED'].includes(f.status) ? { status: f.status as 'PENDING' } : {},
          s ? { OR: [{ name: ci(s) }, { licenseNumber: ci(s) }] } : {},
        ],
      };
      const [orgs, total] = await Promise.all([
        prisma.organization.findMany({ where, orderBy: { name: 'asc' }, ...paging }),
        prisma.organization.count({ where }),
      ]);
      const ids = orgs.map((o) => o.id);
      const evWhere: Prisma.SupplyChainEventWhereInput = { actorOrgId: { in: ids }, ...(created ? { createdAt: created } : {}) };
      const [eventCounts, sent, received, custody] = await Promise.all([
        prisma.supplyChainEvent.groupBy({ by: ['actorOrgId'], where: evWhere, _count: true }),
        prisma.custodyTransfer.groupBy({ by: ['fromOrgId'], where: { fromOrgId: { in: ids }, ...(created ? { createdAt: created } : {}) }, _count: true }),
        prisma.custodyTransfer.groupBy({ by: ['toOrgId'], where: { toOrgId: { in: ids }, status: 'ACCEPTED', ...(created ? { createdAt: created } : {}) }, _count: true }),
        prisma.medicineBatch.groupBy({ by: ['currentCustodianId'], where: { currentCustodianId: { in: ids } }, _count: true }),
      ]);
      const m = <T extends Record<string, unknown>>(rows: T[], key: keyof T) => new Map(rows.map((r) => [r[key] as string, (r as unknown as { _count: number })._count]));
      const ev = m(eventCounts, 'actorOrgId');
      const se = m(sent, 'fromOrgId');
      const re = m(received, 'toOrgId');
      const cu = m(custody, 'currentCustodianId');
      return {
        total,
        columns: [
          { key: 'name', label: 'Organization' },
          { key: 'type', label: 'Type' },
          { key: 'status', label: 'Status' },
          { key: 'license', label: 'Licence' },
          { key: 'events', label: 'Recorded events' },
          { key: 'sent', label: 'Shipments sent' },
          { key: 'received', label: 'Shipments received' },
          { key: 'custody', label: 'Batches in custody' },
        ],
        rows: orgs.map((o) => ({
          name: o.name,
          type: o.type,
          status: o.status,
          license: o.licenseNumber,
          events: ev.get(o.id) ?? 0,
          sent: se.get(o.id) ?? 0,
          received: re.get(o.id) ?? 0,
          custody: cu.get(o.id) ?? 0,
        })),
      };
    }
    case 'blockchain': {
      const and: Prisma.BlockchainTransactionWhereInput[] = [{ mode: chainMode }, isReg ? {} : { batch: scope }];
      if (created) and.push({ createdAt: created });
      if (f.status && ['PENDING', 'CONFIRMED', 'FAILED'].includes(f.status)) and.push({ status: f.status as 'PENDING' });
      if (s) and.push({ OR: [{ txHash: ci(s) }, { simulatedRef: ci(s) }, { payloadHash: ci(s) }, { batch: { batchNumber: ci(s) } }] });
      const where = { AND: and };
      const [items, total] = await Promise.all([
        prisma.blockchainTransaction.findMany({ where, include: { batch: true }, orderBy: { createdAt: 'desc' }, ...paging }),
        prisma.blockchainTransaction.count({ where }),
      ]);
      return {
        total,
        columns: [
          { key: 'createdAt', label: 'Recorded at' },
          { key: 'mode', label: 'Mode' },
          { key: 'operation', label: 'Operation' },
          { key: 'batch', label: 'Batch' },
          { key: 'reference', label: 'Tx hash / simulated ref' },
          { key: 'block', label: 'Block' },
          { key: 'status', label: 'Status' },
          { key: 'payloadHash', label: 'Anchored hash' },
        ],
        rows: items.map((t) => ({
          createdAt: dt(t.createdAt),
          mode: t.mode,
          operation: t.operation,
          batch: t.batch?.batchNumber ?? '—',
          reference: t.txHash ?? t.simulatedRef ?? '',
          block: t.blockNumber ?? '',
          status: t.status,
          payloadHash: t.payloadHash,
        })),
      };
    }
  }
}

reportsRouter.get('/data', async (req, res) => {
  const f = query(req, filtersSchema);
  const report = await buildReport(auth(req), f, { skip: (f.page - 1) * f.pageSize, take: f.pageSize });
  res.json({ ...report, page: f.page, pageSize: f.pageSize, totalPages: Math.max(1, Math.ceil(report.total / f.pageSize)) });
});

/** Neutralises spreadsheet formula injection and escapes CSV special characters. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

reportsRouter.get('/export', async (req: Request, res) => {
  const f = query(req, filtersSchema);
  const report = await buildReport(auth(req), f, { skip: 0, take: 10_000 });
  const lines = [report.columns.map((c) => csvCell(c.label)).join(','), ...report.rows.map((r) => report.columns.map((c) => csvCell(r[c.key])).join(','))];
  await audit(prisma, req, 'report.exported', 'Report', f.type, { rows: report.rows.length, from: f.from ?? null, to: f.to ?? null });
  const name = `medichain-${f.type}-${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(`﻿${lines.join('\r\n')}`);
});

/** Aggregated analytics for charts. */
reportsRouter.get('/summary', async (req, res) => {
  const a = auth(req);
  const isReg = a.user.role === 'REGULATOR';
  const f = query(req, filtersSchema);
  const today = startOfTodayUtc();
  const to = f.to ? new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + DAY) : new Date(today.getTime() + DAY);
  const from = f.from ? new Date(`${f.from}T00:00:00.000Z`) : new Date(to.getTime() - 90 * DAY);
  const scope = batchScope(a);
  const created = { gte: from, lt: to };

  const [transfersByStatus, verificationsByResult, recalls, chainByStatus, events] = await Promise.all([
    prisma.custodyTransfer.groupBy({
      by: ['status'],
      where: { createdAt: created, ...(isReg ? {} : { OR: [{ fromOrgId: a.org.id }, { toOrgId: a.org.id }] }) },
      _count: true,
    }),
    prisma.verificationAttempt.groupBy({ by: ['result'], where: { createdAt: created, ...(isReg ? {} : { batch: scope }) }, _count: true }),
    prisma.recallRecord.findMany({ where: { createdAt: created, ...(isReg ? {} : { batch: scope }) }, select: { createdAt: true, action: true } }),
    prisma.blockchainTransaction.groupBy({ by: ['status'], where: { mode: chainMode, createdAt: created, ...(isReg ? {} : { batch: scope }) }, _count: true }),
    prisma.supplyChainEvent.findMany({
      where: { createdAt: created, batch: scope, type: { in: ['REGISTERED', 'TRANSFER_INITIATED', 'TRANSFER_ACCEPTED', 'TRANSFER_REJECTED'] } },
      select: { createdAt: true, type: true },
      take: 50_000,
    }),
  ]);

  // weekly buckets
  const weeks: { week: string; registrations: number; shipments: number; deliveries: number; rejections: number; recalls: number }[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += 7 * DAY) {
    weeks.push({ week: new Date(t).toISOString().slice(0, 10), registrations: 0, shipments: 0, deliveries: 0, rejections: 0, recalls: 0 });
  }
  const wi = (x: Date) => Math.floor((x.getTime() - from.getTime()) / (7 * DAY));
  for (const e of events) {
    const w = weeks[wi(e.createdAt)];
    if (!w) continue;
    if (e.type === 'REGISTERED') w.registrations++;
    else if (e.type === 'TRANSFER_INITIATED') w.shipments++;
    else if (e.type === 'TRANSFER_ACCEPTED') w.deliveries++;
    else w.rejections++;
  }
  for (const r of recalls) {
    const w = weeks[wi(r.createdAt)];
    if (w) w.recalls++;
  }

  res.json({
    from: from.toISOString().slice(0, 10),
    to: new Date(to.getTime() - DAY).toISOString().slice(0, 10),
    weekly: weeks,
    transfersByStatus: transfersByStatus.map((t) => ({ status: t.status, count: t._count })),
    verificationsByResult: verificationsByResult.map((v) => ({ result: v.result, count: v._count })),
    chainByStatus: chainByStatus.map((c) => ({ status: c.status, count: c._count })),
    chainMode,
  });
});
