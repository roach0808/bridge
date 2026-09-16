import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertNoEmails, clientsFor, makeCall, prisma, seedFixtures, type Client, type Fixtures } from './helpers';

/**
 * §2.2: nobody's email address is ever exposed except to themselves on /me.
 * The Client helper already asserts this on every response in every file;
 * this suite deliberately walks every read endpoint as every role after
 * generating rich data (messages, history, notifications, blocks).
 */
let fx: Fixtures;
let cs: Record<'founder' | 'm1' | 'm2' | 'a1' | 'a3' | 'e1' | 'e2', Client>;
let callId: string;

beforeAll(async () => {
  fx = await seedFixtures();
  cs = await clientsFor(fx, ['founder', 'm1', 'm2', 'a1', 'a3', 'e1', 'e2']);
  const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, scheduledAt: '2027-02-01T09:00:00Z' });
  callId = call.id;
  await makeCall(fx, { associate: fx.a3, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T12:00:00Z' });
  expect((await cs.a1.post(`/calls/${callId}/transition`, { to: 'scheduled', comment: 'ok' })).status).toBe(200);
  // Messaging is switched off, so rows are written directly: they must stay hidden and leak nothing.
  await prisma.message.createMany({
    data: [
      { callId, senderId: fx.e1.id, body: 'Hi, see you then' },
      { callId, senderId: fx.m1.id, body: 'Thanks!' },
    ],
  });
  expect((await cs.founder.post(`/profiles/${fx.pendingProfile.id}/approve`)).status).toBe(200);
  expect((await cs.e1.post(`/experts/${fx.e1.id}/schedule-blocks`, { kind: 'unavailable', startDate: '2027-02-01', repeat: { frequency: 'daily', untilDate: '2027-02-10' } })).status).toBe(201);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const RANGE = { from: '2027-01-31T00:00:00Z', to: '2027-02-07T00:00:00Z' };

describe('no endpoint leaks a fixture email', () => {
  const endpoints: Array<[string, (c: Client) => Promise<unknown>]> = [
    ['GET /users', (c) => c.get('/users')],
    ['GET /users/:id', (c) => c.get(`/users/${fx.e1.id}`)],
    ['GET /users/me/team', (c) => c.get('/users/me/team')],
    ['GET /calls', (c) => c.get('/calls')],
    ['GET /calls/:id', (c) => c.get(`/calls/${callId}`)],
    ['GET /calls/:id/messages', (c) => c.get(`/calls/${callId}/messages`)],
    ['GET /calls/:id/history', (c) => c.get(`/calls/${callId}/history`)],
    ['GET /calendar', (c) => c.get('/calendar', RANGE)],
    ['GET /calendar?expertId', (c) => c.get('/calendar', { ...RANGE, expertId: fx.e1.id })],
    ['GET /calendar/experts', (c) => c.get('/calendar/experts', RANGE)],
    ['GET /profiles', (c) => c.get('/profiles')],
    ['GET /profiles/:id', (c) => c.get(`/profiles/${fx.pendingProfile.id}`)],
    ['GET /notifications', (c) => c.get('/notifications')],
    ['GET /chat/contacts', (c) => c.get('/chat/contacts')],
    ['GET /chat/conversations', (c) => c.get('/chat/conversations')],
    ['GET /todos', (c) => c.get('/todos')],
    ['GET /todos/assignees', (c) => c.get('/todos/assignees')],
    ['GET /stats/associates', (c) => c.get('/stats/associates')],
    ['GET /stats/profiles', (c) => c.get('/stats/profiles')],
    ['GET /stats/finance', (c) => c.get('/stats/finance')],
    ['GET /platforms', (c) => c.get('/platforms')],
    ['GET /dashboard', (c) => c.get('/dashboard')],
    ['GET /avatars', (c) => c.get('/avatars')],
  ];
  const roles = ['founder', 'm1', 'm2', 'a1', 'a3', 'e1', 'e2'] as const;

  it.each(roles)('as %s, across every read endpoint', async (who) => {
    for (const [, hit] of endpoints) await hit(cs[who]); // Client asserts on each response
  });

  it('the data really did produce notifications and history to scan', async () => {
    const notes = await cs.m1.get('/notifications');
    expect(notes.body.items.length).toBeGreaterThan(0);
    const detail = await cs.founder.get(`/calls/${callId}`);
    expect(await prisma.message.count({ where: { callId } })).toBe(2);
    expect(detail.body.messages).toEqual([]);
    expect(detail.body.history).toHaveLength(2);
    const users = await cs.founder.get('/users');
    expect(users.body.length).toBe(fx.users.length);
  });

  it('/me shows the caller’s own email and nobody else’s', async () => {
    for (const who of roles) {
      const res = await cs[who].get('/me');
      expect(res.status).toBe(200);
      expect(res.body.email).toBe((fx[who] as { email: string }).email);
    }
  });

  it('the email detector itself catches a leak', () => {
    const fake = { text: JSON.stringify({ x: fx.a1.email }), req: { method: 'GET', path: '/x' } } as never;
    expect(() => assertNoEmails(fake)).toThrow();
    expect(() => assertNoEmails(fake, fx.a1.email)).not.toThrow();
  });
});
