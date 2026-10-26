import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { useQrDataUrl, verifyHost } from './qr';

export interface LabelData {
  publicId: string;
  verificationUrl: string;
  medicineName?: string;
  strength?: string | null;
  batchNumber?: string;
  expiryDate?: string;
  manufacturerName?: string;
}

/**
 * Pack / shipper label: medicine, batch number, expiry, opaque public ID and a QR that encodes only the
 * public verification URL. Used for the on-screen preview and for printing.
 */
export function BatchLabel({ data, className }: { data: LabelData; className?: string }) {
  const { dataUrl } = useQrDataUrl(data.verificationUrl, 360);
  return (
    <div
      className={cn('flex w-full max-w-[440px] items-stretch gap-4 rounded-xl border-2 border-ink bg-surface p-4 text-ink', className)}
      aria-label={`Batch label for ${data.medicineName ?? data.publicId}`}
    >
      <div className="flex shrink-0 flex-col items-center justify-center">
        {dataUrl ? (
          <img src={dataUrl} alt={`QR code linking to ${data.verificationUrl}`} className="size-[132px]" />
        ) : (
          <div data-qr-pending className="skeleton size-[132px]" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-charcoal">
          <ShieldCheck className="size-3" aria-hidden /> MediChain traceable batch
        </p>
        {data.medicineName && (
          <p className="mt-1.5 font-display text-[17px] font-bold leading-tight">
            {data.medicineName}
            {data.strength ? <span className="font-semibold"> {data.strength}</span> : null}
          </p>
        )}
        {data.manufacturerName && <p className="mt-0.5 truncate text-[11px] text-charcoal">{data.manufacturerName}</p>}
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px]">
          {data.batchNumber && (
            <>
              <dt className="text-charcoal">Batch no.</dt>
              <dd className="font-mono font-semibold">{data.batchNumber}</dd>
            </>
          )}
          {data.expiryDate && (
            <>
              <dt className="text-charcoal">Expiry</dt>
              <dd className="font-semibold">{formatDate(data.expiryDate)}</dd>
            </>
          )}
          <dt className="text-charcoal">ID</dt>
          <dd className="font-mono font-semibold tracking-tight">{data.publicId}</dd>
        </dl>
        <p className="mt-auto pt-2 text-[10.5px] leading-snug text-charcoal">
          Scan to verify at <span className="font-semibold text-ink">{verifyHost(data.verificationUrl)}</span>
        </p>
      </div>
    </div>
  );
}

const PRINT_CSS = `
@media screen { .mc-print-root { display: none !important; } }
@media print {
  @page { margin: 12mm; }
  body > *:not(.mc-print-root) { display: none !important; }
  .mc-print-root { display: block !important; }
  .mc-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

/**
 * Print only the given content (e.g. a batch label), hiding the rest of the app.
 * Renders a portal on demand, waits for the QR image, prints, then cleans up.
 */
export function usePrintContent() {
  const [content, setContent] = useState<ReactNode | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!content) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const done = () => setContent(null);
    const attempt = () => {
      const el = ref.current;
      const pending = el?.querySelector('[data-qr-pending]');
      const imgs = Array.from(el?.querySelectorAll('img') ?? []);
      if ((pending || imgs.some((i) => !i.complete)) && tries++ < 30) {
        timer = setTimeout(attempt, 50);
        return;
      }
      window.addEventListener('afterprint', done, { once: true });
      window.print();
      // Some browsers do not fire afterprint reliably; clean up regardless.
      timer = setTimeout(done, 500);
    };
    timer = setTimeout(attempt, 30);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', done);
    };
  }, [content]);

  const print = useCallback((node: ReactNode) => setContent(node), []);
  const portal = content
    ? createPortal(
        <div ref={ref} className="mc-print-root">
          <style>{PRINT_CSS}</style>
          {content}
        </div>,
        document.body,
      )
    : null;

  return { print, portal, printing: !!content };
}
