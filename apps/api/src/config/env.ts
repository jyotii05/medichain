import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CLIENT_HASH_SALT: z.string().min(8).default('medichain-dev-salt'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
  COOKIE_SECURE: bool,
  ALLOW_DEMO_SEED: bool,
  BLOCKCHAIN_MODE: z.enum(['simulation', 'onchain']).default('simulation'),
  CHAIN_RPC_URL: z.string().default('http://127.0.0.1:8545'),
  CONTRACT_ADDRESS: z.string().optional().default(''),
  RELAYER_PRIVATE_KEY: z.string().optional().default(''),
  DUPLICATE_SCAN_THRESHOLD: z.coerce.number().int().positive().default(50),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  demoSeedEnabled: parsed.data.NODE_ENV !== 'production' && parsed.data.ALLOW_DEMO_SEED,
};

if (env.isProd && env.COOKIE_SECURE === false) {
  console.warn('[security] COOKIE_SECURE is false in production — cookies will be sent over plain HTTP.');
}
