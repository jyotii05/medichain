import type { ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/api';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'px-6 py-8' : 'px-6 py-14', className)}>
      <div className="relative mb-4">
        <div className="absolute inset-0 -m-2 rounded-2xl bg-brand-soft/60 blur-md" aria-hidden />
        <div className="relative grid size-12 place-items-center rounded-2xl border border-line bg-surface text-brand-ink shadow-[var(--shadow-card)] [&_svg]:size-5">
          {icon}
        </div>
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-danger-soft text-danger">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <h3 className="text-[15px] font-semibold">Couldn’t load this data</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-6 px-5 py-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-3.5', c === 0 ? 'w-40' : c === cols - 1 ? 'ml-auto w-16' : 'w-24')} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading page">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="space-y-3 p-5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-16" />
          </Card>
        ))}
      </div>
      <Card>
        <TableSkeleton />
      </Card>
    </div>
  );
}

/** Small mono hash/identifier with copy-on-click. */
export function HashText({ value, className, full }: { value: string | null | undefined; className?: string; full?: boolean }) {
  if (!value) return <span className="text-muted">—</span>;
  const display = full || value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
  return (
    <button
      type="button"
      title={`${value} — click to copy`}
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        import('sonner').then(({ toast }) => toast.success('Copied to clipboard'));
      }}
      className={cn('rounded font-mono text-[12px] text-charcoal decoration-dotted underline-offset-2 hover:text-ink hover:underline', full && 'break-all text-left', className)}
    >
      {display}
    </button>
  );
}
