import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Boxes, Download, PackagePlus } from 'lucide-react';
import { api, downloadFile, errorMessage } from '@/lib/api';
import type { BatchRow, Paged } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/hooks/useListState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SearchAndFilterBar } from '@/components/shared/SearchAndFilterBar';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { cn, daysUntil, formatDate, formatNumber } from '@/lib/utils';
import { toast } from 'sonner';

export const BATCH_FILTERS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'IN_TRANSIT', label: 'In transit' },
  { value: 'EXPIRING', label: 'Expiring ≤ 90d' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'RECALLED', label: 'Recalled' },
  { value: 'BLOCKED', label: 'Blocked' },
];

export function ExpiryCell({ date, status }: { date: string; status?: string }) {
  const d = daysUntil(date);
  const tone = status === 'RECALLED' || status === 'BLOCKED' ? 'text-charcoal' : d < 0 ? 'text-danger' : d <= 90 ? 'text-warning-ink' : 'text-charcoal';
  return (
    <div className="leading-tight">
      <p className="tabular text-[13px] text-charcoal">{formatDate(date)}</p>
      <p className={cn('tabular mt-0.5 text-[11.5px]', tone)}>{d < 0 ? `${Math.abs(d)} days ago` : d === 0 ? 'Expires today' : `in ${d} days`}</p>
    </div>
  );
}

export const batchColumns: Column<BatchRow>[] = [
  {
    key: 'medicine',
    header: 'Medicine',
    sortKey: 'medicine',
    cell: (b) => (
      <div className="min-w-[180px]">
        <p className="font-medium text-ink">
          {b.medicine.name} <span className="font-normal text-muted">{b.medicine.strength}</span>
        </p>
        <p className="mt-0.5 text-[12px] text-muted">{b.medicine.genericName}</p>
      </div>
    ),
  },
  {
    key: 'batch',
    header: 'Batch',
    sortKey: 'batchNumber',
    cell: (b) => (
      <div className="leading-tight">
        <p className="font-mono text-[12.5px] text-ink">{b.batchNumber}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted">{b.publicId}</p>
      </div>
    ),
  },
  { key: 'custodian', header: 'Current custodian', hideBelow: 'md', cell: (b) => <span className="text-[13px]">{b.currentCustodian.name}</span> },
  {
    key: 'quantity',
    header: 'Quantity',
    sortKey: 'quantity',
    hideBelow: 'lg',
    cell: (b) => (
      <span className="tabular text-[13px]">
        {formatNumber(b.quantityOnHand)} <span className="text-muted">{b.unit}</span>
      </span>
    ),
  },
  { key: 'expiry', header: 'Expiry', sortKey: 'expiryDate', hideBelow: 'sm', cell: (b) => <ExpiryCell date={b.expiryDate} status={b.displayStatus} /> },
  { key: 'status', header: 'Status', cell: (b) => <StatusBadge status={b.displayStatus} /> },
];

export default function BatchesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const list = useListState({ pageSize: 10, sort: 'createdAt', order: 'desc' }, ['status'] as const);
  const q = useQuery({
    queryKey: ['batches', list.page, list.search, list.status, list.sort, list.order],
    queryFn: () =>
      api.get<Paged<BatchRow>>('/batches', { page: list.page, pageSize: list.pageSize, search: list.search, status: list.status, sort: list.sort, order: list.order }),
    placeholderData: keepPreviousData,
  });

  const isManufacturer = user?.role === 'MANUFACTURER';
  const exportCsv = () =>
    downloadFile(`/reports/export?type=batches${list.search ? `&search=${encodeURIComponent(list.search)}` : ''}${list.status && ['ACTIVE', 'EXPIRED', 'RECALLED', 'BLOCKED'].includes(list.status) ? `&status=${list.status}` : ''}`, 'medichain-batches.csv').catch((e) =>
      toast.error(errorMessage(e)),
    );

  return (
    <>
      <PageHeader
        title="Medicine batches"
        description={
          user?.role === 'REGULATOR'
            ? 'Every batch registered on MediChain, with its current custodian and status.'
            : 'Batches your organization manufactured, holds, or has handled.'
        }
        actions={
          <>
            <Button variant="outline" onClick={exportCsv}>
              <Download /> Export CSV
            </Button>
            {isManufacturer && (
              <Link to="/app/batches/new">
                <Button>
                  <PackagePlus /> Register batch
                </Button>
              </Link>
            )}
          </>
        }
      />
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
          caption="Medicine batches"
          columns={batchColumns}
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
            title: list.search || list.status ? 'No batches match your filters' : 'No batches yet',
            description: list.search || list.status ? 'Try a different search term or filter.' : isManufacturer ? 'Register your first medicine batch to start tracking it.' : 'Batches appear here once they are shipped to your organization.',
            action: isManufacturer && !list.search && !list.status ? (
              <Link to="/app/batches/new">
                <Button>
                  <PackagePlus /> Register batch
                </Button>
              </Link>
            ) : undefined,
          }}
          pagination={q.data ? { page: q.data.page, totalPages: q.data.totalPages, total: q.data.total, pageSize: q.data.pageSize, onPageChange: list.setPage } : undefined}
        />
      </Card>
    </>
  );
}
