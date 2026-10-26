import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { Lock, LogIn, ScanLine, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/layout/Logo';
import { Button } from '@/components/ui/button';
import { VerifyWorkbench } from '@/components/verify/VerifyWorkbench';

const STEPS = [
  { icon: ScanLine, title: 'Scan or enter the code', body: 'Every registered pack carries a QR code with an opaque MediChain identifier.' },
  { icon: ShieldCheck, title: 'We check the registry', body: 'The batch record, manufacturer, recall status, expiry and recorded custody history.' },
  { icon: Lock, title: 'No account, no tracking', body: 'No sign-in needed. We keep only a salted hash of your network address for abuse prevention.' },
];

export default function PublicVerifyPage() {
  const { code } = useParams();

  useEffect(() => {
    document.title = code ? `Verify ${code.toUpperCase()} · MediChain` : 'Verify a medicine · MediChain';
  }, [code]);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="no-print border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/verify" aria-label="MediChain verification home" className="rounded-lg">
            <Logo subtitle={false} />
          </Link>
          <Link to="/login">
            <Button variant="ghost" size="sm">
              <LogIn /> Partner sign in
            </Button>
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {!code && (
          <div className="mb-8 max-w-2xl">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-brand-ink">Public medicine check</p>
            <h1 className="mt-2 text-[28px] font-bold leading-tight sm:text-[36px]">Is this medicine registered?</h1>
            <p className="mt-3 text-[15px] leading-relaxed text-charcoal">
              Check a medicine pack against the MediChain registry. You will see whether its code belongs to a registered batch, whether it has been recalled or has expired, and the custody
              journey recorded by licensed partners.
            </p>
          </div>
        )}
        {code && <h1 className="sr-only">Verification result for {code.toUpperCase()}</h1>}

        <div className={code ? undefined : 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]'}>
          <VerifyWorkbench code={code} basePath="/verify" context="public" />
          {!code && (
            <aside aria-label="How verification works" className="space-y-3">
              {STEPS.map((s) => (
                <div key={s.title} className="flex gap-3 rounded-2xl border border-line bg-surface p-4">
                  <s.icon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-ink">{s.title}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{s.body}</p>
                  </div>
                </div>
              ))}
            </aside>
          )}
        </div>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 text-[12.5px] leading-relaxed text-muted sm:px-6">
          <p>
            <span className="font-semibold text-charcoal">Please note: </span>A positive result confirms that the code matches a registered batch record and its recorded custody history. It
            does not by itself prove that the physical pack is genuine — check the packaging, and buy medicines only from licensed pharmacies. If in doubt, ask your pharmacist.
          </p>
          <p className="mt-3">MediChain supply-chain traceability · QR codes contain only an opaque identifier, never personal data.</p>
        </div>
      </footer>
    </div>
  );
}
