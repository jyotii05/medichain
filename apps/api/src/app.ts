import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { csrfProtection, loadSession } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRouter } from './modules/auth.js';
import { batchesRouter } from './modules/batches.js';
import { transfersRouter } from './modules/transfers.js';
import { verifyRouter } from './modules/verify.js';
import { recallsRouter, flagsRouter } from './modules/recalls.js';
import { organizationsRouter, usersRouter, profileRouter, notificationsRouter } from './modules/organizations.js';
import { dashboardRouter } from './modules/dashboard.js';
import { reportsRouter } from './modules/reports.js';
import { blockchainRouter, auditRouter } from './modules/blockchain.js';
import { devRouter } from './modules/dev.js';
import { chainMode } from './blockchain/index.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind Vercel / Render / a reverse proxy, trust the first hop so rate limiting sees the client IP.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(loadSession);
  app.use(csrfProtection);

  app.get('/api/health', async (_req, res) => {
    let database = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'unavailable';
    }
    res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', database, blockchainMode: chainMode, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/verify', verifyRouter);
  app.use('/api/blockchain', blockchainRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/batches', batchesRouter);
  app.use('/api/transfers', transfersRouter);
  app.use('/api/recalls', recallsRouter);
  app.use('/api/flags', flagsRouter);
  app.use('/api/organizations', organizationsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/me', profileRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/audit-logs', auditRouter);
  if (!env.isProd) app.use('/api/dev', devRouter);
  app.get('/api/config', (_req, res) => res.json({ demoMode: env.demoSeedEnabled, blockchainMode: chainMode, publicAppUrl: env.PUBLIC_APP_URL }));

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
