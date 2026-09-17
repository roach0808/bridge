import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { anon, app, as, expectError, prisma, seedFixtures, type Fixtures } from './helpers';

// Google's token check is replaced: a credential "google:<sub>:<email>" stands for a verified account.
vi.mock('../src/auth/google', () => ({
  verifyGoogleCredential: async (credential: string) => {
    const [kind, subject, email] = credential.split(':');
    return kind === 'google' && subject && email ? { subject, email: email.toLowerCase() } : null;
  },
}));

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const credential = (sub: string, email: string) => `google:${sub}:${email}`.padEnd(24, '_');
// Straight through supertest: the response describes the caller, email included, which the Client would flag.
const signIn = (sub: string, email: string) => request(app).post('/api/v1/auth/google').send({ credential: credential(sub, email) });

describe('Google sign-in', () => {
  it('publishes the client ID for the login page', async () => {
    expect((await anon.get('/auth/config')).body).toEqual({ googleClientId: 'test-client.apps.googleusercontent.com' });
  });

  it('links on the first sign-in by email, then recognises the Google account by its id', async () => {
    const first = await signIn('sub-a1', fx.a1.email.toUpperCase());
    expect(first.status, first.text).toBe(200);
    expect(first.body.user).toMatchObject({ id: fx.a1.id });
    expect(first.body.accessToken).toBeTruthy();
    expect(await prisma.authIdentity.count({ where: { userId: fx.a1.id, provider: 'google', subject: 'sub-a1' } })).toBe(1);

    // Their Gmail address changed at Google: the id still signs them in.
    const again = await signIn('sub-a1', 'renamed@gmail.com');
    expect(again.body.user.id).toBe(fx.a1.id);
    const link = await prisma.authIdentity.findFirstOrThrow({ where: { userId: fx.a1.id } });
    expect(link.email).toBe('renamed@gmail.com');
    expect(link.lastUsedAt).not.toBeNull();

    const me = await as(fx.a1);
    expect((await me.get('/me/google')).body).toMatchObject({ email: 'renamed@gmail.com' });
    // Audit entries are written just after the response.
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { action: 'auth.google', userId: fx.a1.id } })).toBeGreaterThan(0));
  });

  it('refuses unknown accounts, a second Google account, deactivated users and bad tokens', async () => {
    expectError(await signIn('sub-x', 'stranger@gmail.com'), 401, 'invalid_credentials');
    // Audit entries are written just after the response.
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { action: 'auth.google.failed' } })).toBeGreaterThan(0));

    await signIn('sub-m1', fx.m1.email);
    expectError(await signIn('sub-other', fx.m1.email), 401, 'invalid_credentials');

    await prisma.user.update({ where: { id: fx.a2.id }, data: { isActive: false } });
    expectError(await signIn('sub-a2', fx.a2.email), 401, 'user_inactive');

    expectError(await anon.post('/auth/google', { credential: 'not-a-google-token-at-all' }), 401, 'invalid_credentials');
    expectError(await anon.post('/auth/google', {}), 400);
  });

  it('the founder sees and changes sign-in details and unlinks Google; nobody else can', async () => {
    await signIn('sub-e1', fx.e1.email);
    const founder = await as(fx.founder);
    // The Client refuses emails in responses, so read this one without it.
    const details = await prisma.user.findUniqueOrThrow({ where: { id: fx.e1.id }, select: { email: true } });
    const raw = (method: 'get' | 'patch' | 'delete', path: string, body?: object) =>
      request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${founder.token}`).send(body);

    const read = await raw('get', `/users/${fx.e1.id}/sign-in`);
    expect(read.status, read.text).toBe(200);
    expect(read.body).toMatchObject({ email: details.email, google: { email: fx.e1.email } });

    const changed = await raw('patch', `/users/${fx.e1.id}/sign-in`, { email: 'Seoul.Expert@gmail.com' });
    expect(changed.body.email).toBe('seoul.expert@gmail.com');
    expect((await raw('patch', `/users/${fx.e1.id}/sign-in`, { email: fx.m1.email })).status).toBe(409);

    const unlinked = await raw('delete', `/users/${fx.e1.id}/google`);
    expect(unlinked.body.google).toBeNull();
    // After unlinking, the next Google sign-in links again by the (new) email.
    expect((await signIn('sub-new', 'seoul.expert@gmail.com')).body.user.id).toBe(fx.e1.id);

    expectError(await (await as(fx.m1)).get(`/users/${fx.a1.id}/sign-in`), 403);
    // Audit entries are written just after the response.
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { action: 'user.sign_in.read' } })).toBeGreaterThan(0));
  });
});
