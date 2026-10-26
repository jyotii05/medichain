import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { body, query, param } from '../lib/http.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { paged, pageArgs, paginationSchema } from '../lib/pagination.js';
import { auth, issueSession, requireAuth, requireRole } from '../middleware/auth.js';
import { orgChainRef } from '../lib/hash.js';
import { audit } from '../services/audit.js';
import { notifyOrg } from '../services/notifications.js';
import { chainMode } from '../blockchain/index.js';
import { queueOrganizationSync } from '../blockchain/onchain.js';
import { currentUserPayload } from './auth.js';
import { BCRYPT_COST, passwordSchema } from '../lib/password.js';

// ======================= Organizations =======================
export const organizationsRouter = Router();
organizationsRouter.use(requireAuth);

const orgTypes = ['REGULATOR', 'MANUFACTURER', 'DISTRIBUTOR', 'WHOLESALER', 'PHARMACY'] as const;

organizationsRouter.get('/', async (req, res) => {
  const a = auth(req);
  const q = query(
    req,
    paginationSchema.extend({
      type: z.enum(orgTypes).optional(),
      status: z.enum(['PENDING', 'APPROVED', 'SUSPENDED']).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }),
  );
  const and: Prisma.OrganizationWhereInput[] = [];
  // Partners see the directory of approved organizations only.
  if (a.user.role !== 'REGULATOR') and.push({ status: 'APPROVED' });
  else if (q.status) and.push({ status: q.status });
  if (q.type) and.push({ type: q.type });
  if (q.search) {
    and.push({
      OR: [
        { name: { contains: q.search, mode: 'insensitive' } },
        { licenseNumber: { contains: q.search, mode: 'insensitive' } },
        { city: { contains: q.search, mode: 'insensitive' } },
      ],
    });
  }
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { memberships: true, manufacturedBatches: true, custodyBatches: true } } },
      ...pageArgs(q),
    }),
    prisma.organization.count({ where }),
  ]);
  const isReg = a.user.role === 'REGULATOR';
  res.json(
    paged(
      items.map((o) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        status: o.status,
        licenseNumber: o.licenseNumber,
        city: o.city,
        country: o.country,
        email: isReg ? o.email : undefined,
        phone: isReg ? o.phone : undefined,
        addressLine: isReg ? o.addressLine : undefined,
        approvedAt: o.approvedAt,
        createdAt: o.createdAt,
        isDemo: o.isDemo,
        counts: isReg ? { members: o._count.memberships, manufactured: o._count.manufacturedBatches, inCustody: o._count.custodyBatches } : undefined,
      })),
      total,
      q,
    ),
  );
});

const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(orgTypes),
  licenseNumber: z
    .string()
    .trim()
    .min(4)
    .max(60)
    .transform((s) => s.toUpperCase()),
  email: z.string().trim().email().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  addressLine: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
  approve: z.boolean().default(false),
});

organizationsRouter.post('/', requireRole('REGULATOR'), async (req, res) => {
  const input = body(req, createOrgSchema);
  const { approve, ...data } = input;
  const exists = await prisma.organization.findUnique({ where: { licenseNumber: data.licenseNumber } });
  if (exists) throw new AppError(409, 'DUPLICATE_LICENSE', 'An organization with this licence number already exists');
  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: { ...data, status: approve ? 'APPROVED' : 'PENDING', approvedAt: approve ? new Date() : null, chainRef: 'pending' },
    });
    const o = await tx.organization.update({ where: { id: created.id }, data: { chainRef: orgChainRef(created.id) } });
    await audit(tx, req, 'organization.created', 'Organization', o.id, { name: o.name, type: o.type, status: o.status });
    return o;
  });
  if (chainMode === 'ONCHAIN' && org.status === 'APPROVED') queueOrganizationSync(org.id);
  res.status(201).json({ organization: org });
});

organizationsRouter.patch('/:id/status', requireRole('REGULATOR'), async (req, res) => {
  const a = auth(req);
  const input = body(req, z.object({ status: z.enum(['APPROVED', 'SUSPENDED']), reason: z.string().trim().max(500).optional() }));
  const id = param(req, 'id');
  if (id === a.org.id) throw badRequest('You cannot change the status of your own organization');
  const existing = await prisma.organization.findUnique({ where: { id } });
  if (!existing) throw notFound('Organization');
  if (existing.status === input.status) throw new AppError(409, 'NO_CHANGE', `Organization is already ${input.status.toLowerCase()}`);
  const org = await prisma.$transaction(async (tx) => {
    const o = await tx.organization.update({
      where: { id },
      data: { status: input.status, approvedAt: input.status === 'APPROVED' ? new Date() : existing.approvedAt },
    });
    await audit(tx, req, input.status === 'APPROVED' ? 'organization.approved' : 'organization.suspended', 'Organization', id, {
      reason: input.reason ?? null,
      previous: existing.status,
    });
    await notifyOrg(tx, id, {
      severity: input.status === 'APPROVED' ? 'SUCCESS' : 'CRITICAL',
      title: input.status === 'APPROVED' ? 'Organization approved' : 'Organization suspended',
      message:
        input.status === 'APPROVED'
          ? 'Your organization has been approved by the regulator and can now take part in the supply chain.'
          : `Your organization has been suspended by the regulator${input.reason ? `: ${input.reason}` : '.'}`,
    });
    return o;
  });
  if (chainMode === 'ONCHAIN') queueOrganizationSync(org.id);
  res.json({ organization: org });
});

// ======================= Users (regulator administration) =======================
export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole('REGULATOR'));

const userRow = (u: Prisma.UserGetPayload<{ include: { membership: { include: { organization: true } } } }>) => ({
  id: u.id,
  email: u.email,
  fullName: u.fullName,
  role: u.role,
  status: u.status,
  title: u.membership?.title ?? null,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
  isDemo: u.isDemo,
  organization: u.membership ? { id: u.membership.organization.id, name: u.membership.organization.name, type: u.membership.organization.type } : null,
});

usersRouter.get('/', async (req, res) => {
  const q = query(req, paginationSchema.extend({ role: z.enum(orgTypes).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }));
  const and: Prisma.UserWhereInput[] = [];
  if (q.role) and.push({ role: q.role });
  if (q.status) and.push({ status: q.status });
  if (q.search) {
    and.push({
      OR: [
        { email: { contains: q.search, mode: 'insensitive' } },
        { fullName: { contains: q.search, mode: 'insensitive' } },
        { membership: { organization: { name: { contains: q.search, mode: 'insensitive' } } } },
      ],
    });
  }
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, include: { membership: { include: { organization: true } } }, orderBy: { createdAt: q.order }, ...pageArgs(q) }),
    prisma.user.count({ where }),
  ]);
  res.json(paged(items.map(userRow), total, q));
});

usersRouter.post('/', async (req, res) => {
  const input = body(
    req,
    z.object({
      email: z.string().trim().toLowerCase().email().max(200),
      fullName: z.string().trim().min(2).max(120),
      password: passwordSchema,
      organizationId: z.string().trim().min(1).max(40),
      title: z.string().trim().max(80).optional().nullable(),
    }),
  );
  const org = await prisma.organization.findUnique({ where: { id: input.organizationId } });
  if (!org) throw notFound('Organization');
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw new AppError(409, 'DUPLICATE_EMAIL', 'A user with this email already exists');
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        passwordHash: await bcrypt.hash(input.password, BCRYPT_COST),
        role: org.type, // role always follows the organization type
        membership: { create: { organizationId: org.id, title: input.title ?? null } },
      },
      include: { membership: { include: { organization: true } } },
    });
    await audit(tx, req, 'user.created', 'User', u.id, { email: u.email, role: u.role, organizationId: org.id });
    return u;
  });
  res.status(201).json({ user: userRow(user) });
});

usersRouter.patch('/:id', async (req, res) => {
  const a = auth(req);
  const id = param(req, 'id');
  const input = body(req, z.object({ status: z.enum(['ACTIVE', 'DISABLED']).optional(), fullName: z.string().trim().min(2).max(120).optional() }));
  if (id === a.user.id && input.status === 'DISABLED') throw badRequest('You cannot disable your own account');
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw notFound('User');
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: {
        ...input,
        // disabling a user invalidates all of their sessions
        tokenVersion: input.status === 'DISABLED' ? { increment: 1 } : undefined,
      },
      include: { membership: { include: { organization: true } } },
    });
    await audit(tx, req, 'user.updated', 'User', id, input);
    return u;
  });
  res.json({ user: userRow(user) });
});

// ======================= Own profile =======================
export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.patch('/', async (req, res) => {
  const a = auth(req);
  const input = body(req, z.object({ fullName: z.string().trim().min(2).max(120) }));
  await prisma.user.update({ where: { id: a.user.id }, data: { fullName: input.fullName } });
  await audit(prisma, req, 'profile.updated', 'User', a.user.id, {});
  res.json({ user: await currentUserPayload(a.user.id) });
});

profileRouter.post('/password', async (req, res) => {
  const a = auth(req);
  const input = body(req, z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema }));
  const user = await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } });
  if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Your current password is incorrect');
  }
  if (input.currentPassword === input.newPassword) throw badRequest('The new password must be different from the current one');
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(input.newPassword, BCRYPT_COST), tokenVersion: { increment: 1 } },
  });
  await audit(prisma, req, 'profile.password_changed', 'User', user.id, {});
  // other sessions are invalidated by the version bump; keep this one signed in
  const { csrfToken } = issueSession(res, updated, false);
  res.json({ ok: true, csrfToken });
});

// ======================= Notifications =======================
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res) => {
  const a = auth(req);
  const q = query(req, paginationSchema.extend({ unread: z.enum(['true', 'false']).optional(), severity: z.enum(['INFO', 'SUCCESS', 'WARNING', 'CRITICAL']).optional() }));
  const where: Prisma.NotificationWhereInput = {
    userId: a.user.id,
    ...(q.unread === 'true' ? { readAt: null } : {}),
    ...(q.severity ? { severity: q.severity } : {}),
  };
  const [items, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: a.user.id, readAt: null } }),
  ]);
  res.json({ ...paged(items, total, q), unread });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const a = auth(req);
  const r = await prisma.notification.updateMany({ where: { userId: a.user.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ updated: r.count });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const a = auth(req);
  const r = await prisma.notification.updateMany({ where: { id: param(req, 'id'), userId: a.user.id }, data: { readAt: new Date() } });
  if (!r.count) throw notFound('Notification');
  res.json({ ok: true });
});
