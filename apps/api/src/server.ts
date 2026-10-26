import { env } from './config/env.js';
import { createApp } from './app.js';
import { prisma } from './lib/prisma.js';
import { chainMode, chainStatus, flushChainQueue } from './blockchain/index.js';

const app = createApp();

const server = app.listen(env.PORT, async () => {
  console.log(`MediChain API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  try {
    const s = await chainStatus();
    console.log(`Blockchain: ${s.label}${chainMode === 'ONCHAIN' ? ` — ${s.message}` : ''}`);
  } catch (e) {
    console.warn('Could not determine blockchain status:', (e as Error).message);
  }
  flushChainQueue(); // resume any on-chain writes left pending by a previous run
});

const shutdown = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
