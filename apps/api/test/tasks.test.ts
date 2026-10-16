import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, clientsFor, expectError, prisma, seedFixtures, type Client, type Fixtures } from './helpers';

let fx: Fixtures;
let c: Record<'founder' | 'm1' | 'm2' | 'a1' | 'a2' | 'e1', Client>;
beforeEach(async () => {
  fx = await seedFixtures();
  c = await clientsFor(fx, ['founder', 'm1', 'm2', 'a1', 'a2', 'e1']);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const THU = '2027-03-04T00:00:00.000Z';
const FRI_6PM = '2027-03-05T12:30:00.000Z';

/** A task for the Associate, with whatever the test cares about. */
const give = async (body: Record<string, unknown>, by: Client = c.m1) => {
  const res = await by.post('/todos', { assigneeId: fx.a1.id, title: 'Send 20 SME invitations', ...body });
  expect(res.status, res.text).toBe(201);
  return res.body;
};

describe('Start By and Complete By (§ tasks)', () => {
  it('keeps the two dates apart, with and without a time of day', async () => {
    const task = await give({
      startByAt: THU,
      completeByAt: FRI_6PM,
      completeByHasTime: true,
      timeZone: 'Asia/Kolkata',
      expectedDeliverable: '20 invitations sent',
      definitionOfDone: 'Every invitation accepted by the platform',
    });
    expect(task).toMatchObject({
      startByAt: THU,
      startByHasTime: false,
      completeByAt: FRI_6PM,
      completeByHasTime: true,
      timeZone: 'Asia/Kolkata',
      expectedDeliverable: '20 invitations sent',
      definitionOfDone: 'Every invitation accepted by the platform',
      status: 'open',
    });
  });

  it('reads a task with no zone of its own in the owner’s', async () => {
    const task = await give({ startByAt: THU });
    // AssocOne lives in America/New_York (the fixture default).
    expect(task.timeZone).toBe('America/New_York');
  });

  it('refuses a deadline that falls before work may begin', async () => {
    const res = await c.m1.post('/todos', { assigneeId: fx.a1.id, title: 'Backwards', startByAt: FRI_6PM, completeByAt: THU });
    expectError(res, 400);
    expect(res.body.error.details.issues[0].path).toBe('completeByAt');
  });

  it('clears the time of day when the date itself is cleared', async () => {
    const task = await give({ completeByAt: FRI_6PM, completeByHasTime: true });
    const cleared = await c.m1.patch(`/todos/${task.id}`, { completeByAt: null });
    expect(cleared.status, cleared.text).toBe(200);
    expect(cleared.body).toMatchObject({ completeByAt: null, completeByHasTime: false });
  });
});

describe('changing a task after it was given', () => {
  it('the giver and anyone who may give that person tasks can; the owner cannot', async () => {
    const task = await give({});
    const edited = await c.m1.patch(`/todos/${task.id}`, { title: 'Send 30 SME invitations', startByAt: THU });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body).toMatchObject({ title: 'Send 30 SME invitations', startByAt: THU });

    // The Founder may give this person tasks, so may change them.
    expect((await c.founder.patch(`/todos/${task.id}`, { definitionOfDone: 'All 30 sent' })).status).toBe(200);

    // The owner reports progress; they do not move their own deadline.
    expectError(await c.a1.patch(`/todos/${task.id}`, { completeByAt: FRI_6PM }), 403);
    // A Manager gives tasks only to their own team's Associates (§2.4 canGiveTask), so
    // another team's Manager neither sees nor changes one; nor does an Expert.
    expectError(await c.m2.patch(`/todos/${task.id}`, { details: 'Use the new template' }), 404);
    expectError(await c.e1.patch(`/todos/${task.id}`, { title: 'Mine now' }), 404);
    expect((await prisma.todo.findUniqueOrThrow({ where: { id: task.id } })).details).toBeNull();
  });

  it('a personal to-do is the owner’s to change', async () => {
    const mine = (await c.a1.post('/todos', { assigneeId: fx.a1.id, title: 'Tidy my notes' })).body;
    const edited = await c.a1.patch(`/todos/${mine.id}`, { startByAt: THU, urgency: 'can_wait' });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body).toMatchObject({ startByAt: THU, urgency: 'can_wait', importance: 'strategic' });
  });

  it('leaves a chat task’s words alone: they are the message', async () => {
    const conv = (await c.m1.post('/chat/conversations', { userId: fx.a1.id })).body;
    const msg = (await c.m1.post(`/chat/conversations/${conv.id}/messages`, { body: 'Please chase this' })).body;
    const task = (await c.m1.post(`/chat/messages/${msg.id}/todo`)).body;
    expectError(await c.m1.patch(`/todos/${task.id}`, { title: 'Something else' }), 409);
    // Its dates are still the Manager's to set.
    expect((await c.m1.patch(`/todos/${task.id}`, { startByAt: THU })).body.startByAt).toBe(THU);
  });
});

describe('where the work stands', () => {
  it('moves between not started, in progress and blocked, and says why it is blocked', async () => {
    const task = await give({});
    expect((await c.a1.post(`/todos/${task.id}/status`, { status: 'in_progress' })).body.status).toBe('in_progress');

    const noReason = await c.a1.post(`/todos/${task.id}/status`, { status: 'blocked' });
    expectError(noReason, 400);
    expect(noReason.body.error.details.issues[0].path).toBe('blockedReason');

    const blocked = await c.a1.post(`/todos/${task.id}/status`, { status: 'blocked', blockedReason: 'Waiting on the platform login' });
    expect(blocked.status, blocked.text).toBe(200);
    expect(blocked.body).toMatchObject({ status: 'blocked', blockedReason: 'Waiting on the platform login' });
    // The person who gave it is told they are holding something up.
    expect(await prisma.notification.count({ where: { userId: fx.m1.id, type: 'todo.blocked' } })).toBe(1);

    // Getting going again drops the reason.
    expect((await c.a1.post(`/todos/${task.id}/status`, { status: 'in_progress' })).body).toMatchObject({
      status: 'in_progress',
      blockedReason: null,
    });
  });

  it('a blocked task can still be finished, and finishing clears the reason', async () => {
    const task = await give({});
    await c.a1.post(`/todos/${task.id}/status`, { status: 'blocked', blockedReason: 'No access' });
    const done = await c.a1.post(`/todos/${task.id}/done`, {});
    expect(done.status, done.text).toBe(200);
    expect(done.body).toMatchObject({ status: 'done', blockedReason: null });
    expect((await c.m1.post(`/todos/${task.id}/confirm`)).body.status).toBe('completed');
  });

  it('nobody reports progress on a task already finished', async () => {
    const task = await give({});
    await c.a1.post(`/todos/${task.id}/done`, {});
    expectError(await c.a1.post(`/todos/${task.id}/status`, { status: 'in_progress' }), 409);
  });

  it('is nobody else’s to report', async () => {
    const task = await give({});
    expectError(await c.a2.post(`/todos/${task.id}/status`, { status: 'in_progress' }), 404);
    expectError(await c.e1.post(`/todos/${task.id}/status`, { status: 'in_progress' }), 404);
  });

  it('counts unfinished work on the board however far along it is', async () => {
    const first = await give({});
    const second = await give({});
    await c.a1.post(`/todos/${first.id}/status`, { status: 'in_progress' });
    await c.a1.post(`/todos/${second.id}/status`, { status: 'blocked', blockedReason: 'Stuck' });
    const board = (await c.m1.get('/todos/board')).body;
    const panel = board.find((p: { person: { id: string } }) => p.person.id === fx.a1.id);
    expect(panel.counts).toMatchObject({ open: 2, inProgress: 1, blocked: 1, done: 0, completed: 0 });
    expect(panel.tasks).toHaveLength(2);
  });
});

describe('what a task waits for', () => {
  it('records what must happen first, and shows who owns it', async () => {
    const research = await give({ title: 'Research 30 experts' } as Record<string, unknown>);
    const outreach = (await c.m1.post('/todos', { assigneeId: fx.a2.id, title: 'Contact approved experts', dependsOn: [research.id] })).body;
    expect(outreach.dependsOn).toHaveLength(1);
    expect(outreach.dependsOn[0]).toMatchObject({ id: research.id, title: 'Research 30 experts', status: 'open' });
    expect(outreach.dependsOn[0].assignee.id).toBe(fx.a1.id);
  });

  it('refuses a circle of tasks, and a task waiting for itself', async () => {
    const first = await give({});
    const second = (await c.m1.post('/todos', { assigneeId: fx.a1.id, title: 'Second', dependsOn: [first.id] })).body;
    expectError(await c.m1.patch(`/todos/${first.id}`, { dependsOn: [second.id] }), 409);
    // Waiting for itself is quietly dropped rather than stored.
    expect((await c.m1.patch(`/todos/${first.id}`, { dependsOn: [first.id] })).body.dependsOn).toEqual([]);
  });

  it('refuses a task that does not exist, and replaces the whole list when it changes', async () => {
    const first = await give({});
    const other = await give({});
    const third = (await c.m1.post('/todos', { assigneeId: fx.a1.id, title: 'Third', dependsOn: [first.id, other.id] })).body;
    expect(third.dependsOn).toHaveLength(2);
    expect((await c.m1.patch(`/todos/${third.id}`, { dependsOn: [other.id] })).body.dependsOn).toHaveLength(1);
    expect((await c.m1.patch(`/todos/${third.id}`, { dependsOn: [] })).body.dependsOn).toEqual([]);
    expectError(await c.m1.patch(`/todos/${third.id}`, { dependsOn: ['11111111-1111-4111-8111-111111111111'] }), 400);
  });

  it('forgets what it waited for when that task is deleted', async () => {
    const first = await give({});
    const second = (await c.m1.post('/todos', { assigneeId: fx.a1.id, title: 'Second', dependsOn: [first.id] })).body;
    expect((await c.founder.delete(`/todos/${first.id}`)).status).toBe(204);
    const board = (await c.m1.get('/todos/board')).body;
    const still = board.flatMap((p: { tasks: Array<{ id: string; dependsOn: unknown[] }> }) => p.tasks).find((t: { id: string }) => t.id === second.id);
    expect(still.dependsOn).toEqual([]);
  });
});

describe('a task given in the old way still works', () => {
  it('has no dates, and says so rather than guessing', async () => {
    const task = await give({});
    expect(task).toMatchObject({ startByAt: null, completeByAt: null, startByHasTime: false, completeByHasTime: false });
  });
});

describe('removing a task', () => {
  it('the Founder removes any task at any stage, even one they neither gave nor took', async () => {
    const working = await give({});
    await c.a1.post(`/todos/${working.id}/status`, { status: 'in_progress' });
    expect((await c.founder.delete(`/todos/${working.id}`)).status).toBe(204);

    const waiting = await give({});
    await c.a1.post(`/todos/${waiting.id}/done`);
    expect((await c.founder.delete(`/todos/${waiting.id}`)).status).toBe(204);
    expect((await c.a1.get('/todos', { status: 'all' })).body).toEqual([]);
  });

  it('anyone else waits until it is completed, and then only the giver or the owner may', async () => {
    const task = await give({});
    expectError(await c.a1.delete(`/todos/${task.id}`), 409);
    expectError(await c.m1.delete(`/todos/${task.id}`), 409);
    await c.a1.post(`/todos/${task.id}/done`);
    // Ready for Review is not completed yet.
    expectError(await c.m1.delete(`/todos/${task.id}`), 409);
    await c.m1.post(`/todos/${task.id}/confirm`);
    // Another team's Manager and a teammate do not see the task at all.
    expectError(await c.m2.delete(`/todos/${task.id}`), 404);
    expectError(await c.a2.delete(`/todos/${task.id}`), 404);
    expect((await c.a1.delete(`/todos/${task.id}`)).status).toBe(204);

    const second = await give({});
    await c.a1.post(`/todos/${second.id}/done`);
    await c.m1.post(`/todos/${second.id}/confirm`);
    expect((await c.m1.delete(`/todos/${second.id}`)).status).toBe(204);
  });

  it('takes its notes with it', async () => {
    const task = await give({});
    await c.a1.post(`/todos/${task.id}/notes`, { body: 'Halfway there' });
    expect((await c.founder.delete(`/todos/${task.id}`)).status).toBe(204);
    expect(await prisma.todoNote.count()).toBe(0);
  });
});

describe('notes on a task', () => {
  it('the owner, the giver and anyone above the owner write them, oldest first, with no length cap', async () => {
    const task = await give({});
    const long = 'Called every platform on the list. '.repeat(3000);
    const first = await c.a1.post(`/todos/${task.id}/notes`, { body: `  ${long}  ` });
    expect(first.status, first.text).toBe(201);
    expect(first.body).toMatchObject({ todoId: task.id, author: { id: fx.a1.id }, body: long.trim() });
    expect((await c.m1.post(`/todos/${task.id}/notes`, { body: 'Thanks — keep going' })).status).toBe(201);
    expect((await c.founder.post(`/todos/${task.id}/notes`, { body: 'Seen' })).status).toBe(201);

    const notes = (await c.a1.get(`/todos/${task.id}/notes`)).body;
    expect(notes.map((n: { author: { id: string } }) => n.author.id)).toEqual([fx.a1.id, fx.m1.id, fx.founder.id]);
    const board = (await c.a1.get('/todos/board')).body;
    expect(board[0].tasks.find((t: { id: string }) => t.id === task.id).noteCount).toBe(3);
  });

  it('nobody else reads or writes them, and a blank note says nothing', async () => {
    const task = await give({});
    expectError(await c.a2.get(`/todos/${task.id}/notes`), 404);
    // Not another team's Manager either.
    expectError(await c.m2.get(`/todos/${task.id}/notes`), 404);
    expectError(await c.m2.post(`/todos/${task.id}/notes`, { body: 'Hello' }), 404);
    expectError(await c.e1.post(`/todos/${task.id}/notes`, { body: 'Hello' }), 404);
    expectError(await c.a1.post(`/todos/${task.id}/notes`, { body: '   \n ' }), 400);
  });

  it('only the writer changes a note; the writer or the Founder deletes it', async () => {
    const task = await give({});
    const note = (await c.a1.post(`/todos/${task.id}/notes`, { body: 'Drafted the list' })).body;
    expectError(await c.m1.patch(`/todos/${task.id}/notes/${note.id}`, { body: 'Mine now' }), 403);
    const edited = await c.a1.patch(`/todos/${task.id}/notes/${note.id}`, { body: 'Drafted and sent the list' });
    expect(edited.body.body).toBe('Drafted and sent the list');
    expect(edited.body.updatedAt > edited.body.createdAt).toBe(true);

    expectError(await c.m1.delete(`/todos/${task.id}/notes/${note.id}`), 403);
    expect((await c.founder.delete(`/todos/${task.id}/notes/${note.id}`)).status).toBe(204);
    expectError(await c.a1.delete(`/todos/${task.id}/notes/${note.id}`), 404);
  });

  it('a note belongs to its own task', async () => {
    const task = await give({});
    const other = await give({});
    const note = (await c.a1.post(`/todos/${task.id}/notes`, { body: 'On the first task' })).body;
    expectError(await c.a1.patch(`/todos/${other.id}/notes/${note.id}`, { body: 'Moved' }), 404);
  });
});

describe('another team’s Manager (§2.4 team isolation)', () => {
  it('cannot give a task to someone outside their team, nor find them to give one', async () => {
    expectError(await c.m2.post('/todos', { assigneeId: fx.a1.id, title: 'Help us out' }), 403);
    expectError(await c.m2.post('/todos', { assigneeId: fx.a2.id, title: 'Help us out' }), 403);
    // Handing over a task of their own is refused too.
    const own = (await c.m2.post('/todos', { assigneeId: fx.m2.id, title: 'Mine' })).body;
    expectError(await c.m2.post(`/todos/${own.id}/move`, { assigneeId: fx.a1.id }), 403);
    expect(await prisma.todo.count({ where: { assigneeId: fx.a1.id } })).toBe(0);
    // Their own team still takes them.
    expect((await c.m2.post('/todos', { assigneeId: fx.a3.id, title: 'Help us out' })).status).toBe(201);

    const assignees = (await c.m2.get('/todos/assignees')).body.map((u: { id: string }) => u.id);
    expect(assignees).not.toContain(fx.a1.id);
    expect(assignees.sort()).toEqual([fx.m2.id, fx.a3.id, fx.a4.id].sort());
  });

  it('does not see the other team’s panels or tasks, nor arrange or change them', async () => {
    const task = await give({ title: 'Team one only' });
    // The task names its owner's Manager.
    expect(task.assignee).toMatchObject({ id: fx.a1.id, managerId: fx.m1.id });

    const board = (await c.m2.get('/todos/board')).body as Array<{ person: { id: string }; tasks: Array<{ id: string }> }>;
    expect(board.map((p) => p.person.id).sort()).toEqual([fx.m2.id, fx.a3.id, fx.a4.id].sort());
    expect(board.flatMap((p) => p.tasks).map((t) => t.id)).not.toContain(task.id);
    expect(JSON.stringify(board)).not.toContain('Team one only');

    expectError(await c.m2.post('/todos/reorder', { assigneeId: fx.a1.id, ids: [task.id] }), 403);
    expectError(await c.m2.post(`/todos/${task.id}/move`, { assigneeId: fx.a1.id, urgency: 'can_wait', importance: 'strategic' }), 404);
    expectError(await c.m2.post(`/todos/${task.id}/reopen`), 404);
    expectError(await c.m2.post(`/todos/${task.id}/status`, { status: 'in_progress' }), 404);
    expect(await prisma.todo.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ status: 'open', urgency: 'need_action' });

    // Their own Manager still does all of it.
    expect((await c.m1.get('/todos/board')).body.find((p: { person: { id: string } }) => p.person.id === fx.a1.id).tasks).toHaveLength(1);
  });
});
