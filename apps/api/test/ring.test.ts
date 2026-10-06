import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Every socket event the API sends, to whom.
const emitted = vi.hoisted(() => [] as Array<{ userId: string; event: string; payload: Record<string, unknown> }>);
vi.mock('../src/realtime/hub', async (original) => ({
  ...(await original<typeof import('../src/realtime/hub')>()),
  emitToUser: (userId: string, event: string, payload: Record<string, unknown>) => emitted.push({ userId, event, payload }),
}));

const { as, expectError, prisma, seedFixtures } = await import('./helpers');
const { stopAllRings } = await import('../src/chat/chat.routes');
type Fixtures = Awaited<ReturnType<typeof seedFixtures>>;
type FixtureUser = Fixtures['m1'];

let fx: Fixtures;
beforeEach(async () => {
  stopAllRings();
  emitted.length = 0;
  fx = await seedFixtures();
});
afterAll(async () => {
  stopAllRings();
  await prisma.$disconnect();
});

async function chat(a: FixtureUser, b: FixtureUser) {
  const ca = await as(a);
  const cb = await as(b);
  const id = (await ca.post('/chat/conversations', { userId: b.id })).body.id as string;
  return { ca, cb, id };
}
const events = (event: string) => emitted.filter((e) => e.event === event);

describe('ringing', () => {
  it('a manager rings an expert: the chat keeps a ring, both screens hear of it', async () => {
    const { ca: m1, cb: e1, id } = await chat(fx.m1, fx.e1);
    const res = await m1.post(`/chat/conversations/${id}/ring`);
    expect(res.status, res.text).toBe(201);
    const { ring, message } = res.body;
    expect(ring).toMatchObject({ id: message.id, conversationId: id, from: { id: fx.m1.id }, to: { id: fx.e1.id, nickname: fx.e1.nickname } });
    expect(Date.parse(ring.endsAt) - Date.parse(ring.startedAt)).toBe(45_000);
    expect(message).toMatchObject({ kind: 'ring', body: 'Rang', sender: { id: fx.m1.id } });

    expect(events('chat:ring').map((e) => e.userId).sort()).toEqual([fx.m1.id, fx.e1.id].sort());
    expect(events('chat:message')).toHaveLength(2);

    // It is the chat's latest message, unread by the one rung.
    const list = (await e1.get('/chat/conversations')).body;
    expect(list[0]).toMatchObject({ id, unreadCount: 1, lastMessage: { kind: 'ring' } });
    expect((await e1.get('/chat/rings')).body).toEqual([ring]);
    expect((await m1.get('/chat/rings')).body).toEqual([ring]);
    expect((await (await as(fx.a1)).get('/chat/rings')).body).toEqual([]);
  });

  it('one ring at a time; the one rung opens the chat or closes it, the ringer cancels', async () => {
    const { ca: e1, cb: a1, id } = await chat(fx.e1, fx.a1);
    const first = (await e1.post(`/chat/conversations/${id}/ring`)).body.ring;
    expectError(await e1.post(`/chat/conversations/${id}/ring`), 409);
    expectError(await a1.post(`/chat/conversations/${id}/ring`), 409);

    expect((await a1.post(`/chat/rings/${first.id}/end`, { opened: true })).status).toBe(204);
    expect(events('chat:ring-ended').map((e) => e.payload)).toEqual([
      { id: first.id, conversationId: id, reason: 'opened' },
      { id: first.id, conversationId: id, reason: 'opened' },
    ]);
    expect((await a1.get('/chat/rings')).body).toEqual([]);
    // Already over: nothing more happens.
    expect((await e1.post(`/chat/rings/${first.id}/end`)).status).toBe(204);
    expect(events('chat:ring-ended')).toHaveLength(2);

    // Either side may ring.
    const second = (await a1.post(`/chat/conversations/${id}/ring`)).body.ring;
    await e1.post(`/chat/rings/${second.id}/end`);
    const third = (await a1.post(`/chat/conversations/${id}/ring`)).body.ring;
    await a1.post(`/chat/rings/${third.id}/end`);
    expect(events('chat:ring-ended').map((e) => e.payload.reason)).toEqual(['opened', 'opened', 'closed', 'closed', 'cancelled', 'cancelled']);
    expect((await a1.get(`/chat/conversations/${id}/messages`)).body.items.map((m: { kind: string }) => m.kind)).toEqual(['ring', 'ring', 'ring']);
  });

  it('outsiders can neither ring nor stop a ring; a closed chat cannot ring', async () => {
    const { ca: m1, id } = await chat(fx.m1, fx.a1);
    const a2 = await as(fx.a2);
    expectError(await a2.post(`/chat/conversations/${id}/ring`), 404);
    const ring = (await m1.post(`/chat/conversations/${id}/ring`)).body.ring;
    expectError(await a2.post(`/chat/rings/${ring.id}/end`), 404);
    expect((await m1.get('/chat/rings')).body).toHaveLength(1);
    await m1.post(`/chat/rings/${ring.id}/end`);

    await prisma.user.update({ where: { id: fx.a1.id }, data: { isActive: false } });
    expectError(await m1.post(`/chat/conversations/${id}/ring`), 403);
  });

  it('a ring stays in the chat: it cannot be deleted or made a task', async () => {
    const { ca: m1, id } = await chat(fx.m1, fx.a1);
    const { message } = (await m1.post(`/chat/conversations/${id}/ring`)).body;
    expectError(await m1.delete(`/chat/messages/${message.id}`), 409);
    expectError(await m1.post(`/chat/messages/${message.id}/todo`), 409);
  });
});
