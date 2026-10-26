import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Boxes,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  Download,
  ExternalLink,
  FileCode2,
  Flag,
  Fingerprint,
  History,
  MapPin,
  OctagonX,
  Package,
  QrCode,
  Route,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { api, ApiError, downloadFile, errorMessage } from '@/lib/api';
import type { BatchDetail, EventRow, FlagRow, TransferRow } from '@/lib/types';
import { cn, formatDate, formatDateTime, formatNumber, ROLE_LABEL } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge, StatusBadge } from '@/components/shared/StatusBadge';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { EmptyState, ErrorState, HashText, PageSkeleton } from '@/components/shared/States';
import { SupplyChainTimeline } from '@/components/batch/SupplyChainTimeline';
import { QRCodePanel } from '@/components/batch/QRCodePanel';
import { EVENT_LABEL, EventAnchor, IntegrityPanel } from '@/components/batch/IntegrityPanel';
import { ExpiryCell } from '@/pages/batches/BatchesPage';
import { TransferDialog } from '@/components/transfers/TransferDialog';
import { DispenseDialog } from '@/components/batch-actions/DispenseDialog';
import { FlagDialog } from '@/components/batch-actions/FlagDialog';
import { RecallDialog } from '@/components/recalls/RecallDialog';
import { RecallAlert } from '@/components/recalls/RecallAlert';

type DialogKind = 'transfer' | 'dispense' | 'flag' | 'recall' | null;
const TABS = ['journey', 'details', 'events', 'shipments', 'flags'] as const;
type Tab = (typeof TABS)[number];

export default function BatchDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const q = useQuery({ queryKey: ['batch', id], queryFn: () => api.get<BatchDetail>(`/batches/${encodeURIComponent(id)}`), enabled: !!id });

  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'journey';
  const setTab = (t: string) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (t === 'journey') n.delete('tab');
        else n.set('tab', t);
        return n;
      },
      { replace: true },
    );

  if (q.isLoading) return <PageSkeleton />;
  if (q.error || !q.data) {
    const notFound = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        <PageHeader breadcrumbs={[{ label: 'Batches', to: '/app/batches' }, { label: 'Batch' }]} title={notFound ? 'Batch not found' : 'Batch'} />
        <Card>
          {notFound ? (
            <EmptyState
              icon={<Boxes />}
              title="This batch is not available"
              description="It may not exist, or it is not visible to your organization. Batches are visible to the organizations that handled them and to regulators."
              action={
                <Link to="/app/batches">
                  <Button variant="outline">
                    <ArrowLeft /> Back to batches
                  </Button>
                </Link>
              }
            />
          ) : (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          )}
        </Card>
      </>
    );
  }

  return <BatchDetailView data={q.data} tab={tab} setTab={setTab} dialog={dialog} setDialog={setDialog} refreshing={q.isFetching} />;
}

function BatchDetailView({
  data,
  tab,
  setTab,
  dialog,
  setDialog,
  refreshing,
}: {
  data: BatchDetail;
  tab: Tab;
  setTab: (t: string) => void;
  dialog: DialogKind;
  setDialog: (d: DialogKind) => void;
  refreshing: boolean;
}) {
  const { batch, assessment, journey, events, transfers, recalls, flags, permissions } = data;
  const [busy, setBusy] = useState<'png' | 'svg' | null>(null);
  const latestRecall = useMemo(() => [...recalls].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0], [recalls]);
  const pending = transfers.find((t) => t.status === 'PENDING');
  const openFlags = flags.filter((f) => f.status === 'OPEN').length;
  const blockedOrRecalled = batch.status === 'RECALLED' || batch.status === 'BLOCKED';

  const download = async (format: 'png' | 'svg') => {
    setBusy(format);
    try {
      await downloadFile(`/batches/${encodeURIComponent(batch.id)}/qr?format=${format}`, `medichain-${batch.publicId}.${format}`);
      toast.success(`QR code downloaded (${format.toUpperCase()})`);
    } catch (e) {
      toast.error(errorMessage(e, 'Download failed'));
    } finally {
      setBusy(null);
    }
  };

  const medTitle = `${batch.medicine.name}${batch.medicine.strength ? ` ${batch.medicine.strength}` : ''}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Batches', to: '/app/batches' }, { label: batch.batchNumber }]}
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={batch.displayStatus} />
            {openFlags > 0 && (
              <Badge tone="warning">
                <Flag className="size-3" aria-hidden /> {openFlags} open {openFlags === 1 ? 'flag' : 'flags'}
              </Badge>
            )}
            {batch.isDemo && <Badge>Demo data</Badge>}
          </div>
        }
        title={medTitle}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {batch.medicine.genericName}
              {batch.medicine.dosageForm ? ` · ${batch.medicine.dosageForm}` : ''} · {batch.medicine.category}
            </span>
            <span className="flex items-center gap-1.5">
              Batch <span className="font-mono text-[13px] font-medium text-ink">{batch.batchNumber}</span>
            </span>
            <span className="flex items-center gap-1.5">
              ID <HashText value={batch.publicId} full className="text-[13px]" />
            </span>
          </span>
        }
        actions={
          <>
            {permissions.canTransfer && (
              <Button onClick={() => setDialog('transfer')}>
                <Truck /> Ship / transfer
              </Button>
            )}
            {permissions.canDispense && (
              <Button onClick={() => setDialog('dispense')}>
                <ClipboardList /> Record dispensing
              </Button>
            )}
            {permissions.canRecall && (
              <Button variant="danger" onClick={() => setDialog('recall')}>
                <OctagonX /> Recall / block
              </Button>
            )}
            {permissions.canFlag && (
              <Button variant="outline" onClick={() => setDialog('flag')}>
                <Flag /> Flag as suspicious
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="More batch actions">
                  More <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>QR code</DropdownMenuLabel>
                <DropdownMenuItem disabled={!!busy} onSelect={() => void download('png')}>
                  <Download /> Download PNG
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!!busy} onSelect={() => void download('svg')}>
                  <FileCode2 /> Download SVG
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to={`/verify/${batch.publicId}`} target="_blank" rel="noreferrer">
                    <ExternalLink /> View public page
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to={`/app/tracking/${batch.id}`}>
                    <Route /> Open in tracking
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className={cn('space-y-6 transition-opacity', refreshing && 'opacity-90')}>
        {blockedOrRecalled && latestRecall && <RecallAlert recall={latestRecall} />}

        {pending && (
          <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-info/20 bg-info-soft px-4 py-3 text-[13px] text-info">
            <Truck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1">
              Shipment <span className="font-mono font-semibold">{pending.reference}</span> from {pending.fromOrg.name} to {pending.toOrg.name} is awaiting acceptance (sent{' '}
              {formatDateTime(pending.createdAt)}). Custody changes only when the recipient accepts it.
            </p>
            <Link to="/app/transfers" className="font-semibold underline-offset-4 hover:underline">
              View transfers
            </Link>
          </div>
        )}

        {/* Key facts */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FactTile icon={<MapPin />} label="Current custodian" value={batch.currentCustodian.name} sub={`${ROLE_LABEL[batch.currentCustodian.type]}${batch.currentCustodian.city ? ` · ${batch.currentCustodian.city}` : ''}`} />
          <FactTile
            icon={<Package />}
            label="Quantity on hand"
            value={
              <span className="tabular">
                {formatNumber(batch.quantityOnHand)} <span className="text-sm font-medium text-muted">{batch.unit}</span>
              </span>
            }
            sub={`of ${formatNumber(batch.quantity)} registered`}
          />
          <FactTile icon={<CalendarClock />} label="Expiry" value={<ExpiryCell date={batch.expiryDate} status={batch.displayStatus} />} />
          <FactTile icon={<Boxes />} label="Manufacturer" value={batch.manufacturer.name} sub={`Manufactured ${formatDate(batch.manufactureDate)}`} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="min-w-0">
            <CardHeader icon={<ShieldCheck />} title="Verification & integrity" description="Automated checks on the recorded history. A clean record does not by itself prove physical authenticity." />
            <CardBody>
              <IntegrityPanel assessment={assessment} />
            </CardBody>
          </Card>
          <Card className="lg:self-start">
            <CardHeader icon={<QrCode />} title="Verification QR code" />
            <CardBody>
              <QRCodePanel batchId={batch.id} publicId={batch.publicId} verificationUrl={batch.verificationUrl} batchNumber={batch.batchNumber} medicineName={medTitle} size={176} showActions />
            </CardBody>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Batch information">
            <TabsTrigger value="journey">
              <Route /> Journey
            </TabsTrigger>
            <TabsTrigger value="details">
              <ClipboardList /> Details
            </TabsTrigger>
            <TabsTrigger value="events">
              <History /> Event log <CountPill n={events.length} />
            </TabsTrigger>
            <TabsTrigger value="shipments">
              <Truck /> Shipments <CountPill n={transfers.length} />
            </TabsTrigger>
            {flags.length > 0 && (
              <TabsTrigger value="flags">
                <Flag /> Flags <CountPill n={flags.length} />
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="journey" className="mt-4">
            <Card>
              <CardHeader
                icon={<Route />}
                title="Supply-chain journey"
                description="Custody stages derived from the hash-chained event history. Dashed stages have no recorded custody."
                action={
                  <Link to={`/app/tracking/${batch.id}`}>
                    <Button variant="ghost" size="sm">
                      Open tracking view <ExternalLink />
                    </Button>
                  </Link>
                }
              />
              <CardBody>
                <SupplyChainTimeline stages={journey} />
              </CardBody>
            </Card>
          </TabsContent>

          <TabsContent value="details" className="mt-4">
            <DetailsTab data={data} />
          </TabsContent>

          <TabsContent value="events" className="mt-4">
            <Card>
              <CardHeader
                icon={<History />}
                title="Hash-chained event log"
                description="Each event stores the hash of the previous one, so any edit to history breaks the chain. Database event IDs, ledger references and transaction hashes are shown separately."
              />
              <DataTable
                caption="Batch event log"
                columns={eventColumns}
                rows={[...events].sort((a, b) => b.sequence - a.sequence)}
                rowKey={(e) => String(e.sequence)}
                empty={{ icon: <History />, title: 'No events recorded' }}
              />
            </Card>
          </TabsContent>

          <TabsContent value="shipments" className="mt-4">
            <Card>
              <CardHeader icon={<Truck />} title="Shipments" description="Every custody transfer proposed for this batch, including rejected and cancelled ones." />
              <DataTable
                caption="Batch shipments"
                columns={transferColumns}
                rows={transfers}
                rowKey={(t) => t.id}
                empty={{ icon: <Truck />, title: 'No shipments yet', description: 'This batch has not been shipped since registration.' }}
              />
            </Card>
          </TabsContent>

          {flags.length > 0 && (
            <TabsContent value="flags" className="mt-4">
              <FlagsTab flags={flags} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      {permissions.canTransfer && (
        <TransferDialog
          batch={{ id: batch.id, batchNumber: batch.batchNumber, medicineName: medTitle, quantity: batch.quantityOnHand, unit: batch.unit }}
          open={dialog === 'transfer'}
          onOpenChange={(o) => setDialog(o ? 'transfer' : null)}
        />
      )}
      {permissions.canDispense && (
        <DispenseDialog
          batch={{ id: batch.id, batchNumber: batch.batchNumber, quantityOnHand: batch.quantityOnHand, unit: batch.unit }}
          open={dialog === 'dispense'}
          onOpenChange={(o) => setDialog(o ? 'dispense' : null)}
        />
      )}
      {permissions.canFlag && <FlagDialog batch={{ id: batch.id, batchNumber: batch.batchNumber }} open={dialog === 'flag'} onOpenChange={(o) => setDialog(o ? 'flag' : null)} />}
      {permissions.canRecall && (
        <RecallDialog batch={{ id: batch.id, batchNumber: batch.batchNumber, medicineName: medTitle }} open={dialog === 'recall'} onOpenChange={(o) => setDialog(o ? 'recall' : null)} />
      )}
    </>
  );
}

function CountPill({ n }: { n: number }) {
  return <span className="tabular ml-0.5 rounded-full bg-subtle px-1.5 text-[11px] font-semibold text-charcoal">{n}</span>;
}

function FactTile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted">
        <span className="text-brand-ink [&_svg]:size-4">{icon}</span>
        {label}
      </div>
      <div className="mt-1.5 truncate font-display text-[16px] font-semibold text-ink">{value}</div>
      {sub && <p className="mt-0.5 truncate text-[12px] text-muted">{sub}</p>}
    </Card>
  );
}

/* ------------------------------- Details ------------------------------- */

function DetailsTab({ data }: { data: BatchDetail }) {
  const { batch } = data;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader icon={<Package />} title="Medicine product" />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <DItem label="Brand / product name" value={batch.medicine.name} />
            <DItem label="Generic name" value={batch.medicine.genericName} />
            <DItem label="Category" value={batch.medicine.category} />
            <DItem label="Dosage form" value={batch.medicine.dosageForm} />
            <DItem label="Strength" value={batch.medicine.strength} />
            <DItem label="Packaging reference" value={batch.medicine.packagingRef} />
            <DItem label="Description" value={batch.medicine.description} wide />
          </dl>
        </CardBody>
      </Card>
      <Card>
        <CardHeader icon={<Boxes />} title="Batch" />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <DItem label="Batch number" value={<span className="font-mono">{batch.batchNumber}</span>} />
            <DItem label="Public batch ID" value={<span className="font-mono">{batch.publicId}</span>} />
            <DItem label="Manufacturer" value={batch.manufacturer.name} />
            <DItem label="Manufacturing licence" value={<span className="font-mono">{batch.manufacturerLicense}</span>} />
            <DItem label="Manufactured" value={formatDate(batch.manufactureDate)} />
            <DItem label="Expiry" value={formatDate(batch.expiryDate)} />
            <DItem label="Registered quantity" value={`${formatNumber(batch.quantity)} ${batch.unit}`} />
            <DItem label="On hand" value={`${formatNumber(batch.quantityOnHand)} ${batch.unit}`} />
            <DItem label="Storage requirements" value={batch.storageConditions} wide />
            <DItem label="Notes" value={batch.notes} wide />
            <DItem label="Registered on MediChain" value={formatDateTime(batch.createdAt)} />
          </dl>
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader icon={<Fingerprint />} title="Record fingerprints" description="Identifiers used to detect tampering. Click a value to copy it." />
        <CardBody>
          <dl className="grid gap-5 md:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-[12px] font-medium text-muted">Data hash</dt>
              <dd className="mt-1">
                <HashText value={batch.dataHash} full />
              </dd>
              <dd className="mt-1 text-[12px] leading-relaxed text-muted">Keccak-256 fingerprint of the batch facts declared at registration (ID, batch number, manufacturer, product, dates, quantity).</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[12px] font-medium text-muted">Ledger batch reference</dt>
              <dd className="mt-1">
                <HashText value={batch.chainRef} full />
              </dd>
              <dd className="mt-1 text-[12px] leading-relaxed text-muted">Key under which this batch's event hashes are anchored in the ledger. This is not a transaction hash.</dd>
            </div>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

function DItem({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-[12px] font-medium text-muted">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-sm', empty ? 'text-muted' : 'text-ink')}>{empty ? 'Not provided' : value}</dd>
    </div>
  );
}

/* ------------------------------- Event log ------------------------------- */

function orgName(o: EventRow['actorOrg']) {
  return o ? o.name : '—';
}

const eventColumns: Column<EventRow>[] = [
  { key: 'seq', header: '#', className: 'tabular w-12 text-muted', cell: (e) => e.sequence },
  {
    key: 'type',
    header: 'Event',
    cell: (e) => (
      <div className="min-w-[160px] leading-tight">
        <p className="font-medium text-ink">{EVENT_LABEL[e.type] ?? e.type}</p>
        {(e.fromOrg || e.toOrg) && e.type.startsWith('TRANSFER') && (
          <p className="mt-0.5 text-[12px] text-muted">
            {orgName(e.fromOrg)} → {orgName(e.toOrg)}
          </p>
        )}
        {e.id && (
          <p className="mt-0.5 text-[11px] text-muted">
            DB event ID <span className="font-mono">{e.id}</span>
          </p>
        )}
      </div>
    ),
  },
  {
    key: 'actor',
    header: 'Actor',
    hideBelow: 'md',
    cell: (e) =>
      e.actorOrg ? (
        <div className="leading-tight">
          <p className="text-[13px] text-charcoal">{e.actorOrg.name}</p>
          <p className="mt-0.5 text-[11.5px] text-muted">{ROLE_LABEL[e.actorOrg.type]}</p>
        </div>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  { key: 'time', header: 'Time', hideBelow: 'sm', cell: (e) => <span className="tabular whitespace-nowrap text-[13px]">{formatDateTime(e.createdAt)}</span> },
  { key: 'hash', header: 'Event hash', cell: (e) => <HashText value={e.hash} /> },
  { key: 'prev', header: 'Prev. hash', hideBelow: 'lg', cell: (e) => <HashText value={e.prevHash} /> },
  { key: 'anchor', header: 'Ledger anchor', cell: (e) => <EventAnchor anchor={e.anchor} /> },
];

/* ------------------------------- Shipments ------------------------------- */

const transferColumns: Column<TransferRow>[] = [
  {
    key: 'ref',
    header: 'Reference',
    cell: (t) => (
      <div className="leading-tight">
        <p className="font-mono text-[12.5px] text-ink">{t.reference}</p>
        <p className="mt-0.5 text-[11.5px] text-muted">{formatDateTime(t.createdAt)}</p>
      </div>
    ),
  },
  {
    key: 'route',
    header: 'From → To',
    cell: (t) => (
      <div className="min-w-[200px] text-[13px] leading-tight">
        <p className="text-charcoal">{t.fromOrg.name}</p>
        <p className="mt-0.5 text-muted">→ {t.toOrg.name}</p>
      </div>
    ),
  },
  {
    key: 'qty',
    header: 'Quantity',
    hideBelow: 'md',
    cell: (t) => (
      <span className="tabular text-[13px]">
        {formatNumber(t.quantity)} <span className="text-muted">{t.batch.unit}</span>
      </span>
    ),
  },
  {
    key: 'responded',
    header: 'Responded',
    hideBelow: 'lg',
    cell: (t) => (
      <div className="text-[12.5px] leading-tight">
        <p className="tabular text-charcoal">{t.respondedAt ? formatDateTime(t.respondedAt) : '—'}</p>
        {t.responseNote && <p className="mt-0.5 max-w-[220px] truncate text-muted" title={t.responseNote}>{t.responseNote}</p>}
      </div>
    ),
  },
  { key: 'status', header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
];

/* ------------------------------- Flags ------------------------------- */

function FlagsTab({ flags }: { flags: FlagRow[] }) {
  return (
    <Card>
      <CardHeader icon={<Flag />} title="Suspicion reports" description="Concerns raised by supply-chain partners. Regulators review and resolve them." />
      <ul className="divide-y divide-line">
        {flags.map((f) => (
          <li key={f.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={f.status} />
              <span className="text-[13px] font-medium text-ink">{f.org.name}</span>
              <span className="text-[12px] text-muted">
                · {f.raisedBy} · {formatDateTime(f.createdAt)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-charcoal">{f.reason}</p>
            {f.resolution && (
              <p className="mt-2 rounded-xl bg-subtle px-3 py-2 text-[13px] text-charcoal">
                <span className="font-medium text-ink">Resolution{f.resolvedAt ? ` (${formatDate(f.resolvedAt)})` : ''}:</span> {f.resolution}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
