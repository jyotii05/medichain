import type { BlockchainTransaction, Organization, OrganizationType, SupplyChainEvent, VerificationResult } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { chainMode, verifyBatchAnchors, type ChainCheck } from '../blockchain/index.js';
import { isValidRoute, STAGE_ORDER, verifyEventChain } from './events.js';
import { displayStatus, isExpired } from './batches.js';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';
export interface Check {
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

type EventWithOrgs = SupplyChainEvent & { fromOrg: Organization | null; toOrg: Organization | null; actorOrg: Organization | null };

export interface StageAnchor {
  kind: 'TX_HASH' | 'SIMULATED_REF';
  reference: string | null;
  status: string;
  blockNumber: number | null;
}

export interface JourneyStage {
  key: string;
  role: OrganizationType;
  status: 'completed' | 'current' | 'in_transit' | 'rejected' | 'cancelled' | 'missing' | 'unrecorded' | 'upcoming';
  org: { id: string; name: string; city: string | null; country: string | null } | null;
  shipmentRef: string | null;
  initiatedAt: Date | null;
  completedAt: Date | null;
  eventId: string | null;
  eventHash: string | null;
  anchor: StageAnchor | null;
  note: string | null;
}

function anchorOf(t: BlockchainTransaction | undefined): StageAnchor | null {
  if (!t) return null;
  return t.mode === 'ONCHAIN'
    ? { kind: 'TX_HASH', reference: t.txHash, status: t.status, blockNumber: t.blockNumber }
    : { kind: 'SIMULATED_REF', reference: t.simulatedRef, status: t.status, blockNumber: null };
}

const orgSummary = (o: Organization) => ({ id: o.id, name: o.name, city: o.city, country: o.country });

/** Builds the stage-by-stage journey from the event log. Never invents a stage that has no record. */
export function buildJourney(
  batch: { status: string; currentCustodian: Organization; manufacturer: Organization },
  events: EventWithOrgs[],
  anchors: Map<string, BlockchainTransaction>,
): JourneyStage[] {
  const stages: JourneyStage[] = [];
  const byTransfer = new Map<string, JourneyStage>();

  for (const e of events) {
    const anchor = anchorOf(anchors.get(e.id));
    switch (e.type) {
      case 'REGISTERED':
        stages.push({
          key: e.id,
          role: (e.actorOrg?.type ?? 'MANUFACTURER') as OrganizationType,
          status: 'completed',
          org: e.actorOrg ? orgSummary(e.actorOrg) : null,
          shipmentRef: null,
          initiatedAt: e.createdAt,
          completedAt: e.createdAt,
          eventId: e.id,
          eventHash: e.hash,
          anchor,
          note: 'Batch registered by manufacturer',
        });
        break;
      case 'TRANSFER_INITIATED': {
        const s: JourneyStage = {
          key: e.transferId ?? e.id,
          role: e.toOrg!.type,
          status: 'in_transit',
          org: orgSummary(e.toOrg!),
          shipmentRef: (e.data as { reference?: string })?.reference ?? null,
          initiatedAt: e.createdAt,
          completedAt: null,
          eventId: e.id,
          eventHash: e.hash,
          anchor,
          note: `Shipped by ${e.fromOrg?.name ?? 'unknown'}`,
        };
        stages.push(s);
        if (e.transferId) byTransfer.set(e.transferId, s);
        break;
      }
      case 'TRANSFER_ACCEPTED':
      case 'TRANSFER_REJECTED':
      case 'TRANSFER_CANCELLED': {
        let s = e.transferId ? byTransfer.get(e.transferId) : undefined;
        if (!s) {
          // a response without a matching initiation record — show it, but mark it as unrecorded
          s = {
            key: e.id,
            role: e.toOrg!.type,
            status: 'unrecorded',
            org: e.toOrg ? orgSummary(e.toOrg) : null,
            shipmentRef: (e.data as { reference?: string })?.reference ?? null,
            initiatedAt: null,
            completedAt: e.createdAt,
            eventId: e.id,
            eventHash: e.hash,
            anchor,
            note: 'No matching shipment record',
          };
          stages.push(s);
        }
        s.completedAt = e.createdAt;
        s.eventId = e.id;
        s.eventHash = e.hash;
        s.anchor = anchor ?? s.anchor;
        if (e.type === 'TRANSFER_ACCEPTED' && s.status !== 'unrecorded') {
          s.status = 'completed';
          s.note = `Received from ${e.fromOrg?.name ?? 'unknown'}`;
        }
        if (e.type === 'TRANSFER_REJECTED') {
          s.status = 'rejected';
          s.note = 'Shipment rejected by recipient';
        }
        if (e.type === 'TRANSFER_CANCELLED') {
          s.status = 'cancelled';
          s.note = 'Shipment cancelled because the batch was recalled';
        }
        break;
      }
      default:
        break;
    }
  }

  // Mark the custodian stage and surface custody that has no transfer record.
  const completed = stages.filter((s) => s.status === 'completed');
  const last = completed[completed.length - 1];
  if (last && last.org?.id === batch.currentCustodian.id) {
    last.status = 'current';
  } else {
    stages.push({
      key: 'unrecorded-custodian',
      role: batch.currentCustodian.type,
      status: 'unrecorded',
      org: orgSummary(batch.currentCustodian),
      shipmentRef: null,
      initiatedAt: null,
      completedAt: null,
      eventId: null,
      eventHash: null,
      anchor: null,
      note: 'Current custodian has no recorded custody transfer',
    });
  }

  // Insert placeholders for skipped stages between consecutive custodians.
  const result: JourneyStage[] = [];
  let prevRoleIdx = -1;
  for (const s of stages) {
    const idx = STAGE_ORDER.indexOf(s.role);
    const holdsCustody = s.status === 'completed' || s.status === 'current' || s.status === 'unrecorded';
    if (holdsCustody && prevRoleIdx >= 0 && idx > prevRoleIdx + 1) {
      for (let i = prevRoleIdx + 1; i < idx; i++) {
        result.push({
          key: `missing-${i}-${s.key}`,
          role: STAGE_ORDER[i],
          status: 'missing',
          org: null,
          shipmentRef: null,
          initiatedAt: null,
          completedAt: null,
          eventId: null,
          eventHash: null,
          anchor: null,
          note: 'No custody record for this stage',
        });
      }
    }
    result.push(s);
    if (holdsCustody && idx >= 0) prevRoleIdx = idx;
  }

  // Expected future stages (only while the batch can still move).
  const hasTransit = stages.some((s) => s.status === 'in_transit');
  if (batch.status === 'ACTIVE') {
    const start = hasTransit ? STAGE_ORDER.indexOf(stages.filter((s) => s.status === 'in_transit').at(-1)!.role) : prevRoleIdx;
    for (let i = start + 1; i < STAGE_ORDER.length && start >= 0; i++) {
      result.push({
        key: `upcoming-${i}`,
        role: STAGE_ORDER[i],
        status: 'upcoming',
        org: null,
        shipmentRef: null,
        initiatedAt: null,
        completedAt: null,
        eventId: null,
        eventHash: null,
        anchor: null,
        note: null,
      });
    }
  }
  return result;
}

/** Replays custody from the events and compares it to the stored current custodian. */
function custodyCheck(batch: { manufacturerId: string; currentCustodianId: string }, events: EventWithOrgs[]): string[] {
  const problems: string[] = [];
  let custodian: Organization | null = null;
  const openTransfers = new Map<string, EventWithOrgs>();
  for (const e of events) {
    if (e.type === 'REGISTERED') {
      if (custodian) problems.push('Batch was registered more than once');
      custodian = e.actorOrg;
      if (e.actorOrgId !== batch.manufacturerId) problems.push('Registration was not recorded by the batch manufacturer');
    } else if (e.type === 'TRANSFER_INITIATED') {
      if (!custodian || e.fromOrgId !== custodian.id) problems.push(`Shipment ${(e.data as { reference?: string })?.reference ?? ''} was sent by an organization that did not hold custody`);
      if (e.fromOrg && e.toOrg && !isValidRoute(e.fromOrg.type, e.toOrg.type)) {
        problems.push(`Unexpected route: ${e.fromOrg.type.toLowerCase()} → ${e.toOrg.type.toLowerCase()}`);
      }
      if (e.transferId) openTransfers.set(e.transferId, e);
    } else if (e.type === 'TRANSFER_ACCEPTED') {
      if (!e.transferId || !openTransfers.has(e.transferId)) problems.push('A custody acceptance has no matching shipment record');
      if (!custodian || e.fromOrgId !== custodian.id) problems.push('Custody was accepted from an organization that did not hold it');
      if (e.transferId) openTransfers.delete(e.transferId);
      custodian = e.toOrg;
    } else if (e.type === 'TRANSFER_REJECTED' || e.type === 'TRANSFER_CANCELLED') {
      if (e.transferId) openTransfers.delete(e.transferId);
    }
  }
  if (!custodian) problems.push('No registration record exists for this batch');
  else if (custodian.id !== batch.currentCustodianId) {
    problems.push('The current custodian is not supported by the recorded transfer history (missing or unrecorded custody transfer)');
  }
  if (openTransfers.size > 1) problems.push('More than one shipment is open at the same time');
  return problems;
}

export interface Assessment {
  result: VerificationResult;
  displayStatus: ReturnType<typeof displayStatus>;
  headline: string;
  reasons: string[];
  checks: Check[];
  journey: JourneyStage[];
  events: EventWithOrgs[];
  anchors: Map<string, BlockchainTransaction>;
  chain: ChainCheck | null;
}

const HEADLINES: Record<VerificationResult, string> = {
  VERIFIED: 'Verified record — registered and consistent custody history',
  SUSPICIOUS: 'Suspicious — this record could not be verified',
  UNKNOWN: 'Unknown identifier — no registered batch matches this code',
  RECALLED: 'Recalled — do not use this medicine',
  EXPIRED: 'Expired — this batch is past its expiry date',
};

export async function loadBatchForAssessment(where: { id: string } | { publicId: string }) {
  return prisma.medicineBatch.findUnique({
    where: where as { id: string },
    include: {
      medicine: true,
      manufacturer: true,
      currentCustodian: true,
      events: { orderBy: { sequence: 'asc' }, include: { fromOrg: true, toOrg: true, actorOrg: true } },
      recalls: { orderBy: { createdAt: 'desc' } },
      flags: { where: { status: 'OPEN' } },
      transfers: { where: { status: 'PENDING' }, include: { toOrg: true } },
    },
  });
}

type LoadedBatch = NonNullable<Awaited<ReturnType<typeof loadBatchForAssessment>>>;

export async function assessBatch(batch: LoadedBatch, opts: { includeChain?: boolean } = {}): Promise<Assessment> {
  const now = new Date();
  const checks: Check[] = [];
  const events = batch.events;

  const integrity = verifyEventChain(batch.publicId, events);
  checks.push({
    key: 'integrity',
    label: 'Record integrity',
    status: integrity.ok ? 'pass' : 'fail',
    detail: integrity.ok ? `All ${events.length} events match their hashes and are correctly linked` : integrity.problems.join('; '),
  });

  const custody = custodyCheck(batch, events);
  checks.push({
    key: 'custody',
    label: 'Custody history',
    status: custody.length ? 'fail' : 'pass',
    detail: custody.length ? custody.join('; ') : 'Every custody change is backed by an accepted transfer',
  });

  checks.push({
    key: 'manufacturer',
    label: 'Manufacturer registration',
    status: batch.manufacturer.status === 'APPROVED' ? 'pass' : 'fail',
    detail:
      batch.manufacturer.status === 'APPROVED'
        ? `${batch.manufacturer.name} is an approved manufacturer`
        : `${batch.manufacturer.name} is ${batch.manufacturer.status.toLowerCase()} by the regulator`,
  });

  checks.push({
    key: 'flags',
    label: 'Partner reports',
    status: batch.flags.length ? 'fail' : 'pass',
    detail: batch.flags.length ? `${batch.flags.length} open suspicion report(s) under regulatory review` : 'No open suspicion reports',
  });

  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const scans = await prisma.verificationAttempt.count({ where: { batchId: batch.id, channel: 'PUBLIC', createdAt: { gte: since } } });
  const tooMany = scans >= env.DUPLICATE_SCAN_THRESHOLD;
  checks.push({
    key: 'scans',
    label: 'Duplicate-use indicators',
    status: tooMany ? 'fail' : 'pass',
    detail: tooMany
      ? `This code was checked ${scans} times in 24 hours — the code may have been copied onto other packs`
      : `${scans} public check(s) in the last 24 hours`,
  });

  const expired = isExpired(batch.expiryDate, now);
  checks.push({
    key: 'expiry',
    label: 'Expiry date',
    status: expired ? 'fail' : 'pass',
    detail: expired ? `Expired on ${batch.expiryDate.toISOString().slice(0, 10)}` : `Valid until ${batch.expiryDate.toISOString().slice(0, 10)}`,
  });

  const recall = batch.recalls[0];
  checks.push({
    key: 'recall',
    label: 'Recall status',
    status: batch.status === 'ACTIVE' ? 'pass' : 'fail',
    detail: batch.status === 'ACTIVE' ? 'No recall or block recorded' : `${batch.status === 'BLOCKED' ? 'Blocked' : 'Recalled'} — ${recall?.reference ?? ''}`,
  });

  let chain: ChainCheck | null = null;
  const anchorRows = await prisma.blockchainTransaction.findMany({ where: { batchId: batch.id, mode: chainMode, eventId: { not: null } } });
  const anchors = new Map(anchorRows.map((t) => [t.eventId!, t]));
  if (opts.includeChain !== false) {
    chain = await verifyBatchAnchors(batch, events);
    checks.push({
      key: 'chain',
      label: chainMode === 'ONCHAIN' ? 'Blockchain anchor' : 'Ledger anchor (simulated)',
      status: chain.consistent === false ? 'fail' : chain.consistent === true ? 'pass' : chain.available ? 'info' : 'warn',
      detail: [chain.summary, ...chain.problems].join('; '),
    });
  }

  const hasPending = batch.transfers.length > 0;
  const ds = displayStatus(batch, hasPending, now);
  let result: VerificationResult;
  if (batch.status !== 'ACTIVE') result = 'RECALLED';
  else if (expired) result = 'EXPIRED';
  else if (checks.some((c) => c.status === 'fail')) result = 'SUSPICIOUS';
  else result = 'VERIFIED';

  const reasons = checks.filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => `${c.label}: ${c.detail}`);
  return {
    result,
    displayStatus: ds,
    headline: HEADLINES[result],
    reasons,
    checks,
    journey: buildJourney(batch, events, anchors),
    events,
    anchors,
    chain,
  };
}

export { HEADLINES };
