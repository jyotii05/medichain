import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  BellOff,
  CheckCheck,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Flag,
  Info,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { FlagRow, NotificationRow, Paged, ReportData, Severity } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/hooks/useListState';
import { cn, formatDate, formatDateTime, relativeTime } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Pagination, type Column } from '@/components/shared/DataTable';
import { SearchAndFilterBar } from '@/components/shared/SearchAndFilterBar';
import { Badge, StatusBadge } from '@/components/shared/StatusBadge';
import { EmptyState, ErrorState } from '@/components/shared/States';
import { DetailList, InfoNote, InlineError } from '@/components/batch-actions/InlineNotice';

type Tab = 'notifications' | 'flags' | 'verifications';

const SEVERITY: Record<Severity, { icon: LucideIcon; tone: string; label: string }> = {
  INFO: { icon: Info, tone: 'bg-info-soft text-info', label: 'Information' },
  SUCCESS: { icon: CheckCircle2, tone: 'bg-success-soft text-success', label: 'Success' },
  WARNING: { icon: AlertTriangle, tone: 'bg-warning-soft text-warning-ink', label: 'Warning' },
  CRITICAL: { icon: AlertOctagon, tone: 'bg-danger-soft text-danger', label: 'Critical' },
};

export default function AlertsPage() {
  const { user } = useAuth();
  const isRegulator = user?.role === 'REGULATOR';
  const list = useListState({ pageSize: 15 }, ['tab', 'unread', 'severity', 'status', 'result'] as const);
  const tabs: Tab[] = isRegulator ? ['notifications', 'flags', 'verifications'] : ['notifications'];
  const tab: Tab = tabs.includes(list.tab as Tab) ? (list.tab as Tab) : 'notifications';

  const setTab = (t: string) => list.update({ tab: t === 'notifications' ? '' : t, unread: '', severity: '', status: '', result: '', search: '' });

  return (
    <>
      <PageHeader
        title="Notifications & alerts"
        description={
          isRegulator
            ? 'Your notifications, suspicion reports raised by partners, and verification checks that did not match the records.'
            : 'Shipment updates, recalls and other notices for your account.'
        }
      />
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        {tabs.length > 1 && (
          <TabsList aria-label="Alert type">
            <TabsTrigger value="notifications">
              <Bell aria-hidden /> Notifications
            </TabsTrigger>
            <TabsTrigger value="flags">
              <Flag aria-hidden /> Flagged batches
            </TabsTrigger>
            <TabsTrigger value="verifications">
              <ShieldAlert aria-hidden /> Suspicious verifications
            </TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="notifications">{tab === 'notifications' && <NotificationsPanel list={list} />}</TabsContent>
        {isRegulator && (
          <>
            <TabsContent value="flags">{tab === 'flags' && <FlagsPanel list={list} />}</TabsContent>
            <TabsContent value="verifications">{tab === 'verifications' && <VerificationsPanel list={list} />}</TabsContent>
          </>
        )}
      </Tabs>
    </>
  );
}

type ListState = ReturnType<typeof useListState<'tab' | 'unread' | 'severity' | 'status' | 'result'>>;

/* ------------------------------ Notifications ------------------------------ */

function NotificationsPanel({ list }: { list: ListState }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const unreadOnly = list.unread === 'true';
  const severity = (Object.keys(SEVERITY) as Severity[]).includes(list.severity as Severity) ? list.severity : '';

  const q = useQuery({
    queryKey: ['notifications', 'page', list.page, unreadOnly, severity],
    queryFn: () => api.get<Paged<NotificationRow> & { unread: number }>('/notifications', { page: list.page, pageSize: list.pageSize, unread: unreadOnly ? 'true' : undefined, severity }),
    placeholderData: keepPreviousData,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e) => toast.error(errorMessage(e, 'Could not mark as read')),
  });
  const markAll = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/read-all'),
    onSuccess: (r) => {
      toast.success(r.updated ? `Marked ${r.updated} notification${r.updated === 1 ? '' : 's'} as read` : 'Everything is already read');
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => toast.error(errorMessage(e, 'Could not mark notifications as read')),
  });

  const open = (n: NotificationRow) => {
    if (!n.readAt) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  const unread = q.data?.unread ?? 0;
  const filtered = unreadOnly || !!severity;

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 lg:flex-row lg:items-center">
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Read state">
          {[
            { v: '', label: 'All' },
            { v: 'true', label: 'Unread' },
          ].map((f) => {
            const active = (unreadOnly ? 'true' : '') === f.v;
            return (
              <button
                key={f.label}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => list.set('unread', f.v)}
                className={cn('h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors', active ? 'bg-ink text-white' : 'text-charcoal hover:bg-subtle hover:text-ink')}
              >
                {f.label}
                {f.v === 'true' && unread > 0 && (
                  <span className={cn('tabular ml-1.5 rounded-full px-1.5 text-[11px]', active ? 'bg-white/20' : 'bg-brand-soft text-brand-ink')}>{unread}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <div className="w-full sm:w-44">
            <Select value={severity} onChange={(e) => list.set('severity', e.target.value)} aria-label="Filter by severity" className="h-9">
              <option value="">All severities</option>
              {(Object.keys(SEVERITY) as Severity[]).map((s) => (
                <option key={s} value={s}>
                  {SEVERITY[s].label}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="outline" size="sm" className="h-9" onClick={() => markAll.mutate()} loading={markAll.isPending} disabled={unread === 0}>
            <CheckCheck /> Mark all as read
          </Button>
        </div>
      </div>

      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <div className="divide-y divide-line" aria-busy="true" aria-label="Loading notifications">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3 px-5 py-4">
              <Skeleton className="size-9 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : q.data.items.length === 0 ? (
        <EmptyState
          icon={filtered ? <BellOff /> : <Bell />}
          title={unreadOnly && !severity ? 'You’re all caught up' : filtered ? 'No notifications match your filters' : 'No notifications yet'}
          description={
            unreadOnly && !severity ? 'There are no unread notifications.' : filtered ? 'Try a different filter.' : 'Shipment updates, recalls and approvals will appear here.'
          }
        />
      ) : (
        <>
          <ul className={cn('divide-y divide-line transition-opacity', q.isFetching && 'opacity-60')}>
            {q.data.items.map((n) => {
              const s = SEVERITY[n.severity];
              const Icon = s.icon;
              const isUnread = !n.readAt;
              return (
                <li key={n.id} className={cn('group relative flex items-start gap-3 px-5 py-4 transition-colors hover:bg-canvas', isUnread && 'bg-brand-soft/20')}>
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl', s.tone)} aria-hidden>
                    <Icon className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {isUnread && <span className="size-2 rounded-full bg-brand" aria-hidden />}
                      <button
                        type="button"
                        onClick={() => open(n)}
                        className={cn('text-left text-sm text-ink after:absolute after:inset-0 hover:underline focus-visible:outline-none', isUnread ? 'font-semibold' : 'font-medium')}
                      >
                        <span className="sr-only">
                          {s.label}
                          {isUnread ? ', unread' : ''}:{' '}
                        </span>
                        {n.title}
                      </button>
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-charcoal">{n.message}</p>
                    <p className="mt-1 text-[12px] text-muted">
                      <time dateTime={n.createdAt} title={formatDateTime(n.createdAt)}>
                        {relativeTime(n.createdAt)}
                      </time>
                    </p>
                  </div>
                  <div className="relative z-10 flex shrink-0 items-center gap-1">
                    {isUnread && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => markRead.mutate(n.id)}
                        disabled={markRead.isPending && markRead.variables === n.id}
                        aria-label={`Mark “${n.title}” as read`}
                      >
                        <CheckCheck /> <span className="hidden sm:inline">Mark read</span>
                      </Button>
                    )}
                    {n.link && <ChevronRight className="size-4 text-muted" aria-hidden />}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPageChange={list.setPage} />
        </>
      )}
    </Card>
  );
}

/* ------------------------------ Flagged batches ------------------------------ */

const FLAG_FILTERS = [
  { value: '', label: 'Open' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'DISMISSED', label: 'Dismissed' },
  { value: 'ALL', label: 'All' },
];

function FlagsPanel({ list }: { list: ListState }) {
  const navigate = useNavigate();
  const [reviewing, setReviewing] = useState<FlagRow | null>(null);
  // The default view is open flags; "ALL" clears the status filter.
  const filter = ['RESOLVED', 'DISMISSED', 'ALL'].includes(list.status) ? list.status : '';
  const status = filter === '' ? 'OPEN' : filter === 'ALL' ? undefined : filter;

  const q = useQuery({
    queryKey: ['flags', list.page, status],
    queryFn: () => api.get<Paged<FlagRow>>('/flags', { page: list.page, pageSize: list.pageSize, status }),
    placeholderData: keepPreviousData,
  });

  const columns: Column<FlagRow>[] = [
    {
      key: 'batch',
      header: 'Batch',
      cell: (f) =>
        f.batch ? (
          <div className="min-w-[150px] leading-tight">
            <p className="font-medium text-ink">{f.batch.medicineName}</p>
            <p className="mt-0.5 font-mono text-[11.5px] text-muted">{f.batch.batchNumber}</p>
          </div>
        ) : (
          '—'
        ),
    },
    {
      key: 'reason',
      header: 'Concern',
      cell: (f) => (
        <div className="max-w-[340px]">
          <p className="line-clamp-2 text-[13px] leading-snug text-charcoal" title={f.reason}>
            {f.reason}
          </p>
          {f.resolution && (
            <p className="mt-1 line-clamp-1 text-[12px] text-muted" title={f.resolution}>
              Outcome: {f.resolution}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'raisedBy',
      header: 'Raised by',
      hideBelow: 'md',
      cell: (f) => (
        <div className="leading-tight">
          <p className="text-[13px] text-ink">{f.org.name}</p>
          <p className="mt-0.5 text-[12px] text-muted">{f.raisedBy}</p>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Raised',
      hideBelow: 'lg',
      cell: (f) => (
        <div className="leading-tight">
          <p className="tabular text-[13px]">{formatDate(f.createdAt)}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">{relativeTime(f.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (f) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={f.status} />
          {f.batch && f.batch.status !== 'ACTIVE' && <StatusBadge status={f.batch.status} size="sm" />}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      cell: (f) => (
        <Button
          size="sm"
          variant={f.status === 'OPEN' ? 'subtle' : 'ghost'}
          onClick={(e) => {
            e.stopPropagation();
            setReviewing(f);
          }}
        >
          {f.status === 'OPEN' ? 'Review' : 'Details'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 sm:flex-row sm:items-center">
          <div className="scrollbar-thin -mx-1 flex items-center gap-1 overflow-x-auto px-1" role="radiogroup" aria-label="Flag status">
            {FLAG_FILTERS.map((f) => {
              const active = filter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => list.set('status', f.value)}
                  className={cn('h-8 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium transition-colors', active ? 'bg-ink text-white' : 'text-charcoal hover:bg-subtle hover:text-ink')}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <p className="text-[12.5px] text-muted sm:ml-auto">Suspicion reports raised by supply-chain partners.</p>
        </div>
        <DataTable
          caption="Flagged batches"
          columns={columns}
          rows={q.data?.items}
          rowKey={(f) => f.id}
          loading={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          onRowClick={(f) => (f.batch ? navigate(`/app/batches/${f.batch.id}`) : setReviewing(f))}
          empty={{
            icon: <Flag />,
            title: status === 'OPEN' ? 'No open flags' : 'No flags to show',
            description: status === 'OPEN' ? 'Partners have not raised any suspicion reports that need review.' : 'Try a different status filter.',
          }}
          pagination={q.data ? { page: q.data.page, totalPages: q.data.totalPages, total: q.data.total, pageSize: q.data.pageSize, onPageChange: list.setPage } : undefined}
        />
      </Card>
      <ResolveFlagDialog flag={reviewing} onOpenChange={(o) => !o && setReviewing(null)} />
    </>
  );
}

function ResolveFlagDialog({ flag, onOpenChange }: { flag: FlagRow | null; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const id = useId();
  const open = !!flag;
  const [outcome, setOutcome] = useState<'RESOLVED' | 'DISMISSED'>('RESOLVED');
  const [resolution, setResolution] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setOutcome('RESOLVED');
      setResolution('');
      setFieldError(null);
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.post(`/flags/${flag!.id}/resolve`, { outcome, resolution: resolution.trim() }),
    onSuccess: () => {
      toast.success(outcome === 'RESOLVED' ? 'Flag resolved' : 'Flag dismissed', { description: `The reporting organization (${flag!.org.name}) can see the outcome on the batch record.` });
      for (const key of ['flags', 'batch', 'batches', 'dashboard']) void qc.invalidateQueries({ queryKey: [key] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'FLAG_CLOSED') {
        toast.error('This flag was already closed', { description: 'The list has been refreshed.' });
        void qc.invalidateQueries({ queryKey: ['flags'] });
        onOpenChange(false);
      } else if (e instanceof ApiError && e.fieldErrors.resolution) setFieldError(e.fieldErrors.resolution);
      else setError(errorMessage(e, 'Could not close this flag'));
    },
  });

  const submit = () => {
    setError(null);
    if (resolution.trim().length < 5) return setFieldError('Please add a short resolution note (at least 5 characters)');
    mutation.mutate();
  };

  const isOpen = flag?.status === 'OPEN';

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      {flag && (
        <DialogContent
          size="lg"
          icon={<Flag />}
          title={isOpen ? 'Review flagged batch' : 'Flag details'}
          description={
            flag.batch ? (
              <>
                {flag.batch.medicineName} · <span className="font-mono">{flag.batch.batchNumber}</span>
              </>
            ) : undefined
          }
          footer={
            isOpen ? (
              <>
                <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
                  Cancel
                </Button>
                <Button variant={outcome === 'DISMISSED' ? 'secondary' : 'primary'} onClick={submit} loading={mutation.isPending}>
                  {outcome === 'RESOLVED' ? 'Mark resolved' : 'Dismiss flag'}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            )
          }
        >
          <div className="space-y-5">
            <blockquote className="rounded-xl border border-line bg-canvas p-4 text-sm leading-relaxed text-ink">“{flag.reason}”</blockquote>
            <DetailList
              items={[
                { label: 'Raised by', value: `${flag.raisedBy}, ${flag.org.name}` },
                { label: 'Raised', value: formatDateTime(flag.createdAt) },
                { label: 'Flag status', value: <StatusBadge status={flag.status} size="sm" /> },
                { label: 'Batch status', value: flag.batch ? <StatusBadge status={flag.batch.status} size="sm" /> : '—' },
                ...(flag.resolution
                  ? [{ label: 'Resolution', value: `${flag.resolution}${flag.resolvedBy ? ` — ${flag.resolvedBy}` : ''}${flag.resolvedAt ? `, ${formatDate(flag.resolvedAt)}` : ''}`, full: true }]
                  : []),
              ]}
            />
            {flag.batch && (
              <Link
                to={`/app/batches/${flag.batch.id}`}
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-ink underline-offset-4 hover:underline"
              >
                Open batch record{isOpen && flag.batch.status === 'ACTIVE' ? ' (issue a recall from there if needed)' : ''} <ChevronRight className="size-3.5" aria-hidden />
              </Link>
            )}
            {isOpen && (
              <>
                <fieldset>
                  <legend className="mb-1.5 text-[13px] font-medium text-charcoal">Outcome</legend>
                  <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
                    {[
                      { v: 'RESOLVED' as const, label: 'Resolved', icon: CheckCircle2, text: 'The concern was investigated and addressed.' },
                      { v: 'DISMISSED' as const, label: 'Dismissed', icon: CircleDashed, text: 'No issue found; the report did not need action.' },
                    ].map((o) => {
                      const active = outcome === o.v;
                      const Icon = o.icon;
                      return (
                        <label
                          key={o.v}
                          className={cn(
                            'flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors has-[:focus-visible]:shadow-[var(--shadow-focus)]',
                            active ? 'border-brand bg-brand-soft/50' : 'border-line hover:border-line-strong hover:bg-canvas',
                          )}
                        >
                          <input type="radio" name={`${id}-outcome`} className="sr-only" checked={active} onChange={() => setOutcome(o.v)} />
                          <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-brand-ink' : 'text-muted')} aria-hidden />
                          <span>
                            <span className="block text-sm font-semibold text-ink">{o.label}</span>
                            <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{o.text}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <Field label="Resolution note" htmlFor={`${id}-res`} required error={fieldError ?? undefined} hint="Recorded on the batch history · at least 5 characters">
                  <Textarea
                    id={`${id}-res`}
                    rows={3}
                    maxLength={1000}
                    value={resolution}
                    onChange={(e) => {
                      setResolution(e.target.value);
                      setFieldError(null);
                    }}
                    placeholder="e.g. Sample tested by the national laboratory; results within specification."
                    aria-invalid={!!fieldError}
                    aria-describedby={`${id}-res-msg`}
                  />
                </Field>
                {error && <InlineError>{error}</InlineError>}
              </>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

/* --------------------------- Suspicious verifications --------------------------- */

const RESULT_FILTERS = [
  { value: '', label: 'Suspicious' },
  { value: 'UNKNOWN', label: 'Unknown ID' },
];

function VerificationsPanel({ list }: { list: ListState }) {
  const result = list.result === 'UNKNOWN' ? 'UNKNOWN' : 'SUSPICIOUS';
  const q = useQuery({
    queryKey: ['reports', 'verifications', result, list.page, list.search],
    queryFn: () => api.get<ReportData>('/reports/data', { type: 'verifications', status: result, page: list.page, pageSize: list.pageSize, search: list.search }),
    placeholderData: keepPreviousData,
  });

  type Row = ReportData['rows'][number] & { __i: number };
  const str = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '—' : String(v));

  const columns: Column<Row>[] = [
    { key: 'createdAt', header: 'Checked at', hideBelow: 'sm', cell: (r) => <span className="tabular whitespace-nowrap text-[13px]">{str(r.createdAt)}</span> },
    { key: 'queriedId', header: 'Identifier queried', cell: (r) => <span className="font-mono text-[12.5px] text-ink">{str(r.queriedId)}</span> },
    {
      key: 'medicine',
      header: 'Medicine',
      hideBelow: 'md',
      cell: (r) => (r.medicine && r.medicine !== '—' ? <span className="text-[13px]">{str(r.medicine)}</span> : <span className="text-[13px] text-muted">No matching batch</span>),
    },
    { key: 'result', header: 'Result', cell: (r) => <StatusBadge status={str(r.result)} /> },
    { key: 'channel', header: 'Channel', hideBelow: 'lg', cell: (r) => <Badge tone="neutral">{str(r.channel).charAt(0) + str(r.channel).slice(1).toLowerCase()}</Badge> },
    {
      key: 'reasons',
      header: 'Reasons',
      hideBelow: 'md',
      cell: (r) => {
        const reasons = String(r.reasons ?? '')
          .split(' | ')
          .filter(Boolean);
        return reasons.length ? (
          <ul className="max-w-[380px] list-disc space-y-0.5 pl-4 text-[12.5px] leading-snug text-charcoal">
            {reasons.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        ) : (
          <span className="text-muted">—</span>
        );
      },
    },
  ];

  const rows: Row[] | undefined = q.data?.rows.map((r, i) => ({ ...r, __i: i }));

  return (
    <div className="space-y-4">
      <InfoNote icon={<ShieldCheck />}>
        These are checks where the scanned identifier did not match MediChain records cleanly. A suspicious or unknown result is a signal for investigation, not proof
        of counterfeiting.
      </InfoNote>
      <Card>
        <SearchAndFilterBar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search identifier or batch number"
          filters={RESULT_FILTERS}
          filterValue={list.result === 'UNKNOWN' ? 'UNKNOWN' : ''}
          onFilterChange={(v) => list.set('result', v)}
        />
        <DataTable
          caption={result === 'UNKNOWN' ? 'Verifications of unknown identifiers' : 'Suspicious verifications'}
          columns={columns}
          rows={rows}
          rowKey={(r) => `${r.__i}-${String(r.createdAt)}-${String(r.queriedId)}`}
          loading={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={{
            icon: <ShieldCheck />,
            title: list.search ? 'No checks match your search' : result === 'UNKNOWN' ? 'No unknown identifiers checked' : 'No suspicious verifications',
            description: list.search ? 'Try a different identifier.' : 'Verification checks with this result will be listed here.',
          }}
          pagination={q.data ? { page: q.data.page, totalPages: q.data.totalPages, total: q.data.total, pageSize: q.data.pageSize, onPageChange: list.setPage } : undefined}
        />
      </Card>
    </div>
  );
}
