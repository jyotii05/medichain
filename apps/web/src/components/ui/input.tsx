import {
  forwardRef,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const fieldBase =
  'w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-muted transition-[border,box-shadow] duration-150 ' +
  'hover:border-line-strong focus:border-brand focus:outline-none focus:shadow-[var(--shadow-focus)] ' +
  'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-muted aria-[invalid=true]:border-danger';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightSlot?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, leftIcon, rightSlot, ...props }, ref) => {
  if (!leftIcon && !rightSlot) return <input ref={ref} className={cn(fieldBase, 'h-10', className)} {...props} />;
  return (
    <div className="relative">
      {leftIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted [&_svg]:size-4">{leftIcon}</span>
      )}
      <input ref={ref} className={cn(fieldBase, 'h-10', leftIcon && 'pl-9', rightSlot && 'pr-11', className)} {...props} />
      {rightSlot && <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{rightSlot}</span>}
    </div>
  );
});
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, 'min-h-[88px] py-2.5 leading-relaxed', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select ref={ref} className={cn(fieldBase, 'h-10 appearance-none pr-9', className)} {...props}>
      {children}
    </select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
  </div>
));
Select.displayName = 'Select';

export function Label({ className, children, required, ...props }: LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn('mb-1.5 block text-[13px] font-medium text-charcoal', className)} {...props}>
      {children}
      {required && (
        <span className="ml-0.5 text-brand-ink" aria-hidden>
          *
        </span>
      )}
    </label>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error. Give the control aria-describedby={`${id}-msg`} and aria-invalid. */
export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {(error || hint) && (
        <p id={`${htmlFor}-msg`} className={cn('mt-1.5 text-xs', error ? 'text-danger' : 'text-muted')} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
