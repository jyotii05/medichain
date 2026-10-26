import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { OrganizationStatus, OrganizationType, UserRole } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { forbidden, unauthorized, AppError } from '../lib/errors.js';

export const SESSION_COOKIE = 'mc_session';
export const CSRF_COOKIE = 'mc_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface AuthContext {
  user: { id: string; email: string; fullName: string; role: UserRole };
  org: { id: string; name: string; type: OrganizationType; status: OrganizationStatus; chainRef: string; licenseNumber: string };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

interface TokenPayload {
  sub: string;
  ver: number;
}

const SESSION_HOURS = 12;
const REMEMBER_DAYS = 7;

export function issueSession(res: Response, user: { id: string; tokenVersion: number }, remember: boolean) {
  const expiresIn = remember ? `${REMEMBER_DAYS}d` : `${SESSION_HOURS}h`;
  const token = jwt.sign({ sub: user.id, ver: user.tokenVersion } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn,
    algorithm: 'HS256',
    issuer: 'medichain-api',
  });
  const base = { sameSite: 'lax' as const, secure: env.COOKIE_SECURE, path: '/' };
  const maxAge = remember ? REMEMBER_DAYS * 24 * 3600 * 1000 : undefined; // session cookie unless "remember me"
  res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true, maxAge });
  // Double-submit CSRF token: readable by the SPA, echoed back in the X-CSRF-Token header.
  const csrf = randomBytes(24).toString('hex');
  res.cookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false, maxAge });
  return { csrfToken: csrf };
}

export function clearSession(res: Response) {
  const base = { sameSite: 'lax' as const, secure: env.COOKIE_SECURE, path: '/' };
  res.clearCookie(SESSION_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, base);
}

/** Resolves the session (if any) and attaches req.auth. Never throws for anonymous requests. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'medichain-api' }) as unknown as TokenPayload;
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { membership: { include: { organization: true } } },
    });
    if (user && user.status === 'ACTIVE' && user.tokenVersion === payload.ver && user.membership) {
      const o = user.membership.organization;
      req.auth = {
        user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role },
        org: { id: o.id, name: o.name, type: o.type, status: o.status, chainRef: o.chainRef, licenseNumber: o.licenseNumber },
      };
    }
  } catch {
    // invalid / expired token -> treated as anonymous
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.user.role)) return next(forbidden());
    next();
  };
}

/** Write operations require the user's organization to be approved (not pending / suspended). */
export function requireApprovedOrg(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  if (req.auth.org.status !== 'APPROVED') {
    return next(new AppError(403, 'ORGANIZATION_NOT_APPROVED', `Your organization is ${req.auth.org.status.toLowerCase()} and cannot perform this action`));
  }
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit-cookie CSRF protection for authenticated, state-changing requests. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method) || !req.cookies?.[SESSION_COOKIE]) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (!cookie || !header || cookie.length !== header.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    return next(new AppError(403, 'CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token. Refresh the page and try again.'));
  }
  next();
}

export function auth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
