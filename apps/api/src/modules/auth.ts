import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { body } from '../lib/http.js';
import { AppError } from '../lib/errors.js';
import { clearSession, issueSession, requireAuth, auth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { env } from '../config/env.js';
import { clientHash, orgChainRef } from '../lib/hash.js';
import { BCRYPT_COST, passwordSchema } from '../lib/password.js';
import { notifyRegulators } from '../services/notifications.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait 15 minutes and try again.' } }),
});

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.isTest ? 1000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
  password: z.string().min(1, 'Password is required').max(200),
  remember: z.boolean().optional().default(false),
});

// Constant-time-ish defence against user enumeration: always run one bcrypt compare.
const DUMMY_HASH = bcrypt.hashSync('medichain-dummy-password', 10);

export async function currentUserPayload(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { membership: { include: { organization: true } } },
  });
  const o = u.membership!.organization;
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    title: u.membership?.title ?? null,
    lastLoginAt: u.lastLoginAt,
    isDemo: u.isDemo,
    organization: { id: o.id, name: o.name, type: o.type, status: o.status, licenseNumber: o.licenseNumber, city: o.city, country: o.country },
  };
}

authRouter.post('/login', loginLimiter, async (req, res) => {
  const input = body(req, loginSchema);
  const user = await prisma.user.findUnique({ where: { email: input.email }, include: { membership: true } });
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await audit(prisma, req, 'auth.login_failed', 'User', user?.id ?? null, {});
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  }
  if (user.status !== 'ACTIVE') throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled. Contact your administrator.');
  if (!user.membership) throw new AppError(403, 'NO_ORGANIZATION', 'This account is not linked to an organization');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const { csrfToken } = issueSession(res, user, input.remember);
  req.auth = undefined;
  await prisma.auditLog.create({ data: { action: 'auth.login', entityType: 'User', entityId: user.id, actorUserId: user.id, actorOrgId: user.membership.organizationId } });
  res.json({ user: await currentUserPayload(user.id), csrfToken });
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.isTest ? 1000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many registration attempts. Please try again in an hour.' } }),
});

/** Organization types a member of the public may register. Regulator accounts are only created by an existing regulator. */
export const SELF_SERVICE_ORG_TYPES = ['MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY'] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((s) => s || null);

// .strict(): role, status, approval or any other unexpected field is rejected, never silently applied.
const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(120),
    email: z.string().trim().toLowerCase().email('Enter a valid email address').max(200),
    password: passwordSchema,
    confirmPassword: z.string().max(200),
    jobTitle: optionalText(80),
    organization: z
      .object({
        name: z.string().trim().min(2, 'Enter the organization name').max(120),
        type: z.enum(SELF_SERVICE_ORG_TYPES, { errorMap: () => ({ message: 'Choose a supply-chain role' }) }),
        licenseNumber: z
          .string()
          .trim()
          .min(4, 'Licence number must be at least 4 characters')
          .max(60)
          .transform((s) => s.toUpperCase()),
        phone: optionalText(40),
        city: optionalText(80),
        country: optionalText(80),
      })
      .strict(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms to create an account' }) }),
  })
  .strict()
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

/**
 * Self-service sign-up. Creates a new organization in PENDING status together with its first user, whose role
 * follows the organization type. Pending organizations can sign in and browse, but requireApprovedOrg blocks every
 * supply-chain action until a regulator approves them on the Partners page. Joining an existing organization is not
 * possible here; its members must ask a regulator to create their account.
 */
authRouter.post('/register', registerLimiter, async (req, res) => {
  if (req.auth) throw new AppError(409, 'ALREADY_SIGNED_IN', 'Sign out before creating a new account');
  const input = body(req, registerSchema);
  const { organization: orgInput } = input;

  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw new AppError(409, 'DUPLICATE_EMAIL', 'An account with this email already exists. Sign in instead.', [
      { path: 'email', message: 'An account with this email already exists' },
    ]);
  }
  if (await prisma.organization.findUnique({ where: { licenseNumber: orgInput.licenseNumber }, select: { id: true } })) {
    throw new AppError(
      409,
      'DUPLICATE_LICENSE',
      'An organization with this licence number is already registered. Ask a MediChain regulator to create an account for you in that organization.',
      [{ path: 'organization.licenseNumber', message: 'This licence number is already registered' }],
    );
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: { ...orgInput, email: input.email, status: 'PENDING', chainRef: 'pending' },
    });
    const org = await tx.organization.update({ where: { id: created.id }, data: { chainRef: orgChainRef(created.id) } });
    const u = await tx.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        passwordHash,
        role: org.type, // role always follows the organization type
        lastLoginAt: new Date(),
        membership: { create: { organizationId: org.id, title: input.jobTitle } },
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'auth.registered',
        entityType: 'Organization',
        entityId: org.id,
        actorUserId: u.id,
        actorOrgId: org.id,
        metadata: { userId: u.id, email: u.email, type: org.type, licenseNumber: org.licenseNumber },
        clientHash: clientHash(req.ip),
      },
    });
    await notifyRegulators(tx, {
      severity: 'WARNING',
      title: 'New organization awaiting approval',
      message: `${org.name} (${org.type.toLowerCase()}, licence ${org.licenseNumber}) registered and needs review.`,
      link: '/app/partners?status=PENDING',
    });
    return u;
  });

  // Same session mechanism as /login. The organization is not synced on-chain until a regulator approves it.
  const { csrfToken } = issueSession(res, user, false);
  res.status(201).json({ user: await currentUserPayload(user.id), csrfToken });
});

authRouter.post('/logout', async (req, res) => {
  if (req.auth) await audit(prisma, req, 'auth.logout', 'User', req.auth.user.id);
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await currentUserPayload(auth(req).user.id) });
});

/**
 * Password-reset request. Always answers the same way to avoid revealing which emails exist.
 * Email delivery is not configured in this prototype — the request is only audit-logged.
 */
authRouter.post('/forgot-password', forgotLimiter, async (req, res) => {
  const { email } = body(req, z.object({ email: z.string().trim().toLowerCase().email().max(200) }));
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  await audit(prisma, req, 'auth.password_reset_requested', 'User', user?.id ?? null, {});
  res.status(202).json({
    message: 'If an account exists for this email, password-reset instructions will be sent. In this demo, email delivery is not configured — contact a regulator administrator.',
  });
});
