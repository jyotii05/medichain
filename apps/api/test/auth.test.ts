import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, DEMO_PASSWORD, email, freshBase, login, prisma } from './helpers.js';

function cookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
}

beforeAll(async () => {
  await freshBase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/auth/login', () => {
  it('signs in, sets the session + CSRF cookies and returns the user with role and organization', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: email('manufacturer'), password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: 'manufacturer@medichain.demo',
      role: 'MANUFACTURER',
      organization: { name: 'Aurelia Pharmaceuticals Ltd.', type: 'MANUFACTURER', status: 'APPROVED', licenseNumber: 'MFG-AUR-2041' },
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.csrfToken).toMatch(/^[0-9a-f]{48}$/);

    const c = cookies(res);
    const session = c.find((x) => x.startsWith('mc_session='));
    const csrf = c.find((x) => x.startsWith('mc_csrf='));
    expect(session).toBeDefined();
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(csrf).toBeDefined();
    expect(csrf).not.toMatch(/HttpOnly/i);
    expect(csrf).toContain(`mc_csrf=${res.body.csrfToken}`);

    const u = await prisma.user.findUniqueOrThrow({ where: { email: email('manufacturer') } });
    expect(u.lastLoginAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'auth.login', entityId: u.id } })).toBeGreaterThan(0);
  });

  it('is case-insensitive on the email address', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'Pharmacy@MediChain.Demo', password: DEMO_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('PHARMACY');
  });

  it('rejects a wrong password with 401 INVALID_CREDENTIALS and sets no session', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: email('manufacturer'), password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(cookies(res).some((c) => c.startsWith('mc_session=') && !c.startsWith('mc_session=;'))).toBe(false);
  });

  it('rejects an unknown email with the same 401 INVALID_CREDENTIALS (no user enumeration)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@medichain.demo', password: DEMO_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    const wrongPw = await request(app).post('/api/auth/login').send({ email: email('manufacturer'), password: 'nope-nope' });
    expect(res.body.error.message).toBe(wrongPw.body.error.message);
  });

  it('validates the request body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a disabled user with 403 ACCOUNT_DISABLED', async () => {
    await prisma.user.update({ where: { email: email('oakwood') }, data: { status: 'DISABLED' } });
    try {
      const res = await request(app).post('/api/auth/login').send({ email: email('oakwood'), password: DEMO_PASSWORD });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
      expect(cookies(res).some((c) => c.startsWith('mc_session=') && !c.startsWith('mc_session=;'))).toBe(false);
    } finally {
      await prisma.user.update({ where: { email: email('oakwood') }, data: { status: 'ACTIVE' } });
    }
  });

  it('a disabled user loses an existing session immediately', async () => {
    const s = await login('summit');
    expect((await s.get('/api/auth/me')).status).toBe(200);
    await prisma.user.update({ where: { email: email('summit') }, data: { status: 'DISABLED' } });
    try {
      const res = await s.get('/api/auth/me');
      expect(res.status).toBe(401);
    } finally {
      await prisma.user.update({ where: { email: email('summit') }, data: { status: 'ACTIVE' } });
    }
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 UNAUTHORIZED without a session cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a forged / garbage session token', async () => {
    const res = await request(app).get('/api/auth/me').set('Cookie', 'mc_session=not.a.jwt');
    expect(res.status).toBe(401);
  });

  it('returns the current user with a valid session', async () => {
    const s = await login('regulator');
    const res = await s.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'regulator@medichain.demo', role: 'REGULATOR', organization: { type: 'REGULATOR' } });
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookies so /me becomes 401', async () => {
    const s = await login('distributor');
    expect((await s.get('/api/auth/me')).status).toBe(200);
    const res = await s.post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const c = cookies(res);
    // cleared cookies are sent back empty with an expiry in the past
    expect(c.some((x) => /^mc_session=;/.test(x) && /Expires=Thu, 01 Jan 1970/i.test(x))).toBe(true);
    expect(c.some((x) => /^mc_csrf=;/.test(x))).toBe(true);
    const me = await s.get('/api/auth/me');
    expect(me.status).toBe(401);
  });
});

describe('CSRF protection', () => {
  it('rejects an authenticated mutating request without the X-CSRF-Token header (403 CSRF_TOKEN_INVALID)', async () => {
    const s = await login('regulator');
    const res = await s.agent.post('/api/notifications/read-all').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects a mismatched CSRF header', async () => {
    const s = await login('manufacturer');
    const res = await s.agent.post('/api/batches').set('X-CSRF-Token', 'f'.repeat(48)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
    expect(await prisma.medicineBatch.count()).toBe(0);
  });

  it('accepts the request when the header matches the cookie', async () => {
    const s = await login('regulator');
    const res = await s.post('/api/notifications/read-all');
    expect(res.status).toBe(200);
  });

  it('does not apply to safe methods', async () => {
    const s = await login('regulator');
    expect((await s.agent.get('/api/auth/me')).status).toBe(200);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('answers 202 with the same generic message for existing and unknown emails', async () => {
    const known = await request(app).post('/api/auth/forgot-password').send({ email: email('pharmacy') });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'ghost@nowhere.example' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body.message).toBeTruthy();
    expect(known.body).toEqual(unknown.body);
    expect(await prisma.auditLog.count({ where: { action: 'auth.password_reset_requested' } })).toBe(2);
  });

  it('validates the email', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
