import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Building2, CheckCircle2, MapPin, Truck } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { OrgType, TransferRow } from '@/lib/types';
import { cn, formatNumber, ROLE_LABEL } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import { InfoNote, InlineError } from '@/components/batch-actions/InlineNotice';

interface Recipient {
  id: string;
  name: string;
  type: OrgType;
  city: string | null;
  country: string | null;
  licenseNumber: string;
}

/** Start a whole-batch custody transfer to an approved organization at the next supply-chain stage. */
export function TransferDialog({
  batch,
  open,
  onOpenChange,
}: {
  batch: { id: string; batchNumber: string; medicineName: string; quantity: number; unit: string };
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const id = useId();
  const [toOrgId, setToOrgId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setToOrgId('');
      setNotes('');
      setError(null);
      setFieldErrors({});
    }
  }, [open]);

  const recipients = useQuery({
    queryKey: ['transfers', 'recipients'],
    queryFn: () => api.get<{ items: Recipient[]; nextStage: OrgType | null }>('/transfers/recipients'),
    enabled: open,
    staleTime: 60_000,
  });

  const create = useMutation({
    mutationFn: () => api.post<{ transfer: TransferRow }>('/transfers', { batchId: batch.id, toOrgId, notes: notes.trim() || null }),
    onSuccess: ({ transfer }) => {
      toast.success(`Shipment ${transfer.reference} created`, {
        description: `Awaiting acceptance by ${transfer.toOrg.name}. Custody changes only once they accept.`,
      });
      for (const key of ['batch', 'batches', 'transfers', 'dashboard']) void qc.invalidateQueries({ queryKey: [key] });
      onOpenChange(false);
    },
    onError: (e) => {
      setError(errorMessage(e, 'Could not create the shipment'));
      if (e instanceof ApiError) setFieldErrors(e.fieldErrors);
    },
  });

  const submit = () => {
    setError(null);
    setFieldErrors({});
    if (!toOrgId) {
      setFieldErrors({ toOrgId: 'Choose a recipient' });
      return;
    }
    create.mutate();
  };

  const nextStage = recipients.data?.nextStage;
  const items = recipients.data?.items ?? [];
  const recipientError = fieldErrors.toOrgId;

  return (
    <Dialog open={open} onOpenChange={(o) => !create.isPending && onOpenChange(o)}>
      <DialogContent
        size="lg"
        icon={<Truck />}
        title="Ship batch"
        description={
          <>
            {batch.medicineName} · <span className="font-mono">{batch.batchNumber}</span> · {formatNumber(batch.quantity)} {batch.unit}
          </>
        }
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} loading={create.isPending} disabled={!items.length}>
              <Truck /> Create shipment
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <InfoNote>
            Transfers move the <strong className="font-semibold text-ink">whole batch</strong> ({formatNumber(batch.quantity)} {batch.unit}). The recipient must
            accept the shipment before custody changes — until then your organization remains the recorded custodian and the batch shows as in transit.
          </InfoNote>

          <fieldset aria-describedby={recipientError ? `${id}-recipient-msg` : undefined}>
            <legend className="mb-1.5 text-[13px] font-medium text-charcoal">
              Recipient{nextStage ? ` (${ROLE_LABEL[nextStage].toLowerCase()})` : ''}
              <span className="ml-0.5 text-brand-ink" aria-hidden>
                *
              </span>
            </legend>
            {recipients.isLoading ? (
              <div className="space-y-2" aria-busy="true">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-16 w-full rounded-xl" />
                ))}
              </div>
            ) : recipients.error ? (
              <InlineError>
                {errorMessage(recipients.error)}{' '}
                <button type="button" className="font-semibold underline underline-offset-2" onClick={() => recipients.refetch()}>
                  Try again
                </button>
              </InlineError>
            ) : !nextStage ? (
              <InlineError>Your organization type is the final stage of the supply chain and cannot ship batches onward.</InlineError>
            ) : items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center">
                <Building2 className="mx-auto size-5 text-muted" aria-hidden />
                <p className="mt-2 text-sm font-medium text-ink">No approved {ROLE_LABEL[nextStage].toLowerCase()}s yet</p>
                <p className="mt-1 text-[13px] text-muted">The regulator must approve a {ROLE_LABEL[nextStage].toLowerCase()} before you can ship to one.</p>
              </div>
            ) : (
              <div role="radiogroup" className="scrollbar-thin max-h-72 space-y-2 overflow-y-auto pr-0.5">
                {items.map((r) => {
                  const selected = r.id === toOrgId;
                  return (
                    <label
                      key={r.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors',
                        'has-[:focus-visible]:shadow-[var(--shadow-focus)]',
                        selected ? 'border-brand bg-brand-soft/50' : 'border-line hover:border-line-strong hover:bg-canvas',
                      )}
                    >
                      <input
                        type="radio"
                        name={`${id}-recipient`}
                        value={r.id}
                        checked={selected}
                        onChange={() => setToOrgId(r.id)}
                        className="sr-only"
                      />
                      <span
                        className={cn(
                          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
                          selected ? 'border-brand bg-brand text-ink' : 'border-line-strong bg-surface',
                        )}
                        aria-hidden
                      >
                        {selected && <CheckCircle2 className="size-3.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{r.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3" aria-hidden />
                            {[r.city, r.country].filter(Boolean).join(', ') || 'Location not set'}
                          </span>
                          <span>
                            Licence <span className="font-mono text-charcoal">{r.licenseNumber}</span>
                          </span>
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {recipientError && (
              <p id={`${id}-recipient-msg`} role="alert" className="mt-1.5 text-xs text-danger">
                {recipientError}
              </p>
            )}
          </fieldset>

          <Field label="Notes for the recipient" htmlFor={`${id}-notes`} error={fieldErrors.notes} hint={`Optional · ${notes.length}/500`}>
            <Textarea
              id={`${id}-notes`}
              value={notes}
              maxLength={500}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cold-chain packed, 4 pallets, expected delivery Thursday"
              aria-invalid={!!fieldErrors.notes}
              aria-describedby={`${id}-notes-msg`}
            />
          </Field>

          {error && !recipientError && <InlineError>{error}</InlineError>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
