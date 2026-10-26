import { useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import type { BatchRow, Paged, RecallRow } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/hooks/useListState';
import { formatDate, formatNumber, relativeTime } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SearchAndFilterBar } from '@/components/shared/SearchAndFilterBar';
import { Badge, StatusBadge } from '@/components/shared/StatusBadge';
import { DetailList, InfoNote } from '@/components/batch-actions/InlineNotice';
import { BatchPickerDialog } from '@/components/transfers/BatchPickerDialog';
import { RecallDialog } from '@/components/recalls/RecallDialog';
import { CLASSIFICATION_LABEL } from '@/components/recalls/RecallAlert';
import { ExpiryCell } from '@/pages/batches/BatchesPage';

const ACTION_FILTERS = [
  { value: '', label: 'All' },
  { value: 'RECALL', label: 'Recalls' },
  { value: 'BLOCK', label: 'Blocks' },
];

const columns: Column<RecallRow>[] = [
  { key: 'reference', header: 'Reference', cell: (r) => <span className="font-mono text-[12.5px] text-ink">{r.reference}</span> },
  {
    key: 'batch',
    header: 'Batch',
    cell: (r) => (
      <div className="leading-tight">
        <p className="font-mono text-[12.5px] text-ink">{r.batch.batchNumber}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted">{r.batch.publicId}</p>
      </div>
    ),
  },
  {
    key: 'medicine',
    header: 'Medicine',
    hideBelow: 'md',
    cell: (r) => (
      <div className="min-w-[140px] leading-tight">
        <p className="font-medium text-ink">
          {r.batch.medicineName} <span className="font-normal text-muted">{r.batch.strength}</span>
        </p>
        <p className="mt-0.5 text-[12px] text-muted">{r.batch.manufacturer.name}</p>
      </div>
    ),
  },
  {
    key: 'class',
    header: 'Class',
    hideBelow: 'sm',
    cell: (r) => <Badge tone={r.classification === 'CLASS_I' ? 'danger' : r.classification === 'CLASS_II' ? 'warning' : 'neutral'}>{CLASSIFICATION_LABEL[r.classification]}</Badge>,
  },
  { key: 'action', header: 'Action', cell: (r) => <StatusBadge status={r.action === 'BLOCK' ? 'BLOCKED' : 'RECALLED'} /> },
  {
    key: 'reason',
    header: 'Reason',
    hideBelow: 'lg',
    cell: (r) => (
      <p className="line-clamp-2 max-w-[280px] text-[13px] leading-snug" title={r.reason}>
        {r.reason}
      </p>
    ),
  },
  { key: 'issuedBy', header: 'Issued by', hideBelow: 'xl', cell: (r) => <span className="text-[13px]">{r.initiatedBy}</span> },
  {
    key: 'date',
    header: 'Date',
    hideBelow: 'sm',
    cell: (r) => (
      <div className="leading-tight">
        <p className="tabular text-[13px] text-charcoal">{formatDate(r.createdAt)}</p>
        <p className="mt-0.5 text-[11.5px] text-muted">{relativeTime(r.createdAt)}</p>
      </div>
    ),
  },
];

export default function RecallsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isRegulator = user?.role === 'REGULATOR';
  const list = useListState({ pageSize: 10 }, ['action'] as const);
  const action = ['RECALL', 'BLOCK'].includes(list.action) ? list.action : '';

  const [pickerOpen, setPickerOpen] = useState(false);
  const [target, setTarget] = useState<BatchRow | null>(null);

  const q = useQuery({
    queryKey: ['recalls', list.page, list.search, action],
    queryFn: () => api.get<Paged<RecallRow>>('/recalls', { page: list.page, pageSize: list.pageSize, search: list.search, action }),
    placeholderData: keepPreviousData,
  });

  const filtered = !!(list.search || action);

  return (
    <>
      <PageHeader
        title="Recalls"
        description={
          isRegulator
            ? 'Recalls and blocks issued by the regulator. Each one notifies the manufacturer and current custodian and halts ordinary movement of the batch.'
            : 'Regulatory recalls and blocks affecting batches your organization made, holds, or has handled.'
        }
        actions={
          isRegulator && (
            <Button variant="danger" onClick={() => setPickerOpen(true)}>
              <ShieldAlert /> Issue recall
            </Button>
          )
        }
      />

      <div className="space-y-4">
        {!isRegulator && (
          <InfoNote>
            Only the regulator can issue recalls. If you have a concern about a batch, flag it from your inventory or the batch page and the regulator will review
            it.
          </InfoNote>
        )}
        <Card>
          <SearchAndFilterBar
            search={list.search}
            onSearchChange={list.setSearch}
            placeholder="Search reference, batch, medicine or reason"
            filters={ACTION_FILTERS}
            filterValue={action}
            onFilterChange={(v) => list.set('action', v)}
          />
          <DataTable
            caption="Recall history"
            columns={columns}
            rows={q.data?.items}
            rowKey={(r) => r.id}
            loading={q.isFetching}
            error={q.error}
            onRetry={() => q.refetch()}
            onRowClick={(r) => navigate(`/app/batches/${r.batch.id}`)}
            empty={{
              icon: <ShieldCheck />,
              title: filtered ? 'No recalls match your filters' : 'No recalls on record',
              description: filtered
                ? 'Try a different search term or filter.'
                : isRegulator
                  ? 'Recalls and blocks you issue will be listed here with their full history.'
                  : 'No recalls or blocks affect batches your organization has handled.',
            }}
            pagination={q.data ? { page: q.data.page, totalPages: q.data.totalPages, total: q.data.total, pageSize: q.data.pageSize, onPageChange: list.setPage } : undefined}
          />
        </Card>
      </div>

      {isRegulator && (
        <>
          <BatchPickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            icon={<ShieldAlert />}
            title="Issue recall — select batch"
            description="Search for the batch to recall or block. Batches that are already recalled or blocked cannot be selected."
            params={{}}
            disabledReason={(b) => (b.status !== 'ACTIVE' ? `Already ${b.status.toLowerCase()}` : null)}
            renderSummary={(b) => (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-display text-[15px] font-semibold text-ink">
                    {b.medicine.name} <span className="font-normal text-muted">{b.medicine.strength}</span>
                  </p>
                  <StatusBadge status={b.displayStatus} size="sm" />
                </div>
                <DetailList
                  items={[
                    { label: 'Batch', value: <span className="font-mono text-[12.5px]">{b.batchNumber}</span> },
                    { label: 'Public ID', value: <span className="font-mono text-[12.5px]">{b.publicId}</span> },
                    { label: 'Manufacturer', value: b.manufacturer.name },
                    { label: 'Current custodian', value: `${b.currentCustodian.name}` },
                    { label: 'On hand', value: <span className="tabular">{`${formatNumber(b.quantityOnHand)} / ${formatNumber(b.quantity)} ${b.unit}`}</span> },
                    { label: 'Expiry', value: <ExpiryCell date={b.expiryDate} status={b.displayStatus} /> },
                  ]}
                />
                {b.hasPendingTransfer && (
                  <p className="flex items-start gap-2 text-[12.5px] text-warning-ink">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    This batch has a pending shipment. Issuing a recall will cancel it.
                  </p>
                )}
              </div>
            )}
            continueLabel={
              <>
                Continue <ArrowRight />
              </>
            }
            emptyText={{ title: 'No batches found', description: 'Search by medicine name, batch number or public ID.' }}
            onContinue={(b) => {
              setPickerOpen(false);
              setTarget(b);
            }}
          />
          {target && (
            <RecallDialog open onOpenChange={(o) => !o && setTarget(null)} batch={{ id: target.id, batchNumber: target.batchNumber, medicineName: target.medicine.name }} />
          )}
        </>
      )}
    </>
  );
}
