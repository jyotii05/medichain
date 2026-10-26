import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useForm, type Path } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  EyeOff,
  Factory,
  FlaskConical,
  Lock,
  Mail,
  Phone,
  ScanLine,
  ShieldCheck,
  Store,
  Truck,
  User,
  UserPlus,
  Warehouse,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError, errorMessage } from '@/lib/api';
import type { CurrentUser, RegistrationInput } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Logo } from '@/components/layout/Logo';
import { PasswordHints, PASSWORD_RULES } from '@/components/account/PasswordHints';
import { cn } from '@/lib/utils';

/** Supply-chain roles open to self-registration. Regulator accounts are created by an existing regulator. */
const ORG_TYPES = [
  { value: 'MANUFACTURER', label: 'Manufacturer', icon: Factory, desc: 'Registers batches and issues QR codes' },
  { value: 'DISTRIBUTOR', label: 'Distributor', icon: Truck, desc: 'Receives from manufacturers, ships to wholesalers' },
  { value: 'WHOLESALER', label: 'Wholesaler', icon: Warehouse, desc: 'Receives from distributors, supplies pharmacies' },
  { value: 'PHARMACY', label: 'Pharmacy', icon: Store, desc: 'Receives stock and records dispensing' },
] as const;
type SelfServiceType = (typeof ORG_TYPES)[number]['value'];

const optional = (max: number, label: string) => z.string().trim().max(max, `${label} must be at most ${max} characters`);

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(120, 'Full name must be at most 120 characters'),
    email: z.string().trim().min(1, 'Work email is required').email('Enter a valid email address').max(200),
    jobTitle: optional(80, 'Job title'),
    password: z
      .string()
      .min(1, 'Password is required')
      .max(128, 'Password must be at most 128 characters')
      .superRefine((v, ctx) => {
        const unmet = PASSWORD_RULES.find((r) => !r.test(v));
        if (v && unmet) ctx.addIssue({ code: 'custom', message: `Password needs: ${unmet.label.toLowerCase()}` });
      }),
    confirmPassword: z.string().min(1, 'Confirm your password'),
    organization: z.object({
      name: z.string().trim().min(2, 'Enter the organization name').max(120, 'Organization name must be at most 120 characters'),
      type: z.string().refine((v) => ORG_TYPES.some((t) => t.value === v), 'Choose your organization’s supply-chain role'),
      licenseNumber: z.string().trim().min(4, 'Licence number must be at least 4 characters').max(60, 'Licence number must be at most 60 characters'),
      phone: optional(40, 'Phone number'),
      city: optional(80, 'City'),
      country: optional(80, 'Country'),
    }),
    acceptTerms: z.boolean().refine((v) => v, 'You must accept the terms to create an account'),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
type FormValues = z.infer<typeof schema>;

const blankToUndefined = (s: string) => s.trim() || undefined;

export default function RegisterPage() {
  const { user, register: registerAccount, setUser } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CurrentUser | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      email: '',
      jobTitle: '',
      password: '',
      confirmPassword: '',
      organization: { name: '', type: '', licenseNumber: '', phone: '', city: '', country: '' },
      acceptTerms: false,
    },
  });
  const password = watch('password');
  const selectedType = watch('organization.type');

  if (user && !created) return <Navigate to="/app" replace />;

  const onSubmit = async (v: FormValues) => {
    setFormError(null);
    const input: RegistrationInput = {
      fullName: v.fullName.trim(),
      email: v.email.trim(),
      password: v.password,
      confirmPassword: v.confirmPassword,
      jobTitle: blankToUndefined(v.jobTitle),
      organization: {
        name: v.organization.name.trim(),
        type: v.organization.type as SelfServiceType,
        licenseNumber: v.organization.licenseNumber.trim(),
        phone: blankToUndefined(v.organization.phone),
        city: blankToUndefined(v.organization.city),
        country: blankToUndefined(v.organization.country),
      },
      acceptTerms: true,
    };
    try {
      setCreated(await registerAccount(input));
    } catch (e) {
      if (e instanceof ApiError) {
        // Attach server-side field errors (validation, duplicate email / licence) to their inputs.
        const fields = Object.entries(e.fieldErrors);
        for (const [path, message] of fields) setError(path as Path<FormValues>, { message }, { shouldFocus: true });
        setFormError(e.code === 'VALIDATION_ERROR' && fields.length ? 'Please correct the highlighted fields.' : e.message);
      } else {
        setFormError(errorMessage(e, 'Registration failed. Please try again.'));
      }
    }
  };

  const continueToApp = () => {
    if (!created) return;
    setUser(created);
    toast.success(`Welcome to MediChain, ${created.fullName.split(' ')[0]}`);
    navigate('/app', { replace: true });
  };

  // Shared a11y wiring for Field-wrapped inputs: id, aria-invalid and the Field's message id.
  const a11y = (id: string, invalid: boolean, extra?: string) => ({
    id,
    'aria-invalid': invalid,
    'aria-describedby': [`${id}-msg`, extra].filter(Boolean).join(' '),
  });

  return (
    <div className="min-h-dvh bg-canvas lg:grid lg:grid-cols-[0.8fr_1.2fr]">
      {/* Brand / process panel */}
      <aside className="relative hidden overflow-hidden border-r border-line bg-[#F6F3EE] lg:flex lg:flex-col">
        <div className="absolute inset-0 opacity-[0.55]" aria-hidden style={{ backgroundImage: 'radial-gradient(#e2dbd6 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
        <div className="relative flex flex-1 flex-col px-10 py-10 xl:px-14">
          <Link to="/" aria-label="MediChain home" className="self-start rounded-lg">
            <Logo />
          </Link>
          <div className="my-auto max-w-md py-12">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-brand/25 bg-surface px-3 py-1 text-[12px] font-semibold text-brand-ink">
              <span className="size-1.5 rounded-full bg-brand" /> Join the supply-chain network
            </p>
            <h1 className="font-display text-[38px] font-bold leading-[1.1] tracking-tight text-ink xl:text-[44px]">
              Traceable from the
              <br />
              <span className="text-brand-ink">first handover.</span>
            </h1>
            <p className="mt-5 text-[15px] leading-relaxed text-charcoal">
              Register your organization to record custody transfers, receive shipments and give patients a verifiable record of every pack.
            </p>
            <ol className="mt-9 space-y-3" aria-label="How registration works">
              {[
                { icon: UserPlus, title: 'Create your account', desc: 'Register yourself and your licensed organization.' },
                { icon: ClipboardCheck, title: 'Regulator review', desc: 'A MediChain regulator checks your licence and approves the organization.' },
                { icon: BadgeCheck, title: 'Start recording', desc: 'Once approved, register batches, ship, receive and dispense.' },
              ].map((s, i) => (
                <li key={s.title} className="flex gap-3.5 rounded-2xl border border-line bg-surface/85 p-4 shadow-[var(--shadow-card)] backdrop-blur">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-brand/40 bg-brand-soft text-brand-ink">
                    <s.icon className="size-[18px]" aria-hidden />
                  </span>
                  <div>
                    <p className="text-[13.5px] font-semibold text-ink">
                      <span className="mr-1.5 text-muted">{i + 1}.</span>
                      {s.title}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-charcoal">{s.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1.5"><Lock className="size-3.5" /> Encrypted sessions</span>
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" /> Regulator-approved partners</span>
            <span className="inline-flex items-center gap-1.5"><FlaskConical className="size-3.5" /> Academic prototype</span>
          </div>
        </div>
      </aside>

      {/* Form panel */}
      <main className="flex min-h-dvh flex-col px-4 py-8 sm:px-10">
        <div className="flex items-center justify-between lg:justify-end">
          <Link to="/" aria-label="MediChain home" className="rounded-lg lg:hidden">
            <Logo subtitle={false} />
          </Link>
          <Link to="/verify" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium text-charcoal hover:bg-surface hover:text-ink">
            <ScanLine className="size-4" /> Verify a medicine
          </Link>
        </div>

        <div className="mx-auto my-auto w-full max-w-[640px] py-10">
          <div className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-raised)] sm:p-8">
            {created ? (
              <RegistrationSuccess user={created} onContinue={continueToApp} />
            ) : (
              <>
                <h2 className="font-display text-2xl font-semibold">Create Your MediChain Account</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">
                  Register your organization to access the medicine supply-chain platform. New organizations are reviewed by a regulator before they can
                  record supply-chain activity.
                </p>

                {formError && (
                  <div role="alert" className="mt-5 rounded-xl border border-danger/20 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger">
                    {formError}
                  </div>
                )}

                <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-7" noValidate>
                  <fieldset className="space-y-4">
                    <legend className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Your details</legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Full name" htmlFor="reg-name" error={errors.fullName?.message} required>
                        <Input {...a11y('reg-name', !!errors.fullName)} autoComplete="name" leftIcon={<User />} placeholder="e.g. Nadia Okafor" {...register('fullName')} />
                      </Field>
                      <Field label="Job title" htmlFor="reg-title" error={errors.jobTitle?.message} hint="Optional">
                        <Input {...a11y('reg-title', !!errors.jobTitle)} autoComplete="organization-title" placeholder="e.g. Quality manager" {...register('jobTitle')} />
                      </Field>
                    </div>
                    <Field label="Work email" htmlFor="reg-email" error={errors.email?.message} required hint="You will sign in with this address.">
                      <Input {...a11y('reg-email', !!errors.email)} type="email" autoComplete="email" leftIcon={<Mail />} placeholder="name@organization.com" {...register('email')} />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Password" htmlFor="reg-password" error={errors.password?.message} required>
                        <Input
                          {...a11y('reg-password', !!errors.password, 'reg-password-rules')}
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          leftIcon={<Lock />}
                          rightSlot={
                            <button
                              type="button"
                              onClick={() => setShowPassword((s) => !s)}
                              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
                              aria-label={showPassword ? 'Hide passwords' : 'Show passwords'}
                              aria-pressed={showPassword}
                            >
                              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </button>
                          }
                          {...register('password')}
                        />
                      </Field>
                      <Field label="Confirm password" htmlFor="reg-confirm" error={errors.confirmPassword?.message} required>
                        <Input
                          {...a11y('reg-confirm', !!errors.confirmPassword)}
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          leftIcon={<Lock />}
                          {...register('confirmPassword')}
                        />
                      </Field>
                    </div>
                    <PasswordHints value={password} id="reg-password-rules" />
                  </fieldset>

                  <fieldset className="space-y-4">
                    <legend className="mb-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">Your organization</legend>
                    <Field label="Organization name" htmlFor="reg-org-name" error={errors.organization?.name?.message} required>
                      <Input
                        {...a11y('reg-org-name', !!errors.organization?.name)}
                        autoComplete="organization"
                        leftIcon={<Building2 />}
                        placeholder="e.g. Lakeside Pharmaceuticals Ltd."
                        {...register('organization.name')}
                      />
                    </Field>

                    <div role="radiogroup" aria-labelledby="reg-type-label" aria-describedby="reg-type-msg" aria-required="true" aria-invalid={!!errors.organization?.type}>
                      <p id="reg-type-label" className="mb-1.5 block text-[13px] font-medium text-charcoal">
                        Supply-chain role
                        <span className="ml-0.5 text-brand-ink" aria-hidden>
                          *
                        </span>
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {ORG_TYPES.map((t) => (
                          <label
                            key={t.value}
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-xl border bg-surface p-3 transition-colors',
                              'has-[:focus-visible]:shadow-[var(--shadow-focus)] hover:border-line-strong',
                              selectedType === t.value ? 'border-brand bg-brand-soft/40' : errors.organization?.type ? 'border-danger' : 'border-line',
                            )}
                          >
                            <input type="radio" value={t.value} className="sr-only" {...register('organization.type')} />
                            <span
                              className={cn(
                                'grid size-9 shrink-0 place-items-center rounded-lg border',
                                selectedType === t.value ? 'border-brand bg-surface text-brand-ink' : 'border-line bg-canvas text-charcoal',
                              )}
                            >
                              <t.icon className="size-[18px]" aria-hidden />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[13.5px] font-semibold text-ink">{t.label}</span>
                              <span className="mt-0.5 block text-[12px] leading-snug text-muted">{t.desc}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <p id="reg-type-msg" className={cn('mt-1.5 text-xs', errors.organization?.type ? 'text-danger' : 'text-muted')} role={errors.organization?.type ? 'alert' : undefined}>
                        {errors.organization?.type?.message ?? 'Your account role follows your organization’s role. Regulator accounts cannot be self-registered.'}
                      </p>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field
                        label="Licence number"
                        htmlFor="reg-license"
                        error={errors.organization?.licenseNumber?.message}
                        required
                        hint="As issued by your licensing authority."
                      >
                        <Input
                          {...a11y('reg-license', !!errors.organization?.licenseNumber)}
                          className="font-mono uppercase"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="e.g. MFG-LKS-1042"
                          {...register('organization.licenseNumber')}
                        />
                      </Field>
                      <Field label="Phone number" htmlFor="reg-phone" error={errors.organization?.phone?.message} hint="Optional">
                        <Input {...a11y('reg-phone', !!errors.organization?.phone)} type="tel" autoComplete="tel" leftIcon={<Phone />} placeholder="+00 000 000 000" {...register('organization.phone')} />
                      </Field>
                      <Field label="City" htmlFor="reg-city" error={errors.organization?.city?.message} hint="Optional">
                        <Input {...a11y('reg-city', !!errors.organization?.city)} autoComplete="address-level2" {...register('organization.city')} />
                      </Field>
                      <Field label="Country" htmlFor="reg-country" error={errors.organization?.country?.message} hint="Optional">
                        <Input {...a11y('reg-country', !!errors.organization?.country)} autoComplete="country-name" {...register('organization.country')} />
                      </Field>
                    </div>
                  </fieldset>

                  <div>
                    <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-relaxed text-charcoal">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0 rounded border-line accent-[#E76F75]"
                        aria-invalid={!!errors.acceptTerms}
                        aria-describedby="reg-terms-msg"
                        {...register('acceptTerms')}
                      />
                      <span>
                        I confirm that the information above is accurate, that I am authorised to register this organization, and I accept the MediChain terms
                        of use. <span className="text-brand-ink" aria-hidden>*</span>
                      </span>
                    </label>
                    {errors.acceptTerms && (
                      <p id="reg-terms-msg" className="mt-1.5 text-xs text-danger" role="alert">
                        {errors.acceptTerms.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-4">
                    <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
                      {isSubmitting ? 'Creating account…' : 'Create account'} {!isSubmitting && <ArrowRight />}
                    </Button>
                    <p className="text-center text-[13px] text-muted">
                      Already have an account?{' '}
                      <Link to="/login" className="font-medium text-brand-ink hover:underline">
                        Sign in
                      </Link>
                    </p>
                    <p className="text-center text-[12px] text-muted">
                      <span className="text-brand-ink" aria-hidden>*</span> Required field
                    </p>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
        <p className="text-center text-[12px] text-muted">© {new Date().getFullYear()} MediChain · Academic &amp; portfolio demonstration</p>
      </main>
    </div>
  );
}

function RegistrationSuccess({ user, onContinue }: { user: CurrentUser; onContinue: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  const pending = user.organization.status !== 'APPROVED';
  return (
    <div className="text-center" role="status">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-success-soft text-success">
        <CheckCircle2 className="size-7" aria-hidden />
      </span>
      <h2 ref={headingRef} tabIndex={-1} className="mt-4 font-display text-2xl font-semibold focus:outline-none">
        Account created
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-charcoal">
        Welcome, {user.fullName.split(' ')[0]}. <strong>{user.organization.name}</strong> is registered on MediChain and you are now signed in as{' '}
        <strong className="whitespace-nowrap">{user.email}</strong>.
      </p>
      {pending && (
        <div className="mx-auto mt-5 max-w-md rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-left text-[13px] leading-relaxed text-warning-ink">
          <p className="font-semibold">Pending regulator approval</p>
          <p className="mt-0.5">
            You can sign in and browse now. Batch registration, transfers and other supply-chain actions unlock once a regulator approves your
            organization. You will get a notification when that happens.
          </p>
        </div>
      )}
      <Button size="lg" className="mt-6 w-full sm:w-auto" onClick={onContinue}>
        Continue to dashboard <ArrowRight />
      </Button>
    </div>
  );
}
