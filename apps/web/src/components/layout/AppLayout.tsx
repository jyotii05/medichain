import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import * as D from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  CircleDot,
  LogOut,
  Menu,
  Search,
  Settings,
  UserRound,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { ChainStatus, NotificationRow, Paged } from '@/lib/types';
import { cn, initials, relativeTime, ROLE_LABEL } from '@/lib/utils';
import { Logo } from './Logo';
import { navFor } from './nav';
import { Tooltip } from '@/components/ui/misc';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/misc';

const COLLAPSE_KEY = 'medichain.sidebar.collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppLayout() {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  if (!user) return null;

  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only z-50 rounded-lg bg-ink px-3 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'no-print fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line bg-surface transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[76px]' : 'w-[264px]',
        )}
      >
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </aside>

      {/* Mobile drawer */}
      <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-ink/40 data-[state=open]:animate-fade-in lg:hidden" />
          <D.Content className="fixed inset-y-0 left-0 z-50 flex w-[284px] max-w-[85vw] flex-col bg-surface shadow-[var(--shadow-raised)] data-[state=open]:animate-slide-up focus:outline-none lg:hidden">
            <D.Title className="sr-only">Navigation</D.Title>
            <D.Description className="sr-only">Main navigation menu</D.Description>
            <D.Close className="absolute right-3 top-4 rounded-lg p-2 text-muted hover:bg-subtle" aria-label="Close menu">
              <X className="size-4" />
            </D.Close>
            <Sidebar collapsed={false} />
          </D.Content>
        </D.Portal>
      </D.Root>

      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200 print:pl-0', collapsed ? 'lg:pl-[76px]' : 'lg:pl-[264px]')}>
        <TopBar onMenu={() => setMobileOpen(true)} />
        {user.organization.status !== 'APPROVED' && (
          <div className="border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-center text-[13px] text-warning-ink sm:px-8">
            Your organization is <strong>{user.organization.status.toLowerCase()}</strong>. You can browse, but supply-chain actions are disabled until the regulator approves it.
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
        <footer className="no-print border-t border-line px-4 py-4 text-center text-xs text-muted sm:px-8">
          MediChain verifies registered records and recorded custody history. It does not by itself prove the physical authenticity of a medicine.
        </footer>
      </div>
    </div>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const sections = navFor(user.role);

  const doLogout = async () => {
    await logout();
    toast.success('You have been signed out');
    navigate('/login', { replace: true });
  };

  return (
    <>
      <div className={cn('flex h-16 shrink-0 items-center border-b border-line', collapsed ? 'justify-center px-2' : 'px-5')}>
        <Link to="/app" aria-label="MediChain dashboard" className="rounded-lg">
          <Logo collapsed={collapsed} />
        </Link>
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {sections.map((s) => (
          <div key={s.title} className="mb-5 last:mb-0">
            {!collapsed && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{s.title}</p>}
            {collapsed && <div className="mx-auto mb-2 h-px w-8 bg-line first:hidden" />}
            <ul className="space-y-0.5">
              {s.items.map((item) => {
                const link = (
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex h-9 items-center gap-3 rounded-lg text-[13.5px] font-medium transition-colors',
                        collapsed ? 'justify-center px-0' : 'px-3',
                        isActive ? 'bg-brand-soft text-brand-ink' : 'text-charcoal hover:bg-subtle hover:text-ink',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && !collapsed && <span className="absolute -left-3 top-1.5 h-6 w-[3px] rounded-r-full bg-brand" aria-hidden />}
                        <item.icon className={cn('size-[18px] shrink-0', isActive ? 'text-brand' : 'text-muted group-hover:text-charcoal')} aria-hidden />
                        {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
                      </>
                    )}
                  </NavLink>
                );
                return (
                  <li key={item.to}>
                    {collapsed ? (
                      <Tooltip content={item.label} side="right">
                        {link}
                      </Tooltip>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line p-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Tooltip content={`${user.fullName} · ${ROLE_LABEL[user.role]}`} side="right">
              <span className="grid size-9 place-items-center rounded-full bg-ink text-xs font-semibold text-white">{initials(user.fullName)}</span>
            </Tooltip>
            <Tooltip content="Sign out" side="right">
              <button onClick={doLogout} className="grid size-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink" aria-label="Sign out">
                <LogOut className="size-4" />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-canvas p-3">
            <div className="flex items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-xs font-semibold text-white">{initials(user.fullName)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-ink">{user.fullName}</p>
                <p className="truncate text-[12px] text-muted">{user.organization.name}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-ink">
                <CircleDot className="size-3" aria-hidden />
                {ROLE_LABEL[user.role]}
              </span>
              <button onClick={doLogout} className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-medium text-charcoal hover:bg-surface hover:text-ink">
                <LogOut className="size-3.5" aria-hidden /> Sign out
              </button>
            </div>
          </div>
        )}
        {onToggle && (
          <button
            onClick={onToggle}
            className={cn('mt-2 flex h-8 w-full items-center gap-2 rounded-lg text-[12px] font-medium text-muted hover:bg-subtle hover:text-ink', collapsed ? 'justify-center' : 'px-3')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
          </button>
        )}
      </div>
    </>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const chain = useQuery({ queryKey: ['blockchain', 'status'], queryFn: () => api.get<ChainStatus>('/blockchain/status'), staleTime: 60_000 });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    navigate(`/app/batches?q=${encodeURIComponent(v)}`);
    setQ('');
  };

  return (
    <header className="no-print sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-6 lg:px-8">
      <button onClick={onMenu} className="-ml-1 grid size-9 place-items-center rounded-lg text-charcoal hover:bg-subtle lg:hidden" aria-label="Open menu">
        <Menu className="size-5" />
      </button>
      <form onSubmit={submit} className="hidden max-w-md flex-1 sm:block" role="search">
        <label htmlFor="global-search" className="sr-only">
          Search batches
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id="global-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search batch ID, batch number or medicine…"
            className="h-9 w-full rounded-xl border border-line bg-canvas pl-9 pr-3 text-sm placeholder:text-muted focus:border-brand focus:bg-surface focus:outline-none focus:shadow-[var(--shadow-focus)]"
          />
        </div>
      </form>
      <div className="ml-auto flex items-center gap-2">
        {chain.data && (
          <Link
            to="/app/blockchain"
            className={cn(
              'hidden items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium md:inline-flex',
              chain.data.mode === 'ONCHAIN'
                ? chain.data.connected
                  ? 'border-success/25 bg-success-soft text-success'
                  : 'border-danger/25 bg-danger-soft text-danger'
                : 'border-warning/30 bg-warning-soft text-warning-ink',
            )}
            title={chain.data.message}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                chain.data.mode === 'ONCHAIN' ? (chain.data.connected ? 'bg-success' : 'bg-danger') : 'bg-warning',
              )}
              aria-hidden
            />
            {chain.data.mode === 'ONCHAIN' ? (chain.data.connected ? 'On-chain connected' : 'Blockchain unavailable') : 'Simulation mode'}
          </Link>
        )}
        <NotificationsMenu />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl p-1 pr-2 hover:bg-subtle" aria-label="Account menu">
            <span className="grid size-8 place-items-center rounded-full bg-ink text-[11px] font-semibold text-white">{initials(user?.fullName ?? '')}</span>
            <span className="hidden text-left leading-tight xl:block">
              <span className="block text-[13px] font-semibold text-ink">{user?.fullName}</span>
              <span className="block text-[11px] text-muted">{user && ROLE_LABEL[user.role]}</span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>
              <span className="block truncate text-[13px] font-semibold text-ink">{user?.fullName}</span>
              <span className="block truncate">{user?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/app/settings')}>
              <UserRound /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate('/app/settings?tab=security')}>
              <Settings /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              <LogOut /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

const severityDot: Record<string, string> = { INFO: 'bg-info', SUCCESS: 'bg-success', WARNING: 'bg-warning', CRITICAL: 'bg-danger' };

function NotificationsMenu() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['notifications', 'menu'],
    queryFn: () => api.get<Paged<NotificationRow> & { unread: number }>('/notifications', { pageSize: 6 }),
    refetchInterval: 60_000,
  });
  const readAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = q.data?.unread ?? 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="relative grid size-9 place-items-center rounded-xl text-charcoal hover:bg-subtle" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        <Bell className="size-[18px]" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold leading-4 text-ink ring-2 ring-surface">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button className="text-[12px] font-medium text-brand-ink hover:underline" onClick={() => readAll.mutate()}>
              Mark all as read
            </button>
          )}
        </div>
        <div className="scrollbar-thin max-h-[360px] overflow-y-auto py-1">
          {q.data?.items.length ? (
            q.data.items.map((n) => (
              <DropdownMenuItem
                key={n.id}
                className="mx-1 items-start gap-3 py-2.5"
                onSelect={() => {
                  if (!n.readAt) void api.post(`/notifications/${n.id}/read`).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
                  if (n.link) navigate(n.link);
                }}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', severityDot[n.severity], n.readAt && 'opacity-30')} aria-hidden />
                <span className="min-w-0">
                  <span className={cn('block text-[13px] text-ink', !n.readAt && 'font-semibold')}>{n.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[12px] text-muted">{n.message}</span>
                  <span className="mt-1 block text-[11px] text-muted">{relativeTime(n.createdAt)}</span>
                </span>
              </DropdownMenuItem>
            ))
          ) : (
            <p className="px-4 py-8 text-center text-sm text-muted">You’re all caught up.</p>
          )}
        </div>
        <div className="border-t border-line p-1.5">
          <DropdownMenuItem className="justify-center text-[13px] font-medium text-brand-ink" onSelect={() => navigate('/app/alerts')}>
            View all alerts
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
