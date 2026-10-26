import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import type { Db } from '../lib/prisma.js';
import { clientHash } from '../lib/hash.js';

export async function audit(
  db: Db,
  req: Request | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Prisma.InputJsonValue = {},
) {
  await db.auditLog.create({
    data: {
      action,
      entityType,
      entityId,
      metadata,
      actorUserId: req?.auth?.user.id ?? null,
      actorOrgId: req?.auth?.org.id ?? null,
      clientHash: req ? clientHash(req.ip) : null,
    },
  });
}
