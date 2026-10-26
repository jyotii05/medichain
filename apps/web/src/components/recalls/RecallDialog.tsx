import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertOctagon, ArrowLeft, Ban, ShieldAlert } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { RecallRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { InlineError } from '@/components/batch-actions/InlineNotice';

type Action = 'RECALL' | 'BLOCK';
type Classification = 'CLASS_I' | 'CLASS_II' | 'CLASS_III';

const ACTIONS: { value: Action; label: string; icon: typeof Ban; description: string }[] = [
  { value: 'RECALL', label: 'Recall', icon: AlertOctagon, description: 'Withdraw the batch from the supply chain (e.g. a quality or safety defect).' },
  { value: 'BLOCK', label: 'Block', icon: Ban, description: 'Stop all movement of the batch (e.g. suspected counterfeit or diversion).' },
];

const CLASSES: { value: Classification; label: string; description: string }[] = [
  { value: 'CLASS_I', label: 'Class I', description: 'Reasonable probability of serious adverse health consequences or death.' },
  { value: 'CLASS_II', label: 'Class II', description: 'May cause temporary or medically reversible harm; serious harm is remote.' },
  { value: 'CLASS_III', label: 'Class III', description: 'Unlikely to cause adverse health consequences (e.g. labelling deviation).' },
];

/** Regulator-only: recall or block a batch, with a typed confirmation step. */
export function RecallDialog({
  batch,
  open,
  onOpenChange,
}: {
  batch: { id: string; batchNumber: string; medicineName: string };
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const id = useId();
  const [step, setStep] = useState<'details' | 'confirm'>('details');
  const [action, setAction] = useState<Action>('RECALL');
  const [classification, setClassification] = useState<Classification | ''>('');
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('details');
      setAction('RECALL');
      setClassification('');
      setReason('');
      setConfirmText('');
      setErrors({});
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => api.post<{ recall: RecallRow }>('/recalls', { batchId: batch.id, action, classification, reason: reason.trim() }),
    onSuccess: ({ recall }) => {
      toast.success(`${recall.action === 'BLOCK' ? 'Block' : 'Recall'} ${recall.reference} issued`, {
        description: `Batch ${batch.batchNumber} is now ${recall.action === 'BLOCK' ? 'blocked' : 'recalled'}. The manufacturer and current custodian have been notified.`,
      });
      for (const key of ['batch', 'batches', 'recalls', 'dashboard', 'transfers', 'notifications']) void qc.invalidateQueries({ queryKey: [key] });
      onOpenChange(false);
    },
    onError: (e) => {
      const fe = e instanceof ApiError ? e.fieldErrors : {};
      if (fe.reason || fe.classification) {
        setErrors(fe);
        setStep('details');
      } else setError(errorMessage(e, 'Could not issue the recall'));
    },
  });

  const next = () => {
    const errs: Record<string, string> = {};
    if (!classification) errs.classification = 'Choose a classification';
    if (reason.trim().length < 10) errs.reason = 'Please describe the reason (at least 10 characters)';
    setErrors(errs);
    if (Object.keys(errs).length === 0) {
      setError(null);
      setStep('confirm');
    }
  };

  const confirmed = confirmText.trim() === batch.batchNumber;
  const verb = action === 'BLOCK' ? 'Block' : 'Recall';

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent
        size="lg"
        icon={<ShieldAlert />}
        title={step === 'details' ? 'Issue recall' : `Confirm ${verb.toLowerCase()}`}
        description={
          <>
            {batch.medicineName} · <span className="font-mono">{batch.batchNumber}</span>
            <span className="ml-2 text-muted">Step {step === 'details' ? 1 : 2} of 2</span>
          </>
        }
        footer={
          step === 'details' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="secondary" onClick={next}>
                Review and confirm
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('details')} disabled={mutation.isPending}>
                <ArrowLeft /> Back
              </Button>
              <Button variant="danger" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!confirmed}>
                {verb} batch
              </Button>
            </>
          )
        }
      >
        {step === 'details' ? (
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-charcoal">Action</legend>
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
                {ACTIONS.map((a) => {
                  const active = action === a.value;
                  const Icon = a.icon;
                  return (
                    <label
                      key={a.value}
                      className={cn(
                        'flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-colors has-[:focus-visible]:shadow-[var(--shadow-focus)]',
                        active ? 'border-danger/40 bg-danger-soft' : 'border-line hover:border-line-strong hover:bg-canvas',
                      )}
                    >
                      <input type="radio" name={`${id}-action`} className="sr-only" checked={active} onChange={() => setAction(a.value)} />
                      <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-danger' : 'text-muted')} aria-hidden />
                      <span>
                        <span className={cn('block text-sm font-semibold', active ? 'text-danger' : 'text-ink')}>{a.label}</span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{a.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset aria-describedby={errors.classification ? `${id}-class-msg` : undefined}>
              <legend className="mb-1.5 text-[13px] font-medium text-charcoal">
                Classification
                <span className="ml-0.5 text-brand-ink" aria-hidden>
                  *
                </span>
              </legend>
              <div role="radiogroup" className="space-y-2">
                {CLASSES.map((c) => {
                  const active = classification === c.value;
                  return (
                    <label
                      key={c.value}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors has-[:focus-visible]:shadow-[var(--shadow-focus)]',
                        active ? 'border-brand bg-brand-soft/50' : 'border-line hover:border-line-strong hover:bg-canvas',
                      )}
                    >
                      <input
                        type="radio"
                        name={`${id}-class`}
                        className="sr-only"
                        checked={active}
                        onChange={() => {
                          setClassification(c.value);
                          setErrors((e) => ({ ...e, classification: '' }));
                        }}
                      />
                      <span
                        className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', active ? 'border-brand-ink' : 'border-line-strong')}
                        aria-hidden
                      >
                        {active && <span className="size-2 rounded-full bg-brand-ink" />}
                      </span>
                      <span>
                        <span className="block text-sm font-semibold text-ink">{c.label}</span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{c.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {errors.classification && (
                <p id={`${id}-class-msg`} role="alert" className="mt-1.5 text-xs text-danger">
                  {errors.classification}
                </p>
              )}
            </fieldset>

            <Field label="Reason" htmlFor={`${id}-reason`} required error={errors.reason || undefined} hint={`Shown to every affected organization · ${reason.length}/1000`}>
              <Textarea
                id={`${id}-reason`}
                rows={4}
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setErrors((er) => ({ ...er, reason: '' }));
                }}
                placeholder="e.g. Out-of-specification dissolution results confirmed by the national quality control laboratory."
                aria-invalid={!!errors.reason}
                aria-describedby={`${id}-reason-msg`}
              />
            </Field>
          </div>
        ) : (
          <div className="space-y-5">
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger/25 bg-danger-soft p-4">
              <AlertOctagon className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
              <p className="text-sm leading-relaxed text-ink">
                This will notify the manufacturer and current custodian, cancel any pending shipment, and block ordinary transfers and dispensing.{' '}
                <strong className="font-semibold text-danger">This cannot be undone.</strong>
              </p>
            </div>
            <dl className="grid gap-3 rounded-xl border border-line bg-canvas p-4 text-[13px] sm:grid-cols-3">
              <div>
                <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted">Action</dt>
                <dd className="mt-0.5 font-semibold text-ink">{verb}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted">Classification</dt>
                <dd className="mt-0.5 font-semibold text-ink">{CLASSES.find((c) => c.value === classification)?.label}</dd>
              </div>
              <div className="sm:col-span-3">
                <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted">Reason</dt>
                <dd className="mt-0.5 leading-relaxed text-charcoal">{reason.trim()}</dd>
              </div>
            </dl>
            <Field
              label={`Type the batch number to confirm`}
              htmlFor={`${id}-confirm`}
              hint={
                <>
                  Enter <span className="font-mono font-semibold text-charcoal">{batch.batchNumber}</span> exactly.
                </>
              }
            >
              <Input
                id={`${id}-confirm`}
                value={confirmText}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setConfirmText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && confirmed && !mutation.isPending) mutation.mutate();
                }}
                className="font-mono"
                aria-describedby={`${id}-confirm-msg`}
              />
            </Field>
            {error && <InlineError>{error}</InlineError>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
