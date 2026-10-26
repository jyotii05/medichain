import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Eye, Layers, PackageCheck, Truck } from 'lucide-react';
import { api } from '@/lib/api';
import type { BatchRow, Paged, Role, TransferRow } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/hooks/useListState';
import { formatDate, formatNumber, relativeTime } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SearchAndFilterBar } from '@/components/shared/SearchAndFilterBar';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TransferDialog } from '@/components/transfers/TransferDialog';
import { TransferReviewDialog } from '@/components/transfers/TransferReviewDialog';
import { BatchPickerDialog } from '@/components/transfers/BatchPickerDialog';
import { InfoNote } from '@/components/batch-actions/InlineNotice';

type Tab = 'incoming' | 'outgoing' | 'all';

const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const VALID_STATUS = new Set(STATUS_FILTERS.map((s) => s.value));

function tabsFor(role: Role | undefined): Tab[] {
  if (role === 'REGULATOR') return ['all'];
  if (role === 'MANUFACTURER') return ['outgoing', 'all'];
  if (role === 'PHARMACY') return ['incoming', 'all'];
  return ['incoming', 'outgoing', 'all'];
}

const TAB_META: Record<Tab, { label: string; icon: typeof Truck }> = {
  incoming: { label: 'Incoming', icon: ArrowDownLeft },
  outgoing: { label: 'Outgoing', icon: ArrowUpRight },
  all: { label: 'All', icon: Layers },
};

export default function TransfersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const list = useListState({ pageSize: 10 }, ['tab', 'status'] as const);
  const role = user?.role;
  const isRegulator = role === 'REGULATOR';
  const canShip = role === 'MANUFACTURER' || role === 'DISTRIBUTOR' || role === 'WHOLESALER';
  const canReceive = role === 'DISTRIBUTOR' || role === 'WHOLESALER' || role === 'PHARMACY';
  const orgApproved = user?.organization.status === 'APPROVED';

  const tabs = tabsFor(role);
  const tab: Tab = tabs.includes(list.tab as Tab) ? (list.tab as Tab) : tabs[0];
  const status = VALID_STATUS.has(list.status) ? list.status : '';

  const [reviewing, setReviewing] = useState<TransferRow | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shipBatch, setShipBatch] = useState<BatchRow | null>(null);

  const q = useQuery({
    queryKey: ['transfers', tab, status, list.search, list.page],
    queryFn: () => api.get<Paged<TransferRow>>('/transfers', { direction: tab, status, search: list.search, page: list.page, pageSize: list.pageSize }),
    placeholderData: keepPreviousData,
    enabled: !!user,
  });

  const isIncomingPending = (t: TransferRow) => canReceive && t.status === 'PENDING' && t.toOrg.id === user?.organization.id;

  const columns: Column<TransferRow>[] = [
    {
      key: 'reference',
      header: 'Reference',
      cell: (t) => (
        <div className="leading-tight">
          <p className="font-mono text-[12.5px] text-ink">{t.reference}</p>
          <p className="mt-0.5 text-[11.5px] text-muted md:hidden">{formatDate(t.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'medicine',
      header: 'Medicine & batch',
      cell: (t) => (
        <div className="min-w-[160px] leading-tight">
          <p className="font-medium text-ink">
            {t.batch.medicineName} <span className="font-normal text-muted">{t.batch.strength}</span>
          </p>
          <p className="mt-0.5 font-mono text-[11.5px] text-muted">{t.batch.batchNumber}</p>
        </div>
      ),
    },
    {
      key: 'route',
      header: 'From → To',
      hideBelow: 'lg',
      cell: (t) => (
        <div className="flex min-w-[220px] items-center gap-2 text-[13px]">
          <span className={t.fromOrg.id === user?.organization.id ? 'font-medium text-ink' : 'text-charcoal'}>{t.fromOrg.name}</span>
          <ArrowRight className="size-3.5 shrink-0 text-muted" aria-label="to" />
          <span className={t.toOrg.id === user?.organization.id ? 'font-medium text-ink' : 'text-charcoal'}>{t.toOrg.name}</span>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'Quantity',
      hideBelow: 'xl',
      cell: (t) => (
        <span className="tabular text-[13px]">
          {formatNumber(t.quantity)} <span className="text-muted">{t.batch.unit}</span>
        </span>
      ),
    },
    {
      key: 'sent',
      header: 'Sent',
      hideBelow: 'md',
      cell: (t) => (
        <div className="leading-tight">
          <p className="tabular text-[13px] text-charcoal">{formatDate(t.createdAt)}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">{relativeTime(t.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (t) => (
        <div className="leading-tight">
          <StatusBadge status={t.status} />
          {t.status === 'REJECTED' && t.responseNote && (
            <p className="mt-1 max-w-[200px] truncate text-[11.5px] text-muted" title={t.responseNote}>
              {t.responseNote}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      cell: (t) =>
        isIncomingPending(t) ? (
          <Button
            size="sm"
            variant="subtle"
            disabled={!orgApproved}
            title={orgApproved ? undefined : 'Your organization must be approved first'}
            onClick={(e) => {
              e.stopPropagation();
              setReviewing(t);
            }}
          >
            <PackageCheck /> Review
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/app/batches/${t.batch.id}`);
            }}
            aria-label={`View batch ${t.batch.batchNumber}`}
          >
            <Eye /> View
          </Button>
        ),
    },
  ];

  const filtered = !!(list.search || status);
  const emptyCopy = (() => {
    if (filtered) return { title: 'No shipments match your filters', description: 'Try a different search term or status.' };
    if (tab === 'incoming') return { title: 'No incoming shipments', description: 'Shipments sent to your organization will appear here for you to review and accept.' };
    if (tab === 'outgoing') return { title: 'No outgoing shipments', description: canShip ? 'Ship a batch you hold to the next stage of the supply chain.' : 'Shipments you send will appear here.' };
    return { title: 'No shipments yet', description: isRegulator ? 'Custody transfers between organizations will appear here.' : 'Shipments to and from your organization will appear here.' };
  })();

  return (
    <>
      <PageHeader
        title="Shipments"
        description={
          isRegulator
            ? 'Every custody transfer between organizations. Regulators have read-only oversight.'
            : 'Custody transfers to and from your organization. Custody changes only once the recipient accepts.'
        }
        actions={
          canShip && (
            <Button onClick={() => setPickerOpen(true)} disabled={!orgApproved} title={orgApproved ? undefined : 'Your organization must be approved first'}>
              <Truck /> New shipment
            </Button>
          )
        }
      />

      <div className="space-y-4">
        {tabs.length > 1 && (
          <Tabs value={tab} onValueChange={(v) => list.update({ tab: v })}>
            <TabsList aria-label="Shipment direction">
              {tabs.map((t) => {
                const Icon = TAB_META[t].icon;
                return (
                  <TabsTrigger key={t} value={t}>
                    <Icon aria-hidden /> {TAB_META[t].label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        )}

        {isRegulator && <InfoNote>You are viewing all shipments read-only. Only the receiving organization can accept or reject a shipment.</InfoNote>}

        <Card>
          <SearchAndFilterBar
            search={list.search}
            onSearchChange={list.setSearch}
            placeholder="Search reference, medicine, batch or organization"
            filters={STATUS_FILTERS}
            filterValue={status}
            onFilterChange={(v) => list.set('status', v)}
          />
          <DataTable
            caption={`${TAB_META[tab].label} shipments`}
            columns={columns}
            rows={q.data?.items}
            rowKey={(t) => t.id}
            loading={q.isFetching}
            error={q.error}
            onRetry={() => q.refetch()}
            onRowClick={(t) => (isIncomingPending(t) && orgApproved ? setReviewing(t) : navigate(`/app/batches/${t.batch.id}`))}
            empty={{
              icon: <Truck />,
              ...emptyCopy,
              action:
                !filtered && canShip && tab !== 'incoming' && orgApproved ? (
                  <Button onClick={() => setPickerOpen(true)}>
                    <Truck /> New shipment
                  </Button>
                ) : undefined,
            }}
            pagination={q.data ? { page: q.data.page, totalPages: q.data.totalPages, total: q.data.total, pageSize: q.data.pageSize, onPageChange: list.setPage } : undefined}
          />
        </Card>
      </div>

      <TransferReviewDialog transfer={reviewing} open={!!reviewing} onOpenChange={(o) => !o && setReviewing(null)} />

      {canShip && (
        <BatchPickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          icon={<Truck />}
          title="New shipment"
          description="Choose a batch your organization currently holds. Only active, unexpired batches without a pending shipment can be shipped."
          params={{ scope: 'custody', status: 'ACTIVE' }}
          disabledReason={(b) => (b.quantityOnHand !== b.quantity ? 'Part of this batch has been dispensed — only complete batches can be shipped.' : null)}
          continueLabel={
            <>
              Continue <ArrowRight />
            </>
          }
          emptyText={{ title: 'No batches ready to ship', description: 'Batches you hold that are active, unexpired and not already in transit will appear here.' }}
          onContinue={(b) => {
            setPickerOpen(false);
            setShipBatch(b);
          }}
        />
      )}
      {shipBatch && (
        <TransferDialog
          open={!!shipBatch}
          onOpenChange={(o) => !o && setShipBatch(null)}
          batch={{ id: shipBatch.id, batchNumber: shipBatch.batchNumber, medicineName: shipBatch.medicine.name, quantity: shipBatch.quantityOnHand, unit: shipBatch.unit }}
        />
      )}
    </>
  );
}
