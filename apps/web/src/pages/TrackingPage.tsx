import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Boxes, ChevronRight, Database, Fingerprint, Link2, Link2Off, MapPin, Route, ScanSearch, Search, ShieldCheck, Truck, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { BatchDetail, BatchRow, JourneyStage, Paged } from '@/lib/types';
import { cn, formatDate, formatDateTime, formatNumber, ROLE_LABEL } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { EmptyState, ErrorState, HashText } from '@/components/shared/States';
import { ROLE_ICON, STAGE_STATUS, StageStatusChip, SupplyChainTimeline } from '@/components/batch/SupplyChainTimeline';
import { RecallAlert } from '@/components/recalls/RecallAlert';

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The stage to focus by default: the current custodian / in-transit leg, else the last recorded stage. */
function defaultStage(stages: JourneyStage[]) {
  return (
    [...stages].reverse().find((s) => s.status === 'in_transit') ??
    stages.find((s) => s.status === 'current') ??
    [...stages].reverse().find((s) => s.status !== 'upcoming') ??
    stages[0] ??
    null
  );
}

export default function TrackingPage() {
  const { id } = useParams();
  return (
    <>
      <PageHeader
        title="Supply-chain tracking"
        description="Follow a batch from manufacturer to pharmacy. Every stage is derived from the batch's hash-chained event history — nothing is inferred or filled in."
      />
      <div className="space-y-6">
        <BatchSearch compact={!!id} />
        {id ? <TrackedBatch id={id} /> : <RecentBatches />}
      </div>
    </>
  );
}

/* ------------------------------- Search ------------------------------- */

function BatchSearch({ compact }: { compact: boolean }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const q = useQuery({
    queryKey: ['batches', 'tracking-search', search],
    queryFn: () => api.get<Paged<BatchRow>>('/batches', { search, pageSize: 8, sort: 'createdAt', order: 'desc' }),
    enabled: search.length >= 2,
    placeholderData: keepPreviousData,
  });

  const pick = (b: BatchRow) => {
    setTerm('');
    navigate(`/app/tracking/${b.id}`);
  };

  return (
    <Card>
      <CardBody className={cn(compact ? 'py-4' : 'py-6')}>
        {!compact && (
          <div className="mb-4">
            <h2 className="text-[15px] font-semibold">Find a batch</h2>
            <p className="mt-0.5 text-[13px] text-muted">Search by public batch ID (MC-…), batch number or medicine name.</p>
          </div>
        )}
        <div role="search" className="relative">
          <Input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={compact ? 'Track another batch — ID, batch number or medicine' : 'e.g. MC-7K2Q-…, AMX-2026-0915 or Amoxicillin'}
            aria-label="Search batches to track"
            leftIcon={<Search />}
            className={compact ? 'h-10' : 'h-12 text-[15px]'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && q.data?.items.length === 1) pick(q.data.items[0]);
              if (e.key === 'Escape') setTerm('');
            }}
            rightSlot={
              term ? (
                <button type="button" onClick={() => setTerm('')} className="grid size-8 place-items-center rounded-md text-muted hover:bg-subtle hover:text-ink" aria-label="Clear search">
                  <X className="size-4" />
                </button>
              ) : undefined
            }
          />
        </div>
        {search.length >= 2 && (
          <div className="mt-3 rounded-xl border border-line" aria-live="polite">
            {q.isLoading ? (
              <div className="space-y-3 p-4">
                <Skeleton className="w-2/3" />
                <Skeleton className="w-1/2" />
              </div>
            ) : q.error ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-6" />
            ) : q.data && q.data.items.length === 0 ? (
              <p className="px-4 py-5 text-center text-[13px] text-muted">No batches visible to your organization match “{search}”.</p>
            ) : (
              <ul className="divide-y divide-line" aria-label="Search results">
                {q.data?.items.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => pick(b)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none">
                      <BatchLine b={b} />
                      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                    </button>
                  </li>
                ))}
                {q.data && q.data.total > q.data.items.length && (
                  <li className="px-4 py-2.5 text-[12px] text-muted">
                    Showing {q.data.items.length} of {formatNumber(q.data.total)} matches — refine your search to narrow down.
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function BatchLine({ b }: { b: BatchRow }) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {b.medicine.name} <span className="font-normal text-muted">{b.medicine.strength}</span>
        </p>
        <p className="mt-0.5 truncate text-[12px] text-muted">
          <span className="font-mono text-charcoal">{b.batchNumber}</span> · <span className="font-mono">{b.publicId}</span>
        </p>
      </div>
      <span className="hidden text-[12.5px] text-muted md:block">{b.currentCustodian.name}</span>
      <StatusBadge status={b.displayStatus} size="sm" />
    </div>
  );
}

/* ------------------------------- Empty state ------------------------------- */

function RecentBatches() {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['batches', 'tracking-recent'],
    queryFn: () => api.get<Paged<BatchRow>>('/batches', { pageSize: 9, sort: 'createdAt', order: 'desc' }),
  });
  return (
    <Card>
      <CardHeader icon={<Route />} title="Recent batches" description="Pick a batch to see its journey" />
      {q.isLoading ? (
        <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-line p-4">
              <Skeleton className="w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data || q.data.items.length === 0 ? (
        <EmptyState icon={<Boxes />} title="No batches to track yet" description="Batches appear here once they are registered by, or shipped to, your organization." />
      ) : (
        <ul className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {q.data.items.map((b) => {
            const Icon = ROLE_ICON[b.currentCustodian.type];
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/app/tracking/${b.id}`)}
                  className="group flex h-full w-full flex-col rounded-xl border border-line bg-surface p-4 text-left transition-[border,box-shadow] hover:border-line-strong hover:shadow-[var(--shadow-card)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
                >
                  <div className="flex w-full items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {b.medicine.name} <span className="font-normal text-muted">{b.medicine.strength}</span>
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[12px] text-charcoal">{b.batchNumber}</p>
                    </div>
                    <StatusBadge status={b.displayStatus} size="sm" />
                  </div>
                  <div className="mt-3 flex w-full items-center gap-2 border-t border-line pt-3 text-[12.5px] text-muted">
                    <Icon className="size-4 shrink-0 text-brand-ink" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{b.currentCustodian.name}</span>
                    <ArrowRight className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------- Tracked batch ------------------------------- */

function TrackedBatch({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['batch', id], queryFn: () => api.get<BatchDetail>(`/batches/${encodeURIComponent(id)}`) });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => setSelectedKey(null), [id]);

  if (q.isLoading) {
    return (
      <Card className="space-y-4 p-6" aria-busy="true" aria-label="Loading batch journey">
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <div className="grid gap-4 pt-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      </Card>
    );
  }
  if (q.error || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <Card>
        {notFound ? (
          <EmptyState icon={<ScanSearch />} title="Batch not found" description="It may not exist or may not be visible to your organization. Search for another batch above." />
        ) : (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        )}
      </Card>
    );
  }

  const { batch, journey, assessment, events, recalls } = q.data;
  const fallback = defaultStage(journey);
  const selected = journey.find((s) => s.key === selectedKey) ?? fallback;
  const latestRecall = [...recalls].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const recorded = journey.filter((s) => s.status === 'completed' || s.status === 'current').length;

  return (
    <div className="space-y-6">
      {(batch.status === 'RECALLED' || batch.status === 'BLOCKED') && latestRecall && <RecallAlert recall={latestRecall} />}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-line px-5 py-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={batch.displayStatus} />
              <StatusBadge status={assessment.result} />
            </div>
            <h2 className="mt-2 text-xl font-semibold">
              {batch.medicine.name} {batch.medicine.strength}
            </h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
              <span>
                Batch <span className="font-mono text-charcoal">{batch.batchNumber}</span>
              </span>
              <span>
                ID <span className="font-mono text-charcoal">{batch.publicId}</span>
              </span>
              <span>Expires {formatDate(batch.expiryDate)}</span>
              <span>
                {formatNumber(batch.quantityOnHand)} {batch.unit} on hand
              </span>
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link to={`/app/batches/${batch.id}`}>
              <Button variant="outline">
                Batch details <ArrowRight />
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-3">
          <MiniStat icon={<MapPin />} label="Current custodian" value={batch.currentCustodian.name} sub={ROLE_LABEL[batch.currentCustodian.type]} />
          <MiniStat icon={<Route />} label="Recorded custody stages" value={`${recorded} of ${journey.length}`} sub={batch.hasPendingTransfer ? 'Shipment in transit' : 'No shipment in transit'} />
          <MiniStat icon={<ShieldCheck />} label="Record integrity" value={assessment.headline} sub={assessment.chain?.summary ?? 'Ledger check unavailable'} />
        </div>

        <CardBody className="pt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold">Journey</h3>
            <p className="text-[12.5px] text-muted">Select a stage to inspect its record.</p>
          </div>
          <SupplyChainTimeline stages={journey} orientation="auto" selectedKey={selected?.key ?? null} onSelect={(s) => setSelectedKey(s.key)} />
        </CardBody>
      </Card>

      {selected && <StageDetail stage={selected} eventCount={events.length} anchoredCount={assessment.chain?.anchored ?? null} />}
    </div>
  );
}

function MiniStat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 bg-surface px-5 py-4">
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        <span className="text-brand-ink [&_svg]:size-3.5">{icon}</span>
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 truncate text-[12px] text-muted" title={sub}>
          {sub}
        </p>
      )}
    </div>
  );
}

/* ------------------------------- Stage detail ------------------------------- */

function StageDetail({ stage, eventCount, anchoredCount }: { stage: JourneyStage; eventCount: number; anchoredCount: number | null }) {
  const meta = STAGE_STATUS[stage.status];
  const Icon = ROLE_ICON[stage.role];
  const location = stage.org ? [stage.org.city, stage.org.country].filter(Boolean).join(', ') : '';
  const isMfr = stage.role === 'MANUFACTURER';

  const verification = useMemo(() => {
    if (stage.status === 'upcoming') return { tone: 'muted', text: 'No record yet — this stage has not been reached.' };
    if (stage.status === 'missing') return { tone: 'warning', text: 'No custody record exists for this stage. The batch skipped it or the hand-over was not recorded.' };
    if (stage.status === 'unrecorded') return { tone: 'danger', text: 'Custody changed without a matching accepted transfer. Treat this batch with caution.' };
    if (!stage.eventHash) return { tone: 'warning', text: 'No hash-chained event is linked to this stage.' };
    if (!stage.anchor || !stage.anchor.reference) {
      if (stage.anchor?.status === 'FAILED') return { tone: 'danger', text: 'The event is in the hash chain, but anchoring it to the ledger failed.' };
      return { tone: 'warning', text: 'The event is in the hash chain but has not been anchored to the ledger yet.' };
    }
    if (stage.anchor.status === 'PENDING') return { tone: 'warning', text: 'The event is in the hash chain; its ledger anchor is awaiting confirmation.' };
    if (stage.anchor.status === 'FAILED') return { tone: 'danger', text: 'Anchoring this event failed.' };
    return {
      tone: 'success',
      text:
        stage.anchor.kind === 'TX_HASH'
          ? 'The event is in the hash chain and its hash was anchored in a confirmed blockchain transaction.'
          : 'The event is in the hash chain and recorded in the simulated (database) ledger. This is not a blockchain transaction.',
    };
  }, [stage]);

  const toneCls: Record<string, string> = {
    success: 'border-success/25 bg-success-soft/60 text-success',
    warning: 'border-warning/40 bg-warning-soft/70 text-warning-ink',
    danger: 'border-danger/25 bg-danger-soft/70 text-danger',
    muted: 'border-dashed border-line-strong bg-canvas text-muted',
  };

  return (
    <Card className="animate-fade-in" aria-live="polite">
      <CardHeader
        icon={<Icon />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {ROLE_LABEL[stage.role]} stage
            <StageStatusChip status={stage.status} />
          </span>
        }
        description={stage.org ? `${stage.org.name}${location ? ` · ${location}` : ''}` : meta.label}
      />
      <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-5">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <SItem label="Organization" value={stage.org?.name ?? (stage.status === 'upcoming' ? 'Not yet assigned' : 'No record')} />
            <SItem label="Role" value={ROLE_LABEL[stage.role]} />
            <SItem label={isMfr ? 'Registered' : 'Shipped'} value={stage.initiatedAt ? formatDateTime(stage.initiatedAt) : null} />
            {!isMfr && (
              <SItem
                label={stage.status === 'rejected' ? 'Rejected' : stage.status === 'cancelled' ? 'Cancelled' : 'Received'}
                value={stage.completedAt ? formatDateTime(stage.completedAt) : stage.status === 'in_transit' ? 'Awaiting acceptance' : null}
              />
            )}
            <SItem label="Shipment reference" value={stage.shipmentRef ? <span className="font-mono">{stage.shipmentRef}</span> : null} />
            <SItem label="Note" value={stage.note} />
          </dl>
          <div className={cn('flex items-start gap-2.5 rounded-xl border px-4 py-3 text-[13px]', toneCls[verification.tone])}>
            {verification.tone === 'success' ? <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : verification.tone === 'muted' ? <Route className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Link2Off className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <div>
              <p className="font-semibold">Verification status</p>
              <p className="mt-0.5 leading-relaxed text-charcoal">{verification.text}</p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <IdRow
            icon={<Database />}
            label="Database event ID"
            help="Primary key of the event row in MediChain's database."
            value={stage.eventId ? <span className="break-all font-mono text-[12px] text-charcoal">{stage.eventId}</span> : null}
          />
          <IdRow icon={<Fingerprint />} label="Event hash" help="Keccak-256 hash linking this event to the previous one in the batch's chain." value={stage.eventHash ? <HashText value={stage.eventHash} full /> : null} />
          {stage.anchor?.kind === 'TX_HASH' ? (
            <>
              <IdRow icon={<Link2 />} label="Blockchain transaction hash" help="Transaction that anchored the event hash on-chain." value={stage.anchor.reference ? <HashText value={stage.anchor.reference} full /> : null} />
              <IdRow icon={<Boxes />} label="Block number" value={stage.anchor.blockNumber != null ? <span className="tabular font-mono text-[12px] text-charcoal">{stage.anchor.blockNumber}</span> : null} />
            </>
          ) : stage.anchor?.kind === 'SIMULATED_REF' ? (
            <IdRow
              icon={<Link2 />}
              label="Simulated ledger reference"
              help="Entry in the tamper-evident database ledger (simulation mode). Not a blockchain transaction hash."
              value={stage.anchor.reference ? <HashText value={stage.anchor.reference} full /> : null}
            />
          ) : (
            <IdRow icon={<Link2Off />} label="Ledger anchor" value={null} emptyText={stage.status === 'upcoming' ? 'Not applicable yet' : 'Not anchored'} />
          )}
          <p className="flex items-center gap-1.5 pt-1 text-[12px] text-muted">
            <Truck className="size-3.5" aria-hidden />
            Batch history: {formatNumber(eventCount)} events{anchoredCount != null ? `, ${formatNumber(anchoredCount)} anchored` : ''}.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

function SItem({ label, value }: { label: string; value: ReactNode }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="min-w-0">
      <dt className="text-[12px] font-medium text-muted">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-sm', empty ? 'text-muted' : 'text-ink')}>{empty ? '—' : value}</dd>
    </div>
  );
}

function IdRow({ icon, label, help, value, emptyText = '—' }: { icon: ReactNode; label: string; help?: string; value: ReactNode; emptyText?: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-canvas px-3.5 py-3">
      <span className="mt-0.5 text-muted [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-charcoal">{label}</p>
        <div className="mt-0.5">{value ?? <span className="text-[12.5px] text-muted">{emptyText}</span>}</div>
        {help && <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{help}</p>}
      </div>
    </div>
  );
}
