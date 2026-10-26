import type { ReactNode } from 'react';
import { AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Inline server/validation error shown inside dialogs and forms. */
export function InlineError({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <div role="alert" className={cn('flex items-start gap-2.5 rounded-xl border border-danger/20 bg-danger-soft px-3.5 py-3 text-[13px] leading-relaxed text-danger', className)}>
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Quiet explanatory note (info tone). */
export function InfoNote({ children, className, icon }: { children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border border-info/15 bg-info-soft px-3.5 py-3 text-[13px] leading-relaxed text-charcoal', className)}>
      <span className="mt-0.5 shrink-0 text-info [&_svg]:size-4" aria-hidden>
        {icon ?? <Info />}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Two-column label/value list used in dialog summaries. */
export function DetailList({ items, className }: { items: { label: string; value: ReactNode; full?: boolean }[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2', className)}>
      {items.map((i) => (
        <div key={i.label} className={cn('min-w-0', i.full && 'sm:col-span-2')}>
          <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words text-[13.5px] text-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}
