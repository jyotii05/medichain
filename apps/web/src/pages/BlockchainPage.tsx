import { useState, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Database, FileSearch, Link2, RefreshCw, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { ChainMode, ChainStatus, ChainTx, Paged } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/hooks/useListState';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SearchAndFilterBar } from '@/components/shared/SearchAndFilterBar';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ErrorState, HashText } from '@/components/shared/States';
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog';
import { BlockchainStatusCard } from '@/components/blockchain/BlockchainStatusCard';
import { cn, formatDateTime, formatNumber, relativeTime } from '@/lib/utils';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FAILED', label: 'Failed' },
];

const humanizeOperation = (op: string) => op.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

interface TxDetail {
  transaction: ChainTx;
  event: { id: string; type: string; sequence: number; hash: string; prevHash: string; createdAt: string } | null;
}
interface LedgerCheckResult {
  ok: boolean;
  checked: number;
  problems: string[];
  lastSequence: number;
}

export default function BlockchainPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isReg = user?.role === 'REGULATOR';
  const list = useListState({ pageSize: 15 }, ['status'] as const);
  const [selected, setSelected] = useState<ChainTx | null>(null);
  const [ledgerResult, setLedgerResult] = useState<LedgerCheckResult | null>(null);
  const [confirmRetry, setConfirmRetry] = useState(false);

  const status = useQuery({ queryKey: ['blockchain', 'status'], queryFn: () => api.get<ChainStatus>('/blockchain/status'), refetchInterval: 30_000 });
  const txs = useQuery({
    queryKey: ['blockchain', 'transactions', list.page, list.search, list.status],
    queryFn: () => api.get<Paged<ChainTx> & { mode: ChainMode }>('/blockchain/transactions', { page: list.page, pageSize: list.pageSize, search: list.search, status: list.status }),
    placeholderData: keepPreviousData,
  });

  const mode: ChainMode | undefined = txs.data?.mode ?? status.data?.mode;
  const onchain = mode === 'ONCHAIN';

  const verifyLedger = useMutation({
    mutationFn: () => api.get<LedgerCheckResult>('/blockchain/ledger/verify'),
    onSuccess: (r) => {
      setLedgerResult(r);
      if (r.ok) toast.success(`Ledger intact — ${formatNumber(r.checked)} entries checked`);
      else toast.error(`Ledger integrity problems found (${r.problems.length})`);
      void qc.invalidateQueries({ queryKey: ['blockchain', 'status'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const retry = useMutation({
    mutationFn: () => api.post<{ requeued: number }>('/blockchain/retry'),
    onSuccess: (r) => {
      toast.success(r.requeued ? `${r.requeued} failed write${r.requeued === 1 ? '' : 's'} re-queued for submission` : 'There were no failed writes to retry');
      void qc.invalidateQueries({ queryKey: ['blockchain'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<ChainTx>[] = [
    {
      key: 'time',
      header: 'Time',
      cell: (t) => (
        <div className="leading-tight">
          <p className="tabular whitespace-nowrap text-[13px] text-charcoal">{formatDateTime(t.createdAt)}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">{relativeTime(t.createdAt)}</p>
        </div>
      ),
    },
    { key: 'operation', header: 'Operation', cell: (t) => <span className="text-[13px] font-medium text-ink">{humanizeOperation(t.operation)}</span> },
    {
      key: 'batch',
      header: 'Batch',
      hideBelow: 'md',
      cell: (t) =>
        t.batch ? (
          <div className="leading-tight">
            <p className="font-mono text-[12.5px] text-ink">{t.batch.batchNumber}</p>
            <p className="mt-0.5 font-mono text-[11px] text-muted">{t.batch.publicId}</p>
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'reference',
      header: onchain ? 'Tx hash' : 'Simulated ref',
      cell: (t) =>
        onchain ? (
          <div className="leading-tight" onClick={(e) => e.stopPropagation()}>
            <HashText value={t.txHash} />
            {t.blockNumber != null && <p className="tabular mt-0.5 text-[11px] text-muted">block {formatNumber(t.blockNumber)}</p>}
          </div>
        ) : (
          <span onClick={(e) => e.stopPropagation()}>
            <HashText value={t.simulatedRef} />
          </span>
        ),
    },
    {
      key: 'payload',
      header: 'Anchored hash',
      hideBelow: 'lg',
      cell: (t) => (
        <span onClick={(e) => e.stopPropagation()}>
          <HashText value={t.payloadHash} />
        </span>
      ),
    },
    { key: 'status', header: 'Status', cell: (t) => <StatusBadge status={t.status} size="sm" /> },
  ];

  return (
    <>
      <PageHeader
        title="Blockchain records"
        description={
          onchain
            ? 'Supply-chain events anchored to the MediChainRegistry smart contract, with their transaction hashes and block numbers.'
            : 'Supply-chain events recorded in the tamper-evident simulated ledger. Switch to on-chain mode to anchor them to the smart contract.'
        }
        actions={
          isReg && mode ? (
            mode === 'SIMULATION' ? (
              <Button variant="outline" onClick={() => verifyLedger.mutate()} loading={verifyLedger.isPending}>
                {!verifyLedger.isPending && <ShieldCheck />} Verify ledger integrity
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setConfirmRetry(true)} disabled={!status.data?.totals.failed}>
                <RotateCcw /> Retry failed writes
              </Button>
            )
          ) : undefined
        }
      />

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          {status.error ? (
            <Card>
              <ErrorState error={status.error} onRetry={() => status.refetch()} />
            </Card>
          ) : (
            <BlockchainStatusCard status={status.data} loading={status.isLoading} />
          )}
          {ledgerResult && (
            <div
              role="status"
              className={cn('mt-4 flex gap-3 rounded-2xl border p-4 text-[13px]', ledgerResult.ok ? 'border-success/25 bg-success-soft' : 'border-danger/25 bg-danger-soft')}
            >
              {ledgerResult.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />}
              <div>
                <p className="font-semibold text-ink">
                  {ledgerResult.ok ? 'Ledger integrity verified' : 'Ledger integrity problems found'} · {formatNumber(ledgerResult.checked)} entries checked up to sequence{' '}
                  {formatNumber(ledgerResult.lastSequence)}
                </p>
                {ledgerResult.ok ? (
                  <p className="mt-0.5 text-charcoal">Every entry’s hash was recomputed and each one links correctly to the previous entry.</p>
                ) : (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-charcoal">
                    {ledgerResult.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
        <ModesExplainer active={mode} />
      </div>

      <Card className="mt-6">
        <CardHeader
          title={onchain ? 'On-chain transactions' : 'Simulated ledger entries'}
          description={onchain ? 'Each row is a transaction submitted to the MediChainRegistry contract.' : 'Each row is a SIM-… entry in the hash-chained ledger — not a blockchain transaction.'}
          icon={onchain ? <Link2 /> : <Database />}
        />
        <SearchAndFilterBar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder={onchain ? 'Search tx hash, anchored hash or batch' : 'Search SIM ref, anchored hash or batch'}
          filters={STATUS_FILTERS}
          filterValue={list.status}
          onFilterChange={(v) => list.set('status', v)}
        />
        <DataTable
          caption={onchain ? 'On-chain transactions' : 'Simulated ledger entries'}
          columns={columns}
          rows={txs.data?.items}
          rowKey={(t) => t.id}
          loading={txs.isFetching}
          error={txs.error}
          onRetry={() => txs.refetch()}
          onRowClick={setSelected}
          empty={{
            icon: <FileSearch />,
            title: list.search || list.status ? 'No records match your filters' : 'No records yet',
            description: list.search || list.status ? 'Try a different search term or status.' : 'Records appear here as soon as batches are registered and transferred.',
          }}
          pagination={txs.data ? { page: txs.data.page, totalPages: txs.data.totalPages, total: txs.data.total, pageSize: txs.data.pageSize, onPageChange: list.setPage } : undefined}
        />
      </Card>

      <TxDetailDialog tx={selected} onClose={() => setSelected(null)} />

      <ConfirmationDialog
        open={confirmRetry}
        onOpenChange={setConfirmRetry}
        title="Retry failed blockchain writes?"
        description={`${formatNumber(status.data?.totals.failed ?? 0)} failed write(s) will be re-queued and submitted by the relayer. Make sure the node is reachable first.`}
        confirmLabel="Retry writes"
        tone="primary"
        icon={<RotateCcw />}
        onConfirm={() => retry.mutateAsync()}
      />
    </>
  );
}

function ModesExplainer({ active }: { active?: ChainMode }) {
  const modes: { mode: ChainMode; title: string; icon: ReactNode; points: string[] }[] = [
    {
      mode: 'SIMULATION',
      title: 'Simulation mode',
      icon: <Database className="size-4" />,
      points: [
        'Entries are written to a hash-chained ledger table in PostgreSQL and labelled SIM-….',
        'Tampering with an entry breaks the hash links and is detected.',
        'It is not a blockchain: there is no consensus or independent copy.',
      ],
    },
    {
      mode: 'ONCHAIN',
      title: 'On-chain mode',
      icon: <Link2 className="size-4" />,
      points: [
        'Each event’s hash is written to the MediChainRegistry smart contract.',
        'Records carry a transaction hash and block number you can check on the node.',
        'If the node is unreachable, writes stay pending and can be retried.',
      ],
    },
  ];
  return (
    <Card className="xl:col-span-2">
      <CardHeader title="How records are anchored" icon={<ShieldCheck />} />
      <CardBody className="space-y-3">
        {modes.map((m) => {
          const on = m.mode === active;
          return (
            <div key={m.mode} className={cn('rounded-xl border p-4', on ? 'border-brand/40 bg-brand-soft/40' : 'border-line bg-canvas')}>
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                  <span className={on ? 'text-brand-ink' : 'text-muted'}>{m.icon}</span>
                  {m.title}
                </p>
                {on && <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-medium text-white">Active</span>}
              </div>
              <ul className="mt-2 space-y-1 text-[12.5px] leading-relaxed text-charcoal">
                {m.points.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <p className="flex gap-2 text-[12px] leading-relaxed text-muted">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Anchoring proves a record has not changed since it was written — not that a physical medicine is genuine.
        </p>
      </CardBody>
    </Card>
  );
}

function TxDetailDialog({ tx, onClose }: { tx: ChainTx | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['blockchain', 'tx', tx?.id],
    queryFn: () => api.get<TxDetail>(`/blockchain/transactions/${tx!.id}`),
    enabled: !!tx,
  });
  const verify = useMutation({
    mutationFn: (id: string) => api.post<{ verified: boolean; message: string; unavailable?: boolean; blockNumber?: number }>(`/blockchain/transactions/${id}/verify`),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const t = q.data?.transaction ?? tx;
  const ev = q.data?.event;
  const onchain = t?.mode === 'ONCHAIN';
  const result = verify.data;

  return (
    <Dialog
      open={!!tx}
      onOpenChange={(o) => {
        if (!o) {
          verify.reset();
          onClose();
        }
      }}
    >
      {t && (
        <DialogContent
          size="lg"
          title={onchain ? 'Blockchain transaction' : 'Simulated ledger entry'}
          description={`${humanizeOperation(t.operation)}${t.batch ? ` · batch ${t.batch.batchNumber}` : ''}`}
          icon={onchain ? <Link2 /> : <Database />}
          footer={
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button onClick={() => verify.mutate(t.id)} loading={verify.isPending}>
                {!verify.isPending && <RefreshCw />} Re-verify
              </Button>
            </>
          }
        >
          <div className="space-y-5">
            {result && (
              <div
                role="status"
                className={cn(
                  'flex gap-3 rounded-xl border p-3.5 text-[13px]',
                  result.unavailable ? 'border-warning/40 bg-warning-soft' : result.verified ? 'border-success/25 bg-success-soft' : 'border-danger/25 bg-danger-soft',
                )}
              >
                {result.unavailable ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden />
                ) : result.verified ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                )}
                <div>
                  <p className="font-semibold text-ink">{result.unavailable ? 'Blockchain verification unavailable' : result.verified ? 'Re-verified' : 'Verification failed'}</p>
                  <p className="mt-0.5 text-charcoal">{result.message}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={t.status} />
              <span className="text-[12.5px] text-muted">
                Recorded {formatDateTime(t.createdAt)}
                {t.confirmedAt ? ` · confirmed ${formatDateTime(t.confirmedAt)}` : ''}
                {t.attempts > 1 ? ` · ${t.attempts} attempts` : ''}
              </span>
            </div>
            {t.error && (
              <p className="rounded-xl bg-danger-soft p-3 text-[12.5px] text-charcoal">
                <span className="font-semibold text-danger">Last error: </span>
                {t.error}
              </p>
            )}

            <Group title="Database event" hint="The supply-chain event stored in MediChain’s database.">
              {q.isLoading ? (
                <Skeleton className="h-16 w-full sm:col-span-2" />
              ) : q.error ? (
                <p className="text-[13px] text-danger sm:col-span-2">{errorMessage(q.error)}</p>
              ) : ev ? (
                <>
                  <Field label="Event ID">
                    <HashText value={ev.id} full />
                  </Field>
                  <Field label="Event type">{humanizeOperation(ev.type)}</Field>
                  <Field label="Sequence (per batch)">
                    <span className="tabular">#{ev.sequence}</span>
                  </Field>
                  <Field label="Recorded">{formatDateTime(ev.createdAt)}</Field>
                  <Field label="Event hash" wide>
                    <HashText value={ev.hash} full />
                  </Field>
                  <Field label="Previous event hash" wide>
                    <HashText value={ev.prevHash} full />
                  </Field>
                </>
              ) : (
                <p className="text-[13px] text-muted sm:col-span-2">No database event is linked to this record.</p>
              )}
            </Group>

            {onchain ? (
              <Group title="Blockchain transaction" hint="Written to the MediChainRegistry smart contract.">
                <Field label="Transaction hash" wide>
                  <HashText value={t.txHash} full />
                </Field>
                <Field label="Block number">{t.blockNumber != null ? <span className="tabular">{formatNumber(t.blockNumber)}</span> : <span className="text-muted">—</span>}</Field>
                <Field label="Chain ID">{t.chainId ?? <span className="text-muted">—</span>}</Field>
                <Field label="Contract" wide>
                  <HashText value={t.contractAddress} full />
                </Field>
                <Field label="Anchored hash" wide>
                  <HashText value={t.payloadHash} full />
                </Field>
              </Group>
            ) : (
              <Group title="Simulated ledger entry" hint="A hash-chained row in PostgreSQL — not a blockchain transaction.">
                <Field label="Simulated reference">
                  <HashText value={t.simulatedRef} full />
                </Field>
                <Field label="Ledger sequence">{t.ledgerSequence != null ? <span className="tabular">#{t.ledgerSequence}</span> : <span className="text-muted">—</span>}</Field>
                <Field label="Ledger entry hash" wide>
                  <HashText value={t.ledgerHash} full />
                </Field>
                <Field label="Previous ledger hash" wide>
                  <HashText value={t.prevLedgerHash} full />
                </Field>
                <Field label="Anchored hash (event hash)" wide>
                  <HashText value={t.payloadHash} full />
                </Field>
              </Group>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function Group({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line">
      <header className="border-b border-line bg-subtle/60 px-4 py-2.5">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <p className="text-[12px] text-muted">{hint}</p>
      </header>
      <dl className="grid gap-x-6 gap-y-3 p-4 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function Field({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-charcoal">{children}</dd>
    </div>
  );
}
