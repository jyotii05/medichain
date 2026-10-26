import { AlertTriangle, CheckCircle2, Clock, Info, Link2, Link2Off, XCircle, type LucideIcon } from 'lucide-react';
import type { ChainCheck, Check, EventRow, EventType, VerificationResultType } from '@/lib/types';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { HashText } from '@/components/shared/States';
import { cn, formatNumber } from '@/lib/utils';

export const EVENT_LABEL: Record<EventType, string> = {
  REGISTERED: 'Batch registered',
  TRANSFER_INITIATED: 'Shipment initiated',
  TRANSFER_ACCEPTED: 'Shipment accepted',
  TRANSFER_REJECTED: 'Shipment rejected',
  TRANSFER_CANCELLED: 'Shipment cancelled',
  RECALLED: 'Recalled',
  BLOCKED: 'Blocked',
  FLAGGED: 'Flagged as suspicious',
  FLAG_RESOLVED: 'Flag resolved',
  DISPENSED: 'Dispensed',
};

const CHECK_META: Record<Check['status'], { icon: LucideIcon; cls: string; label: string }> = {
  pass: { icon: CheckCircle2, cls: 'bg-success-soft text-success', label: 'Pass' },
  fail: { icon: XCircle, cls: 'bg-danger-soft text-danger', label: 'Fail' },
  warn: { icon: AlertTriangle, cls: 'bg-warning-soft text-warning-ink', label: 'Warning' },
  info: { icon: Info, cls: 'bg-info-soft text-info', label: 'Info' },
};

const RESULT_TONE: Record<VerificationResultType, string> = {
  VERIFIED: 'border-success/25 bg-success-soft/60',
  EXPIRED: 'border-warning/40 bg-warning-soft/70',
  RECALLED: 'border-danger/25 bg-danger-soft/70',
  SUSPICIOUS: 'border-danger/25 bg-danger-soft/70',
  UNKNOWN: 'border-danger/25 bg-danger-soft/70',
};

export function CheckList({ checks, className }: { checks: Check[]; className?: string }) {
  if (checks.length === 0) return null;
  return (
    <ul className={cn('grid gap-2.5 sm:grid-cols-2', className)}>
      {checks.map((c) => {
        const m = CHECK_META[c.status];
        const Icon = m.icon;
        return (
          <li key={c.key} className="flex gap-3 rounded-xl border border-line bg-surface px-3.5 py-3">
            <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg', m.cls)}>
              <Icon className="size-4" aria-hidden />
              <span className="sr-only">{m.label}:</span>
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-ink">{c.label}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{c.detail}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Mode-aware summary of the ledger check. SIMULATION is never described as a blockchain. */
export function ChainSummary({ chain }: { chain: ChainCheck | null }) {
  if (!chain) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed border-line-strong bg-canvas px-4 py-3 text-[13px] text-muted">
        <Link2Off className="mt-0.5 size-4 shrink-0" aria-hidden />
        Ledger check unavailable for this batch.
      </div>
    );
  }
  const onchain = chain.mode === 'ONCHAIN';
  const ok = chain.available && chain.consistent === true;
  const bad = chain.consistent === false;
  return (
    <div className={cn('rounded-xl border px-4 py-3.5', bad ? 'border-danger/30 bg-danger-soft/50' : ok ? 'border-line bg-canvas' : 'border-warning/40 bg-warning-soft/50')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('grid size-7 place-items-center rounded-lg', bad ? 'bg-danger-soft text-danger' : ok ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning-ink')}>
          {bad ? <XCircle className="size-4" aria-hidden /> : ok ? <Link2 className="size-4" aria-hidden /> : <Clock className="size-4" aria-hidden />}
        </span>
        <p className="text-[13px] font-semibold text-ink">{onchain ? 'Blockchain anchoring (on-chain)' : 'Ledger anchoring (simulation — not a public blockchain)'}</p>
        <span className="text-[12px] font-medium text-muted">
          {!chain.available ? 'Ledger unreachable' : chain.consistent === true ? 'Consistent' : chain.consistent === false ? 'Inconsistent' : 'Not yet checked'}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-charcoal">{chain.summary}</p>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[12.5px]">
        <div className="flex gap-1.5">
          <dt className="text-muted">Anchored</dt>
          <dd className="tabular font-semibold text-ink">{formatNumber(chain.anchored)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted">Pending</dt>
          <dd className={cn('tabular font-semibold', chain.pending ? 'text-warning-ink' : 'text-ink')}>{formatNumber(chain.pending)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted">Failed</dt>
          <dd className={cn('tabular font-semibold', chain.failed ? 'text-danger' : 'text-ink')}>{formatNumber(chain.failed)}</dd>
        </div>
        {chain.latest && (
          <div className="flex min-w-0 items-center gap-1.5">
            <dt className="text-muted">{chain.latest.kind === 'TX_HASH' ? 'Latest tx hash' : 'Latest simulated ref'}</dt>
            <dd className="min-w-0">
              <HashText value={chain.latest.reference} />
              {chain.latest.kind === 'TX_HASH' && chain.latest.blockNumber != null && <span className="tabular ml-1.5 text-charcoal">block {chain.latest.blockNumber}</span>}
            </dd>
          </div>
        )}
      </dl>
      {chain.problems.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12.5px] text-danger">
          {chain.problems.map((p) => (
            <li key={p} className="flex gap-1.5">
              <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      )}
      {chain.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-muted">
          {chain.notes.map((n) => (
            <li key={n} className="flex gap-1.5">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Result banner + reasons + checks + ledger summary for a batch assessment. */
export function IntegrityPanel({
  assessment,
}: {
  assessment: { result: VerificationResultType; headline: string; reasons: string[]; checks: Check[]; chain: ChainCheck | null };
}) {
  return (
    <div className="space-y-4">
      <div className={cn('rounded-xl border px-4 py-3.5', RESULT_TONE[assessment.result])}>
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge status={assessment.result} />
          <p className="font-display text-[15px] font-semibold text-ink">{assessment.headline}</p>
        </div>
        {assessment.reasons.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-charcoal">
            {assessment.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
      <CheckList checks={assessment.checks} />
      <ChainSummary chain={assessment.chain} />
    </div>
  );
}

/** Ledger anchor for an event row: tx hash + block (on-chain) or simulated reference — never conflated. */
export function EventAnchor({ anchor }: { anchor: EventRow['anchor'] }) {
  if (!anchor) return <span className="text-[12px] text-muted">Not anchored</span>;
  const status =
    anchor.status === 'PENDING' ? (
      <StatusBadge status="PENDING" size="sm" label="Pending" />
    ) : anchor.status === 'FAILED' ? (
      <StatusBadge status="FAILED" size="sm" />
    ) : null;
  if (anchor.mode === 'ONCHAIN') {
    return (
      <div className="leading-tight">
        <p className="text-[11px] text-muted">Tx hash</p>
        {anchor.txHash ? <HashText value={anchor.txHash} /> : <span className="text-[12px] text-muted">Awaiting transaction</span>}
        <p className="tabular mt-0.5 text-[11.5px] text-charcoal">{anchor.blockNumber != null ? `Block ${anchor.blockNumber}` : 'Block —'}</p>
        {status && <div className="mt-1">{status}</div>}
      </div>
    );
  }
  return (
    <div className="leading-tight">
      <p className="text-[11px] text-muted">Simulated ref</p>
      {anchor.simulatedRef ? <HashText value={anchor.simulatedRef} full /> : <span className="text-[12px] text-muted">Not assigned</span>}
      {status && <div className="mt-1">{status}</div>}
    </div>
  );
}
