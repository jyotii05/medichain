import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Generic confirmation dialog. `onConfirm` may return a promise; the dialog shows a loading state and
 * stays open if it throws, so the caller can surface the error (e.g. via toast).
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'danger',
  onConfirm,
  children,
  confirmDisabled,
  icon,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => Promise<unknown> | unknown;
  children?: ReactNode;
  confirmDisabled?: boolean;
  icon?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      /* caller reports the error */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        size="sm"
        title={title}
        description={description}
        icon={icon ?? <AlertTriangle />}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={run} loading={busy} disabled={confirmDisabled}>
              {confirmLabel}
            </Button>
          </>
        }
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}
