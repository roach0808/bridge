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
    expect([first.body.hasNewer, second.body.hasNewer]).toEqual([false, true]);
  });

  it('pages back down with after, so a client can keep only a window of messages', async () => {
    const e1 = await as(fx.e1);
    const id = await open(e1, fx.founder);
    const base = Date.parse('2027-01-01T00:00:00Z');
    for (let i = 1; i <= 7; i++) {
      await prisma.chatMessage.create({ data: { conversationId: id, senderId: fx.e1.id, body: `m${i}`, createdAt: new Date(base + i * 1000) } });
    }
    const bodies = (res: { body: { items: Array<{ body: string }> } }) => res.body.items.map((m) => m.body);
    const latest = await e1.get(`/chat/conversations/${id}/messages`, { limit: 3 });
    const older = await e1.get(`/chat/conversations/${id}/messages`, { limit: 3, cursor: latest.body.nextCursor });
    expect(bodies(older)).toEqual(['m2', 'm3', 'm4']);

    const newer = await e1.get(`/chat/conversations/${id}/messages`, { limit: 2, after: older.body.newerCursor });
    expect(bodies(newer)).toEqual(['m5', 'm6']);
    expect(newer.body.hasNewer).toBe(true);
    const newest = await e1.get(`/chat/conversations/${id}/messages`, { limit: 2, after: newer.body.newerCursor });
    expect(bodies(newest)).toEqual(['m7']);
    expect(newest.body).toMatchObject({ hasNewer: false });
    // Scrolling up again from a newer page continues where it left off.
    expect(bodies(await e1.get(`/chat/conversations/${id}/messages`, { limit: 3, cursor: newer.body.nextCursor }))).toEqual(['m2', 'm3', 'm4']);

    expectError(await e1.get(`/chat/conversations/${id}/messages`, { cursor: latest.body.nextCursor, after: older.body.newerCursor }), 400);
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

  it('a manager gives tasks to their own associates only, once per message, in their own chats', async () => {
    const m1 = await as(fx.m1);
    const own = await open(m1, fx.a1);
    const ownMsg = (await send(m1, own, 'Confirm the Hanbit slot')).body;
    expect((await m1.get(`/chat/conversations/${own}`)).body.canGiveTask).toBe(true);
    expect((await (await as(fx.a1)).get(`/chat/conversations/${own}`)).body.canGiveTask).toBe(false);
    expectError(await (await as(fx.a1)).post(`/chat/messages/${ownMsg.id}/todo`), 403);
    expect((await m1.post(`/chat/messages/${ownMsg.id}/todo`)).status).toBe(201);
    expectError(await m1.post(`/chat/messages/${ownMsg.id}/todo`), 409);

    // Another team's associate, and a fellow manager, are off limits.
    const otherTeam = await open(m1, fx.a3);
    expect((await m1.get(`/chat/conversations/${otherTeam}`)).body.canGiveTask).toBe(false);
    const otherMsg = (await send(m1, otherTeam, 'Can you help?')).body;
    expectError(await m1.post(`/chat/messages/${otherMsg.id}/todo`), 403);
    const peers = await open(m1, fx.m2);
    const peerMsg = (await send(m1, peers, 'between managers')).body;
    expectError(await m1.post(`/chat/messages/${peerMsg.id}/todo`), 403);
    // Not a participant: the message doesn't exist for them.
    expectError(await (await as(fx.founder)).post(`/chat/messages/${peerMsg.id}/todo`), 404);

    expect((await m1.get('/todos', { scope: 'created' })).body).toHaveLength(1);
    expectError(await (await as(fx.a1)).get('/todos', { scope: 'created' }), 403);
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

  it('only the assignee marks it done; the giver can remove it while open', async () => {
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

describe('the task board', () => {
  const board = async (user: typeof fx.a1, query?: Record<string, unknown>) => (await (await as(user)).get('/todos/board', query)).body;

  it('puts your own tasks first, then the people below you', async () => {
    const founder = await as(fx.founder);
    const m1 = await as(fx.m1);
    await founder.post('/todos', { assigneeId: fx.m1.id, title: 'Plan the quarter' });
    await m1.post('/todos', { assigneeId: fx.a1.id, title: 'Chase invoices' });
    await founder.post('/todos', { assigneeId: fx.a1.id, title: 'Send the report' });

    const managerBoard = await board(fx.m1);
    expect(managerBoard.map((p: { person: { id: string }; isMe: boolean }) => [p.person.id, p.isMe])).toEqual([
      [fx.m1.id, true],
      [fx.a1.id, false],
      [fx.a2.id, false],
    ]);
    expect(managerBoard[0].tasks.map((t: { title: string }) => t.title)).toEqual(['Plan the quarter']);
    // An Associate's panel holds every task they were given, whoever gave it.
    expect(managerBoard[1].tasks.map((t: { title: string }) => t.title).sort()).toEqual(['Chase invoices', 'Send the report']);
    expect(managerBoard[1]).toMatchObject({ canGive: true, counts: { open: 2, done: 0, completed: 0 } });

    const founderBoard = await board(fx.founder);
    expect(founderBoard[0].person.id).toBe(fx.founder.id);
    expect(founderBoard.some((p: { person: { id: string } }) => p.person.id === fx.e1.id)).toBe(true);
    expect(founderBoard.find((p: { person: { id: string } }) => p.person.id === fx.m1.id).canGive).toBe(true);
  });

  it('an associate sees only their own panel, and the filter follows the status', async () => {
    const founder = await as(fx.founder);
    const a3 = await as(fx.a3);
    const todo = (await founder.post('/todos', { assigneeId: fx.a3.id, title: 'Fix the photos' })).body;
    await a3.post(`/todos/${todo.id}/done`);
    await founder.post(`/todos/${todo.id}/confirm`);

    const own = await board(fx.a3);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ isMe: true, canGive: false, tasks: [], counts: { open: 0, done: 0, completed: 1 } });
    expect((await board(fx.a3, { status: 'completed' }))[0].tasks).toHaveLength(1);
    expect((await board(fx.a3, { status: 'all' }))[0].tasks).toHaveLength(1);
    // Experts have a panel of their own too.
    expect((await board(fx.e1))).toHaveLength(1);
  });
});

describe('tasks without a chat message', () => {
  it('a founder gives anyone a task; a manager only their own associates', async () => {
    const founder = await as(fx.founder);
    const m1 = await as(fx.m1);
    const res = await founder.post('/todos', { assigneeId: fx.e1.id, title: '  Update your availability  ', details: 'For next week' });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ title: 'Update your availability', details: 'For next week', conversationId: null, message: null, status: 'open' });
    expect((await (await as(fx.e1)).get('/notifications')).body.items[0]).toMatchObject({ type: 'todo.assigned', payload: { todoId: res.body.id } });

    expect((await m1.post('/todos', { assigneeId: fx.a2.id, title: 'Chase invoices' })).status).toBe(201);
    expectError(await m1.post('/todos', { assigneeId: fx.a3.id, title: 'Chase invoices' }), 403);
    expectError(await m1.post('/todos', { assigneeId: fx.m2.id, title: 'Chase invoices' }), 403);
    expectError(await (await as(fx.a1)).post('/todos', { assigneeId: fx.a2.id, title: 'Chase invoices' }), 403);
    expectError(await founder.post('/todos', { assigneeId: fx.founder.id, title: 'Myself' }), 403);
    expectError(await founder.post('/todos', { assigneeId: fx.a1.id, title: '   ' }), 400);

    const assignees = (await m1.get('/todos/assignees')).body.map((u: { id: string }) => u.id).sort();
    expect(assignees).toEqual([fx.a1.id, fx.a2.id].sort());
    expect((await founder.get('/todos/assignees')).body.map((u: { id: string }) => u.id)).not.toContain(fx.founder.id);
    expect((await (await as(fx.a1)).get('/todos/assignees')).body).toEqual([]);
  });

  it('taker ticks done, giver confirms: the task is completed and leaves the default list', async () => {
    const m1 = await as(fx.m1);
    const a1 = await as(fx.a1);
    const todo = (await m1.post('/todos', { assigneeId: fx.a1.id, title: 'Send the weekly report' })).body;

    expectError(await m1.post(`/todos/${todo.id}/confirm`), 409); // not done yet
    expectError(await m1.post(`/todos/${todo.id}/done`), 403);
    expectError(await (await as(fx.a2)).post(`/todos/${todo.id}/done`), 404);
    const done = await a1.post(`/todos/${todo.id}/done`, { note: 'Sent' });
    expect(done.body).toMatchObject({ status: 'done', doneNote: 'Sent', confirmedAt: null });
    expect((await m1.get('/notifications')).body.items[0]).toMatchObject({ type: 'todo.done', payload: { todoId: todo.id } });

    expectError(await a1.post(`/todos/${todo.id}/confirm`), 403);
    const confirmed = await m1.post(`/todos/${todo.id}/confirm`);
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(confirmed.body.status).toBe('completed');
    expect(confirmed.body.confirmedAt).not.toBeNull();
    expect((await a1.get('/notifications')).body.items[0]).toMatchObject({ type: 'todo.completed', payload: { todoId: todo.id } });

    expect((await a1.get('/todos')).body).toEqual([]);
    expect((await m1.get('/todos', { scope: 'created' })).body).toEqual([]);
    expect((await a1.get('/todos', { status: 'completed' })).body).toHaveLength(1);
    expect((await a1.get('/todos', { status: 'all' })).body).toHaveLength(1);
    expectError(await m1.delete(`/todos/${todo.id}`), 409);
  });

  it('the giver can reopen a done or completed task, which clears the done state', async () => {
    const founder = await as(fx.founder);
    const a3 = await as(fx.a3);
    const todo = (await founder.post('/todos', { assigneeId: fx.a3.id, title: 'Fix the profile photos' })).body;
    expectError(await founder.post(`/todos/${todo.id}/reopen`), 409);
    await a3.post(`/todos/${todo.id}/done`, { note: 'Fixed' });
    expectError(await a3.post(`/todos/${todo.id}/reopen`), 403);

    const reopened = await founder.post(`/todos/${todo.id}/reopen`, { note: 'Two are still blurry' });
    expect(reopened.body).toMatchObject({ status: 'open', doneAt: null, doneNote: null, confirmedAt: null });
    expect((await a3.get('/notifications')).body.items[0]).toMatchObject({
      type: 'todo.reopened',
      payload: { summary: 'Fix the profile photos — Two are still blurry' },
    });

    await a3.post(`/todos/${todo.id}/done`);
    await founder.post(`/todos/${todo.id}/confirm`);
    expect((await founder.post(`/todos/${todo.id}/reopen`)).body.status).toBe('open');
  });

  it('a chat task confirmed by the giver keeps its done reply in the chat', async () => {
    const m1 = await as(fx.m1);
    const id = await open(m1, fx.a2);
    const msg = (await send(m1, id, 'Rebook the Tuesday call')).body;
    const todo = (await m1.post(`/chat/messages/${msg.id}/todo`)).body;
    await (await as(fx.a2)).post(`/todos/${todo.id}/done`, { note: 'Rebooked for Wednesday' });
    expect((await m1.post(`/todos/${todo.id}/confirm`)).body.status).toBe('completed');
    const items = (await m1.get(`/chat/conversations/${id}/messages`)).body.items;
    expect(items[0].todo.status).toBe('completed');
    expect(items.at(-1)).toMatchObject({ kind: 'todo_done', body: 'Rebooked for Wednesday' });
  });

  it('the giver removes an open task; nobody else can', async () => {
    const founder = await as(fx.founder);
    const todo = (await founder.post('/todos', { assigneeId: fx.m2.id, title: 'Plan the offsite' })).body;
    expectError(await (await as(fx.m2)).delete(`/todos/${todo.id}`), 403);
    expectError(await (await as(fx.m1)).delete(`/todos/${todo.id}`), 404);
    expect((await founder.delete(`/todos/${todo.id}`)).status).toBe(204);
    expect((await (await as(fx.m2)).get('/todos')).body).toEqual([]);
  });
});
