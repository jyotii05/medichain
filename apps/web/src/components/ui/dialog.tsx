import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
  size = 'md',
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: ReactNode;
}) {
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <D.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col',
          'rounded-2xl border border-line bg-surface shadow-[var(--shadow-raised)] focus:outline-none data-[state=open]:animate-slide-up',
          width,
          className,
        )}
      >
        <div className="flex items-start gap-3 border-b border-line px-6 py-5">
          {icon && <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink [&_svg]:size-5">{icon}</span>}
          <div className="min-w-0 flex-1">
            <D.Title className="font-display text-lg font-semibold text-ink">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</D.Description>
            )}
          </div>
          <D.Close className="-mr-2 -mt-1 rounded-lg p-2 text-muted transition-colors hover:bg-subtle hover:text-ink" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </div>
        {children && <div className="scrollbar-thin overflow-y-auto px-6 py-5">{children}</div>}
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}
