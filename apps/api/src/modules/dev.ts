import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { seedSampleData } from '../seed/demo.js';
import { flushChainQueue } from '../blockchain/index.js';
import { audit } from '../services/audit.js';

/** Development-only helpers. Never mounted when NODE_ENV=production. */
export const devRouter = Router();

devRouter.post('/sample-data', requireAuth, requireRole('REGULATOR'), async (req, res) => {
  if (!env.demoSeedEnabled) throw new AppError(403, 'DEMO_SEED_DISABLED', 'Sample data loading is disabled in this environment');
  const result = await seedSampleData(prisma);
  flushChainQueue();
  await audit(prisma, req, 'dev.sample_data_loaded', 'System', null, { created: result.created });
  res.status(result.skipped ? 200 : 201).json(result);
});
