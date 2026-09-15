import { defineConfig } from 'vitest/config';
import { testEnv } from './test/setup/testEnv';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Applied to process.env in each worker before any test module (and so
    // src/config.ts, which reads env at import time) is loaded.
    env: testEnv(),
    globalSetup: ['test/setup/globalSetup.ts'],
    setupFiles: ['test/setup/workerEnv.ts'],
    // Every file truncates and re-seeds the same database.
    fileParallelism: false,
    sequence: { concurrent: false },
    // Prisma logs every query error; the constraint violations the tests
    // provoke on purpose would otherwise drown the output.
    onConsoleLog: (log) => !(log.includes('prisma:error') && /violates|conflicting key value/.test(log)),
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
