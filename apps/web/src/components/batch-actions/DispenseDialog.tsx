import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PackageMinus, ScanLine } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { InfoNote, InlineError } from './InlineNotice';

/** Pharmacy records units dispensed to patients. Stock can never go below zero. */
export function DispenseDialog({
  batch,
  open,
  onOpenChange,
}: {
  batch: { id: string; batchNumber: string; quantityOnHand: number; unit: string };
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const id = useId();
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setValue('');
      setFieldError(null);
      setError(null);
    }
  }, [open]);

  const quantity = Number(value);
  const remaining = Number.isFinite(quantity) && value !== '' ? batch.quantityOnHand - quantity : batch.quantityOnHand;

  const mutation = useMutation({
    mutationFn: () => api.post<{ quantityOnHand: number }>(`/batches/${batch.id}/dispense`, { quantity }),
    onSuccess: (r) => {
      toast.success(`Recorded ${formatNumber(quantity)} ${batch.unit} dispensed`, {
        description: `${formatNumber(r.quantityOnHand)} ${batch.unit} remain on hand for batch ${batch.batchNumber}.`,
      });
      for (const key of ['batch', 'batches', 'dashboard']) void qc.invalidateQueries({ queryKey: [key] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors.quantity) setFieldError(e.fieldErrors.quantity);
      else setError(errorMessage(e, 'Could not record dispensing'));
    },
  });

  const submit = () => {
    setError(null);
    if (!value || !Number.isInteger(quantity) || quantity < 1) return setFieldError('Enter a whole number of at least 1');
    if (quantity > batch.quantityOnHand) return setFieldError(`Only ${formatNumber(batch.quantityOnHand)} ${batch.unit} are on hand`);
    setFieldError(null);
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent
        size="sm"
        icon={<PackageMinus />}
        title="Record dispensing"
        description={
          <>
            Batch <span className="font-mono">{batch.batchNumber}</span> · {formatNumber(batch.quantityOnHand)} {batch.unit} on hand
          </>
        }
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} loading={mutation.isPending} disabled={batch.quantityOnHand < 1}>
              Record dispensing
            </Button>
          </>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <InfoNote icon={<ScanLine />}>Verify the pack (scan its QR code or check the batch ID) before dispensing it to a patient.</InfoNote>
          <Field
            label={`Quantity dispensed (${batch.unit})`}
            htmlFor={`${id}-qty`}
            required
            error={fieldError ?? undefined}
            hint={
              value && !fieldError && remaining >= 0 ? `${formatNumber(remaining)} ${batch.unit} will remain on hand` : `Between 1 and ${formatNumber(batch.quantityOnHand)}`
            }
          >
            <Input
              id={`${id}-qty`}
              type="number"
              inputMode="numeric"
              min={1}
              max={batch.quantityOnHand}
              step={1}
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setFieldError(null);
              }}
              aria-invalid={!!fieldError}
              aria-describedby={`${id}-qty-msg`}
              className="tabular"
            />
          </Field>
          {error && <InlineError>{error}</InlineError>}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
