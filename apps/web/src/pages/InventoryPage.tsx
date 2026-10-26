import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertOctagon, Boxes, CalendarClock, Eye, Flag, Layers, PackageMinus, Truck, Warehouse } from 'lucide-react';
import { api } from '@/lib/api';
import type { BatchRow, CurrentUser, Paged } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/hooks/useListState';
import { cn, daysUntil, formatNumber } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SearchAndFilterBar } from '@/components/shared/SearchAndFilterBar';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { InfoNote } from '@/components/batch-actions/InlineNotice';
import { TransferDialog } from '@/components/transfers/TransferDialog';
import { DispenseDialog } from '@/components/batch-actions/DispenseDialog';
import { FlagDialog } from '@/components/batch-actions/FlagDialog';
import { BATCH_FILTERS, ExpiryCell, batchColumns } from '@/pages/batches/BatchesPage';

const STATS_PAGE_SIZE = 100;
const STATS_MAX_PAGES = 20;

/** Pages through every batch in custody (bounded) so the stat strip reflects real data, not estimates. */
async function fetchCustodyStats() {
  const all: BatchRow[] = [];
  let page = 1;
  let total = 0;
  for (;;) {
    const r = await api.get<Paged<BatchRow>>('/batches', { scope: 'custody', page, pageSize: STATS_PAGE_SIZE, sort: 'createdAt', order: 'desc' });
    all.push(...r.items);
    total = r.total;
    if (page >= r.totalPages || page >= STATS_MAX_PAGES) break;
    page++;
  }
  const units = new Map<string, number>();
  let expiring = 0;
  let restricted = 0;
  for (const b of all) {
    if (b.status === 'ACTIVE') units.set(b.unit, (units.get(b.unit) ?? 0) + b.quantityOnHand);
    const d = daysUntil(b.expiryDate);
    if (b.status === 'ACTIVE' && d >= 0 && d <= 90) expiring++;
    if (b.status !== 'ACTIVE') restricted++;
  }
  const unitTotal = [...units.values()].reduce((a, n) => a + n, 0);
  return { total, counted: all.length, unitTotal, units: [...units.entries()].sort((a, b) => b[1] - a[1]), expiring, restricted };
}

function shipBlockReason(b: BatchRow, user: CurrentUser | null): string | null {
  if (user?.organization.status !== 'APPROVED') return 'Your organization must be approved by the regulator first';
  if (b.status === 'RECALLED') return 'Recalled batches cannot be shipped';
  if (b.status === 'BLOCKED') return 'Blocked batches cannot be shipped';
  if (b.displayStatus === 'EXPIRED') return 'Expired batches cannot be shipped';
  if (b.hasPendingTransfer) return 'A shipment is already pending acceptance for this batch';
  if (b.quantityOnHand !== b.quantity) return 'Part of this batch has been dispensed — only complete batches can be shipped';
  return null;
}

function dispenseBlockReason(b: BatchRow, user: CurrentUser | null): string | null {
  if (user?.organization.status !== 'APPROVED') return 'Your organization must be approved by the regulator first';
  if (b.status !== 'ACTIVE') return `This batch is ${b.status.toLowerCase()} and must not be dispensed`;
  if (b.displayStatus === 'EXPIRED') return 'Expired batches must not be dispensed';
  if (b.quantityOnHand < 1) return 'No units left on hand';
  return null;
}

/** Disabled buttons don't receive pointer events, so the tooltip wraps a focusable span. */
function GuardedAction({ reason, children }: { reason: string | null; children: ReactNode }) {
  if (!reason) return <>{children}</>;
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} className="inline-flex rounded-lg" aria-label={reason}>
        {children}
      </span>
    </Tooltip>
  );
}

export default function InventoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const list = useListState({ pageSize: 10, sort: 'expiryDate', order: 'asc' }, ['status'] as const);
  const isPharmacy = user?.role === 'PHARMACY';

  const [shipping, setShipping] = useState<BatchRow | null>(null);
  const [dispensing, setDispensing] = useState<BatchRow | null>(null);
  const [flagging, setFlagging] = useState<BatchRow | null>(null);

  const stats = useQuery({ queryKey: ['batches', 'custody', 'stats'], queryFn: fetchCustodyStats });
  const q = useQuery({
    queryKey: ['batches', 'custody', list.page, list.search, list.status, list.sort, list.order],
    queryFn: () =>
      api.get<Paged<BatchRow>>('/batches', {
        scope: 'custody',
        page: list.page,
        pageSize: list.pageSize,
        search: list.search,
        status: list.status,
        sort: list.sort,
        order: list.order,
      }),
    placeholderData: keepPreviousData,
  });

  const s = stats.data;
  const partial = s && s.counted < s.total;

  const columns: Column<BatchRow>[] = [
    batchColumns[0],
    batchColumns[1],
    {
      key: 'quantity',
      header: 'On hand / original',
      sortKey: 'quantity',
      hideBelow: 'md',
      cell: (b) => {
        const pct = b.quantity > 0 ? Math.round((b.quantityOnHand / b.quantity) * 100) : 0;
        return (
          <div className="min-w-[140px]">
            <p className="tabular text-[13px] text-charcoal">
              <span className="font-medium text-ink">{formatNumber(b.quantityOnHand)}</span>
              <span className="text-muted"> / {formatNumber(b.quantity)} {b.unit}</span>
            </p>
            <div
              className="mt-1.5 h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-subtle"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              aria-label={`${pct}% of the original quantity on hand`}
            >
              <div className={cn('h-full rounded-full', b.status === 'ACTIVE' ? 'bg-brand' : 'bg-line-strong')} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      },
    },
    { key: 'expiry', header: 'Expiry', sortKey: 'expiryDate', hideBelow: 'sm', cell: (b) => <ExpiryCell date={b.expiryDate} status={b.displayStatus} /> },
    { key: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.displayStatus} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      cell: (b) => {
        const shipReason = shipBlockReason(b, user);
        const dispenseReason = dispenseBlockReason(b, user);
        const flagReason = user?.organization.status !== 'APPROVED' ? 'Your organization must be approved by the regulator first' : null;
        return (
          <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            {isPharmacy ? (
              <GuardedAction reason={dispenseReason}>
                <Button size="sm" variant="subtle" disabled={!!dispenseReason} onClick={() => setDispensing(b)}>
                  <PackageMinus /> Dispense
                </Button>
              </GuardedAction>
            ) : (
              <GuardedAction reason={shipReason}>
                <Button size="sm" variant="subtle" disabled={!!shipReason} onClick={() => setShipping(b)}>
                  <Truck /> Ship
                </Button>
              </GuardedAction>
            )}
            <GuardedAction reason={flagReason}>
              <Tooltip content="Flag as suspicious">
                <Button size="icon-sm" variant="ghost" disabled={!!flagReason} onClick={() => setFlagging(b)} aria-label={`Flag batch ${b.batchNumber} as suspicious`}>
                  <Flag />
                </Button>
              </Tooltip>
            </GuardedAction>
            <Tooltip content="View batch">
              <Button size="icon-sm" variant="ghost" onClick={() => navigate(`/app/batches/${b.id}`)} aria-label={`View batch ${b.batchNumber}`}>
                <Eye />
              </Button>
            </Tooltip>
          </div>
        );
      },
    },
  ];

  const unitsHint = s
    ? s.units.length === 0
      ? 'No active stock'
      : s.units.length === 1
        ? `${s.units[0][0]} across active batches`
        : s.units
            .slice(0, 2)
            .map(([u, n]) => `${formatNumber(n)} ${u}`)
            .join(' · ') + (s.units.length > 2 ? ` · +${s.units.length - 2} more` : '')
    : undefined;

  return (
    <>
      <PageHeader
        title="Inventory"
        description={
          isPharmacy
            ? 'Batches your pharmacy currently holds. Verify packs and record dispensing here.'
            : 'Batches your organization currently holds, ready to ship to the next stage of the supply chain.'
        }
      />

      <div className="space-y-6">
        <section aria-label="Inventory summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Batches in custody" value={s?.total} icon={<Warehouse />} loading={stats.isLoading} hint={stats.error ? 'Could not load' : 'Recorded with your organization'} />
          <StatCard
            label="Units on hand"
            value={s?.unitTotal}
            icon={<Layers />}
            accent="info"
            loading={stats.isLoading}
            hint={stats.error ? 'Could not load' : partial ? `First ${formatNumber(s!.counted)} batches only` : unitsHint}
          />
          <StatCard
            label="Expiring ≤ 90 days"
            value={s?.expiring}
            icon={<CalendarClock />}
            accent="warning"
            loading={stats.isLoading}
            hint={stats.error ? 'Could not load' : 'Active batches nearing expiry'}
            to={s?.expiring ? '/app/inventory?status=EXPIRING' : undefined}
          />
          <StatCard
            label="Recalled or blocked"
            value={s?.restricted}
            icon={<AlertOctagon />}
            accent="danger"
            loading={stats.isLoading}
            hint={stats.error ? 'Could not load' : s?.restricted ? 'Quarantine — do not dispense or ship' : 'None in your custody'}
            to={s?.restricted ? '/app/inventory?status=RECALLED' : undefined}
          />
        </section>

        <InfoNote>
          Transfers move the whole batch; pharmacies record dispensing which reduces units on hand. Stock can never go negative.
        </InfoNote>

        <Card>
          <SearchAndFilterBar
            search={list.search}
            onSearchChange={list.setSearch}
            placeholder="Search medicine, batch or ID"
            filters={BATCH_FILTERS}
            filterValue={list.status}
            onFilterChange={(v) => list.set('status', v)}
          />
          <DataTable
            caption="Batches in your custody"
            columns={columns}
            rows={q.data?.items}
            rowKey={(b) => b.id}
            loading={q.isFetching}
            error={q.error}
            onRetry={() => q.refetch()}
            onRowClick={(b) => navigate(`/app/batches/${b.id}`)}
            sort={{ sort: list.sort, order: list.order }}
            onSortChange={list.setSort}
            empty={{
              icon: <Boxes />,
              title: list.search || list.status ? 'No batches match your filters' : 'No batches in your custody',
              description:
                list.search || list.status
                  ? 'Try a different search term or filter.'
                  : user?.role === 'MANUFACTURER'
                    ? 'Batches you register appear here until you ship them on.'
                    : 'Accept an incoming shipment to take custody of a batch.',
              action:
                !list.search && !list.status ? (
                  <Button variant="outline" onClick={() => navigate(user?.role === 'MANUFACTURER' ? '/app/batches/new' : '/app/transfers?tab=incoming&status=PENDING')}>
                    {user?.role === 'MANUFACTURER' ? 'Register batch' : 'View incoming shipments'}
                  </Button>
                ) : undefined,
            }}
            pagination={q.data ? { page: q.data.page, totalPages: q.data.totalPages, total: q.data.total, pageSize: q.data.pageSize, onPageChange: list.setPage } : undefined}
          />
        </Card>
      </div>

      {shipping && (
        <TransferDialog
          open
          onOpenChange={(o) => !o && setShipping(null)}
          batch={{ id: shipping.id, batchNumber: shipping.batchNumber, medicineName: shipping.medicine.name, quantity: shipping.quantityOnHand, unit: shipping.unit }}
        />
      )}
      {dispensing && (
        <DispenseDialog
          open
          onOpenChange={(o) => !o && setDispensing(null)}
          batch={{ id: dispensing.id, batchNumber: dispensing.batchNumber, quantityOnHand: dispensing.quantityOnHand, unit: dispensing.unit }}
        />
      )}
      {flagging && <FlagDialog open onOpenChange={(o) => !o && setFlagging(null)} batch={{ id: flagging.id, batchNumber: flagging.batchNumber }} />}
    </>
  );
}
