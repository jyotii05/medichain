import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertOctagon, ArrowRight, ChevronLeft, ChevronRight, Info, Printer, QrCode, Search, Tag, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { BatchDetail, BatchRow, Paged } from '@/lib/types';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { EmptyState, ErrorState } from '@/components/shared/States';
import { QRCodePanel } from '@/components/batch/QRCodePanel';
import { BatchLabel, usePrintContent, type LabelData } from '@/components/batch/PrintableLabel';

const PAGE_SIZE = 12;

export default function QrCodesPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('batch');
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(term.trim());

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(term.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  const list = useQuery({
    queryKey: ['batches', 'qr-list', search, page],
    queryFn: () => api.get<Paged<BatchRow>>('/batches', { search, page, pageSize: PAGE_SIZE, sort: 'createdAt', order: 'desc' }),
    placeholderData: keepPreviousData,
  });

  const select = (id: string) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        n.set('batch', id);
        return n;
      },
      { replace: true },
    );

  // Select the first batch by default so the page is never blank on desktop.
  const firstId = list.data?.items[0]?.id;
  useEffect(() => {
    if (!selectedId && firstId && window.matchMedia('(min-width: 1024px)').matches) select(firstId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, firstId]);

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="QR codes & labels"
          description={
            user?.role === 'REGULATOR'
              ? 'Look up the verification QR code for any registered batch.'
              : 'Download verification QR codes and print pack labels for your batches. Each code links to the public verification page using an opaque batch ID.'
          }
        />
      </div>

      <div className="no-print grid gap-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        {/* Batch list */}
        <Card className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <div className="border-b border-line p-4">
            <Input
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search medicine, batch or ID"
              aria-label="Search batches"
              leftIcon={<Search />}
              className="h-9"
              rightSlot={
                term ? (
                  <button type="button" onClick={() => setTerm('')} className="grid size-7 place-items-center rounded-md text-muted hover:bg-subtle hover:text-ink" aria-label="Clear search">
                    <X className="size-3.5" />
                  </button>
                ) : undefined
              }
            />
          </div>
          {list.isLoading ? (
            <div className="space-y-4 p-4" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : list.error ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          ) : !list.data || list.data.items.length === 0 ? (
            <EmptyState
              compact
              icon={<QrCode />}
              title={search ? 'No matching batches' : 'No batches yet'}
              description={search ? 'Try another medicine name, batch number or ID.' : user?.role === 'MANUFACTURER' ? 'Register a batch to generate its QR code.' : 'No batches have been registered yet.'}
              action={
                !search && user?.role === 'MANUFACTURER' ? (
                  <Link to="/app/batches/new">
                    <Button size="sm">Register batch</Button>
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <>
              <ul className={cn('scrollbar-thin max-h-[60vh] divide-y divide-line overflow-y-auto transition-opacity lg:max-h-[calc(100dvh-280px)]', list.isFetching && 'opacity-60')} aria-label="Batches">
                {list.data.items.map((b) => {
                  const active = b.id === selectedId;
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => select(b.id)}
                        aria-current={active || undefined}
                        className={cn(
                          'relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:bg-canvas',
                          active ? 'bg-brand-soft/50' : 'hover:bg-canvas',
                        )}
                      >
                        {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-brand" aria-hidden />}
                        <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', active ? 'bg-brand text-ink' : 'bg-subtle text-charcoal')}>
                          <QrCode className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-ink">
                            {b.medicine.name} <span className="font-normal text-muted">{b.medicine.strength}</span>
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[11.5px] text-muted">
                            {b.batchNumber} · {b.publicId}
                          </span>
                        </span>
                        <StatusBadge status={b.displayStatus} size="sm" className="mt-0.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {list.data.totalPages > 1 && (
                <nav className="flex items-center justify-between border-t border-line px-4 py-2.5" aria-label="Batch list pagination">
                  <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                    <ChevronLeft />
                  </Button>
                  <span className="tabular text-[12.5px] text-muted">
                    Page {page} of {list.data.totalPages} · {formatNumber(list.data.total)} batches
                  </span>
                  <Button variant="ghost" size="icon-sm" disabled={page >= list.data.totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                    <ChevronRight />
                  </Button>
                </nav>
              )}
            </>
          )}
        </Card>

        {/* Selected batch */}
        <div className="min-w-0">
          {selectedId ? (
            <SelectedBatch id={selectedId} />
          ) : (
            <Card>
              <EmptyState icon={<QrCode />} title="Select a batch" description="Choose a batch from the list to view its QR code, download it, or print a label." />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function SelectedBatch({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['batch', id], queryFn: () => api.get<BatchDetail>(`/batches/${encodeURIComponent(id)}`) });
  const { print, portal, printing } = usePrintContent();

  if (q.isLoading) {
    return (
      <Card className="p-6" aria-busy="true" aria-label="Loading QR code">
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="mx-auto size-64 rounded-2xl" />
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="w-1/2" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        </div>
      </Card>
    );
  }
  if (q.error || !q.data) {
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  }

  const { batch } = q.data;
  const label: LabelData = {
    publicId: batch.publicId,
    verificationUrl: batch.verificationUrl,
    medicineName: batch.medicine.name,
    strength: batch.medicine.strength,
    batchNumber: batch.batchNumber,
    expiryDate: batch.expiryDate,
    manufacturerName: batch.manufacturer.name,
  };
  const withdrawn = batch.status === 'RECALLED' || batch.status === 'BLOCKED';

  return (
    <div className="space-y-6">
      {withdrawn && (
        <div role="alert" className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3 text-[13px] text-danger">
          <AlertOctagon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            This batch is <strong>{batch.status === 'BLOCKED' ? 'blocked' : 'recalled'}</strong>. Anyone scanning its QR code will see a recall warning. Do not print new labels for distribution.
          </p>
        </div>
      )}

      <Card>
        <CardHeader
          icon={<QrCode />}
          title={
            <span className="flex flex-wrap items-center gap-2">
              {batch.medicine.name} {batch.medicine.strength}
              <StatusBadge status={batch.displayStatus} size="sm" />
            </span>
          }
          description={
            <>
              Batch <span className="font-mono text-charcoal">{batch.batchNumber}</span> · expires {formatDate(batch.expiryDate)}
            </>
          }
          action={
            <Link to={`/app/batches/${batch.id}`}>
              <Button variant="ghost" size="sm">
                Batch details <ArrowRight />
              </Button>
            </Link>
          }
        />
        <CardBody className="py-8">
          <QRCodePanel batchId={batch.id} publicId={batch.publicId} verificationUrl={batch.verificationUrl} batchNumber={batch.batchNumber} medicineName={batch.medicine.name} size={240} showActions />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon={<Tag />}
          title="Label preview"
          description="Printed alone on the page — application navigation is hidden when printing."
          action={
            <Button variant="secondary" size="sm" onClick={() => print(<BatchLabel data={label} />)} loading={printing}>
              {!printing && <Printer />} Print label
            </Button>
          }
        />
        <CardBody className="flex flex-col items-center gap-4 bg-canvas py-8">
          <BatchLabel data={label} className="shadow-[var(--shadow-card)]" />
          <p className="flex max-w-md items-start gap-1.5 text-[12px] leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            For best scanning, print at 100% scale with the QR at least 2 cm wide. The label contains no personal or confidential data.
          </p>
        </CardBody>
      </Card>
      {portal}
    </div>
  );
}
