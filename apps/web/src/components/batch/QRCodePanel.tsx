import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Download, ExternalLink, FileCode2, Lock, Printer, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import { downloadFile, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useQrDataUrl } from './qr';
import { BatchLabel, usePrintContent } from './PrintableLabel';

export interface QRCodePanelProps {
  batchId?: string;
  publicId: string;
  verificationUrl: string;
  batchNumber?: string;
  medicineName?: string;
  /** rendered QR edge length in CSS pixels (default 200) */
  size?: number;
  showActions?: boolean;
  className?: string;
}

/**
 * Client-rendered QR code for a batch. It encodes exactly `verificationUrl` (public page + opaque ID) —
 * never personal, commercial or confidential data.
 */
export function QRCodePanel({ batchId, publicId, verificationUrl, batchNumber, medicineName, size = 200, showActions = false, className }: QRCodePanelProps) {
  const { dataUrl, error } = useQrDataUrl(verificationUrl, Math.max(256, size * 2));
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'png' | 'svg' | null>(null);
  const { print, portal, printing } = usePrintContent();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(verificationUrl);
      setCopied(true);
      toast.success('Verification link copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy — select the link and copy it manually');
    }
  };

  const download = async (format: 'png' | 'svg') => {
    if (!batchId) return;
    setBusy(format);
    try {
      await downloadFile(`/batches/${encodeURIComponent(batchId)}/qr?format=${format}`, `medichain-${publicId}.${format}`);
      toast.success(`QR code downloaded (${format.toUpperCase()})`);
    } catch (e) {
      toast.error(errorMessage(e, 'Download failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={cn('flex flex-col items-center text-center', className)}>
      <div className="rounded-2xl border border-line bg-surface p-3 shadow-[var(--shadow-card)]">
        {dataUrl ? (
          <img
            src={dataUrl}
            width={size}
            height={size}
            style={{ width: size, height: size }}
            alt={`QR code for batch ${batchNumber ?? publicId}, linking to the public verification page`}
            className="block"
          />
        ) : error ? (
          <div style={{ width: size, height: size }} className="grid place-items-center rounded-lg bg-subtle text-center text-xs text-muted">
            <span className="flex flex-col items-center gap-2 px-4">
              <QrCode className="size-6" aria-hidden />
              QR code could not be rendered
            </span>
          </div>
        ) : (
          <div style={{ width: size, height: size }} className="skeleton" aria-label="Generating QR code" />
        )}
      </div>

      <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Public batch ID</p>
      <p className="mt-0.5 font-mono text-[15px] font-semibold tracking-tight text-ink">{publicId}</p>

      <div className="mt-3 flex w-full max-w-[320px] items-center gap-1 rounded-xl border border-line bg-canvas py-1 pl-3 pr-1">
        <span className="min-w-0 flex-1 truncate text-left font-mono text-[11.5px] text-charcoal" title={verificationUrl}>
          {verificationUrl.replace(/^https?:\/\//, '')}
        </span>
        <Tooltip content={copied ? 'Copied' : 'Copy verification link'}>
          <Button variant="ghost" size="icon-sm" onClick={copy} aria-label="Copy verification link">
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
        </Tooltip>
        <Tooltip content="Open public verification page">
          <a
            href={verificationUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open public verification page in a new tab"
            className="grid size-8 place-items-center rounded-lg text-charcoal hover:bg-subtle hover:text-ink"
          >
            <ExternalLink className="size-4" />
          </a>
        </Tooltip>
      </div>

      {showActions && batchId && (
        <div className="mt-4 grid w-full max-w-[320px] grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => download('png')} loading={busy === 'png'} disabled={!!busy}>
            {busy !== 'png' && <Download />} PNG
          </Button>
          <Button variant="outline" size="sm" onClick={() => download('svg')} loading={busy === 'svg'} disabled={!!busy}>
            {busy !== 'svg' && <FileCode2 />} SVG
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="col-span-2"
            loading={printing}
            onClick={() => print(<BatchLabel data={{ publicId, verificationUrl, medicineName, batchNumber }} />)}
          >
            {!printing && <Printer />} Print label
          </Button>
        </div>
      )}

      <p className="mt-4 flex max-w-[320px] items-start gap-1.5 text-left text-[11.5px] leading-relaxed text-muted">
        <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
        Encodes only the public verification URL with an opaque ID — no personal or confidential data.
      </p>
      {portal}
    </div>
  );
}
