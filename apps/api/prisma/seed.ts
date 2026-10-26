/**
 * Development-only seed script.
 *   npm run db:seed        -> demo organizations, one user per role, and sample batches
 *   npm run db:seed:base   -> demo organizations and users only (dashboard shows the onboarding state)
 * Refuses to run when NODE_ENV=production.
 */
import { PrismaClient } from '@prisma/client';
import { seedBase, seedSampleData, DEMO_PASSWORD } from '../src/seed/demo.js';
import { flushChainQueue } from '../src/blockchain/index.js';
import { dispatchPending } from '../src/blockchain/onchain.js';
import { chainMode } from '../src/blockchain/index.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demonstration data in production.');
  process.exit(1);
}

const prisma = new PrismaClient();
const baseOnly = process.argv.includes('--base');

async function main() {
  await seedBase(prisma);
  console.log('✔ Demo organizations and users ready');
  if (!baseOnly) {
    const r = await seedSampleData(prisma);
    console.log(r.skipped ? '• Sample batches already exist — skipped' : `✔ Created ${r.created} sample batches and ${r.verificationAttempts} sample verification records`);
    if (chainMode === 'ONCHAIN') {
      console.log('… writing queued events to the blockchain');
      void flushChainQueue;
      await dispatchPending();
      const failed = await prisma.blockchainTransaction.count({ where: { mode: 'ONCHAIN', status: 'FAILED' } });
      console.log(failed ? `⚠ ${failed} on-chain writes failed — check the node/contract and use "Retry failed" on the Blockchain page` : '✔ On-chain anchoring complete');
    }
  }
  console.log(`\nDemo accounts (development only) — password for all: ${DEMO_PASSWORD}`);
  for (const e of ['regulator', 'manufacturer', 'distributor', 'wholesaler', 'pharmacy']) console.log(`  ${e}@medichain.demo`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
