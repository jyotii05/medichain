import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, login, prisma, registerBatch, resetDb, seedDemoSamples, type Session } from './helpers.js';
import { csvCell } from '../src/modules/reports.js';
import { startOfTodayUtc } from '../src/services/batches.js';

let regulator: Session;
let manufacturer: Session;
let distributor: Session;

beforeAll(async () => {
  await resetDb();
  await seedDemoSamples();
  [regulator, manufacturer, distributor] = await Promise.all(['regulator', 'manufacturer', 'distributor'].map((u) => login(u)));
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Reads a text response body regardless of content type. */
const asText = (r: request.Test) =>
  r.buffer(true).parse((res, cb) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (c: string) => (data += c));
    res.on('end', () => cb(null, data));
  });

/** Minimal RFC-4180 parser for assertions. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

describe('GET /api/dashboard', () => {
  it('regulator stats are computed from the data', async () => {
    const res = await regulator.get('/api/dashboard');
    expect(res.status).toBe(200);
    const s = res.body.stats;
    const today = startOfTodayUtc();
    const [total, recalled, blocked, expired, inTransit, pending, openFlags, pendingOrgs] = await Promise.all([
      prisma.medicineBatch.count(),
      prisma.medicineBatch.count({ where: { status: 'RECALLED' } }),
      prisma.medicineBatch.count({ where: { status: 'BLOCKED' } }),
      prisma.medicineBatch.count({ where: { status: 'ACTIVE', expiryDate: { lt: today } } }),
      prisma.medicineBatch.count({ where: { status: 'ACTIVE', expiryDate: { gte: today }, transfers: { some: { status: 'PENDING' } } } }),
      prisma.custodyTransfer.count({ where: { status: 'PENDING' } }),
      prisma.batchFlag.count({ where: { status: 'OPEN' } }),
      prisma.organization.count({ where: { status: 'PENDING' } }),
    ]);
    // sanity-check the sample data itself
    expect(total).toBe(12);
    expect(recalled + blocked).toBe(2);
    expect(expired).toBe(1);
    expect(inTransit).toBe(2);

    expect(s.totalBatches).toBe(total);
    expect(s.recalledBatches).toBe(recalled + blocked);
    expect(s.expiredBatches).toBe(expired);
    expect(s.inTransit).toBe(inTransit);
    expect(s.pendingTransfers).toBe(pending);
    expect(s.openFlags).toBe(openFlags);
    expect(s.openFlags).toBe(1);
    expect(s.pendingOrganizations).toBe(pendingOrgs);
    expect(s.pendingOrganizations).toBe(1);
    expect(s.activeBatches).toBe(total - recalled - blocked - expired - inTransit);

    const dist = Object.fromEntries(res.body.statusDistribution.map((d: { status: string; count: number }) => [d.status, d.count]));
    expect(dist).toEqual({ ACTIVE: s.activeBatches, IN_TRANSIT: inTransit, EXPIRED: expired, RECALLED: recalled, BLOCKED: blocked });
    expect(res.body.activity).toHaveLength(30);
    expect(res.body.chain.mode).toBe('SIMULATION');
    expect(res.body.onboarding.systemIsEmpty).toBe(false);
  });

  it('partner stats are scoped to batches the partner made, holds or handled', async () => {
    const res = await distributor.get('/api/dashboard');
    expect(res.status).toBe(200);
    const org = distributor.user.organization.id;
    const scoped = await prisma.medicineBatch.count({
      where: { OR: [{ manufacturerId: org }, { currentCustodianId: org }, { transfers: { some: { OR: [{ fromOrgId: org }, { toOrgId: org }] } } }] },
    });
    expect(res.body.stats.totalBatches).toBe(scoped);
    expect(res.body.stats.totalBatches).toBeLessThan(await prisma.medicineBatch.count());
    expect(res.body.stats.inCustody).toBe(await prisma.medicineBatch.count({ where: { currentCustodianId: org } }));
    expect(res.body.stats.pendingIncoming).toBe(await prisma.custodyTransfer.count({ where: { toOrgId: org, status: 'PENDING' } }));
    expect(res.body.stats.pendingOrganizations).toBe(0);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
  });
});

describe('GET /api/reports/export', () => {
  it('returns text/csv with a header row and one row per batch (regulator)', async () => {
    const res = await asText(regulator.agent.get('/api/reports/export?type=batches'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="medichain-batches-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = String(res.body).replace(/^﻿/, '');
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(['Batch ID', 'Batch number', 'Medicine', 'Manufacturer', 'Current custodian', 'Quantity', 'Expiry date', 'Days to expiry', 'Status', 'Registered']);
    expect(rows.length - 1).toBe(await prisma.medicineBatch.count());
    const batchNumbers = rows.slice(1).map((r) => r[1]);
    expect(batchNumbers).toEqual(expect.arrayContaining(['AMX-2026-0915', 'ATV-2026-0420', 'MTF-2023-0611']));
    const metf = rows.find((r) => r[1] === 'MTF-2023-0611')!;
    expect(metf[8]).toBe('EXPIRED');
    expect(await prisma.auditLog.count({ where: { action: 'report.exported', entityId: 'batches' } })).toBe(1);
  });

  it('is scoped to the caller', async () => {
    const res = await asText(distributor.agent.get('/api/reports/export?type=batches'));
    const rows = parseCsv(String(res.body).replace(/^﻿/, ''));
    const org = distributor.user.organization.id;
    const scoped = await prisma.medicineBatch.count({
      where: { OR: [{ manufacturerId: org }, { currentCustodianId: org }, { transfers: { some: { OR: [{ fromOrgId: org }, { toOrgId: org }] } } }] },
    });
    expect(rows.length - 1).toBe(scoped);
  });

  it('other report types export CSV too', async () => {
    for (const type of ['recalls', 'transfers', 'verifications', 'organizations', 'blockchain', 'expired', 'expiring']) {
      const res = await asText(regulator.agent.get(`/api/reports/export?type=${type}`));
      expect(res.status, type).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(String(res.body).length).toBeGreaterThan(10);
    }
    const recalls = parseCsv(String((await asText(regulator.agent.get('/api/reports/export?type=recalls'))).body).replace(/^﻿/, ''));
    expect(recalls.length - 1).toBe(2);
  });

  it('rejects an unknown report type and requires authentication', async () => {
    expect((await regulator.get('/api/reports/export?type=passwords')).status).toBe(400);
    expect((await request(app).get('/api/reports/export?type=batches')).status).toBe(401);
  });

  it('neutralises spreadsheet formulas coming from user data', async () => {
    await registerBatch(manufacturer, {
      batchNumber: 'CSV-INJ-1',
      medicine: { name: '=HYPERLINK("http://evil.example","x")', genericName: 'Evil', category: 'Test' },
    });
    const res = await asText(manufacturer.agent.get('/api/reports/export?type=batches&search=CSV-INJ'));
    const rows = parseCsv(String(res.body).replace(/^﻿/, ''));
    expect(rows).toHaveLength(2);
    expect(rows[1][2]).toBe(`'=HYPERLINK("http://evil.example","x")`);
    expect(String(res.body)).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

describe('csvCell', () => {
  it.each([
    ['=1+2', "'=1+2"],
    ['+1', "'+1"],
    ['-1', "'-1"],
    ['@SUM(A1)', "'@SUM(A1)"],
    ['\tcmd', "'\tcmd"],
    ['=cmd|"/c calc"!A1', `"'=cmd|""/c calc""!A1"`],
  ])('neutralises formula-like value %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('quotes and escapes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('passes plain values through and handles null/undefined/numbers', () => {
    expect(csvCell('Paracetamol 500 mg')).toBe('Paracetamol 500 mg');
    expect(csvCell(42)).toBe('42');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('a=b')).toBe('a=b');
  });
});
