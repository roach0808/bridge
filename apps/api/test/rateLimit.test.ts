import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Vitest gives each test file a fresh module graph, so lowering the limit
 * before importing the app gives this file its own low-limit config without
 * affecting the other suites (which run with a very high LOGIN_RATE_LIMIT).
 */
process.env.LOGIN_RATE_LIMIT = '3';

type Helpers = typeof import('./helpers');
let h: Helpers;
let fx: Awaited<ReturnType<Helpers['seedFixtures']>>;

beforeAll(async () => {
  h = await import('./helpers');
  fx = await h.seedFixtures();
});
afterAll(async () => {
  await h.prisma.$disconnect();
});

describe('login rate limit', () => {
  it('counts only failures and answers 429 rate_limited once exceeded', async () => {
    const login = (password: string) => request(h.app).post('/api/v1/auth/login').send({ email: fx.a1.email, password });

    // Successful sign-ins are not counted.
    for (let i = 0; i < 4; i++) expect((await login(h.PASSWORD)).status).toBe(200);

    for (let i = 0; i < 3; i++) expect((await login('wrong-password-xx')).status).toBe(401);
    const blocked = await login(h.PASSWORD);
    h.expectError(blocked, 429, 'rate_limited');
    expect(blocked.headers).toHaveProperty('ratelimit');
  });

  it('does not throttle other endpoints', async () => {
    expect((await request(h.app).post('/api/v1/auth/refresh').send({})).status).toBe(401);
    expect((await request(h.app).get('/healthz')).status).toBe(200);
  });
});
