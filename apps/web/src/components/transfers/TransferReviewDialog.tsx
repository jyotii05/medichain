import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, PackageCheck, XCircle } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { BatchDetail, TransferRow } from '@/lib/types';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DetailList, InfoNote, InlineError } from '@/components/batch-actions/InlineNotice';
import { RecallAlert } from '@/components/recalls/RecallAlert';
import { ExpiryCell } from '@/pages/batches/BatchesPage';

const CONFLICT_COPY: Record<string, { title: string; description: string }> = {
  TRANSFER_ALREADY_RESOLVED: {
    title: 'This shipment was already resolved',
    description: 'Someone else accepted, rejected or cancelled it in the meantime. The list has been refreshed.',
  },
  CUSTODY_CHANGED: {
    title: 'Custody changed since this shipment was sent',
    description: 'The batch is no longer held by the sender, so this shipment cannot be completed. The list has been refreshed.',
  },
};

/** Recipient reviews an incoming shipment and accepts or rejects custody. */
export function TransferReviewDialog({ transfer, open, onOpenChange }: { transfer: TransferRow | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const id = useId();
  const [mode, setMode] = useState<'review' | 'reject'>('review');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setMode('review');
      setNote('');
      setReason('');
      setFieldErrors({});
      setError(null);
    }
  }, [open]);

  const detail = useQuery({
    queryKey: ['batch', transfer?.batch.id],
    queryFn: () => api.get<BatchDetail>(`/batches/${transfer!.batch.id}`),
    enabled: open && !!transfer,
  });

  const refresh = () => {
    for (const key of ['batch', 'batches', 'transfers', 'dashboard', 'notifications']) void qc.invalidateQueries({ queryKey: [key] });
  };

  const mutation = useMutation({
    mutationFn: (accept: boolean) =>
      accept
        ? api.post<{ transfer: TransferRow }>(`/transfers/${transfer!.id}/accept`, { note: note.trim() || null })
        : api.post<{ transfer: TransferRow }>(`/transfers/${transfer!.id}/reject`, { reason: reason.trim() }),
    onSuccess: ({ transfer: t }, accept) => {
      if (accept) toast.success(`Shipment ${t.reference} accepted`, { description: `Your organization is now the recorded custodian of batch ${t.batch.batchNumber}.` });
      else toast.success(`Shipment ${t.reference} rejected`, { description: `Custody stays with ${t.fromOrg.name}. They have been notified.` });
      refresh();
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409 && CONFLICT_COPY[e.code]) {
        toast.error(CONFLICT_COPY[e.code].title, { description: CONFLICT_COPY[e.code].description });
        refresh();
        onOpenChange(false);
        return;
      }
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setFieldErrors(e.fieldErrors);
      else setError(errorMessage(e, 'Could not update this shipment'));
    },
  });

  if (!transfer) return null;
  const b = transfer.batch;
  const recall = detail.data?.recalls[0];
  const blocked = b.status !== 'ACTIVE';

  const reject = () => {
    setError(null);
    if (reason.trim().length < 5) return setFieldErrors({ reason: 'Please give a reason (at least 5 characters)' });
    setFieldErrors({});
    mutation.mutate(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent
        size="lg"
        icon={<PackageCheck />}
        title={mode === 'review' ? 'Review incoming shipment' : 'Reject shipment'}
        description={
          <>
            <span className="font-mono">{transfer.reference}</span> from {transfer.fromOrg.name}
          </>
        }
        footer={
          mode === 'review' ? (
            <>
              <Button variant="outline" onClick={() => setMode('reject')} disabled={mutation.isPending}>
                <XCircle /> Reject…
              </Button>
              <Button onClick={() => mutation.mutate(true)} loading={mutation.isPending && mutation.variables === true} disabled={mutation.isPending || blocked}>
                <CheckCircle2 /> Accept custody
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setMode('review')} disabled={mutation.isPending}>
                <ArrowLeft /> Back
              </Button>
              <Button variant="danger" onClick={reject} loading={mutation.isPending}>
                Confirm rejection
              </Button>
            </>
          )
        }
      >
        <div className="space-y-5">
          {blocked &&
            (recall ? (
              <RecallAlert recall={recall} />
            ) : (
              <InlineError>This batch is {b.status.toLowerCase()} by the regulator. Do not accept it into stock — reject the shipment instead.</InlineError>
            ))}

          <div className="rounded-xl border border-line bg-canvas p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-[15px] font-semibold text-ink">
                  {b.medicineName} <span className="font-normal text-muted">{b.strength}</span>
                </p>
                <p className="mt-0.5 font-mono text-[12px] text-charcoal">
                  {b.batchNumber} <span className="text-muted">· {b.publicId}</span>
                </p>
              </div>
              <Link
                to={`/app/batches/${b.id}`}
                className="inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-brand-ink underline-offset-4 hover:underline"
                onClick={() => onOpenChange(false)}
              >
                Open batch <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-charcoal">
              <span className="font-medium">{transfer.fromOrg.name}</span>
              <ArrowRight className="size-3.5 text-muted" aria-label="to" />
              <span className="font-medium">{transfer.toOrg.name}</span>
            </div>
          </div>

          <DetailList
            items={[
              { label: 'Quantity', value: <span className="tabular">{`${formatNumber(transfer.quantity)} ${b.unit}`}</span> },
              { label: 'Expiry', value: <ExpiryCell date={b.expiryDate} status={b.status} /> },
              { label: 'Batch status', value: <StatusBadge status={b.status} size="sm" /> },
              { label: 'Sent', value: `${formatDateTime(transfer.createdAt)}${transfer.initiatedBy ? ` by ${transfer.initiatedBy}` : ''}` },
              {
                label: 'Sender location',
                value: [transfer.fromOrg.city, transfer.fromOrg.country].filter(Boolean).join(', ') || '—',
              },
              { label: 'Recall status', value: blocked ? (recall ? `${recall.reference} (${recall.action === 'BLOCK' ? 'blocked' : 'recalled'})` : b.status) : 'No recall on record' },
              { label: 'Sender notes', value: transfer.notes || <span className="text-muted">No notes</span>, full: true },
            ]}
          />

          {mode === 'review' ? (
            <>
              <InfoNote>
                Accepting records your organization as the custodian of the <strong className="font-semibold text-ink">whole batch</strong>. Check the physical
                goods against these details first.
              </InfoNote>
              <Field label="Note to sender" htmlFor={`${id}-note`} hint="Optional" error={fieldErrors.note}>
                <Textarea
                  id={`${id}-note`}
                  rows={2}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Received in good condition"
                  aria-invalid={!!fieldErrors.note}
                  aria-describedby={`${id}-note-msg`}
                />
              </Field>
            </>
          ) : (
            <Field label="Reason for rejection" htmlFor={`${id}-reason`} required error={fieldErrors.reason} hint="Shared with the sender · at least 5 characters">
              <Textarea
                id={`${id}-reason`}
                rows={3}
                maxLength={500}
                autoFocus
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setFieldErrors({});
                }}
                placeholder="e.g. Seals broken on 2 cartons; quantity does not match the documentation."
                aria-invalid={!!fieldErrors.reason}
                aria-describedby={`${id}-reason-msg`}
              />
            </Field>
          )}
          {error && <InlineError>{error}</InlineError>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
