import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, batchPayload, email, freshBase, login, prisma, LICENSE } from './helpers.js';

function cookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
}

let seq = 0;
/** A valid self-service registration payload with a unique email and licence number. */
function payload(overrides: Record<string, unknown> = {}, org: Record<string, unknown> = {}) {
  seq++;
  return {
    fullName: 'Nadia Okafor',
    email: `nadia.${seq}@lakeside-pharma.example`,
    password: 'Lakeside2026pw',
    confirmPassword: 'Lakeside2026pw',
    jobTitle: 'Quality manager',
    organization: { name: 'Lakeside Pharma', type: 'MANUFACTURER', licenseNumber: `mfg-lks-${1000 + seq}`, phone: '+00 555 0100', city: 'Lakeside', country: 'Testland', ...org },
    acceptTerms: true,
    ...overrides,
  };
}

const register = (body: object) => request(app).post('/api/auth/register').send(body);

beforeAll(async () => {
  await freshBase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('creates a PENDING organization and its first user, signs them in, and never returns secrets', async () => {
    const body = payload({ email: '  Nadia.Main@Lakeside-Pharma.Example ' });
    const res = await register(body);
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: 'nadia.main@lakeside-pharma.example',
      fullName: 'Nadia Okafor',
      role: 'MANUFACTURER',
      title: 'Quality manager',
      isDemo: false,
      organization: { name: 'Lakeside Pharma', type: 'MANUFACTURER', status: 'PENDING', licenseNumber: body.organization.licenseNumber.toUpperCase() },
    });
    expect(res.body.csrfToken).toMatch(/^[0-9a-f]{48}$/);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/passwordHash|Lakeside2026pw|tokenVersion/);

    const c = cookies(res);
    expect(c.find((x) => x.startsWith('mc_session='))).toMatch(/HttpOnly/i);
    expect(c.find((x) => x.startsWith('mc_csrf='))).toContain(`mc_csrf=${res.body.csrfToken}`);

    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'nadia.main@lakeside-pharma.example' }, include: { membership: { include: { organization: true } } } });
    expect(u.passwordHash).not.toBe('Lakeside2026pw');
    expect(u.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(u.membership!.organization.status).toBe('PENDING');
    expect(u.membership!.organization.approvedAt).toBeNull();
    expect(u.membership!.organization.chainRef).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await prisma.auditLog.count({ where: { action: 'auth.registered', entityId: u.membership!.organizationId } })).toBe(1);

    const regulator = await prisma.user.findUniqueOrThrow({ where: { email: email('regulator') } });
    expect(await prisma.notification.count({ where: { userId: regulator.id, title: 'New organization awaiting approval' } })).toBeGreaterThan(0);
  });

  it('the new session works, and supply-chain actions stay blocked until a regulator approves the organization', async () => {
    const body = payload();
    const res = await request.agent(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(201);

    // login works with the newly registered account
    const s = await login(body.email, body.password);
    expect(s.user.organization.status).toBe('PENDING');
    expect((await s.get('/api/auth/me')).status).toBe(200);

    const license = body.organization.licenseNumber.toUpperCase();
    const blocked = await s.post('/api/batches', batchPayload({ manufacturerLicense: license }));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ORGANIZATION_NOT_APPROVED');

    const reg = await login('regulator');
    const approve = await reg.patch(`/api/organizations/${s.user.organization.id}/status`, { status: 'APPROVED' });
    expect(approve.status).toBe(200);

    const allowed = await s.post('/api/batches', batchPayload({ manufacturerLicense: license }));
    expect(allowed.status).toBe(201);
  });

  it('rejects a duplicate email (case-insensitive) with 409 DUPLICATE_EMAIL and creates nothing', async () => {
    const before = await prisma.organization.count();
    const res = await register(payload({ email: 'Manufacturer@MediChain.Demo' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(await prisma.organization.count()).toBe(before);
    expect(cookies(res).some((c) => c.startsWith('mc_session=') && !c.startsWith('mc_session=;'))).toBe(false);
  });

  it('rejects joining an existing organization by licence number with 409 DUPLICATE_LICENSE', async () => {
    const before = await prisma.user.count();
    const res = await register(payload({}, { licenseNumber: LICENSE.aurelia.toLowerCase() }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_LICENSE');
    expect(await prisma.user.count()).toBe(before);
  });

  it.each([
    ['an invalid email', { email: 'not-an-email' }, 'email'],
    ['mismatched passwords', { confirmPassword: 'Different2026pw' }, 'confirmPassword'],
    ['a password without a number', { password: 'onlyletterspassword', confirmPassword: 'onlyletterspassword' }, 'password'],
    ['a short password', { password: 'abc123', confirmPassword: 'abc123' }, 'password'],
    ['terms not accepted', { acceptTerms: false }, 'acceptTerms'],
    ['a missing full name', { fullName: '' }, 'fullName'],
  ])('rejects %s with 400 VALIDATION_ERROR', async (_label, overrides, path) => {
    const before = await prisma.user.count();
    const res = await register(payload(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
    expect(await prisma.user.count()).toBe(before);
  });

  describe('privilege escalation', () => {
    it('refuses a REGULATOR organization type', async () => {
      const res = await register(payload({}, { type: 'REGULATOR' }));
      expect(res.status).toBe(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain('organization.type');
      expect(await prisma.organization.count({ where: { type: 'REGULATOR' } })).toBe(1);
    });

    it.each([
      ['a role field', { role: 'REGULATOR' }, {}],
      ['a user status field', { status: 'ACTIVE' }, {}],
      ['an organization status field', {}, { status: 'APPROVED' }],
      ['an organization id', { organizationId: 'anything' }, {}],
    ])('rejects a payload with %s instead of applying it', async (_label, extra, orgExtra) => {
      const before = await prisma.user.count();
      const res = await register(payload(extra, orgExtra));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.user.count()).toBe(before);
    });

    it('never creates an approved organization', async () => {
      expect(await prisma.organization.count({ where: { licenseNumber: { startsWith: 'MFG-LKS-' }, status: { not: 'PENDING' } } })).toBe(1); // only the one approved in the test above
    });
  });

  it('refuses to register while already signed in', async () => {
    const s = await login('pharmacy');
    const res = await s.post('/api/auth/register', payload());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_SIGNED_IN');
  });

  it('a signed-in request without the CSRF header is rejected before registration runs', async () => {
    const s = await login('pharmacy');
    const res = await s.agent.post('/api/auth/register').send(payload());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });
});
