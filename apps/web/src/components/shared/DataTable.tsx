import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, formatNumber } from '@/lib/utils';
import { EmptyState, ErrorState, TableSkeleton } from './States';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** server sort key; when set the header becomes a sort toggle */
  sortKey?: string;
  className?: string;
  headerClassName?: string;
  /** hide below this breakpoint to keep tables readable on small screens */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
}

export interface SortState {
  sort?: string;
  order: 'asc' | 'desc';
}

const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  sort?: SortState;
  onSortChange?: (s: SortState) => void;
  empty?: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode };
  pagination?: { page: number; totalPages: number; total: number; pageSize: number; onPageChange: (p: number) => void };
  caption?: string;
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, loading, error, onRetry, onRowClick, sort, onSortChange, empty, pagination, caption, className }: Props<T>) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading && !rows) return <TableSkeleton cols={Math.min(columns.length, 6)} />;
  if (rows && rows.length === 0) {
    return <EmptyState icon={empty?.icon ?? <Inbox />} title={empty?.title ?? 'Nothing here yet'} description={empty?.description} action={empty?.action} />;
  }

  const toggleSort = (key: string) => {
    if (!onSortChange) return;
    if (sort?.sort === key) onSortChange({ sort: key, order: sort.order === 'asc' ? 'desc' : 'asc' });
    else onSortChange({ sort: key, order: 'desc' });
  };

  return (
    <div className={className}>
      <div className={cn('scrollbar-thin relative overflow-x-auto transition-opacity', loading && 'opacity-60')}>
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-line bg-subtle/60">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={sort?.sort === c.sortKey ? (sort?.order === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn('h-10 whitespace-nowrap px-5 text-[12px] font-medium uppercase tracking-wide text-muted', c.hideBelow && hide[c.hideBelow], c.headerClassName)}
                >
                  {c.sortKey && onSortChange ? (
                    <button type="button" onClick={() => toggleSort(c.sortKey!)} className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-ink">
                      {c.header}
                      {sort?.sort === c.sortKey ? (
                        sort.order === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ArrowUpDown className="size-3 opacity-50" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows?.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(row);
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none')}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-5 py-3.5 align-middle text-charcoal', c.hideBelow && hide[c.hideBelow], c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && pagination.total > 0 && <Pagination {...pagination} />}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3" aria-label="Pagination">
      <p className="text-[13px] text-muted">
        Showing <span className="tabular font-medium text-charcoal">{formatNumber(from)}</span>–<span className="tabular font-medium text-charcoal">{formatNumber(to)}</span> of{' '}
        <span className="tabular font-medium text-charcoal">{formatNumber(total)}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="tabular px-2 text-[13px] text-charcoal">
          Page {page} of {totalPages}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
