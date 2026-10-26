#!/usr/bin/env node
/**
 * Local development PostgreSQL launcher.
 *
 * Starts a real PostgreSQL 17 server from the `embedded-postgres` npm package so the project can
 * run on machines without a PostgreSQL installation or Docker. Data persists in ~/.medichain/pgdata
 * (outside the project so cloud-sync tools such as OneDrive/Dropbox never lock database files).
 * Override the location with EMBEDDED_PG_DATA.
 *
 * If you already run PostgreSQL yourself, skip this script and point DATABASE_URL at your server.
 *
 *   npm run db:start          # keep this terminal open
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const dataDir = process.env.EMBEDDED_PG_DATA ?? join(homedir(), '.medichain', 'pgdata');
const port = Number(process.env.EMBEDDED_PG_PORT ?? 54329);
const user = 'medichain';
const password = 'medichain';
const databases = ['medichain', 'medichain_test'];

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user,
  password,
  port,
  persistent: true,
  onLog: () => {},
  onError: (msg) => console.error('[postgres]', String(msg).trim()),
});

const firstRun = !existsSync(join(dataDir, 'PG_VERSION'));
if (firstRun) {
  console.log('Initialising a new PostgreSQL data directory at', dataDir);
  mkdirSync(dirname(dataDir), { recursive: true });
  await pg.initialise();
}
await pg.start();

const client = pg.getPgClient('postgres');
await client.connect();
for (const db of databases) {
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
  if (!rowCount) {
    await client.query(`CREATE DATABASE "${db}"`);
    console.log(`Created database ${db}`);
  }
}
await client.end();

console.log(`\nPostgreSQL is running on port ${port}`);
console.log(`  DATABASE_URL=postgresql://${user}:${password}@localhost:${port}/medichain`);
console.log(`  TEST_DATABASE_URL=postgresql://${user}:${password}@localhost:${port}/medichain_test`);
console.log('\nPress Ctrl+C to stop.');

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping PostgreSQL…');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
// keep the process alive
setInterval(() => {}, 1 << 30);
