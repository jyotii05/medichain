import { useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';

/**
 * Categorical chart palette — fixed order, never cycled. Validated with the dataviz palette checker
 * (lightness band, chroma floor, CVD separation ≥ 8 ΔE, normal-vision floor ≥ 15 ΔE) on the white surface.
 * Brand red is below 3:1 contrast, so every chart ships with a legend, tooltip and table view.
 */
export const SERIES_COLORS = ['#E76F75', '#2F6DB5', '#1F9E89', '#9A6BC4', '#B07A2A'] as const;

/** Status colours are reserved for state and always paired with a label/icon. */
export const STATUS_COLORS: Record<string, string> = {
  ACTIVE: '#218653',
  VERIFIED: '#218653',
  ACCEPTED: '#218653',
  CONFIRMED: '#218653',
  IN_TRANSIT: '#3B6EA5',
  PENDING: '#D99427',
  EXPIRED: '#D99427',
  RECALLED: '#C23B44',
  BLOCKED: '#8F2A31',
  SUSPICIOUS: '#C23B44',
  UNKNOWN: '#8F2A31',
  REJECTED: '#C23B44',
  FAILED: '#C23B44',
  CANCELLED: '#9A9A9A',
};

export const axisProps = {
  stroke: '#777777',
  tick: { fill: '#777777', fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

export const gridProps = { stroke: '#EFEBE7', strokeDasharray: '0', vertical: false } as const;

interface TooltipPayload {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

/** Recharts custom tooltip: values in ink, identity via the colour swatch. */
export function ChartTooltip({ active, payload, label, labelFormatter }: { active?: boolean; payload?: TooltipPayload[]; label?: string | number; labelFormatter?: (l: string | number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[160px] rounded-xl border border-line bg-surface px-3 py-2.5 shadow-[var(--shadow-raised)]">
      {label !== undefined && <p className="mb-1.5 text-[11.5px] font-medium text-muted">{labelFormatter ? labelFormatter(label) : label}</p>}
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4 text-[12.5px]">
            <span className="flex items-center gap-2 text-charcoal">
              <span className="size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
              {p.name}
            </span>
            <span className="tabular font-semibold text-ink">{typeof p.value === 'number' ? formatNumber(p.value) : p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: number }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-[12px] text-charcoal">
          <span className="size-2.5 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
          {i.value !== undefined && <span className="tabular font-semibold text-ink">{formatNumber(i.value)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Wraps a chart with a chart/table toggle so the data is never colour-only. */
export function ChartFrame({
  chart,
  table,
  legend,
  className,
  height = 260,
}: {
  chart: ReactNode;
  table: { columns: string[]; rows: (string | number)[][] };
  legend?: ReactNode;
  className?: string;
  height?: number;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>{legend}</div>
        <div className="inline-flex rounded-lg border border-line p-0.5" role="group" aria-label="Chart view">
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn('grid size-7 place-items-center rounded-md text-muted', view === v ? 'bg-subtle text-ink' : 'hover:text-ink')}
              aria-label={v === 'chart' ? 'Show chart' : 'Show table'}
            >
              {v === 'chart' ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
            </button>
          ))}
        </div>
      </div>
      {view === 'chart' ? (
        <div style={{ height }}>{chart}</div>
      ) : (
        <div className="scrollbar-thin overflow-auto rounded-xl border border-line" style={{ maxHeight: height }}>
          <table className="w-full text-left text-[12.5px]">
            <thead className="sticky top-0 bg-subtle">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-medium text-muted">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="tabular px-3 py-1.5 text-charcoal">
                      {typeof c === 'number' ? formatNumber(c) : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
