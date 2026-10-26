import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function pageArgs(p: Pagination) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function paged<T>(items: T[], total: number, p: Pagination) {
  return { items, total, page: p.page, pageSize: p.pageSize, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Picks a sort key from an allow-list, falling back to the default. */
export function sortKey<K extends string>(value: string | undefined, allowed: readonly K[], fallback: K): K {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as K) : fallback;
}

export const optionalDate = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' });
      return z.NEVER;
    }
    return d;
  });
