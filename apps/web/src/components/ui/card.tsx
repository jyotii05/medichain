import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  // min-w-0: lets wide tables scroll inside the card instead of stretching grid layouts on phones
  return <div className={cn('min-w-0 rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)]', className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink [&_svg]:size-4">{icon}</span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-6">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-end gap-2 border-t border-line px-5 py-3.5', className)} {...props} />;
}
