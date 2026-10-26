import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  ArrowRight,
  BadgeCheck,
  BellRing,
  Factory,
  Fingerprint,
  Hash,
  Landmark,
  LayoutDashboard,
  Link2,
  Lock,
  QrCode,
  Rotate3d,
  ScanLine,
  ShieldCheck,
  Store,
  Truck,
  UserPlus,
  Users,
  Warehouse,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/layout/Logo';
import { SupplyGlobe, STAGE_COLORS } from '@/components/home/SupplyGlobe';
import { FlowField } from '@/components/home/FlowField';
import { extractCode, formatManualInput, PUBLIC_ID_PATTERN } from '@/components/verify/verifyUtils';
import { cn } from '@/lib/utils';

const STAGES = [
  { icon: Factory, title: 'Manufacturer', event: 'REGISTERED', body: 'Registers the batch, checked against its licence, and prints an opaque QR identity on every pack.' },
  { icon: Truck, title: 'Distributor', event: 'TRANSFER_ACCEPTED', body: 'Accepts the shipment only when it is the named recipient. Custody moves in one atomic, recorded step.' },
  { icon: Warehouse, title: 'Wholesaler', event: 'TRANSFER_ACCEPTED', body: 'Receives from the distributor and supplies pharmacies. Wrong routes and double shipments are refused.' },
  { icon: Store, title: 'Pharmacy', event: 'DISPENSED', body: 'Takes delivery, records dispensing and can flag anything suspicious for regulator review.' },
];

const FACTS = [
  { value: '4', label: 'custody stages, each handover recorded' },
  { value: '8', label: 'integrity checks behind every scan' },
  { value: 'SHA-256', label: 'hash-chained, append-only event log' },
  { value: '0', label: 'names or patient data written on-chain' },
];

const ROLES = [
  { icon: Landmark, title: 'Regulators', body: 'Approve partners, issue Class I–III recalls, resolve flags and audit every action.' },
  { icon: Factory, title: 'Manufacturers', body: 'Register batches, generate QR labels and ship to approved distributors.' },
  { icon: Truck, title: 'Distributors', body: 'Accept or reject incoming stock and move it on to wholesalers.' },
  { icon: Warehouse, title: 'Wholesalers', body: 'Hold verified inventory and supply licensed pharmacies.' },
  { icon: Store, title: 'Pharmacies', body: 'Receive stock, record dispensing and report suspicious packs.' },
  { icon: Users, title: 'Patients & public', body: 'Scan any pack — no account — to see its recorded journey and recall status.' },
];

// Illustrative hash chain: each block's "prev" is the previous block's hash, exactly as the real event log works.
const CHAIN = [
  { seq: '01', type: 'REGISTERED', hash: '8f3a…c21d' },
  { seq: '02', type: 'TRANSFER_ACCEPTED', hash: '1be0…94af' },
  { seq: '03', type: 'TRANSFER_ACCEPTED', hash: '77c4…0e5b' },
  { seq: '04', type: 'DISPENSED', hash: 'd29e…6a13' },
];

export default function HomePage() {
  const { user } = useAuth();

  useEffect(() => {
    document.title = 'MediChain — Every medicine. Every journey. Verified.';
  }, []);

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-[var(--shadow-raised)]">
        Skip to content
      </a>
      <SiteHeader signedIn={!!user} />

      <main id="main">
        <Hero signedIn={!!user} />
        <FactsStrip />
        <Journey />
        <Trust />
        <Roles />
        <VerifyBand />
        <PartnerCta signedIn={!!user} />
      </main>

      <SiteFooter />
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={cn('sticky top-0 z-40 transition-colors duration-200', scrolled ? 'border-b border-line bg-canvas/85 backdrop-blur-md' : 'border-b border-transparent')}>
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="MediChain home" className="rounded-lg">
          <Logo subtitle={false} />
        </Link>
        <nav aria-label="Homepage sections" className="hidden items-center gap-1 md:flex">
          {[
            ['#journey', 'The journey'],
            ['#trust', 'How trust works'],
            ['#roles', 'Who it’s for'],
            ['#verify', 'Verify a pack'],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-lg px-3 py-2 text-[13.5px] font-medium text-charcoal transition-colors hover:bg-surface hover:text-ink">
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <Link to="/app">
              <Button size="sm">
                <LayoutDashboard /> Open dashboard
              </Button>
            </Link>
          ) : (
            <>
              <Link to="/login" className="hidden sm:block">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link to="/register">
                <Button size="sm">
                  Create account <ArrowRight />
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero({ signedIn }: { signedIn: boolean }) {
  const [following, setFollowing] = useState(false);
  return (
    <section className="relative -mt-16 overflow-hidden pt-16" aria-labelledby="hero-title">
      {/* dotted paper texture, as on the sign-in panel, fading out towards the bottom */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          backgroundImage: 'radial-gradient(#e2dbd6 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'linear-gradient(to bottom, black 0%, black 55%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, black 0%, black 55%, transparent 100%)',
        }}
      />
      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-6 px-4 pb-10 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-4 lg:px-8 lg:pb-16 lg:pt-14">
        <div className="max-w-xl animate-slide-up">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand/25 bg-surface px-3 py-1 text-[12px] font-semibold text-brand-ink shadow-[var(--shadow-card)]">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
            </span>
            Blockchain-anchored medicine traceability
          </p>
          <h1 id="hero-title" className="mt-6 text-[44px] font-bold leading-[1.02] tracking-[-0.03em] sm:text-[58px] xl:text-[68px]">
            Every medicine.
            <br />
            Every journey.
            <br />
            <span className="relative inline-block text-brand-ink">
              Verified.
              <svg viewBox="0 0 220 14" className="absolute -bottom-2 left-0 h-3 w-full text-brand" aria-hidden preserveAspectRatio="none">
                <path d="M2 9 C 50 2, 110 2, 218 7" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" className="hero-underline" />
              </svg>
            </span>
          </h1>
          <p className="mt-7 max-w-lg text-[16.5px] leading-relaxed text-charcoal">
            MediChain gives every batch a tamper-evident identity and records each custody handover — manufacturer to pharmacy — in a hash-chained
            ledger anchored to a blockchain. Anyone can scan a pack and see where it has been.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/verify">
              <Button size="lg">
                <ScanLine /> Verify a medicine
              </Button>
            </Link>
            {signedIn ? (
              <Link to="/app">
                <Button size="lg" variant="outline">
                  Go to your dashboard <ArrowRight />
                </Button>
              </Link>
            ) : (
              <Link to="/register">
                <Button size="lg" variant="outline">
                  Register your organization <ArrowRight />
                </Button>
              </Link>
            )}
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[12.5px] text-muted">
            <li className="inline-flex items-center gap-1.5"><QrCode className="size-3.5 text-brand" aria-hidden /> No sign-in to verify</li>
            <li className="inline-flex items-center gap-1.5"><Lock className="size-3.5 text-brand" aria-hidden /> No personal data on-chain</li>
            <li className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-brand" aria-hidden /> Regulator-approved partners</li>
          </ul>
        </div>

        <div className="relative mx-auto w-full max-w-[640px]">
          <SupplyGlobe className="aspect-square w-full" onSelectionChange={setFollowing} />

          {/* Floating, illustrative status cards (step aside while a route is being followed) */}
          <div aria-hidden className={cn('pointer-events-none transition-opacity duration-300', following && 'opacity-0')}>
            <div className="animate-float absolute left-0 top-[12%] hidden rounded-2xl border border-line bg-surface/90 px-3.5 py-2.5 shadow-[var(--shadow-raised)] backdrop-blur sm:block">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                <Link2 className="size-3.5 text-brand" /> Transfer accepted
              </p>
              <p className="mt-1 text-[13px] font-semibold text-ink">Distributor → Wholesaler</p>
              <p className="mt-0.5 font-mono text-[11px] text-charcoal">hash 77c4…0e5b</p>
            </div>
            <div className="animate-float-delayed absolute bottom-[9%] right-0 rounded-2xl border border-line bg-surface/90 px-3.5 py-3 shadow-[var(--shadow-raised)] backdrop-blur">
              <div className="flex items-center justify-between gap-6">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Batch AMX-2026-0915</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[10.5px] font-semibold text-success">
                  <BadgeCheck className="size-3" /> Verified record
                </span>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                {STAGE_COLORS.map((c, i) => (
                  <span key={c} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full ring-2 ring-white" style={{ background: c }} />
                    {i < 3 && <span className="h-px w-6 bg-line-strong" />}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[12px] text-muted">
            {STAGES.map((s, i) => (
              <span key={s.title} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: STAGE_COLORS[i] }} aria-hidden /> {s.title}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full ring-2 ring-success/30" style={{ background: STAGE_COLORS[3] }} aria-hidden /> Local network
            </span>
            <span className="inline-flex w-full items-center justify-center gap-1.5 text-charcoal">
              <Rotate3d className="size-3.5" aria-hidden /> Drag to rotate · click a hub to follow its shipment
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ facts */

function FactsStrip() {
  return (
    <section aria-label="MediChain at a glance" className="border-y border-line bg-surface">
      <dl className="mx-auto grid w-full max-w-7xl grid-cols-2 divide-line px-4 sm:px-6 lg:grid-cols-4 lg:divide-x lg:px-8">
        {FACTS.map((f, i) => (
          <Reveal key={f.label} delay={i * 80} className="px-2 py-7 sm:px-6">
            <dt className="sr-only">{f.label}</dt>
            <dd>
              <span className="block font-display text-[30px] font-bold tracking-tight text-ink sm:text-[34px]">{f.value}</span>
              <span className="mt-1 block text-[13px] leading-snug text-muted">{f.label}</span>
            </dd>
          </Reveal>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ journey */

function SectionIntro({ eyebrow, title, children, id }: { eyebrow: string; title: ReactNode; children: ReactNode; id: string }) {
  return (
    <Reveal className="max-w-2xl">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand-ink">{eyebrow}</p>
      <h2 id={id} className="mt-3 text-[32px] font-bold leading-[1.1] sm:text-[42px]">
        {title}
      </h2>
      <p className="mt-4 text-[15.5px] leading-relaxed text-charcoal">{children}</p>
    </Reveal>
  );
}

function Journey() {
  return (
    <section id="journey" aria-labelledby="journey-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionIntro id="journey-title" eyebrow="The journey" title={<>One batch. Four handovers.<br className="hidden sm:block" /> One unbroken record.</>}>
          Custody only moves when the current holder ships and the named recipient accepts. Every step is checked by the server, appended to the
          batch’s event log and anchored — so gaps and shortcuts show up the moment someone scans the pack.
        </SectionIntro>

        <div className="relative mt-14">
        {/* connector line behind the cards on large screens */}
        <div aria-hidden className="journey-line absolute left-[12%] right-[12%] top-[46px] hidden h-[2px] lg:block" />
        <ol className="relative grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 110} className="relative">
              <div className="group h-full rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-card)] transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-brand/30 hover:shadow-[var(--shadow-raised)]">
                <div className="flex items-center justify-between">
                  <span
                    className="relative grid size-12 place-items-center rounded-2xl border-2 bg-surface"
                    style={{ borderColor: STAGE_COLORS[i] }}
                  >
                    <s.icon className="size-5 text-ink" aria-hidden />
                  </span>
                  <span className="font-mono text-[12px] text-muted">0{i + 1}</span>
                </div>
                <h3 className="mt-5 text-[18px] font-semibold">{s.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-charcoal">{s.body}</p>
                <p className="mt-4 inline-flex rounded-md border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-charcoal">{s.event}</p>
              </div>
            </Reveal>
          ))}
        </ol>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ trust */

function Trust() {
  const points = [
    {
      icon: Hash,
      title: 'Hash-chained, append-only history',
      body: 'Each event stores the SHA-256 hash of the one before it. The database itself refuses edits and deletes, and changing any past record breaks every later link.',
    },
    {
      icon: Link2,
      title: 'Anchored to a blockchain',
      body: 'Event hashes are written to the MediChainRegistry smart contract — or to a clearly labelled simulated ledger in development. Only opaque references go on-chain.',
    },
    {
      icon: BellRing,
      title: 'Recalls reach every pack',
      body: 'A regulator recall cancels pending shipments, blocks transfers and dispensing, alerts every organization involved and shows on the public check.',
    },
    {
      icon: Fingerprint,
      title: 'Copies stand out',
      body: 'Unknown codes are never shown as verified, and unusual scan volumes on one code flag a possible cloned label.',
    },
  ];
  return (
    <section id="trust" aria-labelledby="trust-title" className="scroll-mt-20 border-y border-line bg-[#F6F3EE] py-20 sm:py-28">
      <div className="mx-auto grid w-full max-w-7xl gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:px-8">
        <div>
          <SectionIntro id="trust-title" eyebrow="How trust works" title="Tamper-evident by construction.">
            MediChain doesn’t ask you to trust a spreadsheet. Integrity is checked mathematically on every verification — eight automated checks, from
            re-hashing the event chain to comparing it with the on-chain record.
          </SectionIntro>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2">
            {points.map((p, i) => (
              <Reveal as="li" key={p.title} delay={i * 90} className="flex gap-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/30 bg-surface text-brand-ink shadow-[var(--shadow-card)]">
                  <p.icon className="size-[18px]" aria-hidden />
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold">{p.title}</h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-charcoal">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
        <Reveal delay={150}>
          <HashChainVisual />
        </Reveal>
      </div>
    </section>
  );
}

function HashChainVisual() {
  return (
    <figure className="relative mx-auto max-w-md">
      <div className="rounded-[22px] border border-line bg-surface p-5 shadow-[var(--shadow-raised)] sm:p-6">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Event log · AMX-2026-0915</p>
          <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
            <ShieldCheck className="size-3" aria-hidden /> Chain intact
          </span>
        </div>
        <ol className="mt-5" aria-label="Example hash chain">
          {CHAIN.map((b, i) => (
            <li key={b.seq} className="relative">
              {i > 0 && (
                <div aria-hidden className="relative ml-[22px] h-7 w-[2px] overflow-hidden bg-line">
                  <span className="chain-pulse absolute inset-x-0 top-0 h-3 bg-brand" style={{ animationDelay: `${i * 0.45}s` }} />
                </div>
              )}
              <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas p-3 transition-colors hover:border-brand/40">
                <span className="grid size-[44px] shrink-0 place-items-center rounded-lg text-[12px] font-bold text-ink" style={{ background: `${STAGE_COLORS[i]}22`, boxShadow: `inset 0 0 0 1.5px ${STAGE_COLORS[i]}` }}>
                  {b.seq}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px] font-semibold text-ink">{b.type}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-muted">
                    <span>
                      prev <span className={i > 0 ? 'text-brand-ink' : undefined}>{i > 0 ? CHAIN[i - 1].hash : '0000…0000'}</span>
                    </span>
                    <span>
                      hash <span className="text-charcoal">{b.hash}</span>
                    </span>
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <figcaption className="mt-3 text-center text-[12px] text-muted">Illustration: each event’s “prev” is the hash of the event before it.</figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ roles */

function Roles() {
  return (
    <section id="roles" aria-labelledby="roles-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionIntro id="roles-title" eyebrow="Who it’s for" title="A workspace for every link in the chain.">
          Each role sees its own dashboard and can only do what its licence allows. Every rule is enforced on the server — hiding a button is never
          the security boundary.
        </SectionIntro>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map((r, i) => (
            <Reveal as="li" key={r.title} delay={(i % 3) * 90}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-line bg-surface p-6 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-1 hover:border-brand/30 hover:shadow-[var(--shadow-raised)]">
                <div aria-hidden className="absolute -right-10 -top-10 size-32 rounded-full bg-brand-soft opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <r.icon className="relative size-6 text-brand" aria-hidden />
                <h3 className="relative mt-4 text-[17px] font-semibold">{r.title}</h3>
                <p className="relative mt-1.5 text-[13.5px] leading-relaxed text-charcoal">{r.body}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ verify */

function VerifyBand() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = extractCode(value);
    if (!code) return navigate('/verify');
    if (!PUBLIC_ID_PATTERN.test(code)) {
      setError('Identifiers look like MC-XXXX-XXXX-XXXX (12 letters and digits; O, I, L and U are not used).');
      return;
    }
    navigate(`/verify/${code}`);
  };

  return (
    <section id="verify" aria-labelledby="verify-title" className="relative scroll-mt-20 overflow-hidden py-24 sm:py-32">
      <FlowField />
      <div className="relative mx-auto w-full max-w-2xl px-4 sm:px-6">
        <Reveal className="rounded-[26px] border border-line bg-surface/90 p-7 text-center shadow-[var(--shadow-raised)] backdrop-blur-md sm:p-10">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-soft text-brand-ink">
            <ScanLine className="size-7" aria-hidden />
          </span>
          <h2 id="verify-title" className="mt-5 text-[28px] font-bold leading-tight sm:text-[34px]">
            Holding a medicine pack?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-charcoal">
            Enter the identifier printed under its QR code — or scan it with your camera. No account needed.
          </p>
          <form onSubmit={submit} className="mx-auto mt-7 flex max-w-md flex-col gap-2.5 sm:flex-row" noValidate>
            <label htmlFor="home-code" className="sr-only">
              Medicine identifier
            </label>
            <input
              id="home-code"
              value={value}
              onChange={(e) => {
                setValue(formatManualInput(e.target.value));
                setError(null);
              }}
              placeholder="MC-XXXX-XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!error}
              aria-describedby="home-code-msg"
              className="h-12 w-full shrink-0 rounded-xl sm:flex-1 border border-line bg-surface px-4 text-center font-mono text-[15px] tracking-wider text-ink placeholder:text-muted focus:border-brand focus:shadow-[var(--shadow-focus)] focus:outline-none aria-[invalid=true]:border-danger sm:text-left"
            />
            <Button type="submit" size="lg" className="h-12">
              Check <ArrowRight />
            </Button>
          </form>
          <p id="home-code-msg" role={error ? 'alert' : undefined} className={cn('mt-2.5 min-h-[18px] text-[12.5px]', error ? 'text-danger' : 'text-muted')}>
            {error ?? (
              <>
                Prefer the camera?{' '}
                <Link to="/verify" className="font-medium text-brand-ink hover:underline">
                  Scan a QR code
                </Link>
              </>
            )}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ partners */

function PartnerCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section aria-labelledby="partner-title" className="px-4 pb-20 sm:px-6 sm:pb-28 lg:px-8">
      <Reveal className="relative mx-auto w-full max-w-7xl overflow-hidden rounded-[28px] bg-ink px-6 py-12 text-white sm:px-12 sm:py-16">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.22]"
          style={{ backgroundImage: 'radial-gradient(#E76F75 1px, transparent 1px)', backgroundSize: '22px 22px', maskImage: 'linear-gradient(110deg, transparent 35%, black 100%)', WebkitMaskImage: 'linear-gradient(110deg, transparent 35%, black 100%)' }}
        />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <h2 id="partner-title" className="text-[28px] font-bold leading-tight text-white sm:text-[36px]">
              Bring your organization onto MediChain.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-white/70">
              Manufacturers, distributors, wholesalers and pharmacies register in minutes. A regulator reviews your licence, then you can start
              recording every handover.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {signedIn ? (
              <Link to="/app">
                <Button size="lg">
                  <LayoutDashboard /> Open dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/register">
                  <Button size="lg">
                    <UserPlus /> Create an account
                  </Button>
                </Link>
                <Link to="/login">
                  <Button size="lg" variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
                    Partner sign in
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ------------------------------------------------------------------ footer */

function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto] lg:px-8">
        <div className="max-w-2xl">
          <Logo />
          <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
            <span className="font-semibold text-charcoal">Please note: </span>a verified result confirms that a code matches a registered batch and a
            consistent recorded custody history. It does not by itself prove that the physical pack is genuine — a QR code can be copied. Buy
            medicines only from licensed pharmacies, and ask your pharmacist if in doubt.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] md:flex-col md:items-end">
          <Link to="/verify" className="text-charcoal hover:text-ink hover:underline">Verify a medicine</Link>
          <Link to="/login" className="text-charcoal hover:text-ink hover:underline">Partner sign in</Link>
          <Link to="/register" className="text-charcoal hover:text-ink hover:underline">Create an account</Link>
        </nav>
      </div>
      <p className="border-t border-line py-4 text-center text-[12px] text-muted">© {new Date().getFullYear()} MediChain · Academic &amp; portfolio demonstration</p>
    </footer>
  );
}

/* ------------------------------------------------------------------ reveal-on-scroll */

function Reveal({
  as: Tag = 'div',
  delay = 0,
  className,
  children,
}: {
  as?: 'div' | 'li';
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setVisible(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref as never} data-visible={visible} className={cn('reveal', className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}
