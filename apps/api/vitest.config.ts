import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts'],
    // All test files share one PostgreSQL database, so they must not run in parallel.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Several tests deliberately trigger DB errors (append-only triggers, CHECK constraints, unique index);
    // the shared Prisma client logs those as "prisma:error". Assertions still verify every one of them.
    onConsoleLog: (log) => (log.startsWith('prisma:error') ? false : undefined),
  },
});
