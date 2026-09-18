import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, expectError, prisma, seedFixtures, type Client, type FixtureUser, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

// A 1×1 PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const image = { dataUrl: PNG, width: 1, height: 1 };

async function chat(a: FixtureUser, b: FixtureUser) {
  const ca = await as(a);
  const cb = await as(b);
  const id = (await ca.post('/chat/conversations', { userId: b.id })).body.id as string;
  return { ca, cb, id };
}
const send = (c: Client, id: string, body: Record<string, unknown>) => c.post(`/chat/conversations/${id}/messages`, body);

describe('chat pictures', () => {
  it('sends a picture with or without a caption; only the two people can load it', async () => {
    const { ca, cb, id } = await chat(fx.m1, fx.a1);
    const res = await send(ca, id, { image });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ body: '', image: { width: 1, height: 1 }, deleted: false, reactions: [] });
    const withCaption = await send(ca, id, { body: ' look ', image });
    expect(withCaption.body.body).toBe('look');

    const loaded = await cb.get(`/chat/images/${res.body.image.id}`);
    expect(loaded.status).toBe(200);
    expect(loaded.headers['content-type']).toBe('image/png');
    expect(loaded.headers['cache-control']).toContain('private');
    expectError(await (await as(fx.m2)).get(`/chat/images/${res.body.image.id}`), 404);

    const list = (await cb.get('/chat/conversations')).body[0];
    expect(list.lastMessage).toMatchObject({ hasImage: true, deleted: false, body: 'look' });
  });

  it('refuses empty messages, fake images and pictures that are too big', async () => {
    const { ca, id } = await chat(fx.m1, fx.a1);
    expectError(await send(ca, id, { body: '   ' }), 400, 'validation_error');
    expectError(await send(ca, id, { image: { ...image, dataUrl: 'data:image/png;base64,aGVsbG8gd29ybGQ=' } }), 400);
    const huge = `data:image/png;base64,${Buffer.alloc(1024 * 1024 + 10).toString('base64')}`;
    expectError(await send(ca, id, { image: { ...image, dataUrl: huge } }), 400);
    expect(await prisma.chatImage.count()).toBe(0);
  });
});

describe('deleting messages', () => {
  it('the sender deletes for both: text, picture and reactions are erased, a placeholder stays', async () => {
    const { ca, cb, id } = await chat(fx.founder, fx.e1);
    const msg = (await send(ca, id, { body: 'secret plan', image })).body;
    await cb.post(`/chat/messages/${msg.id}/reactions`, { emoji: '👍' });

    expectError(await cb.delete(`/chat/messages/${msg.id}`), 403);
    const res = await ca.delete(`/chat/messages/${msg.id}`);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ id: msg.id, deleted: true, body: '', image: null, reactions: [] });

    const row = await prisma.chatMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(row.body).toBe('');
    expect(await prisma.chatImage.count()).toBe(0);
    expect(await prisma.chatReaction.count()).toBe(0);
    expectError(await cb.get(`/chat/images/${msg.image.id}`), 404);

    const seen = (await cb.get(`/chat/conversations/${id}/messages`)).body.items[0];
    expect(seen).toMatchObject({ deleted: true, body: '' });
    expect((await cb.get('/chat/conversations')).body[0].lastMessage).toMatchObject({ deleted: true, hasImage: false });

    expectError(await ca.delete(`/chat/messages/${msg.id}`), 409);
    expectError(await cb.post(`/chat/messages/${msg.id}/reactions`, { emoji: '👍' }), 409);
    expectError(await (await as(fx.m1)).delete(`/chat/messages/${msg.id}`), 404);
  });

  it('a message that is a task cannot be deleted until the task is removed', async () => {
    const { ca, id } = await chat(fx.founder, fx.a1);
    const msg = (await send(ca, id, { body: 'Send the report' })).body;
    await ca.post(`/chat/messages/${msg.id}/todo`);
    expectError(await ca.delete(`/chat/messages/${msg.id}`), 409);
    await ca.delete(`/chat/messages/${msg.id}/todo`);
    expect((await ca.delete(`/chat/messages/${msg.id}`)).status).toBe(200);
  });

  it('a reply to a deleted message shows the original as deleted', async () => {
    const { ca, cb, id } = await chat(fx.founder, fx.a2);
    const msg = (await send(ca, id, { body: 'Call Hanbit' })).body;
    const todo = (await ca.post(`/chat/messages/${msg.id}/todo`)).body;
    await cb.post(`/todos/${todo.id}/done`, { note: 'Done it' });
    // The task keeps its message; a plain earlier message can go.
    const other = (await send(cb, id, { body: 'typo' })).body;
    expect((await cb.delete(`/chat/messages/${other.id}`)).body.deleted).toBe(true);
    const reply = (await ca.get(`/chat/conversations/${id}/messages`)).body.items.find((m: { kind: string }) => m.kind === 'todo_done');
    expect(reply.replyTo).toMatchObject({ id: msg.id, deleted: false, hasImage: false });
    expectError(await cb.delete(`/chat/messages/${reply.id}`), 409);
  });
});

describe('reactions', () => {
  it('toggles each emoji per person and groups them', async () => {
    const { ca, cb, id } = await chat(fx.m1, fx.m2);
    const msg = (await send(ca, id, { body: 'Ready for Friday?' })).body;
    await ca.post(`/chat/messages/${msg.id}/reactions`, { emoji: '👍' });
    const both = await cb.post(`/chat/messages/${msg.id}/reactions`, { emoji: '👍' });
    expect(both.body.reactions).toEqual([{ emoji: '👍', userIds: [fx.m1.id, fx.m2.id] }]);
    const more = await cb.post(`/chat/messages/${msg.id}/reactions`, { emoji: '❤️' });
    expect(more.body.reactions.map((r: { emoji: string }) => r.emoji)).toEqual(['👍', '❤️']);
    const undone = await ca.post(`/chat/messages/${msg.id}/reactions`, { emoji: '👍' });
    expect(undone.body.reactions).toEqual([
      { emoji: '👍', userIds: [fx.m2.id] },
      { emoji: '❤️', userIds: [fx.m2.id] },
    ]);
    expectError(await ca.post(`/chat/messages/${msg.id}/reactions`, { emoji: 'lol' }), 400);
    expectError(await (await as(fx.a1)).post(`/chat/messages/${msg.id}/reactions`, { emoji: '👍' }), 404);
  });
});

describe('erasing a chat history', () => {
  it('clears every message and picture for both people, but keeps the tasks', async () => {
    const { ca, cb, id } = await chat(fx.founder, fx.a1);
    const msg = (await send(ca, id, { body: 'Send me the Q3 report' })).body;
    await send(ca, id, { image });
    await ca.post(`/chat/messages/${msg.id}/todo`);
    await cb.post(`/chat/messages/${msg.id}/reactions`, { emoji: '👍' });

    expect((await cb.delete(`/chat/conversations/${id}/history`)).status).toBe(204);
    expect(await prisma.chatMessage.count({ where: { conversationId: id } })).toBe(0);
    expect(await prisma.chatImage.count({ where: { conversationId: id } })).toBe(0);
    expect(await prisma.chatReaction.count()).toBe(0);
    expect((await ca.get(`/chat/conversations/${id}/messages`)).body.items).toEqual([]);
    // The chat drops off both lists until someone writes again.
    expect((await ca.get('/chat/conversations')).body).toEqual([]);

    // The task lives on, with the message's words as its title.
    const todo = (await ca.get('/todos', { scope: 'created' })).body[0];
    expect(todo).toMatchObject({ title: 'Send me the Q3 report', conversationId: null, message: null, status: 'open' });
    expect((await (await as(fx.a1)).post(`/todos/${todo.id}/done`)).status).toBe(200);

    expect((await send(ca, id, { body: 'Fresh start' })).status).toBe(201);
    expectError(await (await as(fx.m1)).delete(`/chat/conversations/${id}/history`), 404);
  });
});
