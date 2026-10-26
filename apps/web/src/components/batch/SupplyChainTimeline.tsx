import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  Factory,
  Link2,
  Link2Off,
  MapPin,
  Package,
  Store,
  Truck,
  Warehouse,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { JourneyStage, OrgType, StageStatus } from '@/lib/types';
import { cn, formatDateTime, ROLE_LABEL, shortHash } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Stage + status metadata (exported so pages can reuse the wording)    */
/* ------------------------------------------------------------------ */

export const ROLE_ICON: Record<OrgType, LucideIcon> = {
  MANUFACTURER: Factory,
  DISTRIBUTOR: Truck,
  WHOLESALER: Warehouse,
  PHARMACY: Store,
  REGULATOR: Package,
};

type Tone = 'success' | 'brand' | 'info' | 'danger' | 'neutral' | 'warning' | 'muted';

interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  /** stage has no recorded custody (rendered dashed) */
  dashed: boolean;
}

export const STAGE_STATUS: Record<StageStatus, StatusMeta> = {
  completed: { label: 'Completed', tone: 'success', icon: CheckCircle2, dashed: false },
  current: { label: 'Current custodian', tone: 'brand', icon: MapPin, dashed: false },
  in_transit: { label: 'In transit', tone: 'info', icon: Truck, dashed: false },
  rejected: { label: 'Rejected', tone: 'danger', icon: XCircle, dashed: false },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: Ban, dashed: false },
  missing: { label: 'Missing stage', tone: 'warning', icon: AlertTriangle, dashed: true },
  unrecorded: { label: 'Unrecorded custody', tone: 'danger', icon: AlertTriangle, dashed: true },
  upcoming: { label: 'Expected next', tone: 'muted', icon: CircleDashed, dashed: true },
};

const chipTone: Record<Tone, string> = {
  success: 'bg-success-soft text-success border-success/20',
  brand: 'bg-brand-soft text-brand-ink border-brand/30',
  info: 'bg-info-soft text-info border-info/20',
  danger: 'bg-danger-soft text-danger border-danger/40',
  neutral: 'bg-subtle text-charcoal border-line-strong',
  warning: 'bg-warning-soft text-warning-ink border-warning/60',
  muted: 'bg-surface text-muted border-line-strong',
};

const nodeTone: Record<Tone, string> = {
  success: 'border-success bg-success-soft text-success',
  brand: 'border-brand bg-brand text-ink shadow-[0_0_0_5px_var(--color-brand-soft)]',
  info: 'border-info bg-info-soft text-info',
  danger: 'border-danger bg-danger-soft text-danger',
  neutral: 'border-line-strong bg-subtle text-charcoal',
  warning: 'border-warning border-dashed bg-warning-soft text-warning-ink',
  muted: 'border-line-strong border-dashed bg-surface text-muted',
};

/** Labels for the stage timestamps depend on role (registration vs. receipt). */
function timeLabels(stage: JourneyStage) {
  if (stage.role === 'MANUFACTURER') return { initiated: 'Registered', completed: null };
  return { initiated: 'Shipped', completed: stage.status === 'rejected' ? 'Rejected' : stage.status === 'cancelled' ? 'Cancelled' : 'Received' };
}

function orgLine(stage: JourneyStage) {
  if (stage.org) return stage.org.name;
  if (stage.status === 'upcoming') return 'Not yet assigned';
  return 'No record';
}

function hasRecordedCustody(s: StageStatus) {
  return s === 'completed' || s === 'current';
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

export function StageStatusChip({ status, className }: { status: StageStatus; className?: string }) {
  const m = STAGE_STATUS[status];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium',
        chipTone[m.tone],
        m.dashed && 'border-dashed',
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {m.label}
    </span>
  );
}

/** Ledger anchor for a stage's event. Simulated references are never presented as transaction hashes. */
export function AnchorChip({ anchor, className }: { anchor: JourneyStage['anchor']; className?: string }) {
  if (!anchor || !anchor.reference) {
    return (
      <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-subtle px-1.5 py-0.5 text-[11px] text-muted', className)}>
        <Link2Off className="size-3" aria-hidden />
        {anchor?.status === 'PENDING' ? 'Anchor pending' : anchor?.status === 'FAILED' ? 'Anchor failed' : 'Not anchored'}
      </span>
    );
  }
  const pending = anchor.status === 'PENDING';
  const failed = anchor.status === 'FAILED';
  const text =
    anchor.kind === 'TX_HASH'
      ? `Tx ${shortHash(anchor.reference, 4, 2)}${anchor.blockNumber != null ? ` · block ${anchor.blockNumber}` : ''}`
      : `${shortHash(anchor.reference, 10, 4)} (simulated)`;
  return (
    <span
      title={`${anchor.kind === 'TX_HASH' ? 'Blockchain transaction hash' : 'Simulated ledger reference (not a blockchain transaction)'}: ${anchor.reference}${pending ? ' — pending confirmation' : failed ? ' — anchoring failed' : ''}`}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px]',
        failed ? 'bg-danger-soft text-danger' : pending ? 'bg-warning-soft text-warning-ink' : 'bg-subtle text-charcoal',
        className,
      )}
    >
      {pending ? <Clock className="size-3 shrink-0" aria-hidden /> : failed ? <XCircle className="size-3 shrink-0" aria-hidden /> : <Link2 className="size-3 shrink-0" aria-hidden />}
      <span className="truncate">{text}</span>
      {pending && <span className="font-sans">· pending</span>}
      {failed && <span className="font-sans">· failed</span>}
    </span>
  );
}

function StageNode({ stage, size = 'md' }: { stage: JourneyStage; size?: 'sm' | 'md' }) {
  const m = STAGE_STATUS[stage.status];
  const Icon = ROLE_ICON[stage.role] ?? Package;
  return (
    <span
      className={cn(
        'relative z-[1] grid shrink-0 place-items-center rounded-full border-2',
        size === 'sm' ? 'size-9 [&_svg]:size-4' : 'size-11 [&_svg]:size-5',
        nodeTone[m.tone],
      )}
      aria-hidden
    >
      <Icon />
    </span>
  );
}

function StageBody({ stage, compact }: { stage: JourneyStage; compact?: boolean }) {
  const m = STAGE_STATUS[stage.status];
  const t = timeLabels(stage);
  const location = stage.org ? [stage.org.city, stage.org.country].filter(Boolean).join(', ') : '';
  const showAnchor = stage.status !== 'upcoming' || !!stage.anchor;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{ROLE_LABEL[stage.role]}</span>
        <StageStatusChip status={stage.status} />
      </div>
      <p className={cn('mt-1.5 font-display text-[14.5px] font-semibold leading-snug', stage.org ? 'text-ink' : m.tone === 'muted' ? 'text-muted' : 'text-charcoal italic')}>
        {orgLine(stage)}
      </p>
      {location && !compact && <p className="mt-0.5 text-[12px] text-muted">{location}</p>}

      {(stage.initiatedAt || stage.completedAt) && (
        <dl className="mt-2.5 space-y-0.5 text-[12px]">
          {stage.initiatedAt && (
            <div className="flex gap-1.5">
              <dt className="text-muted">{t.initiated}</dt>
              <dd className="tabular text-charcoal">{formatDateTime(stage.initiatedAt)}</dd>
            </div>
          )}
          {t.completed && stage.completedAt && (
            <div className="flex gap-1.5">
              <dt className="text-muted">{t.completed}</dt>
              <dd className="tabular text-charcoal">{formatDateTime(stage.completedAt)}</dd>
            </div>
          )}
        </dl>
      )}
      {stage.shipmentRef && (
        <p className="mt-1.5 text-[12px] text-muted">
          Shipment <span className="font-mono text-charcoal">{stage.shipmentRef}</span>
        </p>
      )}
      {showAnchor && (
        <div className="mt-2.5">
          <AnchorChip anchor={stage.anchor} />
        </div>
      )}
      {stage.note && !compact && <p className="mt-2 text-[12px] leading-relaxed text-muted">{stage.note}</p>}
    </div>
  );
}

/** Wraps stage content in a keyboard-operable button when selectable. */
function StageShell({
  stage,
  selected,
  onSelect,
  className,
  children,
}: {
  stage: JourneyStage;
  selected: boolean;
  onSelect?: (s: JourneyStage) => void;
  className?: string;
  children: ReactNode;
}) {
  const m = STAGE_STATUS[stage.status];
  const base = cn(
    'block w-full rounded-2xl border bg-surface p-4 text-left transition-[border,box-shadow,background] duration-150',
    m.dashed ? 'border-dashed border-line-strong bg-canvas' : 'border-line',
    stage.status === 'current' && 'border-brand/50',
    stage.status === 'unrecorded' && 'border-danger/50',
    stage.status === 'missing' && 'border-warning/60',
    selected && 'border-brand bg-surface shadow-[var(--shadow-focus)]',
    className,
  );
  if (!onSelect) return <div className={base}>{children}</div>;
  return (
    <button
      type="button"
      onClick={() => onSelect(stage)}
      aria-pressed={selected}
      aria-label={`${ROLE_LABEL[stage.role]} stage: ${orgLine(stage)}, ${m.label}. Show details`}
      className={cn(base, 'hover:border-line-strong hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]')}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Layouts                                                             */
/* ------------------------------------------------------------------ */

interface Props {
  stages: JourneyStage[];
  orientation?: 'auto' | 'vertical' | 'horizontal';
  selectedKey?: string | null;
  onSelect?: (stage: JourneyStage) => void;
  compact?: boolean;
}

function Connector({ to, direction }: { to: JourneyStage; direction: 'h' | 'v' }) {
  const solid = hasRecordedCustody(to.status);
  const pendingShip = to.status === 'in_transit';
  const color = solid ? 'border-brand' : pendingShip ? 'border-info' : to.status === 'unrecorded' ? 'border-danger' : to.status === 'missing' ? 'border-warning' : 'border-line-strong';
  return direction === 'h' ? (
    <span className={cn('absolute left-[calc(50%+26px)] right-[calc(-50%+10px)] top-[21px] border-t-2', solid ? 'border-solid' : 'border-dashed', color)} aria-hidden />
  ) : (
    <span className={cn('absolute bottom-0.5 left-[21px] top-[50px] border-l-2', solid ? 'border-solid' : 'border-dashed', color)} aria-hidden />
  );
}

function Horizontal({ stages, selectedKey, onSelect, compact }: Props) {
  return (
    <div className="scrollbar-thin -mx-1 overflow-x-auto px-1 pb-2">
      <ol className="grid gap-4" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(${compact ? 190 : 220}px, 1fr))` }} aria-label="Supply chain journey">
        {stages.map((s, i) => (
          <li key={s.key} className="relative flex flex-col items-center">
            {i < stages.length - 1 && <Connector to={stages[i + 1]} direction="h" />}
            <StageNode stage={s} />
            <span className="mt-1.5 text-[11px] font-medium tabular text-muted" aria-hidden>
              Stage {i + 1}
            </span>
            <StageShell stage={s} selected={selectedKey === s.key} onSelect={onSelect} className="mt-3 flex-1">
              <StageBody stage={s} compact={compact} />
            </StageShell>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Vertical({ stages, selectedKey, onSelect, compact }: Props) {
  return (
    <ol className="space-y-0" aria-label="Supply chain journey">
      {stages.map((s, i) => (
        <li key={s.key} className={cn('relative flex gap-4', i < stages.length - 1 && 'pb-5')}>
          {i < stages.length - 1 && <Connector to={stages[i + 1]} direction="v" />}
          <StageNode stage={s} />
          <StageShell stage={s} selected={selectedKey === s.key} onSelect={onSelect} className="min-w-0 flex-1">
            <StageBody stage={s} compact={compact} />
          </StageShell>
        </li>
      ))}
    </ol>
  );
}

/**
 * Supply-chain journey (manufacturer → distributor → wholesaler → pharmacy) exactly as returned by the API.
 * Never invents stages: missing/unrecorded/upcoming stages are rendered dashed and labelled as such.
 */
export function SupplyChainTimeline({ stages, orientation = 'auto', selectedKey = null, onSelect, compact }: Props) {
  if (stages.length === 0) {
    return <p className="rounded-xl border border-dashed border-line-strong bg-canvas px-4 py-6 text-center text-sm text-muted">No custody stages have been recorded for this batch.</p>;
  }
  const props = { stages, selectedKey, onSelect, compact };
  if (orientation === 'horizontal') return <Horizontal {...props} />;
  if (orientation === 'vertical') return <Vertical {...props} />;
  return (
    <>
      <div className="hidden lg:block">
        <Horizontal {...props} />
      </div>
      <div className="lg:hidden">
        <Vertical {...props} />
      </div>
    </>
  );
}
