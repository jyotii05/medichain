import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { OrgType, Role } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const numberFmt = new Intl.NumberFormat('en-GB');

/** "2026-03-14" or ISO timestamp -> "14 Mar 2026". Date-only strings are treated as UTC calendar dates. */
export function formatDate(v: string | Date | null | undefined) {
  if (!v) return '—';
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}

export function formatDateTime(v: string | Date | null | undefined) {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

export function formatNumber(n: number | null | undefined) {
  return n === null || n === undefined ? '—' : numberFmt.format(n);
}

export function relativeTime(v: string | Date | null | undefined) {
  if (!v) return '—';
  const diff = Date.now() - new Date(v).getTime();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [60_000, 'second'],
    [3_600_000, 'minute'],
    [86_400_000, 'hour'],
    [2_592_000_000, 'day'],
    [31_536_000_000, 'month'],
  ];
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 45_000) return 'just now';
  const divisors = [1000, 60_000, 3_600_000, 86_400_000, 2_592_000_000];
  for (let i = 0; i < units.length; i++) {
    if (abs < units[i][0]) return rtf.format(-Math.round(diff / divisors[i]), units[i][1] as Intl.RelativeTimeFormatUnit);
  }
  return rtf.format(-Math.round(diff / 31_536_000_000), 'year');
}

export function daysUntil(date: string) {
  const d = new Date(`${date}T00:00:00Z`).getTime();
  const today = new Date();
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((d - t) / 86_400_000);
}

/** 0x1234…abcd */
export function shortHash(h: string | null | undefined, head = 6, tail = 4) {
  if (!h) return '—';
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export const ROLE_LABEL: Record<Role | OrgType, string> = {
  REGULATOR: 'Regulator',
  MANUFACTURER: 'Manufacturer',
  DISTRIBUTOR: 'Distributor',
  WHOLESALER: 'Wholesaler',
  PHARMACY: 'Pharmacy',
};

export function initials(name: string) {
  return name
    .replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}
