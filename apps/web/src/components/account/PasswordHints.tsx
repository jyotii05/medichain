import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Mirrors the API password policy: ≥ 10 characters with at least one letter and one number. */
export const PASSWORD_RULES = [
  { test: (v: string) => v.length >= 10, label: 'At least 10 characters' },
  { test: (v: string) => /[A-Za-z]/.test(v), label: 'A letter' },
  { test: (v: string) => /[0-9]/.test(v), label: 'A number' },
];

export function PasswordHints({ value, id }: { value: string; id?: string }) {
  return (
    <ul id={id} className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]" aria-label="Password requirements">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value ?? '');
        return (
          <li key={r.label} className={cn('flex items-center gap-1.5', ok ? 'text-success' : 'text-muted')}>
            {ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
            {r.label}
            <span className="sr-only">{ok ? '(met)' : '(not met)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
