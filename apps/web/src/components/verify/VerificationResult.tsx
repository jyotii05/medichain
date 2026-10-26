import { useState, type ReactNode } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Factory,
  FlaskConical,
  HelpCircle,
  Info,
  Link2,
  ListChecks,
  MapPin,
  RotateCcw,
  Route,
  ShieldAlert,
  ShieldCheck,
  Thermometer,
  Warehouse,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { Check, ChainCheck, JourneyStage, VerificationResponse, VerificationResultType } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, StatusBadge } from '@/components/shared/StatusBadge';
import { HashText } from '@/components/shared/States';
import { SupplyChainTimeline } from '@/components/batch/SupplyChainTimeline';
import { RecallAlert } from '@/components/recalls/RecallAlert';
import { cn, daysUntil, formatDate, formatDateTime, ROLE_LABEL } from '@/lib/utils';

type Context = 'public' | 'app';

interface HeroDef {
  title: string;
  icon: LucideIcon;
  /** container classes */
  shell: string;
  /** icon disc classes */
  disc: string;
  /** secondary text colour inside the hero */
  sub: string;
  guidance: Record<Context, string>;
}

const HERO: Record<VerificationResultType, HeroDef> = {
  VERIFIED: {
    title: 'Verified record',
    icon: ShieldCheck,
    shell: 'border-success/30 bg-success-soft text-ink',
    disc: 'bg-success text-white',
    sub: 'text-charcoal',
    guidance: {
      public: 'This code matches a registered batch from an approved manufacturer, and its recorded custody history is consistent.',
      app: 'Registry record and custody history are consistent. Complete your usual physical pack checks before dispensing.',
    },
  },
  SUSPICIOUS: {
    title: 'Suspicious — unable to verify',
    icon: ShieldAlert,
    shell: 'border-danger/30 bg-danger-soft text-ink',
    disc: 'bg-danger text-white',
    sub: 'text-charcoal',
    guidance: {
      public: 'Do not use this medicine. Return it to the pharmacy where you obtained it and report it to the medicines regulator.',
      app: 'Do not dispense. Quarantine the stock and raise a flag on the batch so the regulator can investigate.',
    },
  },
  UNKNOWN: {
    title: 'Unknown identifier',
    icon: HelpCircle,
    shell: 'border-ink bg-ink text-white',
    disc: 'bg-danger text-white',
    sub: 'text-white/80',
    guidance: {
      public: 'This code is not in the MediChain registry. Check that it was entered correctly. If it was, treat the pack as unverified — do not use it and report where you obtained it.',
      app: 'No registered batch matches this identifier. Do not dispense — check the code and quarantine the pack if it still cannot be found.',
    },
  },
  RECALLED: {
    title: 'Recalled — do not use',
    icon: AlertOctagon,
    shell: 'border-danger/30 bg-danger-soft text-ink',
    disc: 'bg-danger text-white',
    sub: 'text-charcoal',
    guidance: {
      public: 'The regulator has recalled this batch. Stop using it and return it to a pharmacy. Speak to a healthcare professional if you have taken it.',
      app: 'This batch is subject to a regulatory recall. Do not dispense — quarantine all stock and follow the recall notice.',
    },
  },
  EXPIRED: {
    title: 'Expired — do not use',
    icon: Clock,
    shell: 'border-warning/40 bg-warning-soft text-ink',
    disc: 'bg-warning text-ink',
    sub: 'text-charcoal',
    guidance: {
      public: 'This batch is past its expiry date. Do not use it — return it to a pharmacy for safe disposal.',
      app: 'Past its expiry date. Do not dispense — move the stock to expired / quarantine.',
    },
  },
};

const CHECK_ICON: Record<Check['status'], { icon: LucideIcon; cls: string; label: string }> = {
  pass: { icon: CheckCircle2, cls: 'text-success', label: 'Passed' },
  fail: { icon: XCircle, cls: 'text-danger', label: 'Failed' },
  warn: { icon: AlertTriangle, cls: 'text-warning-ink', label: 'Warning' },
  info: { icon: Info, cls: 'text-info', label: 'Information' },
};

export function VerificationResult({
  data,
  onReset,
  context = 'public',
  actions,
}: {
  data: VerificationResponse;
  onReset?: () => void;
  context?: Context;
  /** extra buttons rendered next to "Check another" */
  actions?: ReactNode;
}) {
  const hero = HERO[data.result] ?? HERO.UNKNOWN;
  const Icon = hero.icon;
  const b = data.batch;
  const isUnknown = data.result === 'UNKNOWN' || !b;
  const headlineIsTitle = data.headline.toLowerCase().startsWith(hero.title.toLowerCase());
  const recallTitle = data.result === 'RECALLED' && data.recall?.action === 'BLOCK' ? 'Blocked — do not use' : hero.title;

  return (
    <div className="space-y-6 animate-slide-up" aria-live="polite">
      {/* ---------- Result hero ---------- */}
      <section
        className={cn('relative overflow-hidden rounded-2xl border p-5 shadow-[var(--shadow-card)] sm:p-7', hero.shell)}
        aria-labelledby="verification-result-title"
        data-result={data.result}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <span className={cn('grid size-14 shrink-0 place-items-center rounded-2xl sm:size-16', hero.disc)}>
            <Icon className="size-7 sm:size-8" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn('text-[12px] font-semibold uppercase tracking-[0.12em]', hero.sub)}>Verification result</p>
            <h2 id="verification-result-title" className={cn('mt-1 text-[26px] font-bold leading-tight sm:text-[30px]', data.result === 'UNKNOWN' && 'text-white')}>
              {recallTitle}
            </h2>
            {!headlineIsTitle && <p className={cn('mt-1.5 text-[15px] font-medium', data.result === 'UNKNOWN' ? 'text-white' : 'text-ink')}>{data.headline}</p>}
            <p className={cn('mt-2 max-w-2xl text-sm leading-relaxed', hero.sub)}>{hero.guidance[context]}</p>
            <dl className={cn('mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[13px]', hero.sub)}>
              <div className="flex items-center gap-1.5">
                <dt>Identifier checked:</dt>
                <dd className={cn('font-mono font-semibold', data.result === 'UNKNOWN' ? 'text-white' : 'text-ink')}>{data.queriedId || '—'}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt>Checked at:</dt>
                <dd className={cn('tabular font-medium', data.result === 'UNKNOWN' ? 'text-white' : 'text-ink')}>
                  <time dateTime={data.verifiedAt}>{formatDateTime(data.verifiedAt)}</time>
                </dd>
              </div>
            </dl>
          </div>
          {(onReset || actions) && (
            <div className="no-print flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
              {actions}
              {onReset && (
                <Button variant="outline" onClick={onReset} className={data.result === 'UNKNOWN' ? 'border-white/30 bg-transparent text-white hover:bg-white/10' : undefined}>
                  <RotateCcw /> Check another
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ---------- Honesty disclaimer (always) ---------- */}
      <div role="note" className="flex gap-3 rounded-2xl border border-info/20 bg-info-soft px-4 py-3.5 text-[13px] leading-relaxed text-charcoal">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <p>
          <span className="font-semibold text-ink">What this result means. </span>
          {data.disclaimer}
        </p>
      </div>

      {data.recall && <RecallAlert recall={data.recall} />}

      {data.reasons.length > 0 && (
        <Card>
          <CardHeader title={data.result === 'VERIFIED' ? 'Notes' : 'Why this result'} icon={<AlertTriangle />} />
          <CardBody>
            <ul className="space-y-2.5">
              {data.reasons.map((r) => (
                <li key={r} className="flex gap-2.5 text-sm text-charcoal">
                  <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', data.result === 'EXPIRED' ? 'bg-warning' : data.result === 'VERIFIED' ? 'bg-muted' : 'bg-danger')} aria-hidden />
                  {r}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {isUnknown ? (
        <UnknownHelp context={context} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <MedicineFacts batch={b} />
            {data.journey && data.journey.length > 0 && <Journey stages={data.journey} />}
          </div>
          <div className="space-y-6">
            {data.checks && data.checks.length > 0 && <Checks checks={data.checks} />}
            <ChainDetails chain={data.chain ?? null} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function UnknownHelp({ context }: { context: Context }) {
  const tips =
    context === 'app'
      ? [
          'Re-scan the pack QR code, or type the identifier printed under it.',
          'Identifiers have the form MC-XXXX-XXXX-XXXX (letters O, I, L and U are never used).',
          'If the code still cannot be found, quarantine the pack and raise it with your supplier and the regulator.',
        ]
      : [
          'Check the identifier printed under the QR code and try entering it manually.',
          'Identifiers have the form MC-XXXX-XXXX-XXXX (letters O, I, L and U are never used).',
          'If the code still cannot be found, do not use the medicine. Ask your pharmacist or report it to the medicines regulator.',
        ];
  return (
    <Card>
      <CardHeader title="What to do next" icon={<HelpCircle />} />
      <CardBody>
        <ol className="space-y-3">
          {tips.map((t, i) => (
            <li key={t} className="flex gap-3 text-sm text-charcoal">
              <span className="tabular grid size-6 shrink-0 place-items-center rounded-full bg-subtle text-[12px] font-semibold text-ink">{i + 1}</span>
              <span className="pt-0.5">{t}</span>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function Fact({ icon: I, label, children, className }: { icon: LucideIcon; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex gap-3 rounded-xl bg-canvas p-3.5', className)}>
      <I className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
      <div className="min-w-0">
        <dt className="text-[12px] font-medium text-muted">{label}</dt>
        <dd className="mt-0.5 text-[14px] font-medium text-ink">{children}</dd>
      </div>
    </div>
  );
}

function MedicineFacts({ batch: b }: { batch: NonNullable<VerificationResponse['batch']> }) {
  const days = daysUntil(b.expiryDate);
  return (
    <Card>
      <CardHeader
        title={
          <span>
            {b.medicine.name} <span className="font-normal text-muted">{b.medicine.strength}</span>
          </span>
        }
        description={[b.medicine.genericName, b.medicine.dosageForm, b.medicine.category].filter(Boolean).join(' · ')}
        icon={<FlaskConical />}
        action={<StatusBadge status={b.displayStatus} />}
      />
      <CardBody>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact icon={Boxes} label="Batch number">
            <span className="font-mono">{b.batchNumber}</span>
            <span className="mt-0.5 block font-mono text-[12px] font-normal text-muted">{b.publicId}</span>
          </Fact>
          <Fact icon={Factory} label="Manufacturer">
            {b.manufacturer.name}
            {b.manufacturer.country && <span className="mt-0.5 block text-[12px] font-normal text-muted">{b.manufacturer.country}</span>}
          </Fact>
          <Fact icon={CalendarDays} label="Manufactured">
            <span className="tabular">{formatDate(b.manufactureDate)}</span>
          </Fact>
          <Fact icon={Clock} label="Expiry date">
            <span className="tabular">{formatDate(b.expiryDate)}</span>
            <span className={cn('mt-0.5 block text-[12px] font-normal', days < 0 ? 'text-danger' : days <= 90 ? 'text-warning-ink' : 'text-muted')}>
              {days < 0 ? `Expired ${Math.abs(days)} days ago` : days === 0 ? 'Expires today' : `${days} days remaining`}
            </span>
          </Fact>
          <Fact icon={Thermometer} label="Storage conditions" className="sm:col-span-2">
            <span className="font-normal text-charcoal">{b.storageConditions || '—'}</span>
          </Fact>
          <Fact icon={Warehouse} label="Current custodian (recorded)" className="sm:col-span-2">
            {b.currentCustodian.name}
            <span className="mt-0.5 block text-[12px] font-normal text-muted">
              {ROLE_LABEL[b.currentCustodian.type]}
              {b.currentCustodian.city ? ` · ${b.currentCustodian.city}` : ''}
            </span>
          </Fact>
        </dl>
      </CardBody>
    </Card>
  );
}

function Journey({ stages }: { stages: JourneyStage[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const stage = stages.find((s) => s.key === selected) ?? null;
  return (
    <Card>
      <CardHeader title="Recorded journey" description="Custody stages as recorded by licensed supply-chain partners" icon={<Route />} />
      <CardBody>
        <SupplyChainTimeline stages={stages} orientation="auto" selectedKey={selected} onSelect={(s) => setSelected((cur) => (cur === s.key ? null : s.key))} />
        {stage && (
          <div className="mt-4 rounded-xl border border-line bg-canvas p-4 text-[13px] animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-ink">
                {ROLE_LABEL[stage.role]}
                {stage.org ? ` — ${stage.org.name}` : ''}
              </p>
              <Badge tone="neutral">{stage.status.replace('_', ' ')}</Badge>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {stage.org && (stage.org.city || stage.org.country) && (
                <Row label="Location">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5 text-muted" aria-hidden />
                    {[stage.org.city, stage.org.country].filter(Boolean).join(', ')}
                  </span>
                </Row>
              )}
              {stage.shipmentRef && <Row label="Shipment">{<span className="font-mono">{stage.shipmentRef}</span>}</Row>}
              {stage.initiatedAt && <Row label="Initiated">{formatDateTime(stage.initiatedAt)}</Row>}
              {stage.completedAt && <Row label="Completed">{formatDateTime(stage.completedAt)}</Row>}
              {stage.eventHash && (
                <Row label="Database event hash">
                  <HashText value={stage.eventHash} />
                </Row>
              )}
              {stage.anchor && (
                <Row label={stage.anchor.kind === 'TX_HASH' ? 'Blockchain tx hash' : 'Simulated ledger ref'}>
                  <HashText value={stage.anchor.reference} />
                  {stage.anchor.kind === 'TX_HASH' && stage.anchor.blockNumber != null && <span className="ml-2 text-muted">block {stage.anchor.blockNumber}</span>}
                </Row>
              )}
            </dl>
            {stage.note && <p className="mt-3 text-muted">{stage.note}</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-charcoal">{children}</dd>
    </div>
  );
}

function Checks({ checks }: { checks: Check[] }) {
  const [open, setOpen] = useState(false);
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="verification-checks"
        className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left hover:bg-canvas"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink">
          <ListChecks className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">How this was checked</span>
          <span className="block text-[13px] text-muted">
            {checks.length} checks · {failed ? `${failed} failed` : 'none failed'}
            {warned ? ` · ${warned} warning${warned === 1 ? '' : 's'}` : ''}
          </span>
        </span>
        <ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul id="verification-checks" className="divide-y divide-line border-t border-line">
          {checks.map((c) => {
            const d = CHECK_ICON[c.status];
            return (
              <li key={c.key} className="flex gap-3 px-5 py-3">
                <d.icon className={cn('mt-0.5 size-4 shrink-0', d.cls)} aria-label={d.label} />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium text-ink">{c.label}</p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{c.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ChainDetails({ chain }: { chain: ChainCheck | null }) {
  if (!chain) {
    return (
      <Card>
        <CardHeader title="Ledger verification" icon={<Link2 />} />
        <CardBody className="text-sm text-muted">No ledger check is available for this record.</CardBody>
      </Card>
    );
  }
  const onchain = chain.mode === 'ONCHAIN';
  return (
    <Card>
      <CardHeader
        title={onchain ? 'Blockchain verification' : 'Ledger verification (simulated)'}
        description={onchain ? 'MediChainRegistry smart contract' : 'Hash-chained ledger in the MediChain database — not a blockchain'}
        icon={<Link2 />}
      />
      <CardBody className="space-y-4 text-[13px]">
        {!chain.available ? (
          <div role="status" className="rounded-xl border border-warning/40 bg-warning-soft p-3.5">
            <p className="flex items-center gap-2 font-semibold text-warning-ink">
              <AlertTriangle className="size-4" aria-hidden /> Blockchain verification unavailable
            </p>
            <p className="mt-1 text-charcoal">{chain.summary}</p>
            <p className="mt-1 text-muted">The registry record above was still checked; only the on-chain cross-check could not be completed.</p>
          </div>
        ) : (
          <div
            className={cn(
              'flex gap-2.5 rounded-xl p-3.5',
              chain.consistent === true ? 'bg-success-soft' : chain.consistent === false ? 'bg-danger-soft' : 'bg-subtle',
            )}
          >
            {chain.consistent === true ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Consistent" />
            ) : chain.consistent === false ? (
              <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label="Mismatch" />
            ) : (
              <HelpCircle className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Undetermined" />
            )}
            <p className="text-charcoal">{chain.summary}</p>
          </div>
        )}

        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            { l: onchain ? 'Anchored' : 'Recorded', v: chain.anchored },
            { l: 'Pending', v: chain.pending },
            { l: 'Failed', v: chain.failed },
          ].map((x) => (
            <div key={x.l} className="rounded-xl bg-canvas px-2 py-2.5">
              <dd className="tabular font-display text-lg font-semibold text-ink">{x.v}</dd>
              <dt className="text-[11.5px] text-muted">{x.l}</dt>
            </div>
          ))}
        </dl>

        {chain.latest && (
          <dl className="space-y-2.5">
            <Row label={chain.latest.kind === 'TX_HASH' ? 'Latest transaction hash' : 'Latest simulated reference'}>
              <HashText value={chain.latest.reference} />
            </Row>
            {chain.latest.kind === 'TX_HASH' && chain.latest.blockNumber != null && <Row label="Block number">{<span className="tabular">{chain.latest.blockNumber}</span>}</Row>}
            {chain.latest.confirmedAt && <Row label="Confirmed">{formatDateTime(chain.latest.confirmedAt)}</Row>}
            {chain.latest.logCheck && <Row label="Contract log check">{chain.latest.logCheck}</Row>}
          </dl>
        )}

        {chain.problems.length > 0 && (
          <div>
            <p className="mb-1.5 font-semibold text-danger">Problems found</p>
            <ul className="list-disc space-y-1 pl-5 text-charcoal">
              {chain.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        {chain.notes.length > 0 && (
          <ul className="space-y-1 text-[12.5px] text-muted">
            {chain.notes.map((n) => (
              <li key={n} className="flex gap-2">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {n}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
