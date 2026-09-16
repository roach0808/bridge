import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, expectError, loginRaw, prisma, seedFixtures, PASSWORD, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

/** Signs in with a device and country, as the proxy in front of the API would report them. */
async function signIn(email: string, userAgent: string, country?: string) {
  const req = request(app).post('/api/v1/auth/login').set('user-agent', userAgent);
  if (country) req.set('x-vercel-ip-country', country);
  const res = await req.send({ email, password: PASSWORD });
  expect(res.status, res.text).toBe(200);
  return { token: res.body.accessToken as string, refreshToken: res.body.refreshToken as string };
}

const sessions = (token: string) =>
  request(app).get('/api/v1/me/sessions').set('Authorization', `Bearer ${token}`);

describe('signed-in sessions', () => {
  it('records device and country per sign-in, newest first', async () => {
    await signIn(fx.a1.email, CHROME, 'KR');
    const phone = await signIn(fx.a1.email, IPHONE, 'GB');

    const res = await sessions(phone.token);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ deviceType: 'mobile', browser: 'Safari', os: 'iOS', country: 'GB' });
    expect(res.body[1]).toMatchObject({ deviceType: 'desktop', browser: 'Chrome', os: 'Windows', country: 'KR' });
    expect(res.body[0].ip).toBeTruthy();
    // Someone else's sessions are their own.
    expect((await sessions((await as(fx.a2)).token!)).body).toHaveLength(1);
  });

  it('sessions do not expire on their own', async () => {
    await signIn(fx.e1.email, CHROME);
    const row = await prisma.refreshToken.findFirstOrThrow({ where: { userId: fx.e1.id } });
    expect(row.expiresAt.getUTCFullYear()).toBeGreaterThan(new Date().getUTCFullYear() + 5);
  });

  it('signing out one device leaves the others working', async () => {
    const desktop = await signIn(fx.m1.email, CHROME, 'US');
    const phone = await signIn(fx.m1.email, IPHONE, 'US');
    const list = (await sessions(phone.token)).body as Array<{ id: string; current: boolean }>;
    const other = list.find((s) => !s.current)!;

    const res = await request(app).delete(`/api/v1/me/sessions/${other.id}`).set('Authorization', `Bearer ${phone.token}`);
    expect(res.body).toEqual({ signedOut: 1 });
    // The signed-out device can no longer refresh; the other one can.
    expectError(await request(app).post('/api/v1/auth/refresh').send({ refreshToken: desktop.refreshToken }), 401);
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: phone.refreshToken })).status).toBe(200);
  });

  it('“all” keeps only the session that asked', async () => {
    await signIn(fx.a3.email, CHROME);
    await signIn(fx.a3.email, IPHONE);
    const latest = await signIn(fx.a3.email, CHROME);
    const res = await request(app).delete('/api/v1/me/sessions/all').set('Authorization', `Bearer ${latest.token}`);
    expect(res.body.signedOut).toBe(2);
    expect((await sessions(latest.token)).body).toHaveLength(1);
  });

  it('a refresh keeps the session, its device and its history', async () => {
    const desktop = await signIn(fx.a2.email, CHROME, 'DE');
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: desktop.refreshToken });
    expect(refreshed.status).toBe(200);
    const list = (await sessions(refreshed.body.accessToken)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ browser: 'Chrome', os: 'Windows', country: 'DE' });
  });

  it('only founders see someone else’s sessions, and can end them', async () => {
    await signIn(fx.e2.email, CHROME);
    const founder = await as(fx.founder);
    const manager = await as(fx.m1);
    expectError(await manager.get(`/users/${fx.e2.id}/sessions`), 403);
    expect((await founder.get(`/users/${fx.e2.id}/sessions`)).body).toHaveLength(1);
    expect((await founder.delete(`/users/${fx.e2.id}/sessions`)).body).toEqual({ signedOut: 1 });
    expect((await founder.get(`/users/${fx.e2.id}/sessions`)).body).toEqual([]);
  });

  it('a bogus country header is ignored', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('user-agent', CHROME)
      .set('x-vercel-ip-country', 'not-a-country')
      .send({ email: fx.a4.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect((await sessions(res.body.accessToken)).body[0].country).toBeNull();
    expect((await loginRaw(fx.a4.email)).status).toBe(200);
  });
});
