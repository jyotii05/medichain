import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { cn, formatNumber } from '@/lib/utils';

type Accent = 'brand' | 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const accents: Record<Accent, string> = {
  brand: 'bg-brand-soft text-brand-ink',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning-ink',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-subtle text-charcoal',
  info: 'bg-info-soft text-info',
};

export function StatCard({
  label,
  value,
  icon,
  accent = 'brand',
  hint,
  to,
  loading,
}: {
  label: string;
  value: number | string | undefined;
  icon: ReactNode;
  accent?: Accent;
  hint?: ReactNode;
  to?: string;
  loading?: boolean;
}) {
  const body = (
    <Card className={cn('group relative h-full p-5 transition-[border,box-shadow] duration-200', to && 'hover:border-line-strong hover:shadow-[var(--shadow-raised)]')}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-charcoal">{label}</p>
        <span className={cn('grid size-9 place-items-center rounded-xl [&_svg]:size-[18px]', accents[accent])}>{icon}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-20" />
      ) : (
        <p className="tabular mt-2 font-display text-[28px] font-semibold leading-9 tracking-tight">{typeof value === 'number' ? formatNumber(value) : (value ?? '—')}</p>
      )}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {to && (
        <ArrowUpRight className="absolute bottom-4 right-4 size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      )}
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-2xl focus-visible:outline-offset-4" aria-label={`${label}: ${value ?? ''}`}>
      {body}
    </Link>
  ) : (
    body
  );
}
