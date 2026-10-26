import { useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { Activity, BarChart3, CalendarRange, Download, FileSpreadsheet, Link2, ShieldCheck, Truck } from 'lucide-react';
import { api, downloadFile, errorMessage, withQuery } from '@/lib/api';
import type { ChainMode, ReportData } from '@/lib/types';
import { useListState } from '@/hooks/useListState';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Skeleton, Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SearchAndFilterBar, type FilterOption } from '@/components/shared/SearchAndFilterBar';
import { Badge, StatusBadge, statusDef } from '@/components/shared/StatusBadge';
import { EmptyState, ErrorState, HashText } from '@/components/shared/States';
import { ChartFrame, ChartTooltip, Legend, SERIES_COLORS, STATUS_COLORS, axisProps, gridProps } from '@/components/shared/Chart';
import { cn, formatDate, formatNumber, ROLE_LABEL } from '@/lib/utils';

/* ------------------------------ config ------------------------------ */

const REPORT_TYPES = ['batches', 'expiring', 'expired', 'recalls', 'transfers', 'verifications', 'organizations', 'blockchain'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

const ALL: FilterOption = { value: '', label: 'All' };
const opt = (...values: string[]): FilterOption[] => [ALL, ...values.map((v) => ({ value: v, label: statusDef(v).label }))];

const TYPE_META: Record<ReportType, { label: string; description: string; filters?: FilterOption[]; dated: boolean; search: string }> = {
  batches: { label: 'Batches', description: 'Batches registered in the selected period.', filters: opt('ACTIVE', 'EXPIRED', 'RECALLED', 'BLOCKED'), dated: true, search: 'Search batch, ID, medicine or manufacturer' },
  expiring: { label: 'Expiring', description: 'Active batches expiring within the next 90 days (independent of the date range).', dated: false, search: 'Search batch, ID, medicine or manufacturer' },
  expired: { label: 'Expired', description: 'Batches past their expiry date (independent of the date range).', dated: false, search: 'Search batch, ID, medicine or manufacturer' },
  recalls: {
    label: 'Recalls',
    description: 'Recall and block notices issued in the selected period.',
    filters: [ALL, { value: 'RECALL', label: 'Recalls' }, { value: 'BLOCK', label: 'Blocks' }],
    dated: true,
    search: 'Search reference, reason, batch or medicine',
  },
  transfers: { label: 'Transfers', description: 'Custody transfers initiated in the selected period.', filters: opt('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'), dated: true, search: 'Search shipment, batch or organization' },
  verifications: {
    label: 'Verifications',
    description: 'Verification attempts (public and partner) in the selected period.',
    filters: [ALL, ...['VERIFIED', 'SUSPICIOUS', 'UNKNOWN', 'RECALLED', 'EXPIRED'].map((v) => ({ value: v, label: v === 'VERIFIED' ? 'Verified' : statusDef(v).label }))],
    dated: true,
    search: 'Search identifier or batch',
  },
  organizations: { label: 'Organizations', description: 'Organization activity in the selected period.', filters: opt('APPROVED', 'PENDING', 'SUSPENDED'), dated: true, search: 'Search name or licence' },
  blockchain: { label: 'Blockchain', description: 'Ledger / blockchain records created in the selected period.', filters: opt('CONFIRMED', 'PENDING', 'FAILED'), dated: true, search: 'Search reference, hash or batch' },
};

const ACTIVITY = [
  { key: 'registrations', label: 'Registrations', color: SERIES_COLORS[0] },
  { key: 'shipments', label: 'Shipments sent', color: SERIES_COLORS[1] },
  { key: 'deliveries', label: 'Deliveries accepted', color: SERIES_COLORS[2] },
  { key: 'rejections', label: 'Rejections', color: SERIES_COLORS[3] },
  { key: 'recalls', label: 'Recalls / blocks', color: SERIES_COLORS[4] },
] as const;

const PRESETS = [30, 90, 180] as const;

interface Summary {
  from: string;
  to: string;
  weekly: { week: string; registrations: number; shipments: number; deliveries: number; rejections: number; recalls: number }[];
  transfersByStatus: { status: string; count: number }[];
  verificationsByResult: { result: string; count: number }[];
  chainByStatus: { status: string; count: number }[];
  chainMode: ChainMode;
}

function isoDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ------------------------------ page ------------------------------ */

export default function ReportsPage() {
  const list = useListState({ pageSize: 15 }, ['type', 'status', 'from', 'to'] as const);
  const type: ReportType = (REPORT_TYPES as readonly string[]).includes(list.type) ? (list.type as ReportType) : 'batches';
  const today = isoDay(0);
  const from = list.from || isoDay(-90);
  const to = list.to || today;
  const rangeInvalid = from > to;

  const summary = useQuery({
    queryKey: ['reports', 'summary', from, to],
    queryFn: () => api.get<Summary>('/reports/summary', { from, to }),
    enabled: !rangeInvalid,
    placeholderData: keepPreviousData,
  });

  const meta = TYPE_META[type];
  const status = meta.filters?.some((f) => f.value === list.status) ? list.status : '';
  const dataParams = { type, from: meta.dated ? from : undefined, to: meta.dated ? to : undefined, status, search: list.search };
  const data = useQuery({
    queryKey: ['reports', 'data', dataParams, list.page],
    queryFn: () => api.get<ReportData>('/reports/data', { ...dataParams, page: list.page, pageSize: list.pageSize }),
    enabled: !rangeInvalid,
    placeholderData: keepPreviousData,
  });

  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      await downloadFile(withQuery('/reports/export', dataParams), `medichain-${type}-${today}.csv`);
      toast.success('CSV export downloaded');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const columns = useMemo<Column<{ i: number; r: ReportData['rows'][number] }>[]>(
    () => (data.data?.columns ?? []).map((c) => ({ key: c.key, header: c.label, cell: ({ r }) => <ReportCell type={type} colKey={c.key} value={r[c.key]} /> })),
    [data.data?.columns, type],
  );
  const rows = useMemo(() => data.data?.rows.map((r, i) => ({ i, r })), [data.data?.rows]);

  return (
    <>
      <PageHeader title="Reports & analytics" description="Activity across the supply chain for the selected period, plus detailed reports you can filter and export as CSV. All figures are calculated from recorded data." />

      {/* ---------- Date range ---------- */}
      <Card className="mb-6">
        <CardBody className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label htmlFor="report-from">From</Label>
              <Input id="report-from" type="date" value={from} max={to} onChange={(e) => list.update({ from: e.target.value || undefined })} className="w-[170px]" aria-invalid={rangeInvalid} aria-describedby="report-range-msg" />
            </div>
            <div>
              <Label htmlFor="report-to">To</Label>
              <Input id="report-to" type="date" value={to} min={from} max={today} onChange={(e) => list.update({ to: e.target.value || undefined })} className="w-[170px]" aria-invalid={rangeInvalid} aria-describedby="report-range-msg" />
            </div>
            <div className="inline-flex rounded-xl border border-line p-1" role="group" aria-label="Date range presets">
              {PRESETS.map((n) => {
                const active = from === isoDay(-n) && to === today;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={active}
                    onClick={() => list.update({ from: isoDay(-n), to: today })}
                    className={cn('h-8 rounded-lg px-3 text-[13px] font-medium transition-colors', active ? 'bg-ink text-white' : 'text-charcoal hover:bg-subtle')}
                  >
                    {n} days
                  </button>
                );
              })}
            </div>
          </div>
          <p id="report-range-msg" className={cn('flex items-center gap-2 text-[13px]', rangeInvalid ? 'text-danger' : 'text-muted')} role={rangeInvalid ? 'alert' : undefined}>
            <CalendarRange className="size-4" aria-hidden />
            {rangeInvalid ? 'The start date must be before the end date.' : `${formatDate(from)} – ${formatDate(to)}`}
          </p>
        </CardBody>
      </Card>

      {/* ---------- Charts ---------- */}
      {summary.error ? (
        <Card>
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader title="Weekly supply-chain activity" description="Events recorded per week in the selected period" icon={<Activity />} />
            <CardBody>
              {!summary.data ? (
                <Skeleton className="h-[280px] w-full" />
              ) : (
                <ChartFrame
                  height={280}
                  legend={<Legend items={ACTIVITY.map((s) => ({ label: s.label, color: s.color, value: summary.data!.weekly.reduce((a, w) => a + w[s.key], 0) }))} />}
                  table={{
                    columns: ['Week starting', ...ACTIVITY.map((s) => s.label)],
                    rows: summary.data.weekly.map((w) => [formatDate(w.week), ...ACTIVITY.map((s) => w[s.key])]),
                  }}
                  chart={
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={summary.data.weekly} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                        <CartesianGrid {...gridProps} />
                        <XAxis dataKey="week" {...axisProps} tickFormatter={(v: string) => formatDate(v).slice(0, 6)} interval="preserveStartEnd" minTickGap={24} />
                        <YAxis {...axisProps} allowDecimals={false} width={44} />
                        <RTooltip content={<ChartTooltip labelFormatter={(l) => `Week of ${formatDate(String(l))}`} />} cursor={{ stroke: '#D9D2CE', strokeWidth: 1 }} />
                        {ACTIVITY.map((s) => (
                          <Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: s.color }} activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff' }} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  }
                />
              )}
            </CardBody>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <StatusChartCard title="Transfers by status" icon={<Truck />} loading={!summary.data} data={summary.data?.transfersByStatus.map((t) => ({ status: t.status, count: t.count }))} emptyText="No transfers in this period." />
            <StatusChartCard
              title="Verification results"
              icon={<ShieldCheck />}
              loading={!summary.data}
              data={summary.data?.verificationsByResult.map((v) => ({ status: v.result, count: v.count, label: v.result === 'VERIFIED' ? 'Verified' : undefined }))}
              emptyText="No verification checks in this period."
            />
            <StatusChartCard
              title={summary.data?.chainMode === 'ONCHAIN' ? 'Blockchain transactions' : 'Simulated ledger entries'}
              icon={<Link2 />}
              loading={!summary.data}
              data={summary.data?.chainByStatus.map((c) => ({ status: c.status, count: c.count }))}
              emptyText="No ledger records in this period."
            />
          </div>
        </>
      )}

      {/* ---------- Report explorer ---------- */}
      <Card className="mt-6">
        <CardHeader
          title="Report explorer"
          description={meta.description}
          icon={<FileSpreadsheet />}
          action={
            <Button variant="outline" onClick={exportCsv} loading={exporting} disabled={rangeInvalid}>
              {!exporting && <Download />} Export CSV
            </Button>
          }
        />
        <div className="border-b border-line px-5 py-3">
          <Tabs value={type} onValueChange={(v) => list.update({ type: v === 'batches' ? undefined : v, status: undefined, search: undefined })}>
            <TabsList aria-label="Report type">
              {REPORT_TYPES.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TYPE_META[t].label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <SearchAndFilterBar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder={meta.search}
          filters={meta.filters}
          filterValue={status}
          onFilterChange={meta.filters ? (v) => list.set('status', v) : undefined}
          actions={!meta.dated ? <Badge tone="neutral">Date range not applied</Badge> : undefined}
        />
        <DataTable
          caption={`${meta.label} report`}
          columns={columns}
          rows={rangeInvalid ? [] : rows}
          rowKey={(x) => String(x.i)}
          loading={data.isFetching}
          error={data.error}
          onRetry={() => data.refetch()}
          empty={{
            icon: <BarChart3 />,
            title: rangeInvalid ? 'Fix the date range' : 'No records for this report',
            description: rangeInvalid ? 'The start date must be before the end date.' : list.search || status ? 'Try a different search term or filter.' : meta.dated ? 'Nothing was recorded in the selected period. Try a wider date range.' : undefined,
          }}
          pagination={data.data ? { page: data.data.page, totalPages: data.data.totalPages, total: data.data.total, pageSize: data.data.pageSize, onPageChange: list.setPage } : undefined}
        />
      </Card>
    </>
  );
}

/* ------------------------------ pieces ------------------------------ */

const STATUS_KEYS = new Set(['status', 'result']);

function ReportCell({ type, colKey, value }: { type: ReportType; colKey: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted">—</span>;
  const s = String(value);
  if (STATUS_KEYS.has(colKey)) return <StatusBadge status={s} size="sm" label={colKey === 'result' && s === 'VERIFIED' ? 'Verified' : undefined} />;
  if (type === 'recalls' && colKey === 'action') return <Badge tone="danger">{s === 'BLOCK' ? 'Block' : 'Recall'}</Badge>;
  if (type === 'organizations' && colKey === 'type' && s in ROLE_LABEL) return <span className="text-[13px]">{ROLE_LABEL[s as keyof typeof ROLE_LABEL]}</span>;
  if (colKey === 'payloadHash' || (type === 'blockchain' && colKey === 'reference')) return <HashText value={s} />;
  if (colKey === 'mode') return <span className="text-[12.5px]">{s === 'ONCHAIN' ? 'On-chain' : 'Simulated'}</span>;
  if (colKey === 'operation') return <span className="text-[13px]">{s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>;
  if (['publicId', 'batchNumber', 'batch', 'reference', 'queriedId', 'license'].includes(colKey)) return <span className="whitespace-nowrap font-mono text-[12.5px] text-ink">{s}</span>;
  if (colKey === 'reasons' || colKey === 'reason') return <span className="line-clamp-2 block max-w-[320px] text-[12.5px]" title={s}>{s.replace(/ \| /g, ' · ')}</span>;
  if (colKey === 'daysToExpiry' && typeof value === 'number')
    return <span className={cn('tabular text-[13px]', value < 0 ? 'text-danger' : value <= 90 ? 'text-warning-ink' : 'text-charcoal')}>{formatNumber(value)}</span>;
  if (typeof value === 'number') return <span className="tabular text-[13px]">{formatNumber(value)}</span>;
  return <span className="text-[13px]">{s}</span>;
}

interface StatusDatum {
  status: string;
  count: number;
  label?: string;
}

function StatusChartCard({ title, icon, data, loading, emptyText }: { title: string; icon: ReactNode; data?: StatusDatum[]; loading: boolean; emptyText: string }) {
  const rows = (data ?? [])
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((d) => ({ ...d, name: d.label ?? statusDef(d.status).label, color: STATUS_COLORS[d.status] ?? '#9A9A9A' }));
  const total = rows.reduce((a, r) => a + r.count, 0);
  const height = Math.max(120, rows.length * 40 + 16);
  return (
    <Card>
      <CardHeader title={title} description={loading ? undefined : `${formatNumber(total)} in this period`} icon={icon} />
      <CardBody>
        {loading ? (
          <Skeleton className="h-[160px] w-full" />
        ) : rows.length === 0 ? (
          <EmptyState compact icon={icon} title="Nothing recorded" description={emptyText} />
        ) : (
          <ChartFrame
            height={height}
            legend={<Legend items={rows.map((r) => ({ label: r.name, color: r.color, value: r.count }))} />}
            table={{ columns: ['Status', 'Count', 'Share'], rows: rows.map((r) => [r.name, r.count, `${((r.count / total) * 100).toFixed(0)}%`]) }}
            chart={
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={8}>
                  <CartesianGrid {...gridProps} vertical horizontal={false} />
                  <XAxis type="number" {...axisProps} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" {...axisProps} width={96} />
                  <RTooltip
                    cursor={{ fill: '#F4F2EE' }}
                    content={({ active, payload }) => (
                      <ChartTooltip
                        active={active}
                        label={payload?.[0]?.payload?.name as string | undefined}
                        payload={payload?.map((p) => ({ name: 'Count', value: p.value as number, color: (p.payload as { color: string }).color, dataKey: 'count' }))}
                      />
                    )}
                  />
                  <Bar dataKey="count" name="Count" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {rows.map((r) => (
                      <Cell key={r.status} fill={r.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            }
          />
        )}
      </CardBody>
    </Card>
  );
}
