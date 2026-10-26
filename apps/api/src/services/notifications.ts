import type { NotificationSeverity } from '@prisma/client';
import type { Db } from '../lib/prisma.js';

interface NotifyInput {
  severity?: NotificationSeverity;
  title: string;
  message: string;
  link?: string;
}

/** Fan a notification out to every active member of an organization. */
export async function notifyOrg(db: Db, organizationId: string, input: NotifyInput) {
  const members = await db.organizationMembership.findMany({
    where: { organizationId, user: { status: 'ACTIVE' } },
    select: { userId: true },
  });
  if (!members.length) return;
  await db.notification.createMany({
    data: members.map((m) => ({ userId: m.userId, severity: input.severity ?? 'INFO', title: input.title, message: input.message, link: input.link })),
  });
}

/** Notify every active regulator user. */
export async function notifyRegulators(db: Db, input: NotifyInput) {
  const users = await db.user.findMany({ where: { role: 'REGULATOR', status: 'ACTIVE' }, select: { id: true } });
  if (!users.length) return;
  await db.notification.createMany({
    data: users.map((u) => ({ userId: u.id, severity: input.severity ?? 'INFO', title: input.title, message: input.message, link: input.link })),
  });
}
