import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  Factory,
  Lock,
  Mail,
  ScanLine,
  ShieldCheck,
  Store,
  Truck,
  Warehouse,
  FlaskConical,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, ApiError, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Logo } from '@/components/layout/Logo';
import { cn } from '@/lib/utils';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean(),
});
type FormValues = z.infer<typeof schema>;

/** Development-only demonstration accounts (see README). Shown only when the API reports demo mode. */
const DEMO_ACCOUNTS = [
  { role: 'Regulator', email: 'regulator@medichain.demo', icon: ShieldCheck },
  { role: 'Manufacturer', email: 'manufacturer@medichain.demo', icon: Factory },
  { role: 'Distributor', email: 'distributor@medichain.demo', icon: Truck },
  { role: 'Wholesaler', email: 'wholesaler@medichain.demo', icon: Warehouse },
  { role: 'Pharmacy', email: 'pharmacy@medichain.demo', icon: Store },
];
const DEMO_PASSWORD = 'MediChain@2026';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);
  const config = useQuery({ queryKey: ['config'], queryFn: () => api.get<{ demoMode: boolean }>('/config'), staleTime: Infinity, retry: false });

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '', remember: false } });

  if (user) return <Navigate to="/app" replace />;

  const onSubmit = async (v: FormValues) => {
    setFormError(null);
    try {
      const u = await login(v.email, v.password, v.remember);
      toast.success(`Welcome back, ${u.fullName.split(' ')[0]}`);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith('/app') ? from : '/app', { replace: true });
    } catch (e) {
      setFormError(e instanceof ApiError && e.code === 'NETWORK_ERROR' ? e.message : errorMessage(e, 'Sign-in failed'));
    }
  };

  const fillDemo = (email: string) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', DEMO_PASSWORD, { shouldValidate: true });
    setFormError(null);
  };

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Brand / illustration panel */}
      <aside className="relative hidden overflow-hidden border-r border-line bg-[#F6F3EE] lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-[0.55]" aria-hidden style={{ backgroundImage: 'radial-gradient(#e2dbd6 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
        <div className="relative flex flex-1 flex-col px-12 py-10 xl:px-16">
          <Link to="/" aria-label="MediChain home" className="self-start rounded-lg">
            <Logo />
          </Link>
          <div className="my-auto max-w-xl py-12">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand/25 bg-surface px-3 py-1 text-[12px] font-semibold text-brand-ink">
              <span className="size-1.5 rounded-full bg-brand" /> Pharmaceutical traceability platform
            </p>
            <h1 className="font-display text-[44px] font-bold leading-[1.08] tracking-tight text-ink xl:text-[52px]">
              Every medicine.
              <br />
              Every journey.
              <br />
              <span className="text-brand-ink">Verified.</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-charcoal">
              Register batches, record every custody handover from manufacturer to pharmacy, and let anyone check a pack’s recorded journey with a
              single scan.
            </p>
            <JourneyIllustration />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" /> Encrypted sessions</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> Role-based access</span>
            <span className="inline-flex items-center gap-1.5"><FlaskConical className="size-3.5" /> Academic prototype</span>
          </div>
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex min-h-dvh flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Link to="/" aria-label="MediChain home" className="rounded-lg lg:hidden">
            <Logo subtitle={false} />
          </Link>
          <Link to="/verify" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-charcoal hover:bg-surface hover:text-ink">
            <ScanLine className="size-4" /> Verify a medicine
          </Link>
        </div>

        <div className="mx-auto my-auto w-full max-w-[420px] py-10">
          <div className="rounded-2xl border border-line bg-surface p-7 shadow-[var(--shadow-raised)] sm:p-8">
            <h2 className="font-display text-2xl font-semibold">Sign in to MediChain</h2>
            <p className="mt-1.5 text-sm text-muted">Use your MediChain account or the one issued by your organization.</p>

            {formError && (
              <div role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
              <Field label="Work email" htmlFor="email" error={errors.email?.message}>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@organization.com"
                  leftIcon={<Mail />}
                  aria-invalid={!!errors.email}
                  aria-describedby="email-msg"
                  {...register('email')}
                />
              </Field>
              <Field label="Password" htmlFor="password" error={errors.password?.message}>
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  leftIcon={<Lock />}
                  aria-invalid={!!errors.password}
                  aria-describedby="password-msg"
                  rightSlot={
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      className="grid size-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  }
                  {...register('password')}
                />
              </Field>
              <div className="flex items-center justify-between">
                <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-charcoal">
                  <input type="checkbox" className="size-4 rounded border-line accent-[#E76F75]" {...register('remember')} />
                  Keep me signed in for 7 days
                </label>
                <button type="button" onClick={() => setForgotOpen(true)} className="text-[13px] font-medium text-brand-ink hover:underline">
                  Forgot password?
                </button>
              </div>
              <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
                Sign in <ArrowRight />
              </Button>
            </form>
            <p className="mt-5 text-center text-[13px] text-muted">
              New to MediChain?{' '}
              <Link to="/register" className="font-medium text-brand-ink hover:underline">
                Create an account
              </Link>
            </p>
          </div>

          {config.data?.demoMode && (
            <section className="mt-5 rounded-2xl border border-dashed border-line-strong bg-surface/60 p-5" aria-labelledby="demo-title">
              <div className="flex items-center justify-between gap-2">
                <h3 id="demo-title" className="text-[13px] font-semibold text-ink">
                  Demonstration accounts
                </h3>
                <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-warning-ink">Development only</span>
              </div>
              <p className="mt-1 text-[12px] text-muted">
                Fictional users for testing each role. Password: <code className="rounded bg-subtle px-1 font-mono text-charcoal">{DEMO_PASSWORD}</code>
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    onClick={() => fillDemo(a.email)}
                    className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-left text-[12.5px] font-medium text-charcoal transition-colors hover:border-brand/40 hover:bg-brand-soft/40 hover:text-ink"
                  >
                    <a.icon className="size-4 shrink-0 text-brand" aria-hidden />
                    {a.role}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        <p className="text-center text-[12px] text-muted">© {new Date().getFullYear()} MediChain · Academic &amp; portfolio demonstration</p>
      </main>

      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
    </div>
  );
}

function JourneyIllustration() {
  const stages = [
    { icon: Factory, label: 'Manufacturer' },
    { icon: Truck, label: 'Distributor' },
    { icon: Warehouse, label: 'Wholesaler' },
    { icon: Store, label: 'Pharmacy' },
  ];
  return (
    <div className="mt-10 rounded-2xl border border-line bg-surface/85 p-6 shadow-[var(--shadow-card)] backdrop-blur" aria-hidden>
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Batch AMX-2026-0915</p>
        <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-success">
          <ShieldCheck className="size-3" /> Verified record
        </span>
      </div>
      <div className="relative mt-6 flex items-start justify-between">
        <div className="absolute left-6 right-6 top-6 h-[2px] bg-gradient-to-r from-brand via-brand/70 to-brand/40" />
        {stages.map((s, i) => (
          <div key={s.label} className="relative z-10 flex w-16 flex-col items-center text-center">
            <span className={cn('grid size-12 place-items-center rounded-2xl border-2 bg-surface', i === 3 ? 'border-brand bg-brand-soft' : 'border-brand/50')}>
              <s.icon className={cn('size-5', i === 3 ? 'text-brand-ink' : 'text-charcoal')} />
            </span>
            <span className="mt-2 text-[11px] font-medium text-charcoal">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-4 gap-2">
        {['0x8f3a…c21d', '0x1be0…94af', '0x77c4…0e5b', '0xd29e…6a13'].map((h, i) => (
          <div key={h} className="rounded-lg border border-line bg-canvas px-2 py-1.5">
            <p className="text-[9.5px] font-semibold uppercase tracking-wide text-muted">Block {i + 1}</p>
            <p className="truncate font-mono text-[10.5px] text-charcoal">{h}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ForgotPasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!z.string().email().safeParse(email.trim()).success) {
      setErr('Enter a valid email address');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ message: string }>('/auth/forgot-password', { email: email.trim() });
      setSent(r.message);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setSent(null);
          setErr(null);
        }
      }}
    >
      <DialogContent size="sm" title="Reset your password" description="We’ll send reset instructions to your work email." icon={<Building2 />}>
        {sent ? (
          <div className="rounded-xl border border-success/20 bg-success-soft p-4 text-[13px] leading-relaxed text-success">{sent}</div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Work email" htmlFor="forgot-email" error={err ?? undefined}>
              <Input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@organization.com"
                leftIcon={<Mail />}
                aria-invalid={!!err}
                aria-describedby="forgot-email-msg"
                autoFocus
              />
            </Field>
            <Button type="submit" className="w-full" loading={busy}>
              Send reset instructions
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
