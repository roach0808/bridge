import { assertSafeTestDatabaseUrl } from './testEnv';

// Runs in every worker before the test file (and therefore before src/config.ts
// is imported). Belt and braces on top of `test.env` in vitest.config.ts.
if (process.env.NODE_ENV !== 'test') throw new Error('API tests must run with NODE_ENV=test');
assertSafeTestDatabaseUrl(process.env.DATABASE_URL ?? '');
