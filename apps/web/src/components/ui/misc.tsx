import * as T from '@radix-ui/react-tabs';
import * as M from '@radix-ui/react-dropdown-menu';
import * as Tip from '@radix-ui/react-tooltip';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* ------------------------------- Tabs ------------------------------- */
export const Tabs = T.Root;
export function TabsContent({ className, ...props }: ComponentProps<typeof T.Content>) {
  return <T.Content className={cn('focus-visible:outline-none', className)} {...props} />;
}
export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn('scrollbar-thin inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1', className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-medium text-muted transition-colors',
        'hover:text-ink data-[state=active]:bg-brand-soft data-[state=active]:text-brand-ink [&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  );
}

/* ---------------------------- Dropdown menu ---------------------------- */
export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        sideOffset={sideOffset}
        className={cn('z-50 min-w-[200px] rounded-xl border border-line bg-surface p-1.5 shadow-[var(--shadow-raised)] data-[state=open]:animate-fade-in', className)}
        {...props}
      />
    </M.Portal>
  );
}
export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof M.Item>) {
  return (
    <M.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-charcoal outline-none',
        'data-[highlighted]:bg-subtle data-[highlighted]:text-ink data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:text-muted',
        className,
      )}
      {...props}
    />
  );
}
export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof M.Separator>) {
  return <M.Separator className={cn('my-1.5 h-px bg-line', className)} {...props} />;
}
export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof M.Label>) {
  return <M.Label className={cn('px-2.5 py-1.5 text-xs font-medium text-muted', className)} {...props} />;
}

/* ------------------------------- Tooltip ------------------------------- */
export const TooltipProvider = Tip.Provider;
export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Tip.Root delayDuration={250}>
      <Tip.Trigger asChild>{children}</Tip.Trigger>
      <Tip.Portal>
        <Tip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-xs rounded-lg bg-ink px-2.5 py-1.5 text-xs leading-relaxed text-white shadow-lg data-[state=delayed-open]:animate-fade-in"
        >
          {content}
          <Tip.Arrow className="fill-ink" />
        </Tip.Content>
      </Tip.Portal>
    </Tip.Root>
  );
}

/* ------------------------------- Skeleton ------------------------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4', className)} aria-hidden />;
}
