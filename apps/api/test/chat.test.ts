import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, expectError, prisma, seedFixtures, type Client, type FixtureUser, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function open(client: Client, other: FixtureUser) {
  const res = await client.post('/chat/conversations', { userId: other.id });
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
}

const send = (client: Client, conversationId: string, body: string) =>
  client.post(`/chat/conversations/${conversationId}/messages`, { body });

describe('who can chat with whom', () => {
  it.each<[keyof Fixtures, keyof Fixtures]>([
    ['founder', 'e1'],
    ['founder', 'a3'],
    ['m1', 'm2'],
    ['a1', 'm2'], // any manager, not only their own
    ['m2', 'a1'],
  ])('%s may chat with %s', async (a, b) => {
    const id = await open(await as(fx[a] as FixtureUser), fx[b] as FixtureUser);
    expect((await send(await as(fx[a] as FixtureUser), id, 'Hello')).status).toBe(201);
    expect((await send(await as(fx[b] as FixtureUser), id, 'Hi back')).status).toBe(201);
  });

  it.each<[keyof Fixtures, keyof Fixtures]>([
    ['a1', 'a3'],
    ['e1', 'e2'],
    ['a1', 'e1'],
    ['e1', 'a1'],
    ['m1', 'e2'],
    ['e3', 'm2'],
  ])('%s may not chat with %s', async (a, b) => {
    expectError(await (await as(fx[a] as FixtureUser)).post('/chat/conversations', { userId: (fx[b] as FixtureUser).id }), 403);
  });

  it('contacts follow the same rules', async () => {
    const nick = async (who: FixtureUser) => (await (await as(who)).get('/chat/contacts')).body.map((u: { nickname: string }) => u.nickname).sort();
    expect(await nick(fx.e1)).toEqual(['Founder']);
    expect(await nick(fx.a1)).toEqual(['Founder', 'ManagerOne', 'ManagerTwo']);
    expect(await nick(fx.m1)).toEqual(['AssocFour', 'AssocOne', 'AssocThree', 'AssocTwo', 'Founder', 'ManagerTwo']);
    expect(await nick(fx.founder)).toHaveLength(fx.users.length - 1);
  });

  it('opening the same chat twice returns the same conversation, from either side', async () => {
    const a = await open(await as(fx.m1), fx.a1);
    const b = await open(await as(fx.a1), fx.m1);
    expect(a).toBe(b);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('outsiders cannot read or post; an inactive person closes the chat', async () => {
    const id = await open(await as(fx.m1), fx.m2);
    await send(await as(fx.m1), id, 'secret');
    const a1 = await as(fx.a1);
    expectError(await a1.get(`/chat/conversations/${id}/messages`), 404);
    expectError(await send(a1, id, 'hi'), 404);
    expectError(await (await as(fx.founder)).get(`/chat/conversations/${id}`), 404);

    await prisma.user.update({ where: { id: fx.m2.id }, data: { isActive: false } });
    const m1 = await as(fx.m1);
    expect((await m1.get(`/chat/conversations/${id}`)).body.canSend).toBe(false);
    expectError(await send(m1, id, 'still there?'), 403);
  });

  it('chats from before the rule changed (associate ↔ associate, expert ↔ expert) are read-only', async () => {
    for (const [a, b] of [[fx.a1, fx.a3], [fx.e1, fx.e2]] as const) {
      const [userAId, userBId] = [a.id, b.id].sort() as [string, string];
      const c = await prisma.conversation.create({ data: { userAId, userBId, lastMessageAt: new Date() } });
      await prisma.chatMessage.create({ data: { conversationId: c.id, senderId: a.id, body: 'old message' } });
      const client = await as(a);
      expect((await client.get('/chat/conversations')).body[0]).toMatchObject({ id: c.id, canSend: false });
      expect((await client.get(`/chat/conversations/${c.id}/messages`)).body.items).toHaveLength(1);
      expectError(await send(client, c.id, 'hello again'), 403);
    }
  });
});

describe('messages, unread counts and read receipts', () => {
  it('lists chats with the last message and unread count, and reading clears it', async () => {
    const founder = await as(fx.founder);
    const a1 = await as(fx.a1);
    const id = await open(founder, fx.a1);
    // An empty chat is not listed.
    expect((await a1.get('/chat/conversations')).body).toEqual([]);

    await send(founder, id, 'one');
    await send(founder, id, '  two  ');
    let list = (await a1.get('/chat/conversations')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, unreadCount: 2, canSend: true, other: { id: fx.founder.id, role: 'founder' }, lastMessage: { body: 'two' } });
    expect((await founder.get('/chat/conversations')).body[0].unreadCount).toBe(0);

    expect((await a1.post(`/chat/conversations/${id}/read`)).status).toBe(204);
    list = (await a1.get('/chat/conversations')).body;
    expect(list[0].unreadCount).toBe(0);
    expect((await founder.get(`/chat/conversations/${id}`)).body.otherLastReadAt).not.toBeNull();
  });

  it('pages messages newest page first, oldest-to-newest inside a page', async () => {
    const e1 = await as(fx.e1);
    const id = await open(e1, fx.founder);
    const base = Date.parse('2027-01-01T00:00:00Z');
    for (let i = 1; i <= 5; i++) {
      await prisma.chatMessage.create({ data: { conversationId: id, senderId: fx.e1.id, body: `m${i}`, createdAt: new Date(base + i * 1000) } });
    }
    const first = await e1.get(`/chat/conversations/${id}/messages`, { limit: 3 });
    expect(first.body.items.map((m: { body: string }) => m.body)).toEqual(['m3', 'm4', 'm5']);
    const second = await e1.get(`/chat/conversations/${id}/messages`, { limit: 3, cursor: first.body.nextCursor });
    expect(second.body.items.map((m: { body: string }) => m.body)).toEqual(['m1', 'm2']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('blank messages are rejected', async () => {
    const id = await open(await as(fx.m1), fx.m2);
    expectError(await send(await as(fx.m1), id, '   '), 400, 'validation_error');
  });
});

describe('to-dos', () => {
  async function founderChatWith(user: FixtureUser) {
    const founder = await as(fx.founder);
    const id = await open(founder, user);
    return { founder, id };
  }

  it('a founder turns their instruction into a to-do for the employee, who is notified', async () => {
    const { founder, id } = await founderChatWith(fx.a1);
    const msg = (await send(founder, id, 'Send me the Q3 report by Friday')).body;
    const res = await founder.post(`/chat/messages/${msg.id}/todo`);
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      status: 'open',
      assignee: { id: fx.a1.id },
      createdBy: { id: fx.founder.id },
      conversationId: id,
      message: { id: msg.id, body: 'Send me the Q3 report by Friday' },
    });

    const a1 = await as(fx.a1);
    const todos = (await a1.get('/todos')).body;
    expect(todos.map((t: { id: string }) => t.id)).toEqual([res.body.id]);
    expect((await a1.get('/notifications')).body.items[0]).toMatchObject({ type: 'todo.assigned', payload: { todoId: res.body.id, conversationId: id } });
    // The message in the chat carries the to-do.
    const messages = (await a1.get(`/chat/conversations/${id}/messages`)).body.items;
    expect(messages[0].todo).toMatchObject({ status: 'open', assignee: { id: fx.a1.id } });
    expect((await a1.get(`/chat/conversations/${id}`)).body.openTodoCount).toBe(1);
  });

  it('a founder can also turn the employee’s own message into their to-do', async () => {
    const { founder, id } = await founderChatWith(fx.e1);
    const msg = (await send(await as(fx.e1), id, 'I will update my availability tonight')).body;
    const res = await founder.post(`/chat/messages/${msg.id}/todo`);
    expect(res.status).toBe(201);
    expect(res.body.assignee.id).toBe(fx.e1.id);
  });

  it('only founders create to-dos, once per message, and only in their own chats', async () => {
    const { founder, id } = await founderChatWith(fx.m1);
    const msg = (await send(founder, id, 'Review the team calendar')).body;
    expectError(await (await as(fx.m1)).post(`/chat/messages/${msg.id}/todo`), 403);
    expect((await founder.post(`/chat/messages/${msg.id}/todo`)).status).toBe(201);
    expectError(await founder.post(`/chat/messages/${msg.id}/todo`), 409);

    const other = await open(await as(fx.m1), fx.m2);
    const peerMsg = (await send(await as(fx.m1), other, 'between managers')).body;
    expectError(await founder.post(`/chat/messages/${peerMsg.id}/todo`), 404);
    expectError(await (await as(fx.m1)).get('/todos', { scope: 'created' }), 403);
  });

  it('marking done posts a reply in the chat, closes the to-do and notifies the founder', async () => {
    const { founder, id } = await founderChatWith(fx.a2);
    const msg = (await send(founder, id, 'Call the Hanbit contact')).body;
    const todo = (await founder.post(`/chat/messages/${msg.id}/todo`)).body;
    const a2 = await as(fx.a2);

    const res = await a2.post(`/todos/${todo.id}/done`, { note: 'Called — they want two more experts' });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ status: 'done', doneNote: 'Called — they want two more experts' });
    expect(res.body.doneAt).not.toBeNull();

    const messages = (await founder.get(`/chat/conversations/${id}/messages`)).body.items;
    expect(messages.at(-1)).toMatchObject({
      kind: 'todo_done',
      sender: { id: fx.a2.id },
      body: 'Called — they want two more experts',
      replyTo: { id: msg.id, body: 'Call the Hanbit contact' },
    });
    expect(messages[0].todo.status).toBe('done');
    expect((await founder.get('/chat/conversations')).body[0]).toMatchObject({ unreadCount: 1, openTodoCount: 0 });
    expect((await founder.get('/notifications')).body.items[0]).toMatchObject({ type: 'todo.done', payload: { todoId: todo.id } });
    expect((await founder.get('/todos', { scope: 'created' })).body[0]).toMatchObject({ id: todo.id, status: 'done' });

    // Without a note the reply just says Done; a second attempt is refused.
    expectError(await a2.post(`/todos/${todo.id}/done`), 409);
  });

  it('only the assignee marks it done; open to-dos can be removed, done ones cannot', async () => {
    const { founder, id } = await founderChatWith(fx.e2);
    const msg = (await send(founder, id, 'Block out next Monday')).body;
    const todo = (await founder.post(`/chat/messages/${msg.id}/todo`)).body;
    expectError(await founder.post(`/todos/${todo.id}/done`), 403);
    expectError(await (await as(fx.e1)).post(`/todos/${todo.id}/done`), 404);

    expect((await founder.delete(`/chat/messages/${msg.id}/todo`)).status).toBe(204);
    expect((await (await as(fx.e2)).get('/todos')).body).toEqual([]);

    const again = (await founder.post(`/chat/messages/${msg.id}/todo`)).body;
    const done = await (await as(fx.e2)).post(`/todos/${again.id}/done`);
    expect(done.body.doneNote).toBeNull();
    expect((await founder.get(`/chat/conversations/${id}/messages`)).body.items.at(-1)).toMatchObject({ kind: 'todo_done', body: 'Done' });
    expectError(await founder.delete(`/chat/messages/${msg.id}/todo`), 409);
  });

  it('status filter and ordering: open first', async () => {
    const { founder, id } = await founderChatWith(fx.a1);
    const ids: string[] = [];
    for (const body of ['first', 'second', 'third']) {
      const m = (await send(founder, id, body)).body;
      ids.push((await founder.post(`/chat/messages/${m.id}/todo`)).body.id);
    }
    const a1 = await as(fx.a1);
    await a1.post(`/todos/${ids[2]}/done`);
    expect((await a1.get('/todos')).body.map((t: { status: string }) => t.status)).toEqual(['open', 'open', 'done']);
    expect((await a1.get('/todos', { status: 'done' })).body).toHaveLength(1);
  });
});
