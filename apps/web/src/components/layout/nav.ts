import {
  Bell,
  BarChart3,
  Boxes,
  Building2,
  FileClock,
  Link2,
  LayoutDashboard,
  PackagePlus,
  QrCode,
  Route,
  ScanLine,
  Settings,
  ShieldAlert,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/lib/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  end?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const PARTNERS: Role[] = ['MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY'];

export const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    title: 'Supply chain',
    items: [
      { to: '/app/batches', label: 'Medicine batches', icon: Boxes, end: true },
      { to: '/app/batches/new', label: 'Register batch', icon: PackagePlus, roles: ['MANUFACTURER'] },
      { to: '/app/tracking', label: 'Tracking', icon: Route },
      { to: '/app/transfers', label: 'Shipments', icon: Truck },
      { to: '/app/inventory', label: 'Inventory', icon: Warehouse, roles: PARTNERS },
      { to: '/app/qr', label: 'QR codes', icon: QrCode, roles: ['MANUFACTURER', 'REGULATOR'] },
      { to: '/app/verify', label: 'Verify medicine', icon: ScanLine },
    ],
  },
  {
    title: 'Compliance',
    items: [
      { to: '/app/recalls', label: 'Recalls', icon: ShieldAlert },
      { to: '/app/partners', label: 'Partners', icon: Building2 },
      { to: '/app/blockchain', label: 'Blockchain records', icon: Link2 },
      { to: '/app/alerts', label: 'Alerts', icon: Bell },
      { to: '/app/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/app/users', label: 'Users', icon: Users, roles: ['REGULATOR'] },
      { to: '/app/audit', label: 'Audit trail', icon: FileClock, roles: ['REGULATOR'] },
      { to: '/app/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function navFor(role: Role): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(role)) })).filter((s) => s.items.length);
}
