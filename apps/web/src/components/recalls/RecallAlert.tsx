import { AlertOctagon } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';

export const CLASSIFICATION_LABEL: Record<string, string> = {
  CLASS_I: 'Class I',
  CLASS_II: 'Class II',
  CLASS_III: 'Class III',
};

/** Prominent danger banner shown wherever a recalled or blocked batch is displayed. */
export function RecallAlert({
  recall,
  className,
}: {
  recall: { reference: string; action: 'RECALL' | 'BLOCK'; classification: string; reason: string; createdAt: string };
  className?: string;
}) {
  const title = recall.action === 'BLOCK' ? 'Blocked by regulator' : 'Recalled by regulator';
  return (
    <div role="alert" className={cn('rounded-2xl border border-danger/25 bg-danger-soft p-4 sm:p-5', className)}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-danger text-white" aria-hidden>
          <AlertOctagon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="font-display text-[15px] font-semibold text-danger">{title}</h3>
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-danger ring-1 ring-inset ring-danger/20">
              {CLASSIFICATION_LABEL[recall.classification] ?? recall.classification}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-charcoal">
            <span className="font-mono">{recall.reference}</span>
            <span className="mx-1.5 text-muted" aria-hidden>
              ·
            </span>
            Issued {formatDate(recall.createdAt)}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink">{recall.reason}</p>
          <p className="mt-3 text-[13px] font-semibold text-danger">Do not dispense or transfer this batch.</p>
        </div>
      </div>
    </div>
  );
}
