/**
 * Runs once before the whole suite: brings the TEST database schema up to date with the migrations.
 * Never touches the development database.
 *
 * `prisma migrate deploy` is non-destructive (it only applies outstanding migrations and creates the
 * database if it does not exist). Every test file empties the tables itself with TRUNCATE — see
 * resetDb() in helpers.ts. (`prisma migrate reset` is deliberately not used: Prisma refuses to run it
 * from an AI agent without interactive user consent.)
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default function setup() {
  config({ path: path.join(root, '.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://medichain:medichain@localhost:54329/medichain_test';
  if (!url.includes('medichain_test')) throw new Error(`Refusing to migrate a non-test database: ${url}`);
  try {
    execSync('npx prisma migrate deploy', {
      cwd: root,
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' },
    });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`prisma migrate deploy failed:\n${err.stdout?.toString() ?? ''}\n${err.stderr?.toString() ?? ''}`);
  }
}
