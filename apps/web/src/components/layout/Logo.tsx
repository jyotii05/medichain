import { cn } from '@/lib/utils';

/** MediChain mark: a capsule outline linked to a chain of three custody nodes. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8', className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#E76F75" />
      <rect x="9" y="6.5" width="14" height="10" rx="5" fill="none" stroke="#171717" strokeWidth="1.8" />
      <path d="M16 6.5v10" stroke="#171717" strokeWidth="1.8" />
      <path d="M8.5 23.5h15" stroke="#171717" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="8.5" cy="23.5" r="2.4" fill="#FAF9F6" stroke="#171717" strokeWidth="1.6" />
      <circle cx="16" cy="23.5" r="2.4" fill="#FAF9F6" stroke="#171717" strokeWidth="1.6" />
      <circle cx="23.5" cy="23.5" r="2.4" fill="#171717" />
    </svg>
  );
}

export function Logo({ className, collapsed, subtitle = true }: { className?: string; collapsed?: boolean; subtitle?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      {!collapsed && (
        <div className="leading-none">
          <p className="font-display text-[17px] font-bold tracking-tight text-ink">MediChain</p>
          {subtitle && <p className="mt-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">Supply traceability</p>}
        </div>
      )}
    </div>
  );
}
