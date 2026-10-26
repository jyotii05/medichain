import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Controller, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  Database,
  Download,
  Factory,
  FileText,
  Fingerprint,
  Link2,
  Lock,
  PackagePlus,
  Pill,
  Printer,
  QrCode,
  RotateCcw,
  Thermometer,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import { api, ApiError, downloadFile, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { BatchRow, ChainStatus, OrgType } from '@/lib/types';
import { cn, formatDate, formatNumber, ROLE_LABEL } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/shared/StatusBadge';
import { QRCodePanel } from '@/components/batch/QRCodePanel';
import { BatchLabel, usePrintContent } from '@/components/batch/PrintableLabel';

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  'Analgesic',
  'Antibiotic',
  'Antiviral',
  'Antifungal',
  'Antidiabetic',
  'Cardiovascular',
  'Gastrointestinal',
  'Respiratory',
  'Neurological',
  'Oncology',
  'Dermatological',
  'Vaccine',
  'Biologic',
  'Hormonal',
  'Vitamin & supplement',
];
const OTHER = '__other__';

const DOSAGE_FORMS = ['Tablet', 'Film-coated tablet', 'Capsule', 'Gastro-resistant capsule', 'Oral suspension', 'Syrup', 'Injection', 'Infusion', 'Inhaler', 'Cream', 'Ointment', 'Eye drops', 'Suppository', 'Powder for solution'];

const UNITS = ['tablets', 'capsules', 'vials', 'ampoules', 'bottles', 'pre-filled syringes', 'inhalers', 'sachets', 'tubes', 'blister packs', 'boxes', 'cartons'];

const STORAGE_PRESETS = ['Store below 25 °C', 'Store below 30 °C', 'Store at 2–8 °C (refrigerate)', 'Do not freeze', 'Protect from light', 'Keep dry', 'Store in original package'];

/* ------------------------------------------------------------------ */
/* Validation (mirrors createBatchSchema on the server)                */
/* ------------------------------------------------------------------ */

const todayUtc = () => new Date().toISOString().slice(0, 10);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const req = (max: number, label = 'This field') => z.string().trim().min(1, `${label} is required`).max(max, `Maximum ${max} characters`);
const opt = (max: number) => z.string().trim().max(max, `Maximum ${max} characters`);

const schema = z
  .object({
    medicine: z.object({
      name: req(120, 'Brand / product name'),
      genericName: req(120, 'Generic name'),
      category: z.string().min(1, 'Choose a category'),
      categoryOther: opt(60),
      dosageForm: opt(60),
      strength: opt(60),
      description: opt(1000),
      packagingRef: opt(120),
    }),
    batchNumber: z
      .string()
      .trim()
      .min(3, 'Batch number must be at least 3 characters')
      .max(40, 'Maximum 40 characters')
      .regex(/^[A-Za-z0-9][A-Za-z0-9\-/.]*$/, 'Use letters, numbers, dashes, dots or slashes only'),
    manufacturerLicense: req(60, 'Manufacturer licence'),
    manufactureDate: z.string().regex(DATE_RE, 'Enter the manufacturing date'),
    expiryDate: z.string().regex(DATE_RE, 'Enter the expiry date'),
    quantity: z
      .string()
      .trim()
      .min(1, 'Quantity is required')
      .regex(/^\d+$/, 'Quantity must be a whole number')
      .refine((v) => Number(v) > 0, 'Quantity must be greater than zero')
      .refine((v) => Number(v) <= 100_000_000, 'Quantity cannot exceed 100,000,000'),
    unit: req(30, 'Unit'),
    storagePresets: z.array(z.string()),
    storageExtra: opt(200),
    notes: opt(1000),
    initialRecipientId: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.medicine.category === OTHER && !v.medicine.categoryOther.trim()) {
      ctx.addIssue({ code: 'custom', path: ['medicine', 'categoryOther'], message: 'Enter the category' });
    }
    const storage = composeStorage(v.storagePresets, v.storageExtra);
    if (!storage) ctx.addIssue({ code: 'custom', path: ['storageExtra'], message: 'Select at least one storage requirement or describe them' });
    else if (storage.length > 200) ctx.addIssue({ code: 'custom', path: ['storageExtra'], message: `Storage requirements are too long (${storage.length}/200 characters)` });
    const today = todayUtc();
    if (DATE_RE.test(v.manufactureDate) && v.manufactureDate > today) {
      ctx.addIssue({ code: 'custom', path: ['manufactureDate'], message: 'Manufacturing date cannot be in the future' });
    }
    if (DATE_RE.test(v.expiryDate)) {
      if (DATE_RE.test(v.manufactureDate) && v.expiryDate <= v.manufactureDate) {
        ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Expiry date must be after the manufacturing date' });
      } else if (v.expiryDate <= today) {
        ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Cannot register a batch that has already expired' });
      }
    }
  });

type FormValues = z.infer<typeof schema>;

function composeStorage(presets: string[], extra: string) {
  return [...presets, extra.trim()].filter(Boolean).join('; ');
}

const FORM_PATHS = new Set<string>([
  'medicine.name',
  'medicine.genericName',
  'medicine.category',
  'medicine.dosageForm',
  'medicine.strength',
  'medicine.description',
  'medicine.packagingRef',
  'batchNumber',
  'manufacturerLicense',
  'manufactureDate',
  'expiryDate',
  'quantity',
  'unit',
  'notes',
  'initialRecipientId',
]);

function serverPathToField(path: string): FieldPath<FormValues> | null {
  if (path === 'storageConditions') return 'storageExtra';
  return FORM_PATHS.has(path) ? (path as FieldPath<FormValues>) : null;
}

/** "2 years 3 months" between two YYYY-MM-DD dates */
function shelfLife(from: string, to: string) {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to <= from) return null;
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [y ? `${y} ${y === 1 ? 'year' : 'years'}` : '', m ? `${m} ${m === 1 ? 'month' : 'months'}` : ''].filter(Boolean);
  return { days, label: parts.length ? parts.join(' ') : `${days} ${days === 1 ? 'day' : 'days'}` };
}

interface Recipient {
  id: string;
  name: string;
  type: OrgType;
  city: string | null;
  country: string | null;
  licenseNumber: string;
}

interface CreateResponse {
  batch: BatchRow;
  verificationUrl: string;
  transfer: { id: string; reference: string } | null;
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function RegisterBatchPage() {
  const [created, setCreated] = useState<{ res: CreateResponse; storage: string; recipient: Recipient | null } | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [created]);

  if (created) {
    return (
      <RegistrationSuccess
        result={created.res}
        storage={created.storage}
        recipient={created.recipient}
        onRegisterAnother={() => {
          setCreated(null);
          setFormKey((k) => k + 1);
        }}
      />
    );
  }
  return <RegisterForm key={formKey} onCreated={setCreated} />;
}

function RegisterForm({ onCreated }: { onCreated: (v: { res: CreateResponse; storage: string; recipient: Recipient | null }) => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const org = user?.organization;
  const orgApproved = org?.status === 'APPROVED';

  const recipients = useQuery({
    queryKey: ['transfers', 'recipients'],
    queryFn: () => api.get<{ items: Recipient[]; nextStage: OrgType | null }>('/transfers/recipients'),
    staleTime: 5 * 60_000,
  });
  const chain = useQuery({ queryKey: ['blockchain', 'status'], queryFn: () => api.get<ChainStatus>('/blockchain/status'), staleTime: 60_000 });

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      medicine: { name: '', genericName: '', category: '', categoryOther: '', dosageForm: '', strength: '', description: '', packagingRef: '' },
      batchNumber: '',
      manufacturerLicense: org?.licenseNumber ?? '',
      manufactureDate: '',
      expiryDate: '',
      quantity: '',
      unit: 'tablets',
      storagePresets: [],
      storageExtra: '',
      notes: '',
      initialRecipientId: '',
    },
  });

  const values = useWatch({ control });
  const life = shelfLife(values.manufactureDate ?? '', values.expiryDate ?? '');
  const today = todayUtc();
  const minExpiry = useMemo(() => {
    const base = values.manufactureDate && values.manufactureDate >= today ? values.manufactureDate : today;
    const d = new Date(`${base}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }, [values.manufactureDate, today]);

  const mutation = useMutation({
    mutationFn: (v: FormValues) =>
      api.post<CreateResponse>('/batches', {
        medicine: {
          name: v.medicine.name.trim(),
          genericName: v.medicine.genericName.trim(),
          category: v.medicine.category === OTHER ? v.medicine.categoryOther.trim() : v.medicine.category,
          dosageForm: v.medicine.dosageForm.trim() || null,
          strength: v.medicine.strength.trim() || null,
          description: v.medicine.description.trim() || null,
          packagingRef: v.medicine.packagingRef.trim() || null,
        },
        batchNumber: v.batchNumber.trim(),
        manufacturerLicense: v.manufacturerLicense.trim(),
        manufactureDate: v.manufactureDate,
        expiryDate: v.expiryDate,
        quantity: Number(v.quantity),
        unit: v.unit,
        storageConditions: composeStorage(v.storagePresets, v.storageExtra),
        notes: v.notes.trim() || null,
        initialRecipientId: v.initialRecipientId || null,
      }),
    onSuccess: (res, v) => {
      toast.success(`Batch ${res.batch.batchNumber} registered`, { description: `Public ID ${res.batch.publicId}` });
      void qc.invalidateQueries({ queryKey: ['batches'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      if (res.transfer) void qc.invalidateQueries({ queryKey: ['transfers'] });
      onCreated({
        res,
        storage: composeStorage(v.storagePresets, v.storageExtra),
        recipient: recipients.data?.items.find((r) => r.id === v.initialRecipientId) ?? null,
      });
    },
    onError: (e) => {
      let mapped = 0;
      if (e instanceof ApiError) {
        for (const [path, message] of Object.entries(e.fieldErrors)) {
          const f = serverPathToField(path);
          if (f) {
            setError(f, { type: 'server', message }, { shouldFocus: mapped === 0 });
            mapped++;
          }
        }
        if (e.code === 'DUPLICATE_BATCH') {
          setError('batchNumber', { type: 'server', message: e.message }, { shouldFocus: true });
          mapped++;
        } else if (e.code === 'INVALID_DATES') {
          setError('expiryDate', { type: 'server', message: e.message }, { shouldFocus: true });
          mapped++;
        }
      }
      setFormError(mapped > 0 ? 'Please correct the highlighted fields and try again.' : errorMessage(e, 'The batch could not be registered'));
      toast.error(mapped > 0 ? 'Some fields need attention' : errorMessage(e, 'Registration failed'));
    },
  });

  const onSubmit = (v: FormValues) => {
    setFormError(null);
    mutation.mutate(v);
  };
  const onInvalid = () => setFormError('Please correct the highlighted fields and try again.');

  const err = (path: string): string | undefined => {
    const parts = path.split('.');
    let cur: unknown = errors;
    for (const p of parts) cur = (cur as Record<string, unknown> | undefined)?.[p];
    return (cur as { message?: string } | undefined)?.message;
  };
  const a11y = (id: string, path: string) => ({ id, 'aria-invalid': !!err(path) || undefined, 'aria-describedby': `${id}-msg` });

  const selectedRecipient = recipients.data?.items.find((r) => r.id === values.initialRecipientId) ?? null;
  const storagePreview = composeStorage(values.storagePresets ?? [], values.storageExtra ?? '');

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Batches', to: '/app/batches' }, { label: 'Register batch' }]}
        title="Register a medicine batch"
        description="Create a tamper-evident record for a newly manufactured batch. Once registered, every custody change is appended to its hash-chained history and anchored to the ledger."
      />

      {!orgApproved && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Your organization is not approved yet, so batch registration is disabled until the regulator approves it.
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {/* 1. Medicine product */}
          <Card>
            <CardHeader icon={<Pill />} title="1. Medicine product" description="The product this batch belongs to. Existing products with the same name, generic name and strength are reused." />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <Field label="Brand / product name" htmlFor="med-name" required error={err('medicine.name')}>
                <Input {...a11y('med-name', 'medicine.name')} {...register('medicine.name')} placeholder="e.g. Amoxil" autoComplete="off" />
              </Field>
              <Field label="Generic name (INN)" htmlFor="med-generic" required error={err('medicine.genericName')}>
                <Input {...a11y('med-generic', 'medicine.genericName')} {...register('medicine.genericName')} placeholder="e.g. Amoxicillin" autoComplete="off" />
              </Field>
              <Field label="Therapeutic category" htmlFor="med-category" required error={err('medicine.category')}>
                <Select {...a11y('med-category', 'medicine.category')} {...register('medicine.category')}>
                  <option value="" disabled>
                    Select a category
                  </option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={OTHER}>Other…</option>
                </Select>
              </Field>
              {values.medicine?.category === OTHER && (
                <Field label="Category name" htmlFor="med-category-other" required error={err('medicine.categoryOther')}>
                  <Input {...a11y('med-category-other', 'medicine.categoryOther')} {...register('medicine.categoryOther')} placeholder="e.g. Antimalarial" />
                </Field>
              )}
              <Field label="Dosage form" htmlFor="med-form" error={err('medicine.dosageForm')} hint="Choose a suggestion or type your own">
                <Input {...a11y('med-form', 'medicine.dosageForm')} {...register('medicine.dosageForm')} list="dosage-forms" placeholder="e.g. Film-coated tablet" />
              </Field>
              <datalist id="dosage-forms">
                {DOSAGE_FORMS.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
              <Field label="Strength" htmlFor="med-strength" error={err('medicine.strength')} hint="Include units, e.g. 500 mg or 100 IU/ml">
                <Input {...a11y('med-strength', 'medicine.strength')} {...register('medicine.strength')} placeholder="e.g. 500 mg" />
              </Field>
              <Field label="Packaging reference" htmlFor="med-pack" error={err('medicine.packagingRef')} hint="Pack presentation or artwork code">
                <Input {...a11y('med-pack', 'medicine.packagingRef')} {...register('medicine.packagingRef')} placeholder="e.g. Blister 2×10, PK-AMX-500-20" />
              </Field>
              <Field label="Product description" htmlFor="med-desc" error={err('medicine.description')} className="sm:col-span-2">
                <Textarea {...a11y('med-desc', 'medicine.description')} {...register('medicine.description')} rows={3} placeholder="Optional. Indication or presentation details shown to supply-chain partners." />
              </Field>
            </CardBody>
          </Card>

          {/* 2. Batch */}
          <Card>
            <CardHeader icon={<Boxes />} title="2. Batch identification" description="The manufacturer details are taken from your verified organization profile." />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Batch / lot number"
                htmlFor="batch-number"
                required
                error={err('batchNumber')}
                hint={
                  values.batchNumber && values.batchNumber.trim() !== values.batchNumber.trim().toUpperCase()
                    ? `Will be stored as ${values.batchNumber.trim().toUpperCase()}`
                    : 'Letters, numbers, dashes, dots or slashes, e.g. AMX-2026-0915. Stored in upper case.'
                }
              >
                <Input {...a11y('batch-number', 'batchNumber')} {...register('batchNumber')} placeholder="AMX-2026-0915" className="font-mono" autoComplete="off" spellCheck={false} />
              </Field>
              <ReadOnlyField
                id="internal-id"
                label="Internal batch ID"
                value="Assigned on registration"
                hint="An opaque MC-XXXX-XXXX-XXXX identifier is generated by MediChain and printed in the QR code."
                icon={<Fingerprint />}
              />
              <ReadOnlyField id="manufacturer-name" label="Manufacturer" value={org?.name ?? '—'} hint="From your organization profile" icon={<Factory />} />
              <Field label="Manufacturing licence number" htmlFor="licence" required error={err('manufacturerLicense')} hint="Prefilled from your organization profile">
                <Input {...a11y('licence', 'manufacturerLicense')} {...register('manufacturerLicense')} className="font-mono" />
              </Field>
            </CardBody>
          </Card>

          {/* 3. Dates & quantity */}
          <Card>
            <CardHeader icon={<CalendarDays />} title="3. Dates & quantity" description="Expiry must be after the manufacturing date and in the future." />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <Field label="Manufacturing date" htmlFor="mfg-date" required error={err('manufactureDate')}>
                <Input type="date" max={today} {...a11y('mfg-date', 'manufactureDate')} {...register('manufactureDate')} />
              </Field>
              <Field label="Expiry date" htmlFor="exp-date" required error={err('expiryDate')}>
                <Input type="date" min={minExpiry} {...a11y('exp-date', 'expiryDate')} {...register('expiryDate')} />
              </Field>
              <div className="sm:col-span-2">
                <div className={cn('flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-4 py-3 text-[13px]', life ? 'border-line bg-canvas' : 'border-dashed border-line-strong bg-canvas')} aria-live="polite">
                  <span className="flex items-center gap-2 text-charcoal">
                    <CalendarDays className="size-4 text-muted" aria-hidden />
                    Shelf life:
                    <span className="font-semibold text-ink">{life ? life.label : '—'}</span>
                    {life && <span className="tabular text-muted">({formatNumber(life.days)} days)</span>}
                  </span>
                  {life && values.expiryDate && values.expiryDate > today && (
                    <span className="text-muted">
                      Expires {formatDate(values.expiryDate)} ·{' '}
                      <span className="tabular">{formatNumber(Math.round((new Date(`${values.expiryDate}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86_400_000))} days from today</span>
                    </span>
                  )}
                  {!life && <span className="text-muted">Enter both dates to calculate shelf life.</span>}
                </div>
              </div>
              <Field label="Quantity" htmlFor="quantity" required error={err('quantity')} hint="Total units produced in this batch">
                <Input type="number" inputMode="numeric" min={1} step={1} {...a11y('quantity', 'quantity')} {...register('quantity')} placeholder="e.g. 50000" className="tabular" />
              </Field>
              <Field label="Unit" htmlFor="unit" required error={err('unit')}>
                <Select {...a11y('unit', 'unit')} {...register('unit')}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </Field>
            </CardBody>
          </Card>

          {/* 4. Storage & notes */}
          <Card>
            <CardHeader icon={<Thermometer />} title="4. Storage & handling" description="Shown to every custodian and on the public verification page." />
            <CardBody className="space-y-5">
              <fieldset>
                <legend className="mb-2 text-[13px] font-medium text-charcoal">
                  Storage requirements<span className="ml-0.5 text-brand-ink" aria-hidden>*</span>
                </legend>
                <Controller
                  control={control}
                  name="storagePresets"
                  render={({ field }) => (
                    <div className="flex flex-wrap gap-2">
                      {STORAGE_PRESETS.map((p) => {
                        const on = field.value.includes(p);
                        return (
                          <button
                            key={p}
                            type="button"
                            aria-pressed={on}
                            onClick={() => field.onChange(on ? field.value.filter((x) => x !== p) : [...field.value, p])}
                            className={cn(
                              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
                              on ? 'border-brand/40 bg-brand-soft text-brand-ink' : 'border-line bg-surface text-charcoal hover:border-line-strong hover:bg-subtle',
                            )}
                          >
                            {on && <Check className="size-3.5" aria-hidden />}
                            {p}
                          </button>
                        );
                      })}
                    </div>
                  )}
                />
              </fieldset>
              <Field label="Additional storage instructions" htmlFor="storage-extra" error={err('storageExtra')} hint={storagePreview ? `Recorded as: “${storagePreview}”` : 'Select presets above and/or describe requirements here'}>
                <Input {...a11y('storage-extra', 'storageExtra')} {...register('storageExtra')} placeholder="e.g. Store upright; transport with temperature logger" />
              </Field>
              <Field label="Notes" htmlFor="notes" error={err('notes')} hint="Optional. Visible to supply-chain partners and regulators, not to the public.">
                <Textarea {...a11y('notes', 'notes')} {...register('notes')} rows={3} placeholder="e.g. Released by QP after stability review" />
              </Field>
            </CardBody>
          </Card>

          {/* 5. Initial distribution */}
          <Card>
            <CardHeader
              icon={<Truck />}
              title="5. Initial distribution"
              description="Optional. Start the first shipment immediately — the recipient must accept it before custody changes."
            />
            <CardBody>
              <Field
                label={recipients.data?.nextStage ? `Ship to ${ROLE_LABEL[recipients.data.nextStage].toLowerCase()}` : 'Ship to'}
                htmlFor="recipient"
                error={err('initialRecipientId') ?? (recipients.error ? `Could not load recipients: ${errorMessage(recipients.error)}` : undefined)}
                hint={
                  recipients.data && recipients.data.items.length === 0
                    ? 'No approved organizations are available for the next stage yet.'
                    : 'Only approved organizations at the next stage of the chain are listed.'
                }
              >
                <Select {...a11y('recipient', 'initialRecipientId')} {...register('initialRecipientId')} disabled={recipients.isLoading || !!recipients.error}>
                  <option value="">{recipients.isLoading ? 'Loading recipients…' : 'Keep in my custody — ship later'}</option>
                  {recipients.data?.items.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.city ? ` — ${r.city}` : ''} ({r.licenseNumber})
                    </option>
                  ))}
                </Select>
              </Field>
              {selectedRecipient && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-info-soft px-3.5 py-2.5 text-[13px] text-info">
                  <Truck className="mt-0.5 size-4 shrink-0" aria-hidden />
                  A pending shipment of the full quantity to {selectedRecipient.name} will be created. You remain the custodian until they accept it.
                </p>
              )}
            </CardBody>
          </Card>

          {formError && (
            <div role="alert" className="flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {formError}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Link to="/app/batches" className="sm:w-auto">
              <Button variant="outline" className="w-full sm:w-auto" disabled={mutation.isPending}>
                Cancel
              </Button>
            </Link>
            <Button type="submit" size="lg" loading={mutation.isPending} disabled={!orgApproved}>
              {!mutation.isPending && <PackagePlus />} Register batch
            </Button>
          </div>
        </div>

        {/* Side panel */}
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start" aria-label="Registration summary">
          <div className="space-y-6">
            <Card>
              <CardHeader icon={<FileText />} title="Summary" description="Review before registering" />
              <CardBody className="space-y-3 text-[13px]">
                <SummaryRow label="Medicine" value={values.medicine?.name ? `${values.medicine.name}${values.medicine.strength ? ` ${values.medicine.strength}` : ''}` : null} />
                <SummaryRow label="Generic" value={values.medicine?.genericName || null} />
                <SummaryRow label="Batch no." value={values.batchNumber ? values.batchNumber.trim().toUpperCase() : null} mono />
                <SummaryRow label="Quantity" value={values.quantity && /^\d+$/.test(values.quantity) ? `${formatNumber(Number(values.quantity))} ${values.unit}` : null} />
                <SummaryRow label="Expiry" value={values.expiryDate ? formatDate(values.expiryDate) : null} />
                <SummaryRow label="Shelf life" value={life?.label ?? null} />
                <SummaryRow label="Ship to" value={selectedRecipient?.name ?? 'Keep in custody'} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader icon={<Link2 />} title="What happens next" />
              <CardBody>
                <ol className="space-y-4">
                  <Step icon={Database} title="Database record" text="The batch and product are saved, and a fingerprint (data hash) of the key batch facts is computed." />
                  <Step icon={Fingerprint} title="Hash-chained event" text="A REGISTERED event is appended to the batch history, linked to the previous event by its hash." />
                  <Step
                    icon={Link2}
                    title={chain.data?.mode === 'ONCHAIN' ? 'Blockchain anchor' : chain.data?.mode === 'SIMULATION' ? 'Ledger anchor (simulated)' : 'Ledger anchor'}
                    text={
                      chain.data?.mode === 'ONCHAIN'
                        ? 'The event hash is submitted to the smart contract; the transaction hash and block number appear once confirmed.'
                        : chain.data?.mode === 'SIMULATION'
                          ? 'Simulation mode: the event hash is written to a tamper-evident ledger in the database and receives a SIM- reference, not a blockchain transaction.'
                          : 'The event hash is anchored to the configured ledger.'
                    }
                  />
                  <Step icon={QrCode} title="QR code" text="A QR code linking to the public verification page is generated for pack labels." />
                  {selectedRecipient && <Step icon={Truck} title="Shipment initiated" text={`A pending transfer to ${selectedRecipient.name} is recorded.`} />}
                </ol>
                <p className="mt-5 flex items-start gap-2 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">
                  <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  A registered record proves what was declared and when — not the physical authenticity of the product.
                </p>
              </CardBody>
            </Card>
          </div>
        </aside>
      </form>
    </>
  );
}

function ReadOnlyField({ id, label, value, hint, icon }: { id: string; label: string; value: string; hint?: string; icon?: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-charcoal">
        {label}
      </label>
      <Input id={id} value={value} readOnly aria-readonly="true" aria-describedby={hint ? `${id}-msg` : undefined} leftIcon={icon} className="bg-subtle text-charcoal hover:border-line focus:border-line" />
      {hint && (
        <p id={`${id}-msg`} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-muted">{label}</span>
      <span className={cn('min-w-0 truncate text-right', value ? 'font-medium text-ink' : 'text-muted', mono && value && 'font-mono text-[12.5px]')} title={value ?? undefined}>
        {value ?? '—'}
      </span>
    </div>
  );
}

function Step({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-subtle text-charcoal">
        <Icon className="size-4" aria-hidden />
      </span>
      <div>
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{text}</p>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Success                                                             */
/* ------------------------------------------------------------------ */

function RegistrationSuccess({
  result,
  storage,
  recipient,
  onRegisterAnother,
}: {
  result: CreateResponse;
  storage: string;
  recipient: Recipient | null;
  onRegisterAnother: () => void;
}) {
  const { batch, verificationUrl, transfer } = result;
  const { print, portal, printing } = usePrintContent();
  const [downloading, setDownloading] = useState(false);
  const chain = useQuery({ queryKey: ['blockchain', 'status'], queryFn: () => api.get<ChainStatus>('/blockchain/status'), staleTime: 60_000 });

  const downloadPng = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/batches/${encodeURIComponent(batch.id)}/qr?format=png`, `medichain-${batch.publicId}.png`);
      toast.success('QR code downloaded');
    } catch (e) {
      toast.error(errorMessage(e, 'Download failed'));
    } finally {
      setDownloading(false);
    }
  };

  const printLabel = () =>
    print(
      <BatchLabel
        data={{
          publicId: batch.publicId,
          verificationUrl,
          medicineName: batch.medicine.name,
          strength: batch.medicine.strength,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          manufacturerName: batch.manufacturer.name,
        }}
      />,
    );

  return (
    <div className="animate-slide-up">
      <PageHeader breadcrumbs={[{ label: 'Batches', to: '/app/batches' }, { label: 'Register batch' }]} title="Batch registered" />

      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-line bg-success-soft/60 px-5 py-5 sm:flex-row sm:items-center">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-success text-white">
            <CheckCircle2 className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1" role="status">
            <h2 className="text-lg font-semibold">
              {batch.medicine.name} {batch.medicine.strength} · batch {batch.batchNumber} is now on record
            </h2>
            <p className="mt-0.5 text-sm text-charcoal">
              Public ID <span className="font-mono font-semibold text-ink">{batch.publicId}</span>. Its registration event has been hash-chained and queued for{' '}
              {chain.data?.mode === 'ONCHAIN' ? 'blockchain anchoring' : 'anchoring in the simulated ledger'}.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 px-5 py-4">
          <Link to={`/app/batches/${batch.id}`}>
            <Button>
              View batch details <ArrowRight />
            </Button>
          </Link>
          <Button variant="outline" onClick={downloadPng} loading={downloading}>
            {!downloading && <Download />} Download QR (PNG)
          </Button>
          <Button variant="outline" onClick={printLabel} loading={printing}>
            {!printing && <Printer />} Print label
          </Button>
          <Button variant="ghost" onClick={onRegisterAnother} className="sm:ml-auto">
            <RotateCcw /> Register another
          </Button>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader icon={<Boxes />} title="Batch summary" />
            <CardBody>
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <Fact label="Medicine" value={`${batch.medicine.name} ${batch.medicine.strength}`.trim()} sub={batch.medicine.genericName} />
                <Fact label="Category / form" value={batch.medicine.category} sub={batch.medicine.dosageForm ?? undefined} />
                <Fact label="Batch number" value={<span className="font-mono">{batch.batchNumber}</span>} />
                <Fact label="Public batch ID" value={<span className="font-mono">{batch.publicId}</span>} />
                <Fact label="Manufacturer" value={batch.manufacturer.name} />
                <Fact label="Quantity" value={`${formatNumber(batch.quantity)} ${batch.unit}`} />
                <Fact label="Manufactured" value={formatDate(batch.manufactureDate)} />
                <Fact label="Expiry" value={formatDate(batch.expiryDate)} sub={shelfLife(batch.manufactureDate, batch.expiryDate)?.label ? `Shelf life ${shelfLife(batch.manufactureDate, batch.expiryDate)?.label}` : undefined} />
                <Fact label="Storage" value={storage} className="sm:col-span-2" />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon={<Link2 />} title="Record trail" description="What MediChain recorded for this registration" />
            <CardBody>
              <ul className="space-y-3 text-[13px]">
                <TrailItem done title="Database record created" text="Batch, product and data hash stored." />
                <TrailItem done title="REGISTERED event appended" text="Hash-linked to the batch's event chain (sequence 1)." />
                <TrailItem
                  title={chain.data?.mode === 'ONCHAIN' ? 'Blockchain anchor submitted' : 'Simulated ledger anchor queued'}
                  text={
                    chain.data?.mode === 'ONCHAIN'
                      ? 'The transaction hash and block number appear in the event log once the transaction is confirmed.'
                      : 'A SIM- reference is assigned in the tamper-evident database ledger. This is not a blockchain transaction.'
                  }
                />
                <TrailItem done title="QR code generated" text="Encodes the public verification URL only." />
                {transfer && (
                  <TrailItem
                    done
                    title={`Shipment ${transfer.reference} initiated`}
                    text={`Awaiting acceptance by ${recipient?.name ?? 'the recipient'}. You remain the custodian until then.`}
                  />
                )}
              </ul>
            </CardBody>
          </Card>
        </div>

        <Card className="lg:self-start">
          <CardHeader icon={<QrCode />} title="Verification QR code" description="Print on packs and shipping cartons" />
          <CardBody>
            <QRCodePanel publicId={batch.publicId} verificationUrl={verificationUrl} batchNumber={batch.batchNumber} medicineName={batch.medicine.name} size={208} />
          </CardBody>
        </Card>
      </div>
      {portal}
    </div>
  );
}

function Fact({ label, value, sub, className }: { label: string; value: ReactNode; sub?: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[12px] font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{value}</dd>
      {sub && <dd className="text-[12px] text-muted">{sub}</dd>}
    </div>
  );
}

function TrailItem({ title, text, done }: { title: string; text: string; done?: boolean }) {
  return (
    <li className="flex gap-3">
      <span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full', done ? 'bg-success text-white' : 'border border-dashed border-warning bg-warning-soft text-warning-ink')}>
        {done ? <Check className="size-3" aria-hidden /> : <span className="size-1.5 rounded-full bg-warning" aria-hidden />}
      </span>
      <div>
        <p className="font-semibold text-ink">
          {title}
          {!done && (
            <Badge tone="warning" className="ml-2 align-middle">
              In progress
            </Badge>
          )}
        </p>
        <p className="mt-0.5 text-muted">{text}</p>
      </div>
    </li>
  );
}
