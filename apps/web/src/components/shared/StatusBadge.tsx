import {
  AlertOctagon,
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  HelpCircle,
  ShieldAlert,
  ShieldCheck,
  Truck,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info' | 'brand';

const tones: Record<Tone, string> = {
  success: 'bg-success-soft text-success ring-success/15',
  warning: 'bg-warning-soft text-warning-ink ring-warning/25',
  danger: 'bg-danger-soft text-danger ring-danger/15',
  neutral: 'bg-subtle text-charcoal ring-line-strong/60',
  info: 'bg-info-soft text-info ring-info/15',
  brand: 'bg-brand-soft text-brand-ink ring-brand/20',
};

interface Def {
  label: string;
  tone: Tone;
  icon: LucideIcon;
}

/** Single source of truth for every status label/colour used across the app. */
const STATUS: Record<string, Def> = {
  // batch display status
  ACTIVE: { label: 'Active', tone: 'success', icon: CheckCircle2 },
  IN_TRANSIT: { label: 'In transit', tone: 'info', icon: Truck },
  RECALLED: { label: 'Recalled', tone: 'danger', icon: AlertOctagon },
  BLOCKED: { label: 'Blocked', tone: 'danger', icon: Ban },
  EXPIRED: { label: 'Expired', tone: 'warning', icon: Clock },
  // transfers
  PENDING: { label: 'Pending', tone: 'warning', icon: Clock },
  ACCEPTED: { label: 'Accepted', tone: 'success', icon: CheckCircle2 },
  REJECTED: { label: 'Rejected', tone: 'danger', icon: XCircle },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: Ban },
  // verification
  VERIFIED: { label: 'Verified record', tone: 'success', icon: ShieldCheck },
  SUSPICIOUS: { label: 'Suspicious', tone: 'danger', icon: ShieldAlert },
  UNKNOWN: { label: 'Unknown', tone: 'danger', icon: HelpCircle },
  // organizations / users
  APPROVED: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  SUSPENDED: { label: 'Suspended', tone: 'danger', icon: Ban },
  DISABLED: { label: 'Disabled', tone: 'neutral', icon: Ban },
  // chain
  CONFIRMED: { label: 'Confirmed', tone: 'success', icon: CheckCircle2 },
  FAILED: { label: 'Failed', tone: 'danger', icon: XCircle },
  // flags
  OPEN: { label: 'Open', tone: 'warning', icon: AlertTriangle },
  RESOLVED: { label: 'Resolved', tone: 'success', icon: CheckCircle2 },
  DISMISSED: { label: 'Dismissed', tone: 'neutral', icon: CircleDashed },
};

export function statusDef(status: string): Def {
  return STATUS[status] ?? { label: status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' '), tone: 'neutral', icon: CircleDashed };
}

export function StatusBadge({ status, label, className, size = 'md' }: { status: string; label?: string; className?: string; size?: 'sm' | 'md' }) {
  const d = statusDef(status);
  const Icon = d.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium ring-1 ring-inset',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        tones[d.tone],
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} aria-hidden />
      {label ?? d.label}
    </span>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', tones[tone], className)}>
      {children}
    </span>
  );
}
