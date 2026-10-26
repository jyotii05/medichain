/**
 * DEVELOPMENT / DEMONSTRATION DATA ONLY.
 *
 * Every organization, person and medicine batch below is fictional. Records are flagged isDemo=true.
 * Sample batches are created through the same service functions the API uses, so they follow the
 * same business rules, event hashing and ledger anchoring — except for one deliberately corrupted
 * scenario (see "incomplete journey") that exists to demonstrate how inconsistencies are detected.
 */
import bcrypt from 'bcryptjs';
import type { Organization, OrganizationType, Prisma, PrismaClient } from '@prisma/client';
import { orgChainRef } from '../lib/hash.js';
import { registerBatch, type Actor, type RegisterBatchInput } from '../services/batches.js';
import { initiateTransfer, respondToTransfer } from '../services/transfers.js';
import { recallBatch } from '../services/recalls.js';
import { flagBatch, dispenseFromBatch } from '../services/batches.js';
import { assessBatch, loadBatchForAssessment } from '../services/assessment.js';

export const DEMO_PASSWORD = 'MediChain@2026';

interface OrgSeed {
  key: string;
  name: string;
  type: OrganizationType;
  status: 'APPROVED' | 'PENDING';
  licenseNumber: string;
  city: string;
  country: string;
  email: string;
  addressLine: string;
}

const ORGS: OrgSeed[] = [
  { key: 'reg', name: 'Meridian Medicines Authority', type: 'REGULATOR', status: 'APPROVED', licenseNumber: 'REG-MMA-0001', city: 'Riverton', country: 'Meridia', email: 'oversight@mma.demo', addressLine: '1 Regulatory Plaza' },
  { key: 'aur', name: 'Aurelia Pharmaceuticals Ltd.', type: 'MANUFACTURER', status: 'APPROVED', licenseNumber: 'MFG-AUR-2041', city: 'Westhaven', country: 'Meridia', email: 'quality@aurelia.demo', addressLine: '45 Foundry Road' },
  { key: 'nwb', name: 'Northwind Biologics', type: 'MANUFACTURER', status: 'APPROVED', licenseNumber: 'MFG-NWB-3310', city: 'Lakeport', country: 'Meridia', email: 'compliance@northwind.demo', addressLine: '12 Harbour Science Park' },
  { key: 'crg', name: 'Crestline Generics', type: 'MANUFACTURER', status: 'PENDING', licenseNumber: 'MFG-CRG-7782', city: 'Ashford', country: 'Meridia', email: 'regulatory@crestline.demo', addressLine: '8 Millbrook Industrial Estate' },
  { key: 'hbl', name: 'Harbourline Distribution Co.', type: 'DISTRIBUTOR', status: 'APPROVED', licenseNumber: 'DST-HBL-1180', city: 'Lakeport', country: 'Meridia', email: 'ops@harbourline.demo', addressLine: '200 Dockside Avenue' },
  { key: 'spl', name: 'Summit Pharma Logistics', type: 'DISTRIBUTOR', status: 'APPROVED', licenseNumber: 'DST-SPL-2290', city: 'Highmoor', country: 'Meridia', email: 'dispatch@summit.demo', addressLine: '3 Ridgeway Distribution Park' },
  { key: 'gfm', name: 'Greenfield Medical Wholesale', type: 'WHOLESALER', status: 'APPROVED', licenseNumber: 'WHL-GFM-5520', city: 'Riverton', country: 'Meridia', email: 'orders@greenfield.demo', addressLine: '77 Market Street' },
  { key: 'rps', name: 'Riverside Pharma Supplies', type: 'WHOLESALER', status: 'APPROVED', licenseNumber: 'WHL-RPS-6630', city: 'Westhaven', country: 'Meridia', email: 'supply@riverside.demo', addressLine: '19 Quay Lane' },
  { key: 'ccp', name: 'CityCare Pharmacy — Central', type: 'PHARMACY', status: 'APPROVED', licenseNumber: 'PHM-CCP-0907', city: 'Riverton', country: 'Meridia', email: 'central@citycare.demo', addressLine: '5 Cathedral Square' },
  { key: 'ocp', name: 'Oakwood Community Pharmacy', type: 'PHARMACY', status: 'APPROVED', licenseNumber: 'PHM-OCP-1144', city: 'Ashford', country: 'Meridia', email: 'hello@oakwood.demo', addressLine: '22 Oakwood Parade' },
];

const USERS = [
  { email: 'regulator@medichain.demo', fullName: 'Dr. Amara Okafor', org: 'reg', title: 'Head of Market Surveillance' },
  { email: 'manufacturer@medichain.demo', fullName: 'Daniel Reyes', org: 'aur', title: 'Quality Assurance Manager' },
  { email: 'northwind@medichain.demo', fullName: 'Hannah Lindqvist', org: 'nwb', title: 'Release Officer' },
  { email: 'crestline@medichain.demo', fullName: 'Victor Hale', org: 'crg', title: 'Regulatory Affairs Lead' },
  { email: 'distributor@medichain.demo', fullName: 'Priya Natarajan', org: 'hbl', title: 'Warehouse Supervisor' },
  { email: 'summit@medichain.demo', fullName: 'Marcus Webb', org: 'spl', title: 'Logistics Coordinator' },
  { email: 'wholesaler@medichain.demo', fullName: 'Sofia Marquez', org: 'gfm', title: 'Inbound Logistics Lead' },
  { email: 'riverside@medichain.demo', fullName: 'Tomás Novak', org: 'rps', title: 'Procurement Manager' },
  { email: 'pharmacy@medichain.demo', fullName: 'James Whitfield', org: 'ccp', title: 'Pharmacist in Charge' },
  { email: 'oakwood@medichain.demo', fullName: 'Leila Haddad', org: 'ocp', title: 'Community Pharmacist' },
] as const;

export async function seedBase(prisma: PrismaClient, opts: { bcryptCost?: number } = {}) {
  const orgs: Record<string, Organization> = {};
  for (const o of ORGS) {
    const { key, ...data } = o;
    const existing = await prisma.organization.findUnique({ where: { licenseNumber: o.licenseNumber } });
    orgs[key] =
      existing ??
      (await prisma.organization
        .create({ data: { ...data, chainRef: 'pending', isDemo: true, approvedAt: o.status === 'APPROVED' ? new Date() : null } })
        .then((c) => prisma.organization.update({ where: { id: c.id }, data: { chainRef: orgChainRef(c.id) } })));
  }
  const hash = await bcrypt.hash(DEMO_PASSWORD, opts.bcryptCost ?? 10);
  const users: Record<string, { id: string; orgKey: string }> = {};
  for (const u of USERS) {
    const org = orgs[u.org];
    const existing = await prisma.user.findUnique({ where: { email: u.email } });
    const user =
      existing ??
      (await prisma.user.create({
        data: {
          email: u.email,
          fullName: u.fullName,
          passwordHash: hash,
          role: org.type,
          isDemo: true,
          membership: { create: { organizationId: org.id, title: u.title } },
        },
      }));
    users[u.email] = { id: user.id, orgKey: u.org };
  }
  return { orgs, users };
}

const DAY = 86_400_000;
const daysAgo = (n: number, hour = 10) => {
  const d = new Date(Date.now() - n * DAY);
  d.setUTCHours(hour, (n * 7) % 60, 0, 0);
  // never date sample records in the future
  return d.getTime() > Date.now() ? new Date(Date.now() - 60_000) : d;
};
const dateOnly = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

export async function hasSampleData(prisma: PrismaClient) {
  return (await prisma.medicineBatch.count({ where: { isDemo: true } })) > 0;
}

/** Creates the demonstration scenarios. Idempotent: does nothing if demo batches already exist. */
export async function seedSampleData(prisma: PrismaClient, opts: { bcryptCost?: number } = {}) {
  if (await hasSampleData(prisma)) return { created: 0, skipped: true };
  const { orgs, users } = await seedBase(prisma, opts);
  const actor = (email: string): Actor => {
    const u = users[email];
    return { userId: u.id, org: orgs[u.orgKey] };
  };
  const reg = actor('regulator@medichain.demo');
  const aur = actor('manufacturer@medichain.demo');
  const nwb = actor('northwind@medichain.demo');
  const hbl = actor('distributor@medichain.demo');
  const spl = actor('summit@medichain.demo');
  const gfm = actor('wholesaler@medichain.demo');
  const rps = actor('riverside@medichain.demo');
  const ccp = actor('pharmacy@medichain.demo');
  const ocp = actor('oakwood@medichain.demo');

  const tx = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn, { timeout: 30_000 });

  const register = (a: Actor, input: Omit<RegisterBatchInput, 'manufacturerLicense'>, at: Date) =>
    tx((t) => registerBatch(t, { ...input, manufacturerLicense: a.org.licenseNumber }, a, { createdAt: at, isDemo: true }));
  const ship = (from: Actor, batchId: string, to: Actor, at: Date, notes?: string) =>
    tx((t) => initiateTransfer(t, { batchId, toOrgId: to.org.id, notes }, from, { createdAt: at }));
  const accept = (to: Actor, transferId: string, at: Date) => tx((t) => respondToTransfer(t, { transferId, accept: true }, to, { createdAt: at }));
  const reject = (to: Actor, transferId: string, note: string, at: Date) =>
    tx((t) => respondToTransfer(t, { transferId, accept: false, note }, to, { createdAt: at }));
  const move = async (from: Actor, batchId: string, to: Actor, sentDaysAgo: number, receivedDaysAgo: number) => {
    const t = await ship(from, batchId, to, daysAgo(sentDaysAgo, 9));
    await accept(to, t.id, daysAgo(receivedDaysAgo, 15));
  };

  // 1. Normally tracked batch — complete journey to a pharmacy.
  const amox = await register(aur, {
    medicine: { name: 'Amoxil-A', genericName: 'Amoxicillin', category: 'Antibiotic', dosageForm: 'Capsule', strength: '500 mg', description: 'Broad-spectrum penicillin antibiotic.', packagingRef: 'Blister 3×7' },
    batchNumber: 'AMX-2026-0915', manufactureDate: dateOnly(-75), expiryDate: dateOnly(650), quantity: 12000, unit: 'capsules', storageConditions: 'Store below 25 °C in a dry place', notes: 'Demonstration batch',
  }, daysAgo(58));
  await move(aur, amox.id, hbl, 55, 54);
  await move(hbl, amox.id, gfm, 48, 47);
  await move(gfm, amox.id, ccp, 40, 39);
  await tx((t) => dispenseFromBatch(t, amox.id, 2400, ccp));

  // 2. Batch with a pending transfer (distributor → wholesaler, in transit).
  const para = await register(aur, {
    medicine: { name: 'Paracel', genericName: 'Paracetamol', category: 'Analgesic', dosageForm: 'Tablet', strength: '500 mg', packagingRef: 'Box of 100' },
    batchNumber: 'PCM-2026-1102', manufactureDate: dateOnly(-30), expiryDate: dateOnly(1050), quantity: 50000, unit: 'tablets', storageConditions: 'Store below 30 °C',
  }, daysAgo(26));
  await move(aur, para.id, hbl, 22, 21);
  await ship(hbl, para.id, gfm, daysAgo(1, 8), 'Temperature logger attached');

  // 3. Recalled batch (Class II) held by a wholesaler.
  const ator = await register(nwb, {
    medicine: { name: 'Lipitra', genericName: 'Atorvastatin', category: 'Cardiovascular', dosageForm: 'Tablet', strength: '20 mg', packagingRef: 'Blister 4×7' },
    batchNumber: 'ATV-2026-0420', manufactureDate: dateOnly(-120), expiryDate: dateOnly(600), quantity: 8000, unit: 'tablets', storageConditions: 'Store below 25 °C',
  }, daysAgo(52));
  await move(nwb, ator.id, spl, 50, 49);
  await move(spl, ator.id, rps, 44, 43);
  await tx((t) =>
    recallBatch(t, { batchId: ator.id, action: 'RECALL', classification: 'CLASS_II', reason: 'Out-of-specification dissolution results found in stability testing.' }, reg, { createdAt: daysAgo(6, 11) }),
  );

  // 4. Expired batch still recorded at a pharmacy.
  const metf = await register(aur, {
    medicine: { name: 'Glucomet', genericName: 'Metformin hydrochloride', category: 'Antidiabetic', dosageForm: 'Tablet', strength: '850 mg', packagingRef: 'Box of 60' },
    batchNumber: 'MTF-2023-0611', manufactureDate: dateOnly(-1100), expiryDate: dateOnly(-20), quantity: 6000, unit: 'tablets', storageConditions: 'Store below 25 °C',
  }, daysAgo(59));
  await move(aur, metf.id, hbl, 57, 57);
  await move(hbl, metf.id, gfm, 53, 52);
  await move(gfm, metf.id, ocp, 46, 45);

  // 5. Incomplete journey — DELIBERATELY INCONSISTENT DEMO RECORD.
  //    The batch reaches a distributor through the normal workflow, then its custodian is changed directly
  //    in the database (bypassing the transfer workflow). Verification must detect the missing stages.
  const insu = await register(nwb, {
    medicine: { name: 'Glargena', genericName: 'Insulin glargine', category: 'Antidiabetic', dosageForm: 'Pre-filled pen', strength: '100 IU/mL', packagingRef: '5 × 3 mL pens' },
    batchNumber: 'INS-2026-0077', manufactureDate: dateOnly(-40), expiryDate: dateOnly(320), quantity: 1500, unit: 'pens', storageConditions: 'Refrigerate at 2–8 °C. Do not freeze.',
  }, daysAgo(35));
  await move(nwb, insu.id, spl, 33, 32);
  await prisma.medicineBatch.update({ where: { id: insu.id }, data: { currentCustodianId: ocp.org.id } });

  // 6. Freshly registered batch at the manufacturer.
  await register(aur, {
    medicine: { name: 'Omezol', genericName: 'Omeprazole', category: 'Gastrointestinal', dosageForm: 'Gastro-resistant capsule', strength: '20 mg', packagingRef: 'Bottle of 28' },
    batchNumber: 'OMP-2026-1001', manufactureDate: dateOnly(-5), expiryDate: dateOnly(725), quantity: 20000, unit: 'capsules', storageConditions: 'Store below 25 °C, protect from moisture',
  }, daysAgo(3));

  // 7. Rejected shipment followed by a successful re-route.
  const salb = await register(nwb, {
    medicine: { name: 'Respira', genericName: 'Salbutamol', category: 'Respiratory', dosageForm: 'Metered-dose inhaler', strength: '100 mcg/dose', packagingRef: '200-dose inhaler' },
    batchNumber: 'SAL-2026-0310', manufactureDate: dateOnly(-60), expiryDate: dateOnly(540), quantity: 3000, unit: 'inhalers', storageConditions: 'Store below 30 °C. Do not puncture.',
  }, daysAgo(30));
  await move(nwb, salb.id, hbl, 28, 27);
  const rej = await ship(hbl, salb.id, gfm, daysAgo(20, 9));
  await reject(gfm, rej.id, 'Outer cartons damaged in transit — refused on arrival', daysAgo(19, 14));
  await move(hbl, salb.id, rps, 17, 16);

  // 8. Batch flagged by a pharmacy (open suspicion report).
  const cipro = await register(aur, {
    medicine: { name: 'Ciproxa', genericName: 'Ciprofloxacin', category: 'Antibiotic', dosageForm: 'Tablet', strength: '500 mg', packagingRef: 'Blister 1×10' },
    batchNumber: 'CIP-2026-0505', manufactureDate: dateOnly(-90), expiryDate: dateOnly(630), quantity: 9000, unit: 'tablets', storageConditions: 'Store below 25 °C',
  }, daysAgo(45));
  await move(aur, cipro.id, spl, 43, 42);
  await move(spl, cipro.id, rps, 36, 35);
  await move(rps, cipro.id, ocp, 29, 28);
  await tx(async (t) => {
    const b = await t.medicineBatch.findUniqueOrThrow({ where: { id: cipro.id } });
    return flagBatch(t, b, 'Patients reported tablets with a different imprint and colour than the reference pack.', ocp);
  });

  // 9. Newly shipped from the manufacturer — awaiting distributor acceptance.
  const azi = await register(aur, {
    medicine: { name: 'Azitra', genericName: 'Azithromycin', category: 'Antibiotic', dosageForm: 'Tablet', strength: '250 mg', packagingRef: 'Blister 1×6' },
    batchNumber: 'AZM-2026-0921', manufactureDate: dateOnly(-14), expiryDate: dateOnly(700), quantity: 7200, unit: 'tablets', storageConditions: 'Store below 30 °C',
  }, daysAgo(9));
  await ship(aur, azi.id, hbl, daysAgo(2, 10), 'Initial distribution');

  // 10. Regulatory block while held by a distributor.
  const losa = await register(nwb, {
    medicine: { name: 'Losarta', genericName: 'Losartan potassium', category: 'Cardiovascular', dosageForm: 'Tablet', strength: '50 mg', packagingRef: 'Blister 3×10' },
    batchNumber: 'LOS-2026-0218', manufactureDate: dateOnly(-50), expiryDate: dateOnly(680), quantity: 10000, unit: 'tablets', storageConditions: 'Store below 25 °C',
  }, daysAgo(24));
  await move(nwb, losa.id, hbl, 21, 20);
  await tx((t) =>
    recallBatch(t, { batchId: losa.id, action: 'BLOCK', classification: 'CLASS_I', reason: 'Precautionary hold pending investigation of a nitrosamine impurity notice.' }, reg, { createdAt: daysAgo(4, 16) }),
  );

  // 11–12. Extra active stock for realistic tables.
  const ibu = await register(aur, {
    medicine: { name: 'Ibufen', genericName: 'Ibuprofen', category: 'Analgesic', dosageForm: 'Tablet', strength: '400 mg', packagingRef: 'Box of 24' },
    batchNumber: 'IBU-2026-0814', manufactureDate: dateOnly(-35), expiryDate: dateOnly(75), quantity: 30000, unit: 'tablets', storageConditions: 'Store below 25 °C',
  }, daysAgo(31));
  await move(aur, ibu.id, spl, 27, 26);
  await move(spl, ibu.id, gfm, 15, 14);
  await move(gfm, ibu.id, ccp, 8, 7);

  const cet = await register(nwb, {
    medicine: { name: 'Cetrizal', genericName: 'Cetirizine', category: 'Antihistamine', dosageForm: 'Tablet', strength: '10 mg', packagingRef: 'Blister 1×10' },
    batchNumber: 'CTZ-2026-0630', manufactureDate: dateOnly(-20), expiryDate: dateOnly(900), quantity: 25000, unit: 'tablets', storageConditions: 'Store below 30 °C',
  }, daysAgo(12));
  await move(nwb, cet.id, hbl, 10, 9);

  // Sample public verification history (results computed from each batch's real assessment).
  const all = [amox, para, ator, metf, insu, salb, cipro, azi, losa, ibu, cet];
  let n = 0;
  for (const [i, b] of all.entries()) {
    const loaded = await loadBatchForAssessment({ id: b.id });
    const a = await assessBatch(loaded!, { includeChain: false });
    const count = 2 + ((i * 5) % 7);
    for (let k = 0; k < count; k++) {
      await prisma.verificationAttempt.create({
        data: { batchId: b.id, queriedId: b.publicId, result: a.result, reasons: a.reasons, channel: 'PUBLIC', createdAt: daysAgo((i * 3 + k * 4) % 28, 9 + (k % 9)) },
      });
      n++;
    }
  }
  for (const [k, fake] of ['MC-0000-0000-0000', 'MC-FAKE-CODE-1234', 'AMX-2026-0915', 'MC-9X9X-9X9X-9X9X'].entries()) {
    await prisma.verificationAttempt.create({
      data: { queriedId: fake, result: 'UNKNOWN', reasons: ['No batch with this identifier has been registered by an approved manufacturer'], channel: 'PUBLIC', createdAt: daysAgo(k * 5 + 1, 13) },
    });
    n++;
  }
  return { created: all.length + 1, skipped: false, verificationAttempts: n };
}
