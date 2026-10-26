import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Building2, Eye, EyeOff, Info, KeyRound, Lock, ServerCog, ShieldCheck, UserRound } from 'lucide-react';
import { api, ApiError, errorMessage } from '@/lib/api';
import type { ChainStatus, CurrentUser } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge, StatusBadge } from '@/components/shared/StatusBadge';
import { ErrorState } from '@/components/shared/States';
import { BlockchainStatusCard } from '@/components/blockchain/BlockchainStatusCard';
import { PasswordHints } from '@/components/account/PasswordHints';
import { formatDateTime, initials, ROLE_LABEL } from '@/lib/utils';

const TABS = ['profile', 'security', 'about'] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'profile';
  if (!user) return null;

  return (
    <>
      <PageHeader title="Settings" description="Your profile, sign-in security and information about this MediChain installation." />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          setParams(
            (p) => {
              const n = new URLSearchParams(p);
              if (v === 'profile') n.delete('tab');
              else n.set('tab', v);
              return n;
            },
            { replace: true },
          )
        }
      >
        <TabsList aria-label="Settings sections" className="mb-6">
          <TabsTrigger value="profile">
            <UserRound /> Profile
          </TabsTrigger>
          <TabsTrigger value="security">
            <Lock /> Security
          </TabsTrigger>
          <TabsTrigger value="about">
            <Info /> About
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileTab user={user} />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="about">
          <AboutTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

/* ------------------------------ Profile ------------------------------ */

const profileSchema = z.object({ fullName: z.string().trim().min(2, 'Enter at least 2 characters').max(120, 'Use at most 120 characters') });
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileTab({ user }: { user: CurrentUser }) {
  const { setUser } = useAuth();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { fullName: user.fullName } });

  useEffect(() => reset({ fullName: user.fullName }), [user.fullName, reset]);

  const save = useMutation({
    mutationFn: (v: ProfileValues) => api.patch<{ user: CurrentUser }>('/me', v),
    onSuccess: (r) => {
      setUser(r.user);
      reset({ fullName: r.user.fullName });
      toast.success('Profile updated');
    },
    onError: (e) => {
      const fe = e instanceof ApiError ? e.fieldErrors : {};
      if (fe.fullName) setError('fullName', { message: fe.fullName });
      else toast.error(errorMessage(e));
    },
  });

  const o = user.organization;
  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title="Your profile" description="Your name appears on records you create and in the audit log." icon={<UserRound />} />
        <form noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
          <CardBody className="space-y-5">
            <div className="flex items-center gap-4">
              <span className="grid size-14 place-items-center rounded-full bg-brand-soft font-display text-lg font-semibold text-brand-ink" aria-hidden>
                {initials(user.fullName)}
              </span>
              <div>
                <p className="font-semibold text-ink">{user.fullName}</p>
                <p className="text-[13px] text-muted">{user.title ?? ROLE_LABEL[user.role]}</p>
              </div>
            </div>
            <Field label="Full name" htmlFor="profile-name" error={errors.fullName?.message} required>
              <Input id="profile-name" autoComplete="name" aria-invalid={!!errors.fullName} aria-describedby="profile-name-msg" {...register('fullName')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Email" htmlFor="profile-email" hint="Contact a regulator administrator to change your email.">
                <Input id="profile-email" value={user.email} readOnly disabled aria-describedby="profile-email-msg" />
              </Field>
              <Field label="Role" htmlFor="profile-role" hint="Set by your organization type.">
                <Input id="profile-role" value={ROLE_LABEL[user.role]} readOnly disabled aria-describedby="profile-role-msg" />
              </Field>
            </div>
            <Field label="Organization" htmlFor="profile-org">
              <Input id="profile-org" value={o.name} readOnly disabled />
            </Field>
            {user.lastLoginAt && <p className="text-[12.5px] text-muted">Last sign-in: {formatDateTime(user.lastLoginAt)}</p>}
          </CardBody>
          <CardFooter>
            <Button variant="ghost" onClick={() => reset({ fullName: user.fullName })} disabled={!isDirty || save.isPending}>
              Discard
            </Button>
            <Button type="submit" loading={save.isPending} disabled={!isDirty}>
              Save changes
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Organization" icon={<Building2 />} action={<StatusBadge status={o.status} size="sm" />} />
        <CardBody>
          <p className="font-display text-[17px] font-semibold text-ink">{o.name}</p>
          <div className="mt-1.5">
            <Badge tone="brand">{ROLE_LABEL[o.type]}</Badge>
          </div>
          <dl className="mt-5 space-y-3 text-[13px]">
            <Info2 label="Licence number">
              <span className="font-mono">{o.licenseNumber}</span>
            </Info2>
            <Info2 label="Location">{[o.city, o.country].filter(Boolean).join(', ') || '—'}</Info2>
            {user.isDemo && (
              <Info2 label="Account type">
                <Badge tone="warning">Demonstration account</Badge>
              </Info2>
            )}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}

function Info2({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-charcoal">{children}</dd>
    </div>
  );
}

/* ------------------------------ Security ------------------------------ */

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(10, 'Use at least 10 characters')
      .max(128, 'Use at most 128 characters')
      .regex(/[A-Za-z]/, 'Include at least one letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirm: z.string().min(1, 'Repeat the new password'),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ['confirm'], message: 'The passwords do not match' })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ['newPassword'], message: 'Choose a password different from the current one' });
type PasswordValues = z.infer<typeof passwordSchema>;

function SecurityTab() {
  const [show, setShow] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors },
  } = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } });
  const newPassword = watch('newPassword');

  const change = useMutation({
    mutationFn: (v: PasswordValues) => api.post<{ ok: boolean }>('/me/password', { currentPassword: v.currentPassword, newPassword: v.newPassword }),
    onSuccess: () => {
      reset();
      toast.success('Password changed', { description: 'Other devices have been signed out.' });
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        if (e.code === 'INVALID_PASSWORD') return setError('currentPassword', { message: e.message });
        const fe = e.fieldErrors;
        if (fe.newPassword) return setError('newPassword', { message: fe.newPassword });
        if (e.status === 400) return setError('newPassword', { message: e.message });
      }
      toast.error(errorMessage(e));
    },
  });

  const type = show ? 'text' : 'password';
  const toggle = (
    <button type="button" onClick={() => setShow((s) => !s)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink" aria-label={show ? 'Hide passwords' : 'Show passwords'}>
      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </button>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader title="Change password" description="Use a password you don’t use anywhere else." icon={<KeyRound />} />
        <form noValidate onSubmit={handleSubmit((v) => change.mutate(v))}>
          <CardBody className="space-y-4">
            <Field label="Current password" htmlFor="pw-current" error={errors.currentPassword?.message} required>
              <Input id="pw-current" type={type} autoComplete="current-password" aria-invalid={!!errors.currentPassword} aria-describedby="pw-current-msg" rightSlot={toggle} {...register('currentPassword')} />
            </Field>
            <Field label="New password" htmlFor="pw-new" error={errors.newPassword?.message} required>
              <Input id="pw-new" type={type} autoComplete="new-password" aria-invalid={!!errors.newPassword} aria-describedby="pw-new-msg pw-new-rules" {...register('newPassword')} />
              <PasswordHints value={newPassword} id="pw-new-rules" />
            </Field>
            <Field label="Confirm new password" htmlFor="pw-confirm" error={errors.confirm?.message} required>
              <Input id="pw-confirm" type={type} autoComplete="new-password" aria-invalid={!!errors.confirm} aria-describedby="pw-confirm-msg" {...register('confirm')} />
            </Field>
          </CardBody>
          <CardFooter>
            <Button type="submit" loading={change.isPending}>
              Update password
            </Button>
          </CardFooter>
        </form>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader title="What happens next" icon={<ShieldCheck />} />
        <CardBody>
          <ul className="space-y-3 text-[13px] leading-relaxed text-charcoal">
            <li>You stay signed in on this device.</li>
            <li>All other sessions — other browsers, phones or shared computers — are signed out immediately.</li>
            <li>The change is recorded in the audit log. Your password itself is stored only as a salted bcrypt hash.</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

/* ------------------------------ About ------------------------------ */

interface AppConfig {
  demoMode: boolean;
  blockchainMode: 'SIMULATION' | 'ONCHAIN';
  publicAppUrl: string;
}

function AboutTab() {
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<AppConfig>('/config'), staleTime: 5 * 60_000 });
  const chain = useQuery({ queryKey: ['blockchain', 'status'], queryFn: () => api.get<ChainStatus>('/blockchain/status') });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="System information" icon={<ServerCog />} />
        <CardBody>
          {config.error ? (
            <ErrorState error={config.error} onRetry={() => config.refetch()} className="py-6" />
          ) : !config.data ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          ) : (
            <dl className="space-y-3.5 text-[13px]">
              <Info2 label="Ledger mode">{config.data.blockchainMode === 'ONCHAIN' ? 'On-chain (MediChainRegistry smart contract)' : 'Simulation (hash-chained ledger in PostgreSQL)'}</Info2>
              <Info2 label="Demonstration data">{config.data.demoMode ? <Badge tone="warning">Enabled — sample data can be loaded</Badge> : <Badge tone="neutral">Disabled</Badge>}</Info2>
              <Info2 label="Public verification address">
                <span className="break-all font-mono text-[12.5px]">{config.data.publicAppUrl.replace(/\/$/, '')}/verify</span>
              </Info2>
            </dl>
          )}
          <div className="mt-5">
            {chain.error ? <ErrorState error={chain.error} onRetry={() => chain.refetch()} className="py-6" /> : <BlockchainStatusCard status={chain.data} loading={chain.isLoading} compact />}
          </div>
        </CardBody>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader title="What MediChain can and cannot tell you" icon={<ShieldCheck />} />
          <CardBody className="space-y-3 text-[13px] leading-relaxed text-charcoal">
            <p>
              MediChain records each batch registration and custody transfer as a hash-linked event, and anchors those events to a ledger — the MediChainRegistry smart contract in on-chain mode,
              or a tamper-evident simulated ledger in simulation mode.
            </p>
            <p>
              A <span className="font-semibold text-ink">verified</span> result means the identifier matches a registered batch and its recorded history is consistent and unaltered. It does not by
              itself prove that a physical pack is genuine: a counterfeit could carry a copied code. Packaging checks and licensed supply channels remain essential.
            </p>
            <p>Simulation mode is not a blockchain — it offers tamper evidence but no decentralised consensus.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Data privacy" icon={<Lock />} />
          <CardBody>
            <ul className="space-y-2.5 text-[13px] leading-relaxed text-charcoal">
              <li className="flex gap-2">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                QR codes contain only an opaque batch identifier (or a link to it) — never personal or commercial data.
              </li>
              <li className="flex gap-2">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                Public verification needs no account. Verification logs store only a salted hash of the requester’s IP address — no raw IP, device details or location.
              </li>
              <li className="flex gap-2">
                <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                Only hashes of events are anchored to the ledger; business details stay in the access-controlled database.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
