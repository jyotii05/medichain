import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Bot, ScrollText, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import type { AuditRow, Paged } from '@/lib/types';
import { useListState } from '@/hooks/useListState';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SearchAndFilterBar } from '@/components/shared/SearchAndFilterBar';
import { HashText } from '@/components/shared/States';
import { formatDateTime, relativeTime } from '@/lib/utils';

const ENTITY_TYPES: { value: string; label: string }[] = [
  { value: 'MedicineBatch', label: 'Batches' },
  { value: 'CustodyTransfer', label: 'Transfers' },
  { value: 'RecallRecord', label: 'Recalls' },
  { value: 'BatchFlag', label: 'Flags' },
  { value: 'Organization', label: 'Organizations' },
  { value: 'User', label: 'Users' },
  { value: 'BlockchainTransaction', label: 'Blockchain' },
  { value: 'Report', label: 'Reports' },
  { value: 'System', label: 'System' },
];

const ENTITY_LABEL: Record<string, string> = {
  MedicineBatch: 'Batch',
  CustodyTransfer: 'Transfer',
  RecallRecord: 'Recall',
  BatchFlag: 'Flag',
  Organization: 'Organization',
  User: 'User',
  BlockchainTransaction: 'Blockchain record',
  Report: 'Report',
  System: 'System',
};

const ACTION_OVERRIDES: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.login_failed': 'Sign-in failed',
  'auth.password_reset_requested': 'Password reset requested',
  'profile.password_changed': 'Password changed',
  'profile.updated': 'Profile updated',
  'dev.sample_data_loaded': 'Sample data loaded',
  'verification.suspicious_alert': 'Suspicious verification alert',
  'blockchain.retry': 'Blockchain writes retried',
  'report.exported': 'Report exported',
};

/** "batch.recalled" → "Batch recalled", "transfer.initiated" → "Transfer initiated". */
function humanizeAction(action: string) {
  if (ACTION_OVERRIDES[action]) return ACTION_OVERRIDES[action];
  const text = action.replace(/[._]/g, ' ').trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

const humanKey = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();

function MetadataChips({ metadata }: { metadata: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(metadata ?? {});
  if (!entries.length) return <span className="text-muted">—</span>;
  const shown = open ? entries : entries.slice(0, 3);
  return (
    <div className="flex max-w-[360px] flex-wrap items-center gap-1.5">
      {shown.map(([k, v]) => {
        const val = formatValue(v);
        return (
          <span key={k} className="inline-flex max-w-full items-center gap-1 rounded-md bg-subtle px-1.5 py-0.5 text-[11.5px]" title={`${k}: ${val}`}>
            <span className="text-muted">{humanKey(k)}:</span>
            <span className={open ? 'break-all font-mono text-ink' : 'max-w-[160px] truncate font-mono text-ink'}>{val}</span>
          </span>
        );
      })}
      {entries.length > 3 && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="rounded px-1 text-[11.5px] font-medium text-brand-ink hover:underline" aria-expanded={open}>
          {open ? 'Show less' : `+${entries.length - 3} more`}
        </button>
      )}
    </div>
  );
}

const columns: Column<AuditRow>[] = [
  {
    key: 'time',
    header: 'Time',
    cell: (l) => (
      <div className="leading-tight">
        <p className="tabular whitespace-nowrap text-[13px] text-charcoal">{formatDateTime(l.createdAt)}</p>
        <p className="mt-0.5 text-[11.5px] text-muted">{relativeTime(l.createdAt)}</p>
      </div>
    ),
  },
  {
    key: 'actor',
    header: 'Actor',
    cell: (l) =>
      l.actor ? (
        <div className="min-w-[160px] leading-tight">
          <p className="text-[13px] font-medium text-ink">{l.actor.name}</p>
          <p className="mt-0.5 text-[12px] text-muted">{l.actor.email}</p>
        </div>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
          <Bot className="size-3.5" aria-hidden /> System
        </span>
      ),
  },
  { key: 'org', header: 'Organization', hideBelow: 'lg', cell: (l) => <span className="text-[13px]">{l.organization ?? <span className="text-muted">—</span>}</span> },
  {
    key: 'action',
    header: 'Action',
    cell: (l) => (
      <div className="leading-tight">
        <p className="whitespace-nowrap text-[13px] font-medium text-ink">{humanizeAction(l.action)}</p>
        <p className="mt-0.5 font-mono text-[11px] text-muted">{l.action}</p>
      </div>
    ),
  },
  {
    key: 'entity',
    header: 'Entity',
    hideBelow: 'md',
    cell: (l) => (
      <div className="leading-tight">
        <p className="text-[13px]">{ENTITY_LABEL[l.entityType] ?? l.entityType}</p>
        {l.entityId && <HashText value={l.entityId} className="text-[11px] text-muted" />}
      </div>
    ),
  },
  { key: 'metadata', header: 'Details', hideBelow: 'md', cell: (l) => <MetadataChips metadata={l.metadata} /> },
];

export default function AuditPage() {
  const list = useListState({ pageSize: 20 }, ['entityType'] as const);
  const q = useQuery({
    queryKey: ['audit-logs', list.page, list.search, list.entityType],
    queryFn: () => api.get<Paged<AuditRow>>('/audit-logs', { page: list.page, pageSize: list.pageSize, search: list.search, entityType: list.entityType }),
    placeholderData: keepPreviousData,
  });
  const filtered = !!(list.search || list.entityType);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every security-relevant action taken on MediChain — sign-ins, registrations, transfers, recalls, administration and exports."
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1.5 text-[12px] font-medium text-success">
            <ShieldCheck className="size-3.5" aria-hidden /> Append-only
          </span>
        }
      />
      <Card>
        <SearchAndFilterBar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search action, entity ID, email or organization"
          actions={
            <Select value={list.entityType} onChange={(e) => list.set('entityType', e.target.value)} aria-label="Filter by entity type" className="h-9 min-w-[170px]">
              <option value="">All entity types</option>
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          }
        />
        <DataTable
          caption="Audit log entries"
          columns={columns}
          rows={q.data?.items}
          rowKey={(l) => l.id}
          loading={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={{
            icon: <ScrollText />,
            title: filtered ? 'No entries match your filters' : 'No audit entries yet',
            description: filtered ? 'Try a different search term or entity type.' : 'Actions are recorded here as people use the system.',
          }}
          pagination={q.data ? { page: q.data.page, totalPages: q.data.totalPages, total: q.data.total, pageSize: q.data.pageSize, onPageChange: list.setPage } : undefined}
        />
        <p className="border-t border-line px-5 py-3 text-[12px] text-muted">
          Audit entries cannot be edited or deleted: a database trigger rejects any update or delete on the audit log table, so this record is append-only.
        </p>
      </Card>
    </>
  );
}
