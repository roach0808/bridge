import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../src/auth/tokens';
import { Client, PASSWORD, anon, app, as, assertNoEmails, expectError, loginRaw, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const refresh = async (refreshToken: string) => {
  const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
  assertNoEmails(res, fx.a1.email);
  return res;
};

describe('POST /auth/login', () => {
  it('returns tokens, the user with email, and a refresh cookie', async () => {
    const res = await loginRaw(fx.a1.email);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      user: { id: fx.a1.id, email: fx.a1.email, role: 'associate', nickname: 'AssocOne', managerId: fx.m1.id },
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/god_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(await prisma.refreshToken.count({ where: { userId: fx.a1.id } })).toBe(1);
  });

  it('is case-insensitive on the email', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: fx.a1.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password with 401 invalid_credentials', async () => {
    expectError(await loginRaw(fx.a1.email, 'wrong-password-123'), 401, 'invalid_credentials');
  });

  it('rejects an unknown email with the same error', async () => {
    const res = await loginRaw('nobody@fixtures.test');
    expectError(res, 401, 'invalid_credentials');
  });

  it('rejects an inactive user with 401 user_inactive', async () => {
    await prisma.user.update({ where: { id: fx.a2.id }, data: { isActive: false } });
    expectError(await loginRaw(fx.a2.email), 401, 'user_inactive');
  });

  it('validates the body', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expectError(res, 400, 'validation_error');
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const login = await loginRaw(fx.a1.email);
    const first = login.body.refreshToken as string;
    const res = await refresh(first);
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).not.toBe(first);
    expect(res.body.user.email).toBe(fx.a1.email);

    const old = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(first) } });
    const next = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(res.body.refreshToken) } });
    expect(old.revokedAt).not.toBeNull();
    expect(old.replacedBy).toBe(next.id);
    expect(next.familyId).toBe(old.familyId);
    expect(next.revokedAt).toBeNull();

    // The new access token works.
    const me = await new Client(res.body.accessToken, fx.a1.email).get('/me');
    expect(me.status).toBe(200);
  });

  it('accepts the refresh token from the cookie', async () => {
    const login = await loginRaw(fx.a1.email);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    const res = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(login.body.refreshToken);
  });

  it('reusing a rotated token revokes the whole family', async () => {
    const login = await loginRaw(fx.a1.email);
    const t1 = login.body.refreshToken as string;
    const r2 = await refresh(t1);
    const t2 = r2.body.refreshToken as string;
    const r3 = await refresh(t2);
    const t3 = r3.body.refreshToken as string;
    expect(r3.status).toBe(200);

    expectError(await refresh(t1), 401, 'unauthenticated');
    // The newest token of the family is now dead too.
    expectError(await refresh(t3), 401);
    const family = await prisma.refreshToken.findMany({ where: { userId: fx.a1.id } });
    expect(family).toHaveLength(3);
    expect(family.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it('reuse does not touch other sessions (families) of the same user', async () => {
    const s1 = await loginRaw(fx.a1.email);
    const s2 = await loginRaw(fx.a1.email);
    const rotated = await refresh(s1.body.refreshToken);
    expect(rotated.status).toBe(200);
    expectError(await refresh(s1.body.refreshToken), 401);
    expect((await refresh(s2.body.refreshToken)).status).toBe(200);
  });

  it('rejects a missing or unknown token', async () => {
    expectError(await request(app).post('/api/v1/auth/refresh').send({}), 401, 'unauthenticated');
    expectError(await refresh('definitely-not-a-token'), 401, 'unauthenticated');
  });

  it('rejects an expired token', async () => {
    const login = await loginRaw(fx.a1.email);
    await prisma.refreshToken.updateMany({ where: { userId: fx.a1.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expectError(await refresh(login.body.refreshToken), 401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the refresh token family and clears the cookie', async () => {
    const login = await loginRaw(fx.a1.email);
    const rotated = await refresh(login.body.refreshToken);
    const res = await request(app).post('/api/v1/auth/logout').send({ refreshToken: rotated.body.refreshToken });
    expect(res.status).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/god_rt=;/);
    const rows = await prisma.refreshToken.findMany({ where: { userId: fx.a1.id } });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    expectError(await refresh(rotated.body.refreshToken), 401);
  });

  it('is a no-op without a token', async () => {
    expect((await request(app).post('/api/v1/auth/logout').send({})).status).toBe(204);
  });
});

describe('GET /me', () => {
  it('returns the caller including their email', async () => {
    const client = await as(fx.e1);
    const res = await client.get('/me');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: fx.e1.id, email: fx.e1.email, role: 'expert', timeZone: 'Asia/Seoul' });
  });

  it('requires a bearer token', async () => {
    expectError(await anon.get('/me'), 401, 'unauthenticated');
    expectError(await new Client('garbage').get('/me'), 401, 'unauthenticated');
  });

  it('reports an expired access token as token_expired', async () => {
    const token = jwt.sign({ role: 'associate' }, process.env.JWT_SECRET!, { subject: fx.a1.id, expiresIn: -10 });
    expectError(await new Client(token).get('/me'), 401, 'token_expired');
  });

  it('rejects a token signed with another secret', async () => {
    const token = jwt.sign({ role: 'founder' }, 'another-secret-another-secret-another-secret', { subject: fx.founder.id });
    expectError(await new Client(token).get('/me'), 401);
  });

  it('an access token stops working as soon as the user is deactivated', async () => {
    const client = await as(fx.a1);
    await prisma.user.update({ where: { id: fx.a1.id }, data: { isActive: false } });
    expectError(await client.get('/me'), 401, 'user_inactive');
  });
});

describe('PATCH /me/time-zone', () => {
  it.each(['founder', 'm1', 'a1'] as const)('is 403 for %s', async (key) => {
    const client = await as(fx[key]);
    expectError(await client.patch('/me/time-zone', { timeZone: 'Asia/Tokyo' }), 403, 'forbidden');
  });

  it('lets an expert set their zone', async () => {
    const client = await as(fx.e1);
    const res = await client.patch('/me/time-zone', { timeZone: 'Europe/Paris' });
    expect(res.status).toBe(200);
    expect(res.body.timeZone).toBe('Europe/Paris');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fx.e1.id } })).timeZone).toBe('Europe/Paris');
  });

  it.each(['Mars/Base', '+09:00', 'UTC+9', ''])('is 400 for an invalid zone %j', async (timeZone) => {
    const client = await as(fx.e1);
    expectError(await client.patch('/me/time-zone', { timeZone }), 400, 'validation_error');
  });
});
