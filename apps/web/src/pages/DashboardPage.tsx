import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import {
  AlertOctagon,
  ArrowRight,
  Bell,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Clock,
  Database,
  Inbox,
  Link2,
  PackagePlus,
  QrCode,
  Route,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Truck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { DashboardData, Role } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatNumber, relativeTime, ROLE_LABEL } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { StatusBadge, statusDef } from '@/components/shared/StatusBadge';
import { EmptyState, ErrorState, HashText, PageSkeleton } from '@/components/shared/States';
import { ChartFrame, ChartTooltip, Legend, SERIES_COLORS, STATUS_COLORS, axisProps, gridProps } from '@/components/shared/Chart';

const SERIES = [
  { key: 'registrations', label: 'Registrations', color: SERIES_COLORS[0] },
  { key: 'shipments', label: 'Shipments sent', color: SERIES_COLORS[1] },
  { key: 'deliveries', label: 'Deliveries accepted', color: SERIES_COLORS[2] },
] as const;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<DashboardData>('/dashboard'), refetchInterval: 60_000 });
  const seed = useMutation({
    mutationFn: () => api.post<{ created: number }>('/dev/sample-data'),
    onSuccess: (r) => {
      toast.success(`Loaded ${r.created} demonstration batches`);
      void qc.invalidateQueries();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!user) return null;
  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  const s = d.stats;
  const firstName = user.fullName.replace(/^Dr\.\s+/, '').split(' ')[0];

  const header = (
    <PageHeader
      eyebrow={
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-brand-ink">
          {ROLE_LABEL[user.role]} workspace · {user.organization.name}
        </span>
      }
      title={`${greeting()}, ${user.role === 'REGULATOR' && user.fullName.startsWith('Dr.') ? `Dr. ${user.fullName.split(' ').at(-1)}` : firstName}`}
      description="Live overview of medicine batches, custody transfers and verification activity — calculated from recorded data."
      actions={<QuickPrimaryAction role={user.role} />}
    />
  );

  if (s.totalBatches === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<Sparkles />}
            title={d.onboarding.systemIsEmpty ? 'Welcome to MediChain' : 'No batches to show yet'}
            description={
              d.onboarding.systemIsEmpty
                ? d.onboarding.demoSeedEnabled
                  ? 'The database has no medicine batches yet. Load the clearly labelled demonstration data set to explore every workflow — normal journeys, pending transfers, recalls, expired and suspicious batches.'
                  : 'No medicine batches have been registered yet. Manufacturers can register the first batch from their workspace.'
                : user.role === 'MANUFACTURER'
                  ? 'Register your first medicine batch to generate its QR code and start recording its journey.'
                  : 'Batches will appear here as soon as a supply-chain partner ships one to your organization.'
            }
            action={
              <>
                {d.onboarding.demoSeedEnabled && d.onboarding.systemIsEmpty && (
                  <Button onClick={() => seed.mutate()} loading={seed.isPending}>
                    <Database /> Load sample data (development)
                  </Button>
                )}
                {user.role === 'MANUFACTURER' && (
                  <Link to="/app/batches/new">
                    <Button>
                      <PackagePlus /> Register a batch
                    </Button>
                  </Link>
                )}
                <Link to="/verify">
                  <Button variant="outline">
                    <ScanLine /> Open public verification
                  </Button>
                </Link>
              </>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {header}
      <StatGrid role={user.role} d={d} />

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Supply-chain activity" description="Events recorded over the last 30 days" icon={<Route />} />
          <CardBody>
            <ChartFrame
              height={250}
              legend={<Legend items={SERIES.map((x) => ({ label: x.label, color: x.color, value: d.activity.reduce((a, r) => a + r[x.key], 0) }))} />}
              table={{
                columns: ['Date', ...SERIES.map((x) => x.label), 'Verifications'],
                rows: d.activity.filter((r) => r.registrations + r.shipments + r.deliveries + r.verifications > 0).map((r) => [formatDate(r.date), r.registrations, r.shipments, r.deliveries, r.verifications]),
              }}
              chart={
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.activity} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap="22%">
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} tickFormatter={(v: string) => formatDate(v).slice(0, 6)} interval="preserveStartEnd" minTickGap={28} />
                    <YAxis {...axisProps} allowDecimals={false} width={44} />
                    <RTooltip content={<ChartTooltip labelFormatter={(l) => formatDate(String(l))} />} cursor={{ fill: '#F4F2EE' }} />
                    {SERIES.map((x, i) => (
                      <Bar
                        key={x.key}
                        dataKey={x.key}
                        name={x.label}
                        stackId="activity"
                        fill={x.color}
                        stroke="#FFFFFF"
                        strokeWidth={1}
                        radius={i === SERIES.length - 1 ? [3, 3, 0, 0] : 0}
                        maxBarSize={18}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              }
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Batch status" description="Current status of batches you can see" icon={<Boxes />} />
          <CardBody className="space-y-4">
            <StatusBars data={d.statusDistribution} total={s.totalBatches} />
            <div className="rounded-xl bg-canvas p-3.5 text-[12.5px] leading-relaxed text-charcoal">
              <span className="font-semibold text-ink">{formatNumber(s.expiringSoon)}</span> active batch{s.expiringSoon === 1 ? '' : 'es'} expire within 90 days.
              <Link to="/app/batches?status=EXPIRING" className="ml-1 font-medium text-brand-ink hover:underline">
                Review
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <PendingApprovals d={d} role={user.role} />
        <QuickActions role={user.role} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Recent batch registrations"
            icon={<PackagePlus />}
            action={
              <Link to="/app/batches" className="text-[13px] font-medium text-brand-ink hover:underline">
                View all
              </Link>
            }
          />
          <ul className="divide-y divide-line">
            {d.recentBatches.map((b) => (
              <li key={b.id}>
                <Link to={`/app/batches/${b.id}`} className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-canvas">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-subtle text-charcoal">
                    <Boxes className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">
                      {b.medicine.name} <span className="font-normal text-muted">{b.medicine.strength}</span>
                    </p>
                    <p className="truncate text-[12px] text-muted">
                      <span className="font-mono">{b.batchNumber}</span> · {b.manufacturer.name}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <StatusBadge status={b.displayStatus} size="sm" />
                    <p className="mt-1 text-[11px] text-muted">{relativeTime(b.createdAt)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader
            title="Recent custody transfers"
            icon={<Truck />}
            action={
              <Link to="/app/transfers" className="text-[13px] font-medium text-brand-ink hover:underline">
                View all
              </Link>
            }
          />
          {d.recentTransfers.length ? (
            <ul className="divide-y divide-line">
              {d.recentTransfers.map((t) => (
                <li key={t.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">{t.batch.medicineName}</p>
                    <p className="flex min-w-0 items-center gap-1.5 truncate text-[12px] text-muted">
                      <span className="truncate">{t.fromOrg.name}</span>
                      <ArrowRight className="size-3 shrink-0" aria-label="to" />
                      <span className="truncate">{t.toOrg.name}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusBadge status={t.status} size="sm" />
                    <p className="mt-1 font-mono text-[11px] text-muted">{t.reference}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<Truck />} title="No transfers yet" />
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recent alerts"
            icon={<Bell />}
            action={
              <Link to="/app/alerts" className="text-[13px] font-medium text-brand-ink hover:underline">
                All alerts
              </Link>
            }
          />
          {d.alerts.length ? (
            <ul className="divide-y divide-line">
              {d.alerts.map((n) => (
                <li key={n.id} className="flex gap-3 px-5 py-3">
                  <SeverityIcon severity={n.severity} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">{n.title}</p>
                    <p className="line-clamp-2 text-[12px] text-muted">{n.message}</p>
                    <p className="mt-0.5 text-[11px] text-muted">{relativeTime(n.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={<Bell />} title="No alerts" description="Recall notices, shipment updates and flags will appear here." />
          )}
        </Card>

        <Card className="xl:col-span-3">
          <CardHeader
            title={d.chain.mode === 'ONCHAIN' ? 'Recent blockchain transactions' : 'Recent ledger entries (simulated)'}
            description={d.chain.mode === 'ONCHAIN' ? 'Events anchored to the MediChainRegistry contract' : 'Tamper-evident hash-chained ledger — not a public blockchain'}
            icon={<Link2 />}
            action={
              <Link to="/app/blockchain" className="text-[13px] font-medium text-brand-ink hover:underline">
                Explorer
              </Link>
            }
          />
          {d.chain.recent.length ? (
            <div className="scrollbar-thin overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-subtle/60 text-[11.5px] uppercase tracking-wide text-muted">
                    <th className="px-5 py-2 font-medium">Operation</th>
                    <th className="px-5 py-2 font-medium">Batch</th>
                    <th className="px-5 py-2 font-medium">{d.chain.mode === 'ONCHAIN' ? 'Tx hash' : 'Simulated ref'}</th>
                    <th className="px-5 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.chain.recent.map((t) => (
                    <tr key={t.id}>
                      <td className="px-5 py-2.5 text-charcoal">{t.operation.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</td>
                      <td className="px-5 py-2.5 font-mono text-[12px] text-charcoal">{t.batch?.batchNumber ?? '—'}</td>
                      <td className="px-5 py-2.5">
                        <HashText value={t.txHash ?? t.simulatedRef} />
                        {t.blockNumber != null && <span className="ml-2 text-[11px] text-muted">block {t.blockNumber}</span>}
                      </td>
                      <td className="px-5 py-2.5">
                        <StatusBadge status={t.status} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState compact icon={<Link2 />} title="No ledger activity yet" />
          )}
        </Card>
      </div>
    </>
  );
}

function StatGrid({ role, d }: { role: Role; d: DashboardData }) {
  const s = d.stats;
  const isReg = role === 'REGULATOR';
  const isMfr = role === 'MANUFACTURER';
  const cards = isReg || isMfr
    ? [
        { label: 'Total batches', value: s.totalBatches, icon: <Boxes />, accent: 'brand' as const, to: '/app/batches', hint: isReg ? 'Registered across the network' : 'Registered by your organization' },
        { label: 'Active batches', value: s.activeBatches, icon: <CheckCircle2 />, accent: 'success' as const, to: '/app/batches?status=ACTIVE', hint: `${formatNumber(s.inTransit)} currently in transit` },
        { label: 'Pending transfers', value: s.pendingTransfers, icon: <Truck />, accent: 'info' as const, to: '/app/transfers?status=PENDING', hint: 'Awaiting recipient acceptance' },
        { label: 'Recalled / blocked', value: s.recalledBatches, icon: <AlertOctagon />, accent: 'danger' as const, to: '/app/recalls' },
        { label: 'Expired batches', value: s.expiredBatches, icon: <Clock />, accent: 'warning' as const, to: '/app/batches?status=EXPIRED' },
        {
          label: 'Suspicious checks',
          value: s.suspiciousVerifications,
          icon: <ShieldAlert />,
          accent: 'danger' as const,
          to: '/app/reports?type=verifications',
          hint: isReg ? `Suspicious or unknown, last 30 days · ${s.openFlags} open flag${s.openFlags === 1 ? '' : 's'}` : 'Suspicious results, last 30 days',
        },
      ]
    : [
        { label: 'In your custody', value: s.inCustody, icon: <Warehouse />, accent: 'brand' as const, to: '/app/inventory' },
        { label: 'Incoming shipments', value: s.pendingIncoming, icon: <Inbox />, accent: 'info' as const, to: '/app/transfers?tab=incoming', hint: 'Waiting for your acceptance' },
        { label: 'Outgoing in transit', value: s.pendingOutgoing, icon: <Truck />, accent: 'neutral' as const, to: '/app/transfers?tab=outgoing' },
        { label: 'Recalled / blocked', value: s.recalledBatches, icon: <AlertOctagon />, accent: 'danger' as const, to: '/app/recalls' },
        { label: 'Expired batches', value: s.expiredBatches, icon: <Clock />, accent: 'warning' as const, to: '/app/batches?status=EXPIRED' },
        { label: 'Expiring ≤ 90 days', value: s.expiringSoon, icon: <CalendarClock />, accent: 'warning' as const, to: '/app/batches?status=EXPIRING' },
      ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {cards.map((c) => (
        <StatCard key={c.label} {...c} />
      ))}
    </div>
  );
}

function StatusBars({ data, total }: { data: DashboardData['statusDistribution']; total: number }) {
  return (
    <ul className="space-y-3.5">
      {data.map((r) => {
        const def = statusDef(r.status);
        const pct = total ? (r.count / total) * 100 : 0;
        return (
          <li key={r.status}>
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <span className="flex items-center gap-2 text-charcoal">
                <def.icon className="size-3.5" style={{ color: STATUS_COLORS[r.status] }} aria-hidden />
                {def.label}
              </span>
              <span className="tabular text-charcoal">
                <span className="font-semibold text-ink">{formatNumber(r.count)}</span>
                <span className="ml-1.5 text-[11.5px] text-muted">{pct.toFixed(0)}%</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-subtle" role="presentation">
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(pct, r.count ? 2 : 0)}%`, background: STATUS_COLORS[r.status] }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function PendingApprovals({ d, role }: { d: DashboardData; role: Role }) {
  const navigate = useNavigate();
  const isReg = role === 'REGULATOR';
  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title={isReg ? 'Pending custody transfers' : 'Shipments awaiting your acceptance'}
        description={isReg ? 'Transfers across the network that have not been accepted yet' : 'Review and accept or reject incoming custody transfers'}
        icon={<Inbox />}
        action={
          <Link to={isReg ? '/app/transfers?status=PENDING' : '/app/transfers?tab=incoming'} className="text-[13px] font-medium text-brand-ink hover:underline">
            Open shipments
          </Link>
        }
      />
      {d.pendingApprovals.length ? (
        <ul className="divide-y divide-line">
          {d.pendingApprovals.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-4 px-5 py-3.5">
              <span className="grid size-9 place-items-center rounded-xl bg-info-soft text-info">
                <Truck className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-ink">
                  {t.batch.medicineName} <span className="font-normal text-muted">{t.batch.strength}</span>
                  <span className="ml-2 font-mono text-[12px] font-normal text-muted">{t.batch.batchNumber}</span>
                </p>
                <p className="text-[12px] text-muted">
                  {isReg ? `${t.fromOrg.name} → ${t.toOrg.name}` : `From ${t.fromOrg.name}`} · {formatNumber(t.quantity)} {t.batch.unit} · sent {relativeTime(t.createdAt)}
                </p>
              </div>
              {!isReg && (
                <Button size="sm" variant="subtle" onClick={() => navigate('/app/transfers?tab=incoming')}>
                  Review
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon={<CheckCircle2 />} title="Nothing waiting" description={isReg ? 'No transfers are pending.' : 'You have no incoming shipments to review.'} />
      )}
    </Card>
  );
}

const QUICK: Record<Role, { to: string; label: string; icon: LucideIcon; desc: string }[]> = {
  REGULATOR: [
    { to: '/app/recalls', label: 'Issue a recall', icon: ShieldAlert, desc: 'Recall or block a batch' },
    { to: '/app/alerts?tab=flags', label: 'Review flags', icon: AlertOctagon, desc: 'Suspicion reports from partners' },
    { to: '/app/partners?status=PENDING', label: 'Approve partners', icon: CheckCircle2, desc: 'Pending organizations' },
    { to: '/app/reports', label: 'Reports', icon: Database, desc: 'Analytics & CSV export' },
  ],
  MANUFACTURER: [
    { to: '/app/batches/new', label: 'Register batch', icon: PackagePlus, desc: 'Create a new batch & QR' },
    { to: '/app/qr', label: 'QR codes', icon: QrCode, desc: 'Download or print labels' },
    { to: '/app/inventory', label: 'Ship a batch', icon: Truck, desc: 'Transfer to a distributor' },
    { to: '/app/tracking', label: 'Track a batch', icon: Route, desc: 'Follow its journey' },
  ],
  DISTRIBUTOR: [
    { to: '/app/transfers?tab=incoming', label: 'Incoming shipments', icon: Inbox, desc: 'Accept or reject' },
    { to: '/app/inventory', label: 'Ship to wholesaler', icon: Truck, desc: 'From your inventory' },
    { to: '/app/verify', label: 'Verify a batch', icon: ScanLine, desc: 'Scan or enter an ID' },
    { to: '/app/tracking', label: 'Track a batch', icon: Route, desc: 'Follow its journey' },
  ],
  WHOLESALER: [
    { to: '/app/transfers?tab=incoming', label: 'Incoming shipments', icon: Inbox, desc: 'Accept or reject' },
    { to: '/app/inventory', label: 'Ship to pharmacy', icon: Truck, desc: 'From your inventory' },
    { to: '/app/verify', label: 'Verify a batch', icon: ScanLine, desc: 'Scan or enter an ID' },
    { to: '/app/tracking', label: 'Track a batch', icon: Route, desc: 'Follow its journey' },
  ],
  PHARMACY: [
    { to: '/app/verify', label: 'Verify before dispensing', icon: ScanLine, desc: 'Scan the pack QR code' },
    { to: '/app/transfers?tab=incoming', label: 'Receive shipments', icon: Inbox, desc: 'Accept or reject' },
    { to: '/app/inventory', label: 'Inventory', icon: Warehouse, desc: 'Stock & dispensing' },
    { to: '/app/recalls', label: 'Recall notices', icon: ShieldAlert, desc: 'Affected batches' },
  ],
};

function QuickActions({ role }: { role: Role }) {
  return (
    <Card>
      <CardHeader title="Quick actions" icon={<Sparkles />} />
      <CardBody className="grid grid-cols-2 gap-2.5">
        {QUICK[role].map((a) => (
          <Link
            key={a.to + a.label}
            to={a.to}
            className="group rounded-xl border border-line bg-surface p-3.5 transition-colors hover:border-brand/40 hover:bg-brand-soft/30"
          >
            <a.icon className="size-[18px] text-brand" aria-hidden />
            <p className="mt-2.5 text-[13px] font-semibold text-ink">{a.label}</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{a.desc}</p>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}

function QuickPrimaryAction({ role }: { role: Role }) {
  if (role === 'MANUFACTURER')
    return (
      <Link to="/app/batches/new">
        <Button>
          <PackagePlus /> Register batch
        </Button>
      </Link>
    );
  if (role === 'REGULATOR')
    return (
      <Link to="/app/recalls">
        <Button variant="outline">
          <ShieldAlert /> Recall management
        </Button>
      </Link>
    );
  return (
    <Link to="/app/verify">
      <Button>
        <ScanLine /> Verify medicine
      </Button>
    </Link>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  const map: Record<string, { icon: LucideIcon; cls: string }> = {
    INFO: { icon: Bell, cls: 'bg-info-soft text-info' },
    SUCCESS: { icon: CheckCircle2, cls: 'bg-success-soft text-success' },
    WARNING: { icon: ShieldAlert, cls: 'bg-warning-soft text-warning-ink' },
    CRITICAL: { icon: AlertOctagon, cls: 'bg-danger-soft text-danger' },
  };
  const m = map[severity] ?? map.INFO;
  return (
    <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', m.cls)} aria-label={severity.toLowerCase()}>
      <m.icon className="size-4" />
    </span>
  );
}
