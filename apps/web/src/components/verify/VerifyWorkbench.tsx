import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type QrScannerType from 'qr-scanner';
import { AlertTriangle, Camera, CameraOff, Hourglass, ImageUp, Keyboard, Loader2, RefreshCw, ScanLine, Search, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { VerificationResponse } from '@/lib/types';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { ErrorState } from '@/components/shared/States';
import { cn } from '@/lib/utils';
import { VerificationResult } from './VerificationResult';
import { extractCode, formatManualInput, PUBLIC_ID_PATTERN } from './verifyUtils';

type Method = 'scan' | 'upload' | 'manual';

/**
 * Full verification experience (input methods → GET /api/verify/:code → result).
 * Used by the public /verify page and the in-app /app/verify page.
 */
export function VerifyWorkbench({
  code,
  basePath,
  context,
  resultActions,
  intro,
}: {
  code?: string;
  basePath: '/verify' | '/app/verify';
  context: 'public' | 'app';
  resultActions?: (data: VerificationResponse) => ReactNode;
  /** optional content rendered above the input card when no code is selected */
  intro?: ReactNode;
}) {
  const navigate = useNavigate();
  const normalised = code ? (extractCode(code) ?? code.toUpperCase()) : undefined;

  const q = useQuery({
    queryKey: ['verify', normalised],
    queryFn: () => api.get<VerificationResponse>(`/verify/${encodeURIComponent(normalised!)}`),
    enabled: !!normalised,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  const go = useCallback((id: string) => navigate(`${basePath}/${encodeURIComponent(id)}`), [navigate, basePath]);
  const reset = useCallback(() => navigate(basePath), [navigate, basePath]);

  useEffect(() => {
    if (normalised) window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [normalised]);

  if (!normalised) {
    return (
      <div className="space-y-6">
        {intro}
        <CodeInputCard onCode={go} context={context} />
      </div>
    );
  }

  if (q.isLoading) return <ResultSkeleton code={normalised} />;

  if (q.error || !q.data) {
    const rateLimited = q.error instanceof ApiError && q.error.status === 429;
    return (
      <Card>
        {rateLimited ? (
          <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
            <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-warning-soft text-warning-ink">
              <Hourglass className="size-5" aria-hidden />
            </div>
            <h2 className="text-[15px] font-semibold">Too many checks in a short time</h2>
            <p className="mt-1 max-w-sm text-sm text-muted">
              To protect the service, verification is limited per device. Please wait about a minute, then try again.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => q.refetch()} loading={q.isFetching}>
                <RefreshCw /> Try again
              </Button>
              <Button variant="ghost" onClick={reset}>
                Check another
              </Button>
            </div>
          </div>
        ) : (
          <>
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
            <div className="-mt-6 pb-8 text-center">
              <Button variant="link" onClick={reset}>
                Check another code
              </Button>
            </div>
          </>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => q.refetch()} loading={q.isFetching} aria-label="Re-run verification">
          {!q.isFetching && <RefreshCw />} Re-verify
        </Button>
      </div>
      <div className={cn('transition-opacity', q.isFetching && 'opacity-60')}>
        <VerificationResult data={q.data} onReset={reset} context={context} actions={resultActions?.(q.data)} />
      </div>
    </div>
  );
}

function ResultSkeleton({ code }: { code: string }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <Card className="p-6 sm:p-7">
        <div className="flex items-start gap-5">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-subtle text-muted">
            <Loader2 className="size-6 animate-spin" aria-hidden />
          </span>
          <div className="flex-1 space-y-3">
            <p className="text-sm font-medium text-charcoal" role="status">
              Checking <span className="font-mono">{code}</span> against the registry…
            </p>
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="space-y-3 p-5 lg:col-span-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-24 w-full" />
        </Card>
        <Card className="space-y-3 p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-24 w-full" />
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CodeInputCard({ onCode, context }: { onCode: (id: string) => void; context: 'public' | 'app' }) {
  const [method, setMethod] = useState<Method>('scan');
  const [foreign, setForeign] = useState<string | null>(null);

  /** Text decoded from a QR code: verify only if it is a MediChain code or verification link. */
  const handleDecoded = (text: string) => {
    const id = extractCode(text);
    if (!id) {
      setForeign(text);
      return;
    }
    setForeign(null);
    onCode(id);
  };

  return (
    <Card>
      <CardBody className="p-5 sm:p-6">
        <div className="mb-5 flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold">{context === 'app' ? 'Check a pack' : 'Check your medicine'}</h2>
            <p className="mt-0.5 text-[13px] text-muted">Scan the QR code on the pack, upload a photo of it, or type the identifier printed beneath it.</p>
          </div>
        </div>
        <Tabs value={method} onValueChange={(v) => setMethod(v as Method)}>
          <TabsList className="grid w-full grid-cols-3" aria-label="Verification method">
            <TabsTrigger value="scan" className="justify-center">
              <Camera /> <span>Scan</span>
            </TabsTrigger>
            <TabsTrigger value="upload" className="justify-center">
              <ImageUp /> <span>Upload</span>
            </TabsTrigger>
            <TabsTrigger value="manual" className="justify-center">
              <Keyboard /> <span>Enter ID</span>
            </TabsTrigger>
          </TabsList>
          <div className="mt-5">
            <TabsContent value="scan">{method === 'scan' && <CameraScanner onDecoded={handleDecoded} />}</TabsContent>
            <TabsContent value="upload">
              <ImageUpload onDecoded={handleDecoded} />
            </TabsContent>
            <TabsContent value="manual">
              <ManualEntry onCode={onCode} />
            </TabsContent>
          </div>
        </Tabs>
        {foreign && (
          <div role="alert" className="mt-4 flex gap-3 rounded-xl border border-danger/25 bg-danger-soft p-3.5 text-[13px]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold text-ink">This is not a MediChain code</p>
              <p className="mt-0.5 text-charcoal">
                The QR code contains: <span className="break-all font-mono text-[12px]">{foreign.slice(0, 160)}</span>
              </p>
              <p className="mt-1 text-muted">Do not open links from codes you do not trust. Medicine packs registered on MediChain carry an identifier like MC-XXXX-XXXX-XXXX.</p>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

type CamState = 'idle' | 'starting' | 'scanning' | 'denied' | 'unsupported' | 'nocamera' | 'error';

function CameraScanner({ onDecoded }: { onDecoded: (text: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScannerType | null>(null);
  const doneRef = useRef(false);
  const [state, setState] = useState<CamState>('idle');
  const [detail, setDetail] = useState('');

  const stop = useCallback(() => {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }
    setState('starting');
    doneRef.current = false;
    try {
      const { default: QrScanner } = await import('qr-scanner');
      if (!(await QrScanner.hasCamera())) {
        setState('nocamera');
        return;
      }
      if (!videoRef.current) return;
      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          if (doneRef.current) return;
          doneRef.current = true;
          stop();
          setState('idle');
          onDecoded(result.data);
        },
        { returnDetailedScanResult: true, preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8 },
      );
      scannerRef.current = scanner;
      await scanner.start();
      setState('scanning');
    } catch (e) {
      stop();
      const name = e instanceof DOMException ? e.name : '';
      const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : '';
      if (name === 'NotAllowedError' || name === 'SecurityError' || /denied|permission/i.test(msg)) setState('denied');
      else if (name === 'NotFoundError' || /not found/i.test(msg)) setState('nocamera');
      else {
        setDetail(msg);
        setState('error');
      }
    }
  };

  const cancel = () => {
    stop();
    setState('idle');
  };

  const problem: Partial<Record<CamState, { title: string; body: string }>> = {
    denied: {
      title: 'Camera permission was denied',
      body: 'Allow camera access for this site in your browser settings and try again, or use “Upload” or “Enter ID” instead.',
    },
    unsupported: {
      title: 'Camera scanning is not available here',
      body: 'Your browser does not allow camera access on this connection (a secure https:// connection is required). Upload a photo of the QR code or enter the identifier instead.',
    },
    nocamera: { title: 'No camera found', body: 'This device has no usable camera. Upload a photo of the QR code or enter the identifier instead.' },
    error: { title: 'The camera could not be started', body: detail || 'Another app may be using the camera. Close it and try again, or use another method.' },
  };
  const p = problem[state];
  const live = state === 'scanning' || state === 'starting';

  return (
    <div>
      <div className={cn('relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-2xl bg-ink', !live && 'hidden')}>
        <video ref={videoRef} className="size-full object-cover" muted playsInline aria-label="Camera preview" />
        {state === 'starting' && (
          <div className="absolute inset-0 grid place-items-center text-sm text-white/80">
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Starting camera…
            </span>
          </div>
        )}
      </div>
      {live ? (
        <div className="mt-4 flex flex-col items-center gap-3 text-center">
          <p className="text-[13px] text-muted" role="status">
            {state === 'scanning' ? 'Point the camera at the QR code on the pack. It is read automatically.' : 'Waiting for camera permission…'}
          </p>
          <Button variant="outline" onClick={cancel}>
            <CameraOff /> Stop camera
          </Button>
        </div>
      ) : p ? (
        <div role="alert" className="rounded-xl border border-warning/40 bg-warning-soft p-4 text-[13px]">
          <p className="flex items-center gap-2 font-semibold text-warning-ink">
            <CameraOff className="size-4" aria-hidden /> {p.title}
          </p>
          <p className="mt-1 text-charcoal">{p.body}</p>
          {state !== 'unsupported' && state !== 'nocamera' && (
            <Button variant="outline" size="sm" className="mt-3" onClick={start}>
              <RefreshCw /> Try again
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-canvas px-6 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-surface text-brand shadow-[var(--shadow-card)]">
            <ScanLine className="size-7" aria-hidden />
          </span>
          <p className="mt-4 text-sm font-medium text-ink">Scan the pack’s QR code</p>
          <p className="mt-1 max-w-xs text-[13px] text-muted">Your camera is only used on this device to read the code. No images are uploaded.</p>
          <Button className="mt-5" size="lg" onClick={start}>
            <Camera /> Start camera
          </Button>
        </div>
      )}
    </div>
  );
}

function ImageUpload({ onDecoded }: { onDecoded: (text: string) => void }) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const scan = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPG, PNG, HEIC or WebP).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { default: QrScanner } = await import('qr-scanner');
      const r = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
      onDecoded(r.data);
    } catch {
      setError('No QR code could be read from this image. Try a sharper, well-lit photo with the whole code in view, or enter the identifier manually.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void scan(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center rounded-2xl border border-dashed px-6 py-10 text-center transition-colors focus-within:shadow-[var(--shadow-focus)]',
          dragging ? 'border-brand bg-brand-soft/50' : 'border-line-strong bg-canvas hover:border-brand/60',
        )}
      >
        <span className="grid size-14 place-items-center rounded-2xl bg-surface text-brand shadow-[var(--shadow-card)]">
          {busy ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <ImageUp className="size-7" aria-hidden />}
        </span>
        <span className="mt-4 text-sm font-medium text-ink">{busy ? 'Reading QR code…' : 'Choose a photo of the QR code'}</span>
        <span className="mt-1 text-[13px] text-muted">or drag and drop it here · the image never leaves your device</span>
        <input
          id={inputId}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void scan(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
      {error && (
        <p role="alert" className="mt-3 flex gap-2 text-[13px] text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

function ManualEntry({ onCode }: { onCode: (id: string) => void }) {
  const id = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = extractCode(value);
    if (!code) {
      setError(value.trim() ? 'This link is not a MediChain verification link.' : 'Enter the identifier printed under the QR code.');
      return;
    }
    // Full verification links are passed through; bare identifiers must have the right shape.
    if (!/\/verify\//i.test(value) && !PUBLIC_ID_PATTERN.test(code)) {
      setError('Identifiers look like MC-XXXX-XXXX-XXXX (12 letters and digits; O, I, L and U are not used).');
      return;
    }
    setError(null);
    onCode(code);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Field label="Medicine identifier or verification link" htmlFor={id} error={error ?? undefined} hint="Printed beneath the QR code, e.g. MC-7K2D-9QXR-4M8P">
        <Input
          id={id}
          value={value}
          onChange={(e) => {
            setValue(formatManualInput(e.target.value));
            setError(null);
          }}
          placeholder="MC-XXXX-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          className="h-12 font-mono text-base tracking-wider"
          aria-invalid={!!error}
          aria-describedby={`${id}-msg`}
        />
      </Field>
      <Button type="submit" size="lg" className="w-full sm:w-auto">
        <Search /> Verify
      </Button>
    </form>
  );
}
