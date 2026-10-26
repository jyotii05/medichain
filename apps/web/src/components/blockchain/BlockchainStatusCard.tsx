import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Database, Link2, Link2Off, ServerCog, XCircle } from 'lucide-react';
import type { ChainStatus } from '@/lib/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { Badge } from '@/components/shared/StatusBadge';
import { HashText } from '@/components/shared/States';
import { cn, formatNumber } from '@/lib/utils';

/** Steps shown when on-chain mode is configured but the node / contract cannot be reached. */
export const ONCHAIN_SETUP_HINT = [
  'Start the Hardhat node: run "npm run node" in packages/contracts (or make your configured RPC reachable).',
  'Deploy the MediChainRegistry contract: "npm run deploy:local" in packages/contracts.',
  'Set CONTRACT_ADDRESS and RELAYER_PRIVATE_KEY (and CHAIN_RPC_URL) in the API environment, then restart the API.',
];

export function ModeBadge({ mode }: { mode: ChainStatus['mode'] }) {
  return mode === 'ONCHAIN' ? (
    <Badge tone="info">
      <Link2 className="size-3" aria-hidden /> On-chain
    </Badge>
  ) : (
    <Badge tone="brand">
      <Database className="size-3" aria-hidden /> Simulation
    </Badge>
  );
}

export function BlockchainStatusCard({ status, loading, compact }: { status?: ChainStatus; loading?: boolean; compact?: boolean }) {
  if (loading || !status) {
    return (
      <Card className={cn('space-y-3', compact ? 'p-4' : 'p-5')} aria-busy="true">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-4 w-full max-w-md" />
        {!compact && <Skeleton className="h-16 w-full" />}
      </Card>
    );
  }

  const onchain = status.mode === 'ONCHAIN';
  const down = onchain && !status.connected;
  const ledgerBroken = !onchain && status.ledger && !status.ledger.intact;
  const icon = down ? <Link2Off /> : onchain ? <Link2 /> : <Database />;

  const health = down ? (
    <Badge tone="danger">
      <XCircle className="size-3" aria-hidden /> Unavailable
    </Badge>
  ) : ledgerBroken ? (
    <Badge tone="danger">
      <AlertTriangle className="size-3" aria-hidden /> Integrity problem
    </Badge>
  ) : (
    <Badge tone="success">
      <CheckCircle2 className="size-3" aria-hidden /> {onchain ? 'Connected' : 'Ledger intact'}
    </Badge>
  );

  if (compact) {
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-4', down ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-ink')}>{icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ModeBadge mode={status.mode} />
              {health}
            </div>
            <p className="mt-1.5 text-[13px] font-medium text-ink">{down ? 'Blockchain verification unavailable' : status.label}</p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{status.message}</p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={down ? 'Blockchain verification unavailable' : status.label}
        description={onchain ? 'Events are anchored to the MediChainRegistry smart contract by a relayer account.' : 'Events are recorded in a hash-chained ledger inside PostgreSQL.'}
        icon={icon}
        action={
          <>
            <ModeBadge mode={status.mode} />
            {health}
          </>
        }
      />
      <CardBody className="space-y-5">
        {down ? (
          <div role="alert" className="rounded-xl border border-danger/25 bg-danger-soft p-4 text-[13px]">
            <p className="font-semibold text-ink">The blockchain node or contract could not be reached</p>
            <p className="mt-1 break-words text-charcoal">{status.message}</p>
            <p className="mt-3 flex items-center gap-1.5 font-semibold text-ink">
              <ServerCog className="size-4" aria-hidden /> To restore on-chain verification
            </p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-charcoal">
              {ONCHAIN_SETUP_HINT.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="mt-3 text-muted">Database records continue to be written; pending anchors are submitted once the chain is reachable again.</p>
          </div>
        ) : (
          <p className="text-[13px] leading-relaxed text-charcoal">{status.message}</p>
        )}

        <dl className="grid grid-cols-3 gap-3">
          <Metric label={onchain ? 'Confirmed tx' : 'Ledger entries'} value={status.totals.confirmed} />
          <Metric label="Pending" value={status.totals.pending} tone={status.totals.pending ? 'warning' : undefined} />
          <Metric label="Failed" value={status.totals.failed} tone={status.totals.failed ? 'danger' : undefined} />
        </dl>

        {!onchain && status.ledger && (
          <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
            <Item label="Ledger entries checked">{formatNumber(status.ledger.entries)}</Item>
            <Item label="Last ledger sequence">{formatNumber(status.ledger.lastSequence)}</Item>
            {status.ledger.problems.length > 0 && (
              <div className="sm:col-span-2">
                <dt className="text-[11.5px] font-medium uppercase tracking-wide text-danger">Integrity problems</dt>
                <dd>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-charcoal">
                    {status.ledger.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        )}

        {onchain && (
          <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
            {status.network && (
              <>
                <Item label="Network">
                  {status.network.name ?? '—'}
                  {status.network.chainId != null && <span className="text-muted"> · chain id {status.network.chainId}</span>}
                </Item>
                <Item label="Latest block">{status.network.blockNumber != null ? formatNumber(status.network.blockNumber) : '—'}</Item>
              </>
            )}
            <Item label="Contract address">
              <HashText value={status.contractAddress} />
            </Item>
            <Item label="Relayer address">
              <HashText value={status.relayerAddress} />
              {status.relayerHasRoles === false && <span className="ml-2 text-[12px] text-danger">missing contract roles</span>}
            </Item>
            {status.rpcUrl && (
              <Item label="RPC endpoint">
                <span className="break-all font-mono text-[12px]">{status.rpcUrl}</span>
              </Item>
            )}
          </dl>
        )}
      </CardBody>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'warning' | 'danger' }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-3">
      <dd className={cn('tabular font-display text-xl font-semibold', tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning-ink' : 'text-ink')}>{formatNumber(value)}</dd>
      <dt className="mt-0.5 text-[12px] text-muted">{label}</dt>
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-charcoal">{children}</dd>
    </div>
  );
}
