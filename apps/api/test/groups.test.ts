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

async function group(owner: FixtureUser, members: FixtureUser[], title = 'Pumps project') {
  const client = await as(owner);
  const res = await client.post('/chat/groups', { title, memberIds: members.map((m) => m.id) });
  expect(res.status, res.text).toBe(201);
  return { client, id: res.body.id as string, body: res.body };
}
const send = (c: Client, id: string, body: Record<string, unknown>) => c.post(`/chat/conversations/${id}/messages`, body);
const messages = async (c: Client, id: string) => (await c.get(`/chat/conversations/${id}/messages`)).body.items as Array<{ id: string; kind: string; body: string; sender: { id: string }; mentionIds: string[]; replyTo: { id: string } | null; deleted: boolean }>;
const listed = async (c: Client, id: string) => ((await c.get('/chat/conversations')).body as Array<{ id: string; unreadCount: number; unreadMentions: number }>).find((x) => x.id === id);

describe('starting a group', () => {
  it('anyone but an Expert starts one and owns it; the members find it in their chats', async () => {
    const { id, body } = await group(fx.m1, [fx.a1, fx.a2, fx.founder]);
    expect(body).toMatchObject({
      kind: 'group',
      other: null,
      group: { title: 'Pumps project', memberCount: 4, myRole: 'owner', photoId: null },
      canSend: true,
      mode: 'free',
      canGiveTask: false,
      canRing: false,
      otherLastReadAt: null,
    });
    const a1 = await as(fx.a1);
    // "Created the group" shows, but is nothing to read.
    expect(await listed(a1, id)).toMatchObject({ unreadCount: 0, unreadMentions: 0 });
    expect(await messages(a1, id)).toMatchObject([{ kind: 'system', body: 'created the group “Pumps project”', sender: { id: fx.m1.id } }]);
    expect((await a1.get(`/chat/groups/${id}`)).body).toMatchObject({ myRole: 'member', createdBy: { id: fx.m1.id } });
    // An Associate may start one too, with their own team.
    await group(fx.a1, [fx.a2, fx.m1]);
  });

  it('Experts start none and only a Founder adds them; a group wants a name and someone to talk to', async () => {
    const e1 = await as(fx.e1);
    expectError(await e1.post('/chat/groups', { title: 'Mine', memberIds: [fx.a1.id] }), 403);
    expectError(await e1.get('/chat/group-candidates'), 403);
    const m1 = await as(fx.m1);
    expectError(await m1.post('/chat/groups', { title: 'With an Expert', memberIds: [fx.a1.id, fx.e1.id] }), 400);
    expectError(await m1.post('/chat/groups', { title: '  ', memberIds: [fx.a1.id] }), 400);
    expectError(await m1.post('/chat/groups', { title: 'Only me', memberIds: [fx.m1.id] }), 400);
    const candidates = (await m1.get('/chat/group-candidates')).body as Array<{ id: string; role: string }>;
    expect(candidates.some((u) => u.role === 'expert' || u.id === fx.m1.id)).toBe(false);
    // Only the people the caller may chat with: their own team, the other Managers, the Founder.
    expect(candidates.map((u) => u.id).sort()).toEqual([fx.founder.id, fx.m2.id, fx.a1.id, fx.a2.id].sort());
    const a1Candidates = (await (await as(fx.a1)).get('/chat/group-candidates')).body as Array<{ id: string }>;
    expect(a1Candidates.map((u) => u.id).sort()).toEqual([fx.founder.id, fx.m1.id, fx.a2.id].sort());
    // The Founder may put anyone in a group, Experts too.
    const founderCandidates = (await (await as(fx.founder)).get('/chat/group-candidates')).body as Array<{ id: string }>;
    expect(founderCandidates.map((u) => u.id).sort()).toEqual(
      [fx.m1.id, fx.m2.id, fx.a1.id, fx.a2.id, fx.a3.id, fx.a4.id, fx.e1.id, fx.e2.id, fx.e3.id].sort(),
    );
  });

  it('a Founder’s group with Experts: everyone talks freely in it, and only a Founder grows it', async () => {
    const { client: founder, id, body } = await group(fx.founder, [fx.e1, fx.a1, fx.a3], 'Pumps experts');
    expect(body).toMatchObject({ mode: 'free', canSend: true, group: { memberCount: 4 } });

    // The Expert finds it in their chats and writes freely — no set scheduling sentences.
    const e1 = await as(fx.e1);
    expect(await listed(e1, id)).toBeTruthy();
    const said = await send(e1, id, { body: 'Happy to walk through the pump market, @AssocOne.' });
    expect(said.status, said.text).toBe(201);
    expect(said.body.mentionIds).toEqual([fx.a1.id]);
    expect((await (await as(fx.a1)).get(`/chat/conversations/${id}`)).body).toMatchObject({ mode: 'free', canSend: true });
    expect((await send(await as(fx.a3), id, { body: 'Thanks!' })).status).toBe(201);
    expect((await messages(founder, id)).filter((m) => m.kind === 'text').map((m) => m.sender.id)).toEqual([fx.e1.id, fx.a3.id]);

    // Nobody else adds an Expert, even to a group of their own…
    const m1 = await as(fx.m1);
    expectError(await m1.post('/chat/groups', { title: 'With an Expert', memberIds: [fx.a1.id, fx.e2.id] }), 400);
    // …or grows the Founder's group with an Expert in it, even as its admin.
    await founder.put(`/chat/groups/${id}/members/${fx.a1.id}/role`, { role: 'admin' });
    expectError(await (await as(fx.a1)).post(`/chat/groups/${id}/members`, { userIds: [fx.a2.id] }), 403);
    expectError(await (await as(fx.a1)).post(`/chat/groups/${id}/members`, { userIds: [fx.e2.id] }), 400);
    // An Expert still starts none.
    expectError(await e1.post('/chat/groups', { title: 'Mine', memberIds: [fx.founder.id] }), 403);

    // The Founder adds another Expert; any Expert can leave.
    const added = await founder.post(`/chat/groups/${id}/members`, { userIds: [fx.e2.id] });
    expect(added.status, added.text).toBe(200);
    expect(added.body.memberCount).toBe(5);
    expect((await e1.delete(`/chat/groups/${id}/members/${fx.e1.id}`)).status).toBeLessThan(300);
    // Gone for them, as for anyone who leaves.
    expectError(await send(e1, id, { body: 'still here?' }), 404);
  });

  it('holds only people who may chat with each other: no group reaches into another team', async () => {
    const m1 = await as(fx.m1);
    const a1 = await as(fx.a1);
    for (const [client, memberIds] of [
      [m1, [fx.a1.id, fx.a3.id]], // another team's Associate
      [a1, [fx.a3.id]],
      [a1, [fx.a2.id, fx.m2.id]], // another team's Manager
      [await as(fx.a3), [fx.a1.id]],
      // m1 may chat with m2 and with a1, but a1 may not chat with m2.
      [m1, [fx.m2.id, fx.a1.id]],
    ] as const) {
      const res = await client.post('/chat/groups', { title: 'Across teams', memberIds });
      expectError(res, 403);
      expect(res.body.error.message).toBe('A group can only hold people who may chat with each other');
    }
    expect(await prisma.conversation.count()).toBe(0);

    // The Founder may bring both teams together.
    await group(fx.founder, [fx.a1, fx.a3, fx.m2]);
  });
});

describe('talking in a group', () => {
  it('everyone reads it; an @mention is counted for the one mentioned', async () => {
    const { client: m1, id } = await group(fx.m1, [fx.a1, fx.a2]);
    const a1 = await as(fx.a1);
    const sent = await send(a1, id, { body: 'Can you call the client, @AssocTwo? Thanks @assoctwo.' });
    expect(sent.status, sent.text).toBe(201);
    expect(sent.body.mentionIds).toEqual([fx.a2.id]);

    const a2 = await as(fx.a2);
    expect(await listed(a2, id)).toMatchObject({ unreadCount: 1, unreadMentions: 1 });
    expect(await listed(m1, id)).toMatchObject({ unreadCount: 1, unreadMentions: 0 });
    // Sending counts as reading.
    expect(await listed(a1, id)).toMatchObject({ unreadCount: 0 });
    expect((await a2.post(`/chat/conversations/${id}/read`)).status).toBe(204);
    expect(await listed(a2, id)).toMatchObject({ unreadCount: 0, unreadMentions: 0 });

    // Outsiders see nothing.
    const a3 = await as(fx.a3);
    expectError(await a3.get(`/chat/conversations/${id}/messages`), 404);
    expectError(await send(a3, id, { body: 'hello?' }), 404);
    expectError(await a3.get(`/chat/groups/${id}`), 404);
  });

  it('a reply quotes a message of the same chat', async () => {
    const { client: m1, id } = await group(fx.m1, [fx.a1]);
    const first = (await send(m1, id, { body: 'Who takes Tuesday?' })).body;
    const reply = await send(await as(fx.a1), id, { body: 'I do', replyToId: first.id });
    expect(reply.status, reply.text).toBe(201);
    expect(reply.body.replyTo).toMatchObject({ id: first.id, body: 'Who takes Tuesday?', sender: { id: fx.m1.id } });

    const elsewhere = (await group(fx.m1, [fx.a2], 'Other')).id;
    const other = (await send(m1, elsewhere, { body: 'elsewhere' })).body;
    expectError(await send(m1, id, { body: 'no', replyToId: other.id }), 400);
    const system = (await messages(m1, id)).find((m) => m.kind === 'system')!;
    expectError(await send(m1, id, { body: 'no', replyToId: system.id }), 400);
  });

  it('replies work in one-to-one chats too', async () => {
    const m1 = await as(fx.m1);
    const id = (await m1.post('/chat/conversations', { userId: fx.a1.id })).body.id;
    const first = (await send(m1, id, { body: 'Ready?' })).body;
    expect((await send(await as(fx.a1), id, { body: 'Yes', replyToId: first.id })).body.replyTo).toMatchObject({ id: first.id });
  });

  it('pictures and reactions work as in any chat; no rings or tasks', async () => {
    const { client: m1, id } = await group(fx.m1, [fx.a1]);
    const pic = await send(m1, id, { image: { dataUrl: PNG, width: 1, height: 1 } });
    expect(pic.status, pic.text).toBe(201);
    expect((await (await as(fx.a1)).get(`/chat/images/${pic.body.image.id}`)).status).toBe(200);
    expectError(await (await as(fx.a3)).get(`/chat/images/${pic.body.image.id}`), 404);
    expect((await (await as(fx.a1)).post(`/chat/messages/${pic.body.id}/reactions`, { emoji: '👍' })).body.reactions).toEqual([{ emoji: '👍', userIds: [fx.a1.id] }]);
    const system = (await messages(m1, id)).find((m) => m.kind === 'system')!;
    expectError(await m1.post(`/chat/messages/${system.id}/reactions`, { emoji: '👍' }), 409);
    expectError(await m1.delete(`/chat/messages/${system.id}`), 409);

    expectError(await m1.post(`/chat/conversations/${id}/ring`), 400);
    const text = (await send(m1, id, { body: 'Do this' })).body;
    expectError(await m1.post(`/chat/messages/${text.id}/todo`), 400);
  });
});

describe('running a group', () => {
  it('owners and admins add, rename and change the picture; members do not', async () => {
    const { client: m1, id } = await group(fx.m1, [fx.a1, fx.founder]);
    const a1 = await as(fx.a1);
    expectError(await a1.post(`/chat/groups/${id}/members`, { userIds: [fx.a2.id] }), 403);
    expectError(await a1.patch(`/chat/groups/${id}`, { title: 'Mine now' }), 403);
    expectError(await a1.put(`/chat/groups/${id}/members/${fx.founder.id}/role`, { role: 'admin' }), 403);

    expect((await m1.put(`/chat/groups/${id}/members/${fx.a1.id}/role`, { role: 'admin' })).body.members).toEqual(
      expect.arrayContaining([expect.objectContaining({ user: expect.objectContaining({ id: fx.a1.id }), role: 'admin' })]),
    );
    let res = await a1.post(`/chat/groups/${id}/members`, { userIds: [fx.a2.id, fx.founder.id] });
    expect(res.status, res.text).toBe(200);
    expect(res.body.memberCount).toBe(4);
    expectError(await a1.post(`/chat/groups/${id}/members`, { userIds: [fx.e2.id] }), 400);
    res = await a1.patch(`/chat/groups/${id}`, { title: 'Pumps, phase 2' });
    expect(res.body.title).toBe('Pumps, phase 2');
    res = await a1.put(`/chat/groups/${id}/photo`, { dataUrl: PNG });
    expect(res.status, res.text).toBe(200);
    expect(res.body.photoId).toBeTruthy();
    // An admin still does not choose admins.
    expectError(await a1.put(`/chat/groups/${id}/members/${fx.founder.id}/role`, { role: 'admin' }), 403);

    // Each change is a line in the chat, newest last; and the new member reads it all.
    const said = (await messages(await as(fx.a2), id)).filter((m) => m.kind === 'system').map((m) => m.body);
    expect(said).toEqual([
      'created the group “Pumps project”',
      'made AssocOne an admin',
      'added AssocTwo',
      'renamed the group to “Pumps, phase 2”',
      'changed the group photo',
    ]);
  });

  it('nobody adds someone from another team, whoever runs the group', async () => {
    const { client: m1, id } = await group(fx.m1, [fx.a1]);
    await m1.put(`/chat/groups/${id}/members/${fx.a1.id}/role`, { role: 'admin' });
    const a1 = await as(fx.a1);
    for (const [client, userIds] of [
      [m1, [fx.a3.id]],
      [m1, [fx.a2.id, fx.a4.id]], // one wrong name refuses the lot
      [a1, [fx.a3.id]],
      [a1, [fx.m2.id]],
      // The owner may chat with m2, but a1, already in the group, may not.
      [m1, [fx.m2.id]],
    ] as const) {
      const res = await client.post(`/chat/groups/${id}/members`, { userIds });
      expectError(res, 403);
      expect(res.body.error.message).toBe('A group can only hold people who may chat with each other');
    }
    expect((await m1.get(`/chat/groups/${id}`)).body.memberCount).toBe(2);
    expectError(await (await as(fx.a3)).get(`/chat/conversations/${id}/messages`), 404);

    // In the Founder's group an admin still adds only people they may chat with; the Founder anyone.
    const { client: founder, id: mixed } = await group(fx.founder, [fx.a1]);
    await founder.put(`/chat/groups/${mixed}/members/${fx.a1.id}/role`, { role: 'admin' });
    expectError(await a1.post(`/chat/groups/${mixed}/members`, { userIds: [fx.a4.id] }), 403);
    const added = await founder.post(`/chat/groups/${mixed}/members`, { userIds: [fx.a4.id] });
    expect(added.status, added.text).toBe(200);
    expect(added.body.memberCount).toBe(3);
    // Now it spans two teams, only the Founder grows it: a1's own teammate a2 may not chat with a4.
    expectError(await a1.post(`/chat/groups/${mixed}/members`, { userIds: [fx.a2.id] }), 403);
    expect((await founder.post(`/chat/groups/${mixed}/members`, { userIds: [fx.a2.id] })).status).toBe(200);
  });

  it('admins take out members and delete their messages; nobody else does', async () => {
    // The Founder may bring people of both teams together.
    const { client: owner, id } = await group(fx.founder, [fx.a1, fx.a2, fx.a3]);
    await owner.put(`/chat/groups/${id}/members/${fx.a1.id}/role`, { role: 'admin' });
    await owner.put(`/chat/groups/${id}/members/${fx.a2.id}/role`, { role: 'admin' });
    const a1 = await as(fx.a1);
    const a3 = await as(fx.a3);
    const said = (await send(a3, id, { body: 'something off' })).body;
    // A plain member deletes only their own.
    expectError(await a3.delete(`/chat/messages/${(await send(a1, id, { body: 'mine' })).body.id}`), 403);
    expect((await a1.delete(`/chat/messages/${said.id}`)).body.deleted).toBe(true);

    expectError(await a3.delete(`/chat/groups/${id}/members/${fx.a1.id}`), 403);
    expectError(await a1.delete(`/chat/groups/${id}/members/${fx.a2.id}`), 403); // another admin
    expectError(await a1.delete(`/chat/groups/${id}/members/${fx.founder.id}`), 403); // the owner
    expect((await a1.delete(`/chat/groups/${id}/members/${fx.a3.id}`)).body.memberCount).toBe(3);
    expectError(await a3.get(`/chat/conversations/${id}/messages`), 404);
    expect((await listed(a3, id))).toBeUndefined();
    expect((await owner.delete(`/chat/groups/${id}/members/${fx.a2.id}`)).body.memberCount).toBe(2);
  });

  it('anyone leaves; an owner leaving hands the group on, and the last one out ends it', async () => {
    const { client: m1, id } = await group(fx.m1, [fx.a1, fx.a2]);
    await m1.put(`/chat/groups/${id}/members/${fx.a2.id}/role`, { role: 'admin' });
    expect((await m1.delete(`/chat/groups/${id}/members/${fx.m1.id}`)).status).toBe(204);
    expectError(await m1.get(`/chat/groups/${id}`), 404);
    const a2 = await as(fx.a2);
    const now = (await a2.get(`/chat/groups/${id}`)).body;
    expect(now).toMatchObject({ myRole: 'owner', memberCount: 2 });
    expect((await messages(a2, id)).at(-1)).toMatchObject({ kind: 'system', body: 'left the group; AssocTwo owns it now', sender: { id: fx.m1.id } });

    expect((await (await as(fx.a1)).delete(`/chat/groups/${id}/members/${fx.a1.id}`)).status).toBe(204);
    expect((await a2.delete(`/chat/groups/${id}/members/${fx.a2.id}`)).status).toBe(204);
    expect(await prisma.conversation.count({ where: { id } })).toBe(0);
  });

  it('only the owner deletes the group or clears its history', async () => {
    const { client: m1, id } = await group(fx.m1, [fx.a1]);
    const a1 = await as(fx.a1);
    await send(a1, id, { body: 'hello' });
    expectError(await a1.delete(`/chat/conversations/${id}/history`), 403);
    expectError(await a1.delete(`/chat/groups/${id}`), 403);
    expect((await m1.delete(`/chat/conversations/${id}/history`)).status).toBe(204);
    expect(await messages(a1, id)).toEqual([]);
    // Still in their list, empty.
    expect(await listed(a1, id)).toBeTruthy();
    expect((await m1.delete(`/chat/groups/${id}`)).status).toBe(204);
    expectError(await a1.get(`/chat/conversations/${id}`), 404);
  });
});

describe('the Founder reading every chat', () => {
  it('lists a group by its name and members', async () => {
    const { id } = await group(fx.m1, [fx.a1, fx.a2]);
    const chats = (await (await as(fx.founder)).get('/chat/observed')).body as Array<{ id: string; title: string | null; people: Array<{ id: string }> }>;
    const g = chats.find((c) => c.id === id)!;
    expect(g.title).toBe('Pumps project');
    expect(g.people.map((p) => p.id).sort()).toEqual([fx.m1.id, fx.a1.id, fx.a2.id].sort());
  });
});
