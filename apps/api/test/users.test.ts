import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, app, as, expectError, loginRaw, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const newUser = (over: Record<string, unknown>) => ({
  nickname: 'NewPerson',
  email: 'newperson@fixtures.test',
  password: 'A-long-enough-password',
  ...over,
});

describe('GET /users', () => {
  it('founder sees everyone, without emails', async () => {
    const res = await (await as(fx.founder)).get('/users');
    expect(res.status).toBe(200);
    expect(res.body.map((u: { id: string }) => u.id).sort()).toEqual(fx.users.map((u) => u.id).sort());
    for (const u of res.body) {
      expect(u).not.toHaveProperty('email');
      expect(u).not.toHaveProperty('passwordHash');
    }
  });

  it('manager sees own associates and all experts only', async () => {
    const res = await (await as(fx.m1)).get('/users');
    expect(res.body.map((u: { id: string }) => u.id).sort()).toEqual([fx.a1.id, fx.a2.id, fx.e1.id, fx.e2.id, fx.e3.id].sort());
    expectError(await (await as(fx.m1)).get(`/users/${fx.a3.id}`), 404);
    expectError(await (await as(fx.m1)).get(`/users/${fx.founder.id}`), 404);
  });

  it('filters by role', async () => {
    const res = await (await as(fx.founder)).get('/users', { role: 'expert' });
    expect(res.body.map((u: { nickname: string }) => u.nickname).sort()).toEqual(['ExpertLondon', 'ExpertNY', 'ExpertSeoul']);
  });

  it('manager team endpoint', async () => {
    const res = await (await as(fx.m2)).get('/users/me/team');
    expect(res.body.map((u: { id: string }) => u.id).sort()).toEqual([fx.a3.id, fx.a4.id].sort());
  });

  it.each(['a1', 'e1'] as const)('%s gets 403', async (who) => {
    expectError(await (await as(fx[who])).get('/users'), 403, 'forbidden');
  });
});

describe('POST /users', () => {
  it('manager creates an associate in their own team', async () => {
    const res = await (await as(fx.m1)).post('/users', newUser({ role: 'associate' }));
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ role: 'associate', managerId: fx.m1.id, avatarId: 'associate-01', isActive: true });
    expect(res.body).not.toHaveProperty('email');
    expect((await loginRaw('newperson@fixtures.test', 'A-long-enough-password')).status).toBe(200);
  });

  it('manager may name themselves as manager but not another manager', async () => {
    const m1 = await as(fx.m1);
    expect((await m1.post('/users', newUser({ role: 'associate', managerId: fx.m1.id }))).status).toBe(201);
    expectError(await m1.post('/users', newUser({ role: 'associate', nickname: 'Other', email: 'other@fixtures.test', managerId: fx.m2.id })), 403);
    expect(await prisma.user.count({ where: { nickname: 'Other' } })).toBe(0);
  });

  it.each(['expert', 'manager', 'founder'] as const)('manager cannot create a %s', async (role) => {
    expectError(await (await as(fx.m1)).post('/users', newUser({ role })), 403, 'forbidden');
  });

  it('founder creates a manager, an expert with a time zone and an associate for any manager', async () => {
    const f = await as(fx.founder);
    const mgr = await f.post('/users', newUser({ role: 'manager', nickname: 'Mgr3', email: 'mgr3@fixtures.test' }));
    expect(mgr.status, mgr.text).toBe(201);
    const exp = await f.post('/users', newUser({ role: 'expert', nickname: 'Exp4', email: 'exp4@fixtures.test', timeZone: 'Asia/Tokyo' }));
    expect(exp.status, exp.text).toBe(201);
    expect(exp.body).toMatchObject({ role: 'expert', timeZone: 'Asia/Tokyo', managerId: null });
    const asc = await f.post('/users', newUser({ role: 'associate', nickname: 'Asc5', email: 'asc5@fixtures.test', managerId: fx.m2.id }));
    expect(asc.status, asc.text).toBe(201);
    expect(asc.body.manager).toMatchObject({ id: fx.m2.id, nickname: 'ManagerTwo' });
  });

  it('founder must give an associate an active manager', async () => {
    const f = await as(fx.founder);
    expectError(await f.post('/users', newUser({ role: 'associate' })), 400);
    expectError(await f.post('/users', newUser({ role: 'associate', managerId: fx.e1.id })), 400);
    await prisma.user.update({ where: { id: fx.m2.id }, data: { isActive: false } });
    expectError(await f.post('/users', newUser({ role: 'associate', managerId: fx.m2.id })), 400);
  });

  it('only experts get a time zone, only associates get a manager', async () => {
    const f = await as(fx.founder);
    expectError(await f.post('/users', newUser({ role: 'manager', timeZone: 'Asia/Tokyo' })), 400);
    expectError(await f.post('/users', newUser({ role: 'expert', managerId: fx.m1.id })), 400);
  });

  it('duplicate email or nickname (case-insensitive) is 409', async () => {
    const f = await as(fx.founder);
    const dupEmail = await f.post('/users', newUser({ role: 'expert', email: fx.e1.email }));
    expectError(dupEmail, 409, 'conflict');
    expect(dupEmail.body.error.details).toEqual({ field: 'email' });
    const dupNick = await f.post('/users', newUser({ role: 'expert', nickname: 'expertseoul' }));
    expectError(dupNick, 409, 'conflict');
    expect(dupNick.body.error.details).toEqual({ field: 'nickname' });
  });

  it('a wrong avatar set is 400', async () => {
    expectError(await (await as(fx.founder)).post('/users', newUser({ role: 'expert', avatarId: 'founder-01' })), 400);
  });

  it('associates and experts cannot create users', async () => {
    expectError(await (await as(fx.a1)).post('/users', newUser({ role: 'associate' })), 403);
    expectError(await (await as(fx.e1)).post('/users', newUser({ role: 'associate' })), 403);
  });
});

describe('PATCH /users/:id and deactivation', () => {
  it('deactivation blocks login and refresh, and revokes refresh tokens', async () => {
    const session = await loginRaw(fx.a2.email);
    const res = await (await as(fx.founder)).patch(`/users/${fx.a2.id}`, { isActive: false });
    expect(res.status, res.text).toBe(200);
    expect(res.body.isActive).toBe(false);

    expectError(await loginRaw(fx.a2.email), 401, 'user_inactive');
    const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.body.refreshToken });
    expectError(refresh, 401);
    const tokens = await prisma.refreshToken.findMany({ where: { userId: fx.a2.id } });
    expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
  });

  it('refresh is refused for a deactivated user even with an unrevoked token', async () => {
    const session = await loginRaw(fx.a2.email);
    await prisma.user.update({ where: { id: fx.a2.id }, data: { isActive: false } });
    const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.body.refreshToken });
    expectError(refresh, 401, 'user_inactive');
  });

  it('reactivation restores login', async () => {
    const f = await as(fx.founder);
    await f.patch(`/users/${fx.a2.id}`, { isActive: false });
    await f.patch(`/users/${fx.a2.id}`, { isActive: true });
    expect((await loginRaw(fx.a2.email, PASSWORD)).status).toBe(200);
  });

  it('manager may deactivate own associate but not another team’s or an expert', async () => {
    const m1 = await as(fx.m1);
    expect((await m1.patch(`/users/${fx.a1.id}`, { isActive: false })).status).toBe(200);
    expectError(await m1.patch(`/users/${fx.a3.id}`, { isActive: false }), 404);
    expectError(await m1.patch(`/users/${fx.e1.id}`, { isActive: false }), 403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fx.e1.id } })).isActive).toBe(true);
  });

  it('manager cannot move associates or set time zones', async () => {
    expectError(await (await as(fx.m1)).patch(`/users/${fx.a1.id}`, { managerId: fx.m2.id }), 403);
  });

  it('founder moves an associate to another manager', async () => {
    const res = await (await as(fx.founder)).patch(`/users/${fx.a1.id}`, { managerId: fx.m2.id });
    expect(res.status).toBe(200);
    expect(res.body.managerId).toBe(fx.m2.id);
  });

  it('nobody deactivates themselves', async () => {
    expectError(await (await as(fx.founder)).patch(`/users/${fx.founder.id}`, { isActive: false }), 400);
  });

  it('founder sets an expert time zone but not a manager’s', async () => {
    const f = await as(fx.founder);
    expect((await f.patch(`/users/${fx.e2.id}`, { timeZone: 'America/Chicago' })).body.timeZone).toBe('America/Chicago');
    expectError(await f.patch(`/users/${fx.m1.id}`, { timeZone: 'America/Chicago' }), 400);
  });
});

describe('DELETE /users/:id', () => {
  it('erases the account and frees the email, while their past work stays', async () => {
    const founder = await as(fx.founder);
    const call = await makeCall(fx, { associate: fx.a2, expert: fx.e2, status: 'process_to_bank' });
    const conversation = await prisma.conversation.create({
      data: { userAId: [fx.a2.id, fx.founder.id].sort()[0]!, userBId: [fx.a2.id, fx.founder.id].sort()[1]!, lastMessageAt: new Date() },
    });
    await prisma.chatMessage.create({ data: { conversationId: conversation.id, senderId: fx.a2.id, body: 'my last word' } });

    expect((await founder.delete(`/users/${fx.a2.id}`)).status).toBe(204);
    const gone = await prisma.user.findUniqueOrThrow({ where: { id: fx.a2.id } });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.isActive).toBe(false);
    expect(gone.nickname).toMatch(/^Removed user /);
    expect(gone.email).not.toBe(fx.a2.email);
    expect(await prisma.refreshToken.count({ where: { userId: fx.a2.id, revokedAt: null } })).toBe(0);

    // Their work is untouched, and names them as a removed user.
    expect(await prisma.call.findUniqueOrThrow({ where: { id: call.id } })).toMatchObject({ associateId: fx.a2.id });
    expect(await prisma.chatMessage.count({ where: { senderId: fx.a2.id } })).toBe(1);
    expect((await founder.get(`/calls/${call.id}`)).body.associate.nickname).toMatch(/^Removed user /);

    // Gone from every list, and they cannot sign in or be reached.
    expect((await founder.get('/users')).body.some((u: { id: string }) => u.id === fx.a2.id)).toBe(false);
    expectError(await founder.get(`/users/${fx.a2.id}`), 404);
    expect((await founder.get('/chat/contacts')).body.some((u: { id: string }) => u.id === fx.a2.id)).toBe(false);
    expect((await founder.get('/stats/associates')).body.rows.some((r: { associate: { id: string } }) => r.associate.id === fx.a2.id)).toBe(false);
    expect((await loginRaw(fx.a2.email)).status).toBe(401);

    // The email is free for a new account.
    const reused = await founder.post('/users', newUser({ role: 'associate', managerId: fx.m1.id, email: fx.a2.email }));
    expect(reused.status, reused.text).toBe(201);
  });

  it('refuses yourself, a Manager with a team, and unfinished calls', async () => {
    const founder = await as(fx.founder);
    expectError(await founder.delete(`/users/${fx.founder.id}`), 400);
    expectError(await founder.delete(`/users/${fx.m1.id}`), 409);

    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled' });
    expectError(await founder.delete(`/users/${fx.a1.id}`), 409);
    expectError(await founder.delete(`/users/${fx.e1.id}`), 409);
    expectError(await (await as(fx.m1)).delete(`/users/${fx.a1.id}`), 403);
    expectError(await founder.delete(`/users/${fx.founder.id.replace(/.$/, '0')}`), 404);
  });

  it('a Manager can be deleted once their Associates have moved', async () => {
    const founder = await as(fx.founder);
    for (const a of [fx.a1, fx.a2]) await founder.patch(`/users/${a.id}`, { managerId: fx.m2.id });
    expect((await founder.delete(`/users/${fx.m1.id}`)).status).toBe(204);
    expect((await founder.get('/users')).body.some((u: { id: string }) => u.id === fx.m1.id)).toBe(false);
  });
});
