import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Ban, Eye, EyeOff, MoreHorizontal, UserCheck, UserPlus, Users } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { OrganizationRow, Paged, Role, UserRow } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/hooks/useListState';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { SearchAndFilterBar } from '@/components/shared/SearchAndFilterBar';
import { Badge, StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog';
import { PasswordHints } from '@/components/account/PasswordHints';
import { cn, formatDateTime, initials, relativeTime, ROLE_LABEL } from '@/lib/utils';

const ROLES: Role[] = ['REGULATOR', 'MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY'];
const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'DISABLED', label: 'Disabled' },
];

const ROLE_TONE: Record<Role, 'brand' | 'info' | 'success' | 'warning' | 'neutral'> = {
  REGULATOR: 'brand',
  MANUFACTURER: 'info',
  DISTRIBUTOR: 'neutral',
  WHOLESALER: 'warning',
  PHARMACY: 'success',
};

function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>;
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const list = useListState({ pageSize: 15 }, ['role', 'status'] as const);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [target, setTarget] = useState<UserRow | null>(null);

  const q = useQuery({
    queryKey: ['users', list.page, list.search, list.role, list.status],
    queryFn: () => api.get<Paged<UserRow>>('/users', { page: list.page, pageSize: list.pageSize, search: list.search, role: list.role, status: list.status }),
    placeholderData: keepPreviousData,
  });

  const setStatus = useMutation({
    mutationFn: (v: { id: string; status: 'ACTIVE' | 'DISABLED' }) => api.patch<{ user: UserRow }>(`/users/${v.id}`, { status: v.status }),
    onSuccess: (r) => {
      toast.success(r.user.status === 'DISABLED' ? `${r.user.fullName} has been disabled and signed out` : `${r.user.fullName} has been re-enabled`);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: Column<UserRow>[] = [
    {
      key: 'user',
      header: 'User',
      cell: (u) => (
        <div className="flex min-w-[220px] items-center gap-3">
          <span className={cn('grid size-9 shrink-0 place-items-center rounded-full text-[12px] font-semibold', u.status === 'DISABLED' ? 'bg-subtle text-muted' : 'bg-brand-soft text-brand-ink')} aria-hidden>
            {initials(u.fullName)}
          </span>
          <div className="min-w-0 leading-tight">
            <p className="truncate font-medium text-ink">
              {u.fullName}
              {u.id === me?.id && <span className="ml-1.5 text-[12px] font-normal text-muted">(you)</span>}
            </p>
            <p className="mt-0.5 truncate text-[12px] text-muted">{u.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'org', header: 'Organization', hideBelow: 'md', cell: (u) => <span className="text-[13px]">{u.organization?.name ?? <span className="text-muted">—</span>}</span> },
    { key: 'role', header: 'Role', cell: (u) => <RoleBadge role={u.role} /> },
    { key: 'title', header: 'Title', hideBelow: 'xl', cell: (u) => <span className="text-[13px]">{u.title ?? <span className="text-muted">—</span>}</span> },
    { key: 'status', header: 'Status', cell: (u) => <StatusBadge status={u.status} size="sm" /> },
    {
      key: 'lastLogin',
      header: 'Last sign-in',
      hideBelow: 'lg',
      cell: (u) =>
        u.lastLoginAt ? (
          <span className="text-[13px]" title={formatDateTime(u.lastLoginAt)}>
            {relativeTime(u.lastLoginAt)}
          </span>
        ) : (
          <span className="text-[13px] text-muted">Never</span>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-12 text-right',
      cell: (u) =>
        u.id === me?.id ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.fullName}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {u.status === 'ACTIVE' ? (
                <DropdownMenuItem onSelect={() => setTarget(u)} className="text-danger [&_svg]:text-danger">
                  <Ban /> Disable account
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => setTarget(u)}>
                  <UserCheck /> Enable account
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
    },
  ];

  const filtered = !!(list.search || list.role || list.status);
  const disabling = target?.status === 'ACTIVE';

  return (
    <>
      <PageHeader
        title="Users"
        description="Accounts for every organization on the network. A user’s role always follows the type of organization they belong to."
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus /> Invite user
          </Button>
        }
      />
      <Card>
        <SearchAndFilterBar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search name, email or organization"
          filters={STATUS_FILTERS}
          filterValue={list.status}
          onFilterChange={(v) => list.set('status', v)}
          actions={
            <Select value={list.role} onChange={(e) => list.set('role', e.target.value)} aria-label="Filter by role" className="h-9 min-w-[160px]">
              <option value="">All roles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          }
        />
        <DataTable
          caption="Users"
          columns={columns}
          rows={q.data?.items}
          rowKey={(u) => u.id}
          loading={q.isFetching}
          error={q.error}
          onRetry={() => q.refetch()}
          empty={{
            icon: <Users />,
            title: filtered ? 'No users match your filters' : 'No users yet',
            description: filtered ? 'Try a different search term, role or status.' : 'Invite the first user to an organization.',
          }}
          pagination={q.data ? { page: q.data.page, totalPages: q.data.totalPages, total: q.data.total, pageSize: q.data.pageSize, onPageChange: list.setPage } : undefined}
        />
      </Card>

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      <ConfirmationDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={disabling ? `Disable ${target?.fullName ?? 'user'}?` : `Enable ${target?.fullName ?? 'user'}?`}
        description={
          disabling
            ? 'They will be signed out of all sessions immediately and cannot sign in until re-enabled. Their recorded actions remain in the audit log.'
            : 'They will be able to sign in again with their existing password.'
        }
        confirmLabel={disabling ? 'Disable account' : 'Enable account'}
        tone={disabling ? 'danger' : 'primary'}
        icon={disabling ? <Ban /> : <UserCheck />}
        onConfirm={() => target && setStatus.mutateAsync({ id: target.id, status: disabling ? 'DISABLED' : 'ACTIVE' })}
      />
    </>
  );
}

/* ------------------------------ invite ------------------------------ */

const inviteSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the person’s full name').max(120),
  email: z.string().trim().min(1, 'Enter an email address').email('Enter a valid email address').max(200),
  organizationId: z.string().min(1, 'Choose an organization'),
  title: z.string().trim().max(80).optional(),
  password: z
    .string()
    .min(10, 'Use at least 10 characters')
    .max(128)
    .regex(/[A-Za-z]/, 'Include at least one letter')
    .regex(/[0-9]/, 'Include at least one number'),
});
type InviteValues = z.infer<typeof inviteSchema>;

function InviteUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const orgs = useQuery({
    queryKey: ['organizations', 'all-for-invite'],
    queryFn: () => api.get<Paged<OrganizationRow>>('/organizations', { pageSize: 100 }),
    enabled: open,
    staleTime: 60_000,
  });
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { fullName: '', email: '', organizationId: '', title: '', password: '' } });

  const orgId = watch('organizationId');
  const password = watch('password');
  const org = orgs.data?.items.find((o) => o.id === orgId);

  const create = useMutation({
    mutationFn: (v: InviteValues) => api.post<{ user: UserRow }>('/users', { ...v, title: v.title || null }),
    onSuccess: (r) => {
      toast.success(`${r.user.fullName} was added as ${ROLE_LABEL[r.user.role]}`, { description: 'Share the temporary password with them securely.' });
      void qc.invalidateQueries({ queryKey: ['users'] });
      close();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        if (e.code === 'DUPLICATE_EMAIL') {
          setError('email', { message: e.message });
          return;
        }
        const fe = e.fieldErrors;
        let mapped = false;
        for (const k of ['fullName', 'email', 'organizationId', 'title', 'password'] as const) {
          if (fe[k]) {
            setError(k, { message: fe[k] });
            mapped = true;
          }
        }
        if (mapped) return;
      }
      setServerError(errorMessage(e));
    },
  });

  const close = () => {
    reset();
    setServerError(null);
    setShow(false);
    onOpenChange(false);
  };

  const groups = ROLES.map((r) => ({ role: r, items: (orgs.data?.items ?? []).filter((o) => o.type === r) })).filter((g) => g.items.length);

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : !create.isPending && close())}>
      <DialogContent
        size="md"
        title="Invite user"
        description="Create an account for a member of an organization. Their role is set by the organization type."
        icon={<UserPlus />}
        footer={
          <>
            <Button variant="outline" onClick={close} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="invite-user-form" loading={create.isPending}>
              Create account
            </Button>
          </>
        }
      >
        <form
          id="invite-user-form"
          noValidate
          onSubmit={handleSubmit((v) => {
            setServerError(null);
            create.mutate(v);
          })}
          className="space-y-4"
        >
          {serverError && (
            <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
              {serverError}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="inv-name" error={errors.fullName?.message} required>
              <Input id="inv-name" autoComplete="off" aria-invalid={!!errors.fullName} aria-describedby="inv-name-msg" {...register('fullName')} />
            </Field>
            <Field label="Work email" htmlFor="inv-email" error={errors.email?.message} required>
              <Input id="inv-email" type="email" autoComplete="off" aria-invalid={!!errors.email} aria-describedby="inv-email-msg" {...register('email')} />
            </Field>
          </div>
          <Field
            label="Organization"
            htmlFor="inv-org"
            error={errors.organizationId?.message ?? (orgs.error ? errorMessage(orgs.error) : undefined)}
            hint={org ? <span>Role: <RoleBadge role={org.type} />{org.status !== 'APPROVED' && <span className="ml-2 text-warning-ink">Organization is {org.status.toLowerCase()}</span>}</span> : 'The user’s role follows the organization type.'}
            required
          >
            <Select id="inv-org" aria-invalid={!!errors.organizationId} aria-describedby="inv-org-msg" disabled={orgs.isLoading} {...register('organizationId')}>
              <option value="">{orgs.isLoading ? 'Loading organizations…' : 'Choose an organization'}</option>
              {groups.map((g) => (
                <optgroup key={g.role} label={ROLE_LABEL[g.role]}>
                  {g.items.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.status !== 'APPROVED' ? ` (${o.status.toLowerCase()})` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Job title" htmlFor="inv-title" error={errors.title?.message} hint="Optional, e.g. Quality assurance lead">
            <Input id="inv-title" aria-invalid={!!errors.title} aria-describedby="inv-title-msg" {...register('title')} />
          </Field>
          <Field label="Temporary password" htmlFor="inv-password" error={errors.password?.message} required>
            <Input
              id="inv-password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby="inv-password-msg inv-password-rules"
              {...register('password')}
              rightSlot={
                <button type="button" onClick={() => setShow((s) => !s)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              }
            />
            <PasswordHints value={password} id="inv-password-rules" />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
