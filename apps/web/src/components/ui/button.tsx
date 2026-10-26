import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'subtle' | 'link';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variants: Record<Variant, string> = {
  // Near-black label on light red keeps WCAG AA contrast (5.9:1) while using the brand colour.
  primary: 'bg-brand text-ink hover:bg-brand-hover shadow-[inset_0_-1px_0_rgb(0_0_0/0.08)] font-semibold',
  secondary: 'bg-ink text-white hover:bg-charcoal font-semibold',
  outline: 'border border-line bg-surface text-ink hover:border-line-strong hover:bg-subtle',
  ghost: 'text-charcoal hover:bg-subtle hover:text-ink',
  subtle: 'bg-brand-soft text-brand-ink hover:bg-[#f9dcdc] font-semibold',
  danger: 'bg-danger text-white hover:bg-[#a8323a] font-semibold',
  link: 'text-brand-ink underline-offset-4 hover:underline px-0 h-auto',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
  icon: 'h-10 w-10 rounded-xl',
  'icon-sm': 'h-8 w-8 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, disabled, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:pointer-events-none disabled:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';
