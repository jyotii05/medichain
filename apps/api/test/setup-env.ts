/**
 * Runs in every test worker before any test file (and therefore before src/config/env.ts) is imported.
 * dotenv never overrides variables that are already set, so these values win over .env.
 */
import { config } from 'dotenv';

config({ quiet: true });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://medichain:medichain@localhost:54329/medichain_test';
process.env.BLOCKCHAIN_MODE = 'simulation';
process.env.ALLOW_DEMO_SEED = 'true';

if (!process.env.DATABASE_URL.includes('medichain_test')) {
  throw new Error(`Refusing to run tests against a non-test database: ${process.env.DATABASE_URL}`);
}
