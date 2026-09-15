/**
 * Environment for the integration tests. Used by vitest.config.ts (so the
 * values reach every worker through `test.env`), by the global setup (for
 * `prisma migrate deploy`) and re-checked inside each worker.
 * Nothing here may ever point at a non-local database.
 */
export const DEFAULT_TEST_DATABASE_URL = 'postgresql://god:god@localhost:5432/god_testsuite';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Throws unless the URL is a local database other than the dev database `god`. */
export function assertSafeTestDatabaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid URL: ${raw}`);
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing to run the API tests against non-local database host "${url.hostname}"`);
  }
  if (url.pathname.replace(/^\//, '') === 'god') {
    throw new Error('Refusing to run the API tests against the development database "god"');
  }
  return raw;
}

export function resolveTestDatabaseUrl(): string {
  return assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL);
}

export function testEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: resolveTestDatabaseUrl(),
    JWT_SECRET: 'test-only-secret-0123456789abcdef-0123456789abcdef',
    ACCESS_TOKEN_TTL: '15m',
    REFRESH_TOKEN_TTL: '30d',
    LOGIN_RATE_LIMIT: '10000',
    LOG_LEVEL: 'silent',
    PUSH_ENABLED: 'false',
    CORS_ORIGINS: 'http://localhost:5173',
  };
}
