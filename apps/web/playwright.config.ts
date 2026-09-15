import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against a running stack (API on :4000 with seeded data, web on :5173).
 * Start both with `pnpm dev` from the repo root, then `pnpm --filter web e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
