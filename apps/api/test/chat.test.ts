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
    ['m1', 'e2'], // managers reach every expert
    ['e3', 'm2'],
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
  ])('%s may not chat with %s', async (a, b) => {
    expectError(await (await as(fx[a] as FixtureUser)).post('/chat/conversations', { userId: (fx[b] as FixtureUser).id }), 403);
  });

  it('contacts follow the same rules', async () => {
    const nick = async (who: FixtureUser) => (await (await as(who)).get('/chat/contacts')).body.map((u: { nickname: string }) => u.nickname).sort();
    expect(await nick(fx.e1)).toEqual(['Founder', 'ManagerOne', 'ManagerTwo']);
    expect(await nick(fx.a1)).toEqual(['Founder', 'ManagerOne', 'ManagerTwo']);
    expect(await nick(fx.m1)).toEqual([
      'AssocFour', 'AssocOne', 'AssocThree', 'AssocTwo', 'ExpertLondon', 'ExpertNY', 'ExpertSeoul', 'Founder', 'ManagerTwo',
    ]);
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

  it('a manager gives tasks to any associate, once per message, in their own chats', async () => {
    const m1 = await as(fx.m1);
    const own = await open(m1, fx.a1);
    const ownMsg = (await send(m1, own, 'Confirm the Hanbit slot')).body;
    expect((await m1.get(`/chat/conversations/${own}`)).body.canGiveTask).toBe(true);
    expect((await (await as(fx.a1)).get(`/chat/conversations/${own}`)).body.canGiveTask).toBe(false);
    expectError(await (await as(fx.a1)).post(`/chat/messages/${ownMsg.id}/todo`), 403);
    expect((await m1.post(`/chat/messages/${ownMsg.id}/todo`)).status).toBe(201);
    expectError(await m1.post(`/chat/messages/${ownMsg.id}/todo`), 409);

    // Another team's associate is fine; a fellow manager is not.
    const otherTeam = await open(m1, fx.a3);
    expect((await m1.get(`/chat/conversations/${otherTeam}`)).body.canGiveTask).toBe(true);
    const otherMsg = (await send(m1, otherTeam, 'Can you help?')).body;
    expect((await m1.post(`/chat/messages/${otherMsg.id}/todo`)).status).toBe(201);
    const peers = await open(m1, fx.m2);
    const peerMsg = (await send(m1, peers, 'between managers')).body;
    expectError(await m1.post(`/chat/messages/${peerMsg.id}/todo`), 403);
    // Not a participant: the message doesn't exist for them.
    expectError(await (await as(fx.founder)).post(`/chat/messages/${peerMsg.id}/todo`), 404);

    expect((await m1.get('/todos', { scope: 'created' })).body).toHaveLength(2);
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
    // A Manager follows every Associate, not only their own team.
    expect(managerBoard[0]).toMatchObject({ person: { id: fx.m1.id }, isMe: true });
    expect(managerBoard.slice(1).map((p: { person: { id: string } }) => p.person.id).sort()).toEqual(
      [fx.a1.id, fx.a2.id, fx.a3.id, fx.a4.id].sort(),
    );
    expect(managerBoard[0].tasks.map((t: { title: string }) => t.title)).toEqual(['Plan the quarter']);
    // An Associate's panel holds every task they were given, whoever gave it.
    const a1Panel = managerBoard.find((p: { person: { id: string } }) => p.person.id === fx.a1.id);
    expect(a1Panel.tasks.map((t: { title: string }) => t.title).sort()).toEqual(['Chase invoices', 'Send the report']);
    expect(a1Panel).toMatchObject({ canGive: true, counts: { open: 2, done: 0, completed: 0 } });

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
    // A task confirmed just now stays in sight for a week. Your own panel takes your own tasks.
    expect(own[0]).toMatchObject({ isMe: true, canGive: true, counts: { open: 0, done: 0, completed: 1 } });
    expect(own[0].tasks).toHaveLength(1);
    expect((await board(fx.a3, { status: 'completed' }))[0].tasks).toHaveLength(1);
    expect((await board(fx.a3, { status: 'all' }))[0].tasks).toHaveLength(1);

    // Eight days on, it drops out of the default view but is still there under Completed.
    await prisma.todo.update({ where: { id: todo.id }, data: { confirmedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
    expect((await board(fx.a3))[0].tasks).toEqual([]);
    expect((await board(fx.a3, { status: 'completed' }))[0].tasks).toHaveLength(1);
    // Experts have a panel of their own too.
    expect((await board(fx.e1))).toHaveLength(1);
  });
});

describe('a task you give yourself', () => {
  it('anyone may add one, and ticking it finishes it at once', async () => {
    const a1 = await as(fx.a1);
    const res = await a1.post('/todos', { assigneeId: fx.a1.id, title: 'Read the new platform rules' });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ assignee: { id: fx.a1.id }, createdBy: { id: fx.a1.id }, status: 'open' });

    const done = await a1.post(`/todos/${res.body.id}/done`);
    expect(done.status, done.text).toBe(200);
    // No confirmation step, and nobody to notify.
    expect(done.body.status).toBe('completed');
    expect(done.body.confirmedAt).not.toBeNull();
    expect((await a1.get('/notifications')).body.items).toEqual([]);

    // It can be put back on the list, and cleared away.
    expect((await a1.post(`/todos/${res.body.id}/reopen`)).body.status).toBe('open');
    expect((await a1.delete(`/todos/${res.body.id}`)).status).toBe(204);
  });

  it('an Expert too, but still nobody else’s list', async () => {
    const e1 = await as(fx.e1);
    expect((await e1.post('/todos', { assigneeId: fx.e1.id, title: 'Update my availability' })).status).toBe(201);
    expectError(await e1.post('/todos', { assigneeId: fx.a1.id, title: 'Do my work' }), 403);
    expect((await e1.get('/todos', { scope: 'created' })).body).toHaveLength(1);
  });
});

describe('the order of a panel (§ drag and drop)', () => {
  const titles = async (user: typeof fx.a1, personId: string) => {
    const board = (await (await as(user)).get('/todos/board')).body;
    return board.find((p: { person: { id: string } }) => p.person.id === personId).tasks.map((t: { title: string }) => t.title);
  };

  it('a new task lands on top, and a drag is saved for everyone', async () => {
    const m1 = await as(fx.m1);
    const a1 = await as(fx.a1);
    const first = (await m1.post('/todos', { assigneeId: fx.a1.id, title: 'First' })).body;
    const second = (await m1.post('/todos', { assigneeId: fx.a1.id, title: 'Second' })).body;
    const third = (await a1.post('/todos', { assigneeId: fx.a1.id, title: 'Third' })).body;
    expect(await titles(fx.a1, fx.a1.id)).toEqual(['Third', 'Second', 'First']);

    // The owner of the panel arranges it; the Manager watching sees the same order.
    const moved = await a1.post('/todos/reorder', { assigneeId: fx.a1.id, ids: [first.id, third.id, second.id] });
    expect(moved.status, moved.text).toBe(204);
    expect(await titles(fx.a1, fx.a1.id)).toEqual(['First', 'Third', 'Second']);
    expect(await titles(fx.m1, fx.a1.id)).toEqual(['First', 'Third', 'Second']);
    expect(await titles(fx.founder, fx.a1.id)).toEqual(['First', 'Third', 'Second']);

    // Whoever may give the tasks may arrange them too.
    expect((await m1.post('/todos/reorder', { assigneeId: fx.a1.id, ids: [second.id, first.id, third.id] })).status).toBe(204);
    expect(await titles(fx.a1, fx.a1.id)).toEqual(['Second', 'First', 'Third']);
  });

  it('nobody arranges a panel that is not theirs to arrange', async () => {
    const m1 = await as(fx.m1);
    const own = (await m1.post('/todos', { assigneeId: fx.m1.id, title: 'Mine' })).body;
    const theirs = (await m1.post('/todos', { assigneeId: fx.a1.id, title: 'Theirs' })).body;
    expectError(await (await as(fx.a1)).post('/todos/reorder', { assigneeId: fx.m1.id, ids: [own.id] }), 403);
    // The ids must really belong to that panel.
    expectError(await m1.post('/todos/reorder', { assigneeId: fx.a1.id, ids: [theirs.id, own.id] }), 409);
  });
});

describe('the four quadrants of a board (§ task board)', () => {
  const quadrantOf = async (user: typeof fx.a1, personId: string, title: string) => {
    const board = (await (await as(user)).get('/todos/board')).body;
    const panel = board.find((p: { person: { id: string } }) => p.person.id === personId);
    const task = panel.tasks.find((t: { title: string }) => t.title === title);
    return { urgency: task.urgency, importance: task.importance };
  };

  it('a new task needs action and is strategic, whoever gives it', async () => {
    const a1 = await as(fx.a1);
    const mine = (await a1.post('/todos', { assigneeId: fx.a1.id, title: 'Mine' })).body;
    expect(mine).toMatchObject({ urgency: 'need_action', importance: 'strategic' });

    // A task handed to me by my Manager lands in the same quadrant as one I write myself.
    const m1 = await as(fx.m1);
    const given = (await m1.post('/todos', { assigneeId: fx.a1.id, title: 'Given' })).body;
    expect(given).toMatchObject({ urgency: 'need_action', importance: 'strategic' });
    expect(await quadrantOf(fx.a1, fx.a1.id, 'Given')).toEqual({ urgency: 'need_action', importance: 'strategic' });

    // And so does one made from a chat message.
    const conv = (await m1.post('/chat/conversations', { userId: fx.a1.id })).body;
    const msg = (await m1.post(`/chat/conversations/${conv.id}/messages`, { body: 'Please chase this' })).body;
    const fromChat = (await m1.post(`/chat/messages/${msg.id}/todo`)).body;
    expect(fromChat).toMatchObject({ urgency: 'need_action', importance: 'strategic' });
  });

  it('a task can be given straight to another quadrant, and dragged into one', async () => {
    const a1 = await as(fx.a1);
    const later = (await a1.post('/todos', { assigneeId: fx.a1.id, title: 'Later', urgency: 'can_wait', importance: 'non_strategic' })).body;
    expect(later).toMatchObject({ urgency: 'can_wait', importance: 'non_strategic' });

    const now = (await a1.post('/todos', { assigneeId: fx.a1.id, title: 'Now' })).body;
    const also = (await a1.post('/todos', { assigneeId: fx.a1.id, title: 'Also' })).body;
    // Dragged out of "need action / strategic" and dropped below the one already waiting.
    const dropped = await a1.post('/todos/reorder', {
      assigneeId: fx.a1.id,
      urgency: 'can_wait',
      importance: 'non_strategic',
      ids: [later.id, now.id],
    });
    expect(dropped.status, dropped.text).toBe(204);
    expect(await quadrantOf(fx.a1, fx.a1.id, 'Now')).toEqual({ urgency: 'can_wait', importance: 'non_strategic' });
    // The one left behind stays where it was.
    expect(await quadrantOf(fx.a1, fx.a1.id, 'Also')).toEqual({ urgency: 'need_action', importance: 'strategic' });

    const board = (await a1.get('/todos/board')).body;
    const mine = board.find((p: { isMe: boolean }) => p.isMe).tasks as Array<{ id: string; title: string; urgency: string }>;
    expect(mine.filter((t) => t.urgency === 'can_wait').map((t) => t.title)).toEqual(['Later', 'Now']);
    expect(also.id).toBeTruthy();
  });

  it('a task handed to someone else lands in the quadrant it was dropped on', async () => {
    const m1 = await as(fx.m1);
    const task = (await m1.post('/todos', { assigneeId: fx.m1.id, title: 'Hand over' })).body;
    const moved = await m1.post(`/todos/${task.id}/move`, { assigneeId: fx.a1.id, urgency: 'can_wait', importance: 'strategic' });
    expect(moved.status, moved.text).toBe(200);
    expect(moved.body).toMatchObject({ urgency: 'can_wait', importance: 'strategic' });
    expect(moved.body.assignee.id).toBe(fx.a1.id);

    // Dropped on the person rather than a quadrant, it lands where a new task would,
    // whatever corner it sat in on the giver's own board.
    const other = (await m1.post('/todos', { assigneeId: fx.m1.id, title: 'Plain hand over', urgency: 'can_wait', importance: 'non_strategic' })).body;
    const plain = await m1.post(`/todos/${other.id}/move`, { assigneeId: fx.a1.id });
    expect(plain.body).toMatchObject({ urgency: 'need_action', importance: 'strategic' });
  });
});

describe('tasks without a chat message', () => {
  it('a founder gives anyone a task; a manager any associate', async () => {
    const founder = await as(fx.founder);
    const m1 = await as(fx.m1);
    const res = await founder.post('/todos', { assigneeId: fx.e1.id, title: '  Update your availability  ', details: 'For next week' });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ title: 'Update your availability', details: 'For next week', conversationId: null, message: null, status: 'open' });
    expect((await (await as(fx.e1)).get('/notifications')).body.items[0]).toMatchObject({ type: 'todo.assigned', payload: { todoId: res.body.id } });

    expect((await m1.post('/todos', { assigneeId: fx.a2.id, title: 'Chase invoices' })).status).toBe(201);
    expect((await m1.post('/todos', { assigneeId: fx.a3.id, title: 'Chase invoices' })).status).toBe(201);
    expectError(await m1.post('/todos', { assigneeId: fx.m2.id, title: 'Chase invoices' }), 403);
    expectError(await (await as(fx.a1)).post('/todos', { assigneeId: fx.a2.id, title: 'Chase invoices' }), 403);
    expectError(await founder.post('/todos', { assigneeId: fx.a1.id, title: '   ' }), 400);

    const assignees = (await m1.get('/todos/assignees')).body.map((u: { id: string }) => u.id).sort();
    expect(assignees).toEqual([fx.m1.id, fx.a1.id, fx.a2.id, fx.a3.id, fx.a4.id].sort());
    expect((await founder.get('/todos/assignees')).body.map((u: { id: string }) => u.id)).toContain(fx.founder.id);
    // Everyone can put a task on their own list, and nobody else's.
    expect((await (await as(fx.a1)).get('/todos/assignees')).body.map((u: { id: string }) => u.id)).toEqual([fx.a1.id]);
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

    // Completed work stays on the list for a week, then only under Completed.
    expect((await a1.get('/todos')).body).toHaveLength(1);
    await prisma.todo.update({ where: { id: todo.id }, data: { confirmedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) } });
    expect((await a1.get('/todos')).body).toEqual([]);
    expect((await m1.get('/todos', { scope: 'created' })).body).toEqual([]);
    expect((await a1.get('/todos', { status: 'completed' })).body).toHaveLength(1);
    expect((await a1.get('/todos', { status: 'all' })).body).toHaveLength(1);
    // A completed task can be cleared away; one still waiting for confirmation cannot.
    expect((await m1.delete(`/todos/${todo.id}`)).status).toBe(204);
    expect((await a1.get('/todos', { status: 'all' })).body).toEqual([]);
  });

  it('a task waiting for confirmation cannot be removed', async () => {
    const m1 = await as(fx.m1);
    const todo = (await m1.post('/todos', { assigneeId: fx.a1.id, title: 'Send the weekly report' })).body;
    await (await as(fx.a1)).post(`/todos/${todo.id}/done`);
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
