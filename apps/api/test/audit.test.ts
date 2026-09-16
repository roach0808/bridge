import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { trimAuditTrail } from '../src/backup/dumps';
import { app, as, expectError, makeCall, prisma, seedFixtures, PASSWORD, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
  await prisma.auditLog.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** The trail is written after the response, so give it a moment to land. */
async function trail(where: object = {}, expected = 1) {
  for (let i = 0; i < 60; i++) {
    const rows = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' } });
    if (rows.length >= expected) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
  return prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' } });
}

describe('audit trail', () => {
  it('records a change with who, what and from where', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    const res = await request(app)
      .post(`/api/v1/calls/${call.id}/transition`)
      .set('Authorization', `Bearer ${(await as(fx.e1)).token}`)
      .set('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile Safari/604.1')
      .set('x-vercel-ip-country', 'KR')
      .send({ to: 'confirmed' });
    expect(res.status, res.text).toBe(200);

    const [entry] = await trail({ action: 'call.transition' });
    expect(entry).toMatchObject({
      userId: fx.e1.id,
      actorRole: 'expert',
      actorName: 'ExpertSeoul',
      action: 'call.transition',
      entityId: call.id,
      method: 'POST',
      statusCode: 200,
      country: 'KR',
      deviceType: 'mobile',
    });
    expect(entry!.sessionId).toBeTruthy();
  });

  it('records refused attempts too', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    // The Associate may not confirm: that edge belongs to the Expert.
    expectError(await (await as(fx.a1)).post(`/calls/${call.id}/transition`, { to: 'confirmed' }), 403);
    const [entry] = await trail({ action: 'call.transition.failed' });
    expect(entry).toMatchObject({ userId: fx.a1.id, statusCode: 403 });
    expect(entry!.summary).toMatch(/refused/);
    expect(entry!.summary).toMatch(/moved a call/);
  });

  it('records sign-ins, failed sign-ins with the attempted email, and sign-outs', async () => {
    const ok = await request(app).post('/api/v1/auth/login').send({ email: fx.m1.email, password: PASSWORD });
    expect(ok.status).toBe(200);
    const [signIn] = await trail({ action: 'auth.login' });
    expect(signIn).toMatchObject({ userId: fx.m1.id, actorName: 'ManagerOne' });

    await request(app).post('/api/v1/auth/login').send({ email: fx.m1.email, password: 'wrong-password' });
    const [failed] = await trail({ action: 'auth.login.failed' });
    expect(failed).toMatchObject({ userId: null, statusCode: 401 });
    expect(failed!.meta).toMatchObject({ email: fx.m1.email });
    // The API shortens it, because no endpoint may return an address.
    const shown = await (await as(fx.founder)).get('/audit', { action: 'auth.login.failed' });
    expect(shown.body.items[0].meta.email).toBe('ma***@fixtures.test');

    await request(app).post('/api/v1/auth/logout').send({ refreshToken: ok.body.refreshToken });
    expect(await trail({ action: 'auth.logout' })).toHaveLength(1);
  });

  it('records reads of bank details and database dumps, but not ordinary reads', async () => {
    const founder = await as(fx.founder);
    await founder.get(`/profiles/${fx.approvedProfile.id}/banks`);
    await founder.get('/db-dumps');
    await founder.get('/calls');
    await founder.get('/dashboard');
    const rows = await trail({}, 2);
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('bank.read');
    expect(actions).toContain('dump.read');
    expect(actions.some((a) => a.startsWith('call') || a.startsWith('dashboard'))).toBe(false);
  });

  it('token renewals and read receipts are left out', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: fx.a2.email, password: PASSWORD });
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: login.body.refreshToken });
    await (await as(fx.a2)).post('/notifications/read', { all: true });
    await new Promise((r) => setTimeout(r, 200));
    const actions = (await prisma.auditLog.findMany()).map((a) => a.action);
    expect(actions).not.toContain('auth.refresh.post');
    expect(actions.some((a) => a.startsWith('notifications'))).toBe(false);
  });

  it('only the Founder reads the trail, with filters and paging', async () => {
    const founder = await as(fx.founder);
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    await (await as(fx.e1)).post(`/calls/${call.id}/transition`, { to: 'confirmed' });
    await founder.patch(`/calls/${call.id}`, { notes: 'looked at' });
    await trail({}, 2);

    expectError(await (await as(fx.m1)).get('/audit'), 403);
    const all = await founder.get('/audit');
    expect(all.status, all.text).toBe(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    expect(all.body.items[0]).toMatchObject({ actorName: expect.any(String), action: expect.any(String) });

    const byUser = await founder.get('/audit', { userId: fx.e1.id });
    expect(byUser.body.items.every((i: { userId: string }) => i.userId === fx.e1.id)).toBe(true);
    const byAction = await founder.get('/audit', { action: 'call' });
    expect(byAction.body.items.every((i: { action: string }) => i.action.startsWith('call'))).toBe(true);
    expect((await founder.get('/audit', { q: 'transition' })).body.items.length).toBeGreaterThan(0);
    expect((await founder.get('/audit', { pageSize: 1 })).body.items).toHaveLength(1);
    expect((await founder.get('/audit/actions')).body).toEqual(expect.arrayContaining(['call.transition']));
  });

  it('entries older than a year are trimmed by the nightly job', async () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    await prisma.auditLog.create({
      data: { action: 'call.update', summary: 'old', method: 'PATCH', path: '/api/v1/calls/x', statusCode: 200, createdAt: old },
    });
    await prisma.auditLog.create({
      data: { action: 'call.update', summary: 'recent', method: 'PATCH', path: '/api/v1/calls/y', statusCode: 200 },
    });
    expect(await trimAuditTrail()).toBe(1);
    expect((await prisma.auditLog.findMany()).map((a) => a.summary)).toEqual(['recent']);
  });
});

describe('the trail keeps no address for a successful sign-in', () => {
  it('only failed attempts carry the email', async () => {
    const fx2 = await seedFixtures();
    await prisma.auditLog.deleteMany();
    await request(app).post('/api/v1/auth/login').send({ email: fx2.a1.email, password: PASSWORD });
    for (let i = 0; i < 60; i++) {
      const rows = await prisma.auditLog.findMany({ where: { action: 'auth.login' } });
      if (rows.length) {
        expect(rows[0]!.meta).toBeNull();
        return;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('no sign-in recorded');
  });
});
