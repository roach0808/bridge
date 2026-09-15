import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Configure push before the app (and its config) loads, and capture what would be sent.
const sent = vi.hoisted(() => ({ calls: [] as Array<{ endpoint: string; payload: Record<string, unknown> }>, fail: new Map<string, number>() }));
vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = 'BPublicKeyForTestsOnly_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  process.env.VAPID_PRIVATE_KEY = 'private-key-for-tests';
});
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (sub: { endpoint: string }, body: string) => {
      const status = sent.fail.get(sub.endpoint);
      if (status) throw Object.assign(new Error('push failed'), { statusCode: status });
      sent.calls.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
    }),
  },
}));

const { as, expectError, prisma, seedFixtures } = await import('./helpers');
type Fixtures = Awaited<ReturnType<typeof seedFixtures>>;

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
  sent.calls.length = 0;
  sent.fail.clear();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const sub = (n: number) => ({ endpoint: `https://push.example.com/send/${n}`, keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` } });
const waitForPush = async (count: number) => {
  for (let i = 0; i < 50 && sent.calls.length < count; i++) await new Promise((r) => setTimeout(r, 20));
};

describe('browser push', () => {
  it('exposes the public key and stores, moves and removes subscriptions', async () => {
    const a1 = await as(fx.a1);
    expect((await a1.get('/push/config')).body.publicKey).toMatch(/^BPublicKey/);

    expect((await a1.post('/push/subscriptions', sub(1))).status).toBe(204);
    expect((await a1.post('/push/subscriptions', sub(1))).status).toBe(204);
    expect(await prisma.webPushSubscription.count()).toBe(1);

    // Someone else signs in on the same browser: the subscription follows them.
    await (await as(fx.a2)).post('/push/subscriptions', sub(1));
    expect((await prisma.webPushSubscription.findFirstOrThrow()).userId).toBe(fx.a2.id);

    expectError(await a1.post('/push/subscriptions', { endpoint: 'not a url', keys: {} }), 400);
    // a1 cannot remove a2's subscription; a2 can.
    await a1.delete('/push/subscriptions', { endpoint: sub(1).endpoint });
    expect(await prisma.webPushSubscription.count()).toBe(1);
    expect((await (await as(fx.a2)).delete('/push/subscriptions', { endpoint: sub(1).endpoint })).status).toBe(204);
    expect(await prisma.webPushSubscription.count()).toBe(0);
  });

  it('a chat message is pushed to the other person, linking to the chat', async () => {
    const founder = await as(fx.founder);
    await (await as(fx.a1)).post('/push/subscriptions', sub(2));
    await founder.post('/push/subscriptions', sub(3));
    const conv = (await founder.post('/chat/conversations', { userId: fx.a1.id })).body;
    await founder.post(`/chat/conversations/${conv.id}/messages`, { body: 'Can you check the Q3 numbers?' });
    await waitForPush(1);
    expect(sent.calls).toEqual([
      {
        endpoint: sub(2).endpoint,
        payload: { title: 'Founder', body: 'Can you check the Q3 numbers?', url: `/chat/${conv.id}`, tag: `chat:${conv.id}`, kind: 'chat' },
      },
    ]);
  });

  it('notifications are pushed too (a to-do assigned)', async () => {
    const founder = await as(fx.founder);
    await (await as(fx.e1)).post('/push/subscriptions', sub(4));
    const conv = (await founder.post('/chat/conversations', { userId: fx.e1.id })).body;
    const msg = (await founder.post(`/chat/conversations/${conv.id}/messages`, { body: 'Update your calendar' })).body;
    await founder.post(`/chat/messages/${msg.id}/todo`);
    await waitForPush(2);
    expect(sent.calls.map((c) => c.payload)).toContainEqual(
      expect.objectContaining({ title: 'Founder gave you a to-do', body: 'Update your calendar', url: '/todos', kind: 'notification' }),
    );
  });

  it('subscriptions the push service reports gone are deleted', async () => {
    const founder = await as(fx.founder);
    await (await as(fx.m1)).post('/push/subscriptions', sub(5));
    sent.fail.set(sub(5).endpoint, 410);
    const conv = (await founder.post('/chat/conversations', { userId: fx.m1.id })).body;
    await founder.post(`/chat/conversations/${conv.id}/messages`, { body: 'hello' });
    for (let i = 0; i < 50 && (await prisma.webPushSubscription.count()) > 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await prisma.webPushSubscription.count()).toBe(0);
  });
});
