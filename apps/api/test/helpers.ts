import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { DEMO_PASSWORD, seedBase, seedSampleData } from '../src/seed/demo.js';

export { prisma, DEMO_PASSWORD };

export const app: Express = createApp();

const TABLES = [
  'VerificationAttempt',
  'Notification',
  'AuditLog',
  'BlockchainTransaction',
  'SupplyChainEvent',
  'BatchFlag',
  'RecallRecord',
  'CustodyTransfer',
  'MedicineBatch',
  'Medicine',
  'OrganizationMembership',
  'User',
  'Organization',
];

/** Empties every application table. TRUNCATE is not affected by the row-level append-only triggers. */
export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes('medichain_test')) throw new Error('resetDb() refused: not the test database');
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (db !== 'medichain_test') throw new Error(`resetDb() refused: connected to "${db}", not medichain_test`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export const seedDemoBase = () => seedBase(prisma, { bcryptCost: 4 });
export const seedDemoSamples = () => seedSampleData(prisma, { bcryptCost: 4 });

/** Fresh database with the demo organizations and users (no batches). */
export async function freshBase() {
  await resetDb();
  return seedDemoBase();
}

export const email = (name: string) => `${name}@medichain.demo`;

export type Agent = ReturnType<typeof request.agent>;

export interface Session {
  agent: Agent;
  csrf: string;
  user: { id: string; email: string; role: string; organization: { id: string; name: string; type: string; status: string } };
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
}

/** Signs in a demo user. The agent keeps the mc_session / mc_csrf cookies; mutating helpers add X-CSRF-Token. */
export async function login(who: string, password = DEMO_PASSWORD): Promise<Session> {
  const addr = who.includes('@') ? who : email(who);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: addr, password });
  if (res.status !== 200) throw new Error(`login(${addr}) failed: ${res.status} ${JSON.stringify(res.body)}`);
  const csrf: string = res.body.csrfToken;
  return {
    agent,
    csrf,
    user: res.body.user,
    get: (url) => agent.get(url),
    post: (url, body = {}) => agent.post(url).set('X-CSRF-Token', csrf).send(body),
    patch: (url, body = {}) => agent.patch(url).set('X-CSRF-Token', csrf).send(body),
  };
}

const DAY = 86_400_000;
/** YYYY-MM-DD for today (UTC) + offset days. */
export function isoDay(offsetDays: number) {
  return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
}

let counter = 0;
/** A valid batch-registration payload for the Aurelia manufacturer (licence MFG-AUR-2041). */
export function batchPayload(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    medicine: {
      name: 'Testamol',
      genericName: 'Paracetamol',
      category: 'Analgesic',
      dosageForm: 'Tablet',
      strength: '500 mg',
    },
    batchNumber: `TST-${Date.now().toString(36).toUpperCase()}-${counter}`,
    manufacturerLicense: 'MFG-AUR-2041',
    manufactureDate: isoDay(-10),
    expiryDate: isoDay(365),
    quantity: 1000,
    unit: 'tablets',
    storageConditions: 'Store below 25 °C',
    ...overrides,
  };
}

export async function orgByLicense(licenseNumber: string) {
  return prisma.organization.findUniqueOrThrow({ where: { licenseNumber } });
}

export const LICENSE = {
  regulator: 'REG-MMA-0001',
  aurelia: 'MFG-AUR-2041',
  northwind: 'MFG-NWB-3310',
  crestline: 'MFG-CRG-7782',
  harbourline: 'DST-HBL-1180',
  summit: 'DST-SPL-2290',
  greenfield: 'WHL-GFM-5520',
  riverside: 'WHL-RPS-6630',
  citycare: 'PHM-CCP-0907',
  oakwood: 'PHM-OCP-1144',
} as const;

/** Registers a batch as the given manufacturer session and returns the API batch row. */
export async function registerBatch(s: Session, overrides: Record<string, unknown> = {}) {
  const res = await s.post('/api/batches', batchPayload(overrides));
  if (res.status !== 201) throw new Error(`registerBatch failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.batch as { id: string; publicId: string; batchNumber: string; status: string };
}

/** Ships a batch from `from` to the org with `toLicense` and has `to` accept it. */
export async function moveBatch(from: Session, to: Session, batchId: string) {
  const t = await from.post('/api/transfers', { batchId, toOrgId: to.user.organization.id });
  if (t.status !== 201) throw new Error(`transfer failed: ${t.status} ${JSON.stringify(t.body)}`);
  const a = await to.post(`/api/transfers/${t.body.transfer.id}/accept`);
  if (a.status !== 200) throw new Error(`accept failed: ${a.status} ${JSON.stringify(a.body)}`);
  return t.body.transfer.id as string;
}
