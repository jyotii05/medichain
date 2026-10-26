import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Ban,
  Building2,
  CheckCircle2,
  Factory,
  Mail,
  MapPin,
  Phone,
  Plus,
  ShieldCheck,
  Store,
  Truck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { OrgType, OrganizationRow, Paged } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { useListState } from '@/hooks/useListState';
import { cn, formatDate, formatNumber, ROLE_LABEL } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { Pagination } from '@/components/shared/DataTable';
import { SearchAndFilterBar } from '@/components/shared/SearchAndFilterBar';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { ConfirmationDialog } from '@/components/shared/ConfirmationDialog';
import { EmptyState, ErrorState } from '@/components/shared/States';
import { InlineError } from '@/components/batch-actions/InlineNotice';

const TYPE_ICON: Record<OrgType, LucideIcon> = {
  REGULATOR: ShieldCheck,
  MANUFACTURER: Factory,
  DISTRIBUTOR: Truck,
  WHOLESALER: Warehouse,
  PHARMACY: Store,
};
const ORG_TYPES: OrgType[] = ['MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY', 'REGULATOR'];
const TYPE_FILTERS = [{ value: '', label: 'All types' }, ...ORG_TYPES.map((t) => ({ value: t, label: `${ROLE_LABEL[t]}s` }))];
const STATUSES = ['PENDING', 'APPROVED', 'SUSPENDED'] as const;

type StatusAction = { org: OrganizationRow; to: 'APPROVED' | 'SUSPENDED' };

export default function PartnersPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isRegulator = user?.role === 'REGULATOR';
  const list = useListState({ pageSize: 12 }, ['type', 'status'] as const);
  const type = (ORG_TYPES as string[]).includes(list.type) ? list.type : '';
  const status = isRegulator && (STATUSES as readonly string[]).includes(list.status) ? list.status : '';

  const [statusAction, setStatusAction] = useState<StatusAction | null>(null);
  const [reason, setReason] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const q = useQuery({
    queryKey: ['organizations', list.page, list.search, type, status],
    queryFn: () => api.get<Paged<OrganizationRow>>('/organizations', { page: list.page, pageSize: list.pageSize, search: list.search, type, status }),
    placeholderData: keepPreviousData,
  });

  const changeStatus = async () => {
    if (!statusAction) return;
    const { org, to } = statusAction;
    try {
      await api.patch(`/organizations/${org.id}/status`, { status: to, reason: reason.trim() || undefined });
      toast.success(to === 'APPROVED' ? `${org.name} approved` : `${org.name} suspended`, {
        description: to === 'APPROVED' ? 'They can now take part in the supply chain.' : 'Their members can no longer ship or receive batches.',
      });
      void qc.invalidateQueries({ queryKey: ['organizations'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['transfers', 'recipients'] });
    } catch (e) {
      toast.error(errorMessage(e, 'Could not update the organization'));
      if (e instanceof ApiError && e.code === 'NO_CHANGE') void qc.invalidateQueries({ queryKey: ['organizations'] });
      throw e;
    }
  };

  const suspending = statusAction?.to === 'SUSPENDED';
  const filtered = !!(list.search || type || status);

  return (
    <>
      <PageHeader
        title="Partners"
        description={
          isRegulator
            ? 'Every organization registered on MediChain. Approve new partners and suspend those who no longer meet requirements.'
            : 'Directory of approved supply-chain partners.'
        }
        actions={
          isRegulator && (
            <Button onClick={() => setAddOpen(true)}>
              <Plus /> Add organization
            </Button>
          )
        }
      />

      <Card>
        <SearchAndFilterBar
          search={list.search}
          onSearchChange={list.setSearch}
          placeholder="Search name, licence or city"
          filters={TYPE_FILTERS}
          filterValue={type}
          onFilterChange={(v) => list.set('type', v)}
          actions={
            isRegulator && (
              <div className="w-full lg:w-44">
                <Select value={status} onChange={(e) => list.set('status', e.target.value)} aria-label="Filter by status" className="h-9">
                  <option value="">All statuses</option>
                  <option value="PENDING">Pending approval</option>
                  <option value="APPROVED">Approved</option>
                  <option value="SUSPENDED">Suspended</option>
                </Select>
              </div>
            )
          }
        />

        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading organizations">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-3 rounded-2xl border border-line p-5">
                <div className="flex gap-3">
                  <Skeleton className="size-10 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ) : q.data.items.length === 0 ? (
          <EmptyState
            icon={<Building2 />}
            title={filtered ? 'No organizations match your filters' : 'No organizations yet'}
            description={filtered ? 'Try a different search term, type or status.' : isRegulator ? 'Add the first supply-chain partner to get started.' : 'Approved partners will be listed here.'}
            action={
              isRegulator && !filtered ? (
                <Button onClick={() => setAddOpen(true)}>
                  <Plus /> Add organization
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className={cn('grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-3 transition-opacity', q.isFetching && 'opacity-60')}>
              {q.data.items.map((o) => {
                const Icon = TYPE_ICON[o.type];
                const own = o.id === user?.organization.id;
                return (
                  <li key={o.id} className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface p-5 transition-[border,box-shadow] hover:border-line-strong hover:shadow-[var(--shadow-card)]">
                    <div className="flex items-start gap-3">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-ink" aria-hidden>
                        <Icon className="size-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[15px] font-semibold leading-6" title={o.name}>
                          {o.name}
                        </h3>
                        <p className="text-[12.5px] text-muted">
                          {ROLE_LABEL[o.type]}
                          {own && <span className="ml-1.5 font-medium text-brand-ink">· Your organization</span>}
                        </p>
                      </div>
                      {(isRegulator || o.status !== 'APPROVED') && <StatusBadge status={o.status} size="sm" />}
                    </div>

                    <dl className="mt-4 space-y-1.5 text-[13px]">
                      <div className="flex items-center gap-2">
                        <dt className="sr-only">Licence</dt>
                        <ShieldCheck className="size-3.5 shrink-0 text-muted" aria-hidden />
                        <dd className="font-mono text-[12.5px] text-charcoal">{o.licenseNumber}</dd>
                      </div>
                      <div className="flex items-center gap-2">
                        <dt className="sr-only">Location</dt>
                        <MapPin className="size-3.5 shrink-0 text-muted" aria-hidden />
                        <dd className="text-charcoal">{[o.city, o.country].filter(Boolean).join(', ') || <span className="text-muted">Location not set</span>}</dd>
                      </div>
                      {o.email && (
                        <div className="flex items-center gap-2">
                          <dt className="sr-only">Email</dt>
                          <Mail className="size-3.5 shrink-0 text-muted" aria-hidden />
                          <dd className="truncate">
                            <a href={`mailto:${o.email}`} className="text-charcoal hover:text-brand-ink hover:underline">
                              {o.email}
                            </a>
                          </dd>
                        </div>
                      )}
                      {o.phone && (
                        <div className="flex items-center gap-2">
                          <dt className="sr-only">Phone</dt>
                          <Phone className="size-3.5 shrink-0 text-muted" aria-hidden />
                          <dd className="text-charcoal">{o.phone}</dd>
                        </div>
                      )}
                    </dl>

                    {o.counts && (
                      <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-canvas p-3 text-center">
                        {[
                          { label: 'Members', value: o.counts.members },
                          { label: 'Made', value: o.counts.manufactured },
                          { label: 'In custody', value: o.counts.inCustody },
                        ].map((c) => (
                          <div key={c.label} className="flex flex-col-reverse">
                            <dt className="text-[11px] text-muted">{c.label}</dt>
                            <dd className="tabular font-display text-[17px] font-semibold text-ink">{formatNumber(c.value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
                      <p className="text-[11.5px] text-muted">{o.approvedAt ? `Approved ${formatDate(o.approvedAt)}` : `Registered ${formatDate(o.createdAt)}`}</p>
                      {isRegulator && !own && (
                        <div className="flex gap-1.5">
                          {o.status !== 'APPROVED' && (
                            <Button size="sm" variant="subtle" onClick={() => setStatusAction({ org: o, to: 'APPROVED' })}>
                              <CheckCircle2 /> {o.status === 'SUSPENDED' ? 'Reinstate' : 'Approve'}
                            </Button>
                          )}
                          {o.status !== 'SUSPENDED' && (
                            <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setStatusAction({ org: o, to: 'SUSPENDED' })}>
                              <Ban /> Suspend
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pagination page={q.data.page} totalPages={q.data.totalPages} total={q.data.total} pageSize={q.data.pageSize} onPageChange={list.setPage} />
          </>
        )}
      </Card>

      <ConfirmationDialog
        open={!!statusAction}
        onOpenChange={(o) => {
          if (!o) {
            setStatusAction(null);
            setReason('');
          }
        }}
        tone={suspending ? 'danger' : 'primary'}
        icon={suspending ? <Ban /> : <CheckCircle2 />}
        title={suspending ? `Suspend ${statusAction?.org.name ?? ''}?` : `${statusAction?.org.status === 'SUSPENDED' ? 'Reinstate' : 'Approve'} ${statusAction?.org.name ?? ''}?`}
        description={
          suspending
            ? 'Members will no longer be able to register, ship, receive or dispense batches. Existing records are kept. The organization is notified with your reason.'
            : 'The organization will be able to take part in the supply chain and will appear in partners’ recipient lists.'
        }
        confirmLabel={suspending ? 'Suspend organization' : 'Approve organization'}
        confirmDisabled={suspending && reason.trim().length < 5}
        onConfirm={changeStatus}
      >
        {suspending && (
          <Field label="Reason for suspension" htmlFor="suspend-reason" required hint="Shared with the organization · at least 5 characters">
            <Textarea
              id="suspend-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Licence expired on 30 September; renewal documents not received."
              aria-describedby="suspend-reason-msg"
            />
          </Field>
        )}
      </ConfirmationDialog>

      {isRegulator && <AddOrganizationDialog open={addOpen} onOpenChange={setAddOpen} />}
    </>
  );
}

/* --------------------------- Add organization --------------------------- */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const orgSchema = z.object({
  name: z.string().trim().min(2, 'Enter the organization name').max(120),
  type: z.enum(['REGULATOR', 'MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY'], { errorMap: () => ({ message: 'Choose a type' }) }),
  licenseNumber: z.string().trim().min(4, 'Licence number must be at least 4 characters').max(60),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email address').max(200)]).transform((v) => v || null),
  phone: optional(40),
  addressLine: optional(200),
  city: optional(80),
  country: optional(80),
  approve: z.boolean(),
});
type OrgInput = z.input<typeof orgSchema>;
type OrgOutput = z.output<typeof orgSchema>;

const DEFAULTS: OrgInput = { name: '', type: 'MANUFACTURER', licenseNumber: '', email: '', phone: '', addressLine: '', city: '', country: '', approve: true };

function AddOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<OrgInput, unknown, OrgOutput>({ resolver: zodResolver(orgSchema), defaultValues: DEFAULTS });

  useEffect(() => {
    if (!open) {
      reset(DEFAULTS);
      setFormError(null);
    }
  }, [open, reset]);

  const mutation = useMutation({
    mutationFn: (v: OrgOutput) => api.post<{ organization: OrganizationRow }>('/organizations', v),
    onSuccess: ({ organization }) => {
      toast.success(`${organization.name} added`, {
        description: organization.status === 'APPROVED' ? 'The organization is approved and can take part immediately.' : 'The organization is pending approval.',
      });
      void qc.invalidateQueries({ queryKey: ['organizations'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['transfers', 'recipients'] });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        if (e.code === 'DUPLICATE_LICENSE') return setError('licenseNumber', { message: e.message });
        const fe = Object.entries(e.fieldErrors);
        if (fe.length) {
          for (const [path, message] of fe) setError(path as keyof OrgInput, { message });
          return;
        }
      }
      setFormError(errorMessage(e, 'Could not add the organization'));
    },
  });

  const ctl = (name: keyof OrgInput) => ({
    id: `org-${name}`,
    'aria-invalid': !!errors[name],
    'aria-describedby': `org-${name}-msg`,
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent
        size="lg"
        icon={<Building2 />}
        title="Add organization"
        description="Register a supply-chain partner. Users can be added to it from the Users page."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="add-org-form" loading={mutation.isPending}>
              Add organization
            </Button>
          </>
        }
      >
        <form
          id="add-org-form"
          noValidate
          onSubmit={handleSubmit((v) => {
            setFormError(null);
            mutation.mutate(v);
          })}
          className="grid gap-4 sm:grid-cols-2"
        >
          <Field label="Organization name" htmlFor="org-name" required error={errors.name?.message} className="sm:col-span-2">
            <Input {...register('name')} {...ctl('name')} placeholder="e.g. Meridian Health Distributors" autoFocus />
          </Field>
          <Field label="Type" htmlFor="org-type" required error={errors.type?.message}>
            <Select {...register('type')} {...ctl('type')}>
              {ORG_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ROLE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Licence number" htmlFor="org-licenseNumber" required error={errors.licenseNumber?.message} hint="Stored in upper case; must be unique">
            <Input {...register('licenseNumber')} {...ctl('licenseNumber')} className="font-mono uppercase" placeholder="DST-MHD-1234" />
          </Field>
          <Field label="Email" htmlFor="org-email" error={errors.email?.message}>
            <Input type="email" {...register('email')} {...ctl('email')} placeholder="compliance@example.org" />
          </Field>
          <Field label="Phone" htmlFor="org-phone" error={errors.phone?.message}>
            <Input type="tel" {...register('phone')} {...ctl('phone')} placeholder="+00 000 000 000" />
          </Field>
          <Field label="Address" htmlFor="org-addressLine" error={errors.addressLine?.message} className="sm:col-span-2">
            <Input {...register('addressLine')} {...ctl('addressLine')} placeholder="Street and number" />
          </Field>
          <Field label="City" htmlFor="org-city" error={errors.city?.message}>
            <Input {...register('city')} {...ctl('city')} />
          </Field>
          <Field label="Country" htmlFor="org-country" error={errors.country?.message}>
            <Input {...register('country')} {...ctl('country')} />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-canvas p-3.5 sm:col-span-2">
            <input type="checkbox" {...register('approve')} className="mt-0.5 size-4 accent-brand" />
            <span>
              <span className="block text-sm font-medium text-ink">Approve immediately</span>
              <span className="mt-0.5 block text-[12.5px] text-muted">Licence has been checked. Otherwise the organization is created as pending approval.</span>
            </span>
          </label>
          {formError && <InlineError className="sm:col-span-2">{formError}</InlineError>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
