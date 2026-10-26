import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export const prisma = new PrismaClient({
  log: env.isProd ? ['error'] : ['error', 'warn'],
});

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
