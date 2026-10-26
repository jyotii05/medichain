import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Flag } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/input';
import { InfoNote, InlineError } from './InlineNotice';

const PRESETS = [
  { label: 'Packaging differs', text: 'Packaging differs from the reference pack.' },
  { label: 'Wrong imprint / colour', text: 'Tablet imprint or colour does not match the reference product.' },
  { label: 'Broken seal', text: 'Tamper-evident seal is broken or missing.' },
  { label: 'Temperature excursion', text: 'Storage temperature excursion during handling or transport.' },
  { label: 'Documentation mismatch', text: 'Shipping documentation does not match the batch record.' },
];

/** Raise a suspicion report on a batch for regulator review. */
export function FlagDialog({ batch, open, onOpenChange }: { batch: { id: string; batchNumber: string }; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const id = useId();
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setReason('');
      setFieldError(null);
      setError(null);
    }
  }, [open]);

  const togglePreset = (text: string) => {
    setFieldError(null);
    setReason((r) => {
      if (r.includes(text)) return r.replace(text, '').replace(/\s{2,}/g, ' ').trim();
      return r.trim() ? `${r.trim()} ${text}` : text;
    });
  };

  const mutation = useMutation({
    mutationFn: () => api.post(`/batches/${batch.id}/flags`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success('Batch flagged for regulator review', { description: `Batch ${batch.batchNumber} has been reported. The regulator has been notified.` });
      for (const key of ['batch', 'batches', 'flags', 'dashboard', 'notifications']) void qc.invalidateQueries({ queryKey: [key] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.reason) setFieldError(e.fieldErrors.reason);
      else setError(errorMessage(e, 'Could not flag this batch'));
    },
  });

  const submit = () => {
    setError(null);
    if (reason.trim().length < 10) return setFieldError('Please describe the concern (at least 10 characters)');
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent
        icon={<Flag />}
        title="Flag batch as suspicious"
        description={
          <>
            Report a concern about batch <span className="font-mono">{batch.batchNumber}</span> to the regulator.
          </>
        }
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} loading={mutation.isPending}>
              <Flag /> Submit flag
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p id={`${id}-presets`} className="mb-2 text-[13px] font-medium text-charcoal">
              Common concerns
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-presets`}>
              {PRESETS.map((p) => {
                const active = reason.includes(p.text);
                return (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => togglePreset(p.text)}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors',
                      active ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line bg-surface text-charcoal hover:border-line-strong hover:bg-subtle',
                    )}
                  >
                    {active && <Check className="size-3.5" aria-hidden />}
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Describe the concern" htmlFor={`${id}-reason`} required error={fieldError ?? undefined} hint={`At least 10 characters · ${reason.length}/1000`}>
            <Textarea
              id={`${id}-reason`}
              value={reason}
              maxLength={1000}
              rows={4}
              onChange={(e) => {
                setReason(e.target.value);
                setFieldError(null);
              }}
              placeholder="What did you observe? Include pack details, where it was found and any patient reports."
              aria-invalid={!!fieldError}
              aria-describedby={`${id}-reason-msg`}
            />
          </Field>
          <InfoNote>A flag does not change the batch status. The regulator reviews it and decides whether to resolve, dismiss, or recall the batch.</InfoNote>
          {error && <InlineError>{error}</InlineError>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
