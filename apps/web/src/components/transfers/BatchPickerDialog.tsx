import { useEffect, useId, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Boxes, CheckCircle2, Search } from 'lucide-react';
import { api } from '@/lib/api';
import type { BatchRow, Paged } from '@/lib/types';
import { cn, formatNumber } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { EmptyState, ErrorState } from '@/components/shared/States';
import { ExpiryCell } from '@/pages/batches/BatchesPage';

/**
 * Searchable batch chooser used before opening an action dialog (new shipment, issue recall).
 * `disabledReason` returns why a batch cannot be chosen (shown inline) or null when it can.
 */
export function BatchPickerDialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  params,
  disabledReason,
  renderSummary,
  continueLabel,
  onContinue,
  emptyText,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  icon: ReactNode;
  params: Record<string, string>;
  disabledReason?: (b: BatchRow) => string | null;
  renderSummary?: (b: BatchRow) => ReactNode;
  continueLabel: ReactNode;
  onContinue: (b: BatchRow) => void;
  emptyText: { title: string; description: string };
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<BatchRow | null>(null);

  useEffect(() => {
    if (!open) {
      setDraft('');
      setSearch('');
      setSelected(null);
    }
  }, [open]);
  useEffect(() => {
    const t = setTimeout(() => setSearch(draft.trim()), 300);
    return () => clearTimeout(t);
  }, [draft]);

  const q = useQuery({
    queryKey: ['batches', 'picker', params, search],
    queryFn: () => api.get<Paged<BatchRow>>('/batches', { ...params, search, pageSize: 20, sort: 'expiryDate', order: 'asc' }),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const items = q.data?.items;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        icon={icon}
        title={title}
        description={description}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => selected && onContinue(selected)} disabled={!selected}>
              {continueLabel}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            leftIcon={<Search />}
            placeholder="Search medicine, batch number or ID"
            aria-label="Search batches"
            autoFocus
          />
          <div className={cn('transition-opacity', q.isFetching && items && 'opacity-60')}>
            {q.error ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-8" />
            ) : !items ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading batches">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <EmptyState compact icon={<Boxes />} title={search ? 'No batches match your search' : emptyText.title} description={search ? 'Try a different search term.' : emptyText.description} />
            ) : (
              <div role="radiogroup" aria-label="Batches" className="scrollbar-thin max-h-[42vh] space-y-2 overflow-y-auto pr-0.5">
                {items.map((b) => {
                  const reason = disabledReason?.(b) ?? null;
                  const active = selected?.id === b.id;
                  return (
                    <label
                      key={b.id}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors has-[:focus-visible]:shadow-[var(--shadow-focus)]',
                        reason ? 'cursor-not-allowed border-line bg-subtle/60' : 'cursor-pointer',
                        !reason && (active ? 'border-brand bg-brand-soft/50' : 'border-line hover:border-line-strong hover:bg-canvas'),
                      )}
                    >
                      <input
                        type="radio"
                        name={`${id}-batch`}
                        className="sr-only"
                        disabled={!!reason}
                        checked={active}
                        onChange={() => setSelected(b)}
                        aria-describedby={reason ? `${id}-${b.id}-reason` : undefined}
                      />
                      <span
                        className={cn('grid size-5 shrink-0 place-items-center rounded-full border', active ? 'border-brand bg-brand text-ink' : 'border-line-strong bg-surface')}
                        aria-hidden
                      >
                        {active && <CheckCircle2 className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {b.medicine.name} <span className="font-normal text-muted">{b.medicine.strength}</span>
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[11.5px] text-muted">
                          {b.batchNumber} · {b.publicId}
                        </span>
                        {reason && (
                          <span id={`${id}-${b.id}-reason`} className="mt-1 block text-[12px] text-warning-ink">
                            {reason}
                          </span>
                        )}
                      </span>
                      <span className="hidden text-right sm:block">
                        <span className="tabular block text-[12.5px] text-charcoal">
                          {formatNumber(b.quantityOnHand)} <span className="text-muted">{b.unit}</span>
                        </span>
                      </span>
                      <StatusBadge status={b.displayStatus} size="sm" />
                    </label>
                  );
                })}
                {q.data && q.data.total > items.length && (
                  <p className="px-1 pt-1 text-center text-[12px] text-muted">
                    Showing {items.length} of {formatNumber(q.data.total)} — refine your search to find others.
                  </p>
                )}
              </div>
            )}
          </div>
          {selected && (
            <div className="rounded-xl border border-line bg-canvas p-4 animate-fade-in" aria-live="polite">
              {renderSummary ? (
                renderSummary(selected)
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted">Selected</p>
                    <p className="mt-0.5 text-sm font-medium text-ink">
                      {selected.medicine.name} · <span className="font-mono">{selected.batchNumber}</span>
                    </p>
                  </div>
                  <ExpiryCell date={selected.expiryDate} status={selected.displayStatus} />
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
