import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEnv } from './testEnv';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Brings the separate test database up to the latest migration before any test file runs. */
export default function setup() {
  const env = testEnv();
  execSync('pnpm exec prisma migrate deploy', {
    cwd: apiRoot,
    stdio: 'pipe',
    env: { ...process.env, ...env },
  });
}
