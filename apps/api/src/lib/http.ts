import type { Request } from 'express';
import type { ZodType, ZodTypeDef } from 'zod';
import { prisma, type Tx } from './prisma.js';
import { auth } from '../middleware/auth.js';
import type { Actor } from '../services/batches.js';
import { flushChainQueue } from '../blockchain/index.js';

export function body<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): T {
  return schema.parse(req.body ?? {});
}

export function query<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): T {
  return schema.parse(req.query ?? {});
}

export function param(req: Request, name: string): string {
  const v = req.params[name];
  return typeof v === 'string' ? v.slice(0, 64) : '';
}

export function actorFrom(req: Request): Actor {
  const a = auth(req);
  return { userId: a.user.id, org: a.org };
}

/** Runs a business operation in a DB transaction, then hands any queued blockchain writes to the relayer. */
export async function inTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await prisma.$transaction(fn, { timeout: 20_000, maxWait: 10_000 });
  flushChainQueue();
  return result;
}
