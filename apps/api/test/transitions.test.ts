import type { CallStatus } from '@god/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, clientsFor, expectError, makeCall, prisma, seedFixtures, type Client, type FixtureUser, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** What the Expert must supply when starting / finishing a call. */
const REQUIRED_EXTRAS: Partial<Record<CallStatus, Record<string, unknown>>> = {
  ongoing: { ninjaLink: 'https://vdo.ninja/?room=test' },
  finished: { actualDurationMinutes: 50 },
  process_to_bank: { realIncome: 950 },
};

const transition = (client: Client, callId: string, to: CallStatus, comment?: string) =>
  client.post(`/calls/${callId}/transition`, { to, ...REQUIRED_EXTRAS[to], ...(comment ? { comment } : {}) });

async function lastHistory(callId: string) {
  return prisma.callStatusHistory.findFirstOrThrow({ where: { callId }, orderBy: { createdAt: 'desc' } });
}

async function expectMoved(client: Client, actor: FixtureUser, callId: string, from: CallStatus, to: CallStatus, isOverride: boolean) {
  const res = await transition(client, callId, to, `moving to ${to}`);
  expect(res.status, res.text).toBe(200);
  expect(res.body.status).toBe(to);
  const h = await lastHistory(callId);
  expect(h).toMatchObject({ fromStatus: from, toStatus: to, actorId: actor.id, isOverride, comment: `moving to ${to}` });
  expect((await prisma.call.findUniqueOrThrow({ where: { id: callId } })).status).toBe(to);
}

describe('valid moves record history with the right is_override', () => {
  it('associate schedules, reschedules and re-schedules their own call (no override)', async () => {
    const c = await as(fx.a1);
    const call = await makeCall(fx, { associate: fx.a1 });
    await expectMoved(c, fx.a1, call.id, 'on_scheduling', 'scheduled', false);
    await expectMoved(c, fx.a1, call.id, 'scheduled', 'on_rescheduling', false);
    await expectMoved(c, fx.a1, call.id, 'on_rescheduling', 'scheduled', false);
    expect(await prisma.callStatusHistory.count({ where: { callId: call.id } })).toBe(4);
  });

  it('manager of the associate overrides associate edges', async () => {
    const c = await as(fx.m1);
    const call = await makeCall(fx, { associate: fx.a2 });
    await expectMoved(c, fx.m1, call.id, 'on_scheduling', 'scheduled', true);
    await expectMoved(c, fx.m1, call.id, 'scheduled', 'on_rescheduling', true);
  });

  it('founder overrides associate edges', async () => {
    const c = await as(fx.founder);
    const call = await makeCall(fx, { associate: fx.a3, status: 'on_rescheduling' });
    await expectMoved(c, fx.founder, call.id, 'on_rescheduling', 'scheduled', true);
  });

  it('expert confirms, starts and finishes their call (no override)', async () => {
    const c = await as(fx.e1);
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    await expectMoved(c, fx.e1, call.id, 'scheduled', 'confirmed', false);
    await expectMoved(c, fx.e1, call.id, 'confirmed', 'ongoing', false);
    await expectMoved(c, fx.e1, call.id, 'ongoing', 'finished', false);
  });

  it('expert may finish directly from confirmed', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'confirmed' });
    await expectMoved(await as(fx.e1), fx.e1, call.id, 'confirmed', 'finished', false);
  });

  it('a scheduled call cannot start or finish before the expert confirms', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    const e1 = await as(fx.e1);
    expectError(await transition(e1, call.id, 'ongoing'), 409, 'invalid_transition');
    expectError(await transition(e1, call.id, 'finished'), 409, 'invalid_transition');
  });

  it('founder overrides expert edges', async () => {
    const c = await as(fx.founder);
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    await expectMoved(c, fx.founder, call.id, 'scheduled', 'confirmed', true);
    await expectMoved(c, fx.founder, call.id, 'confirmed', 'ongoing', true);
    await expectMoved(c, fx.founder, call.id, 'ongoing', 'finished', true);
  });

  it.each(['scheduled', 'confirmed'] as const)('expert requests rescheduling from %s (no override)', async (from) => {
    const call = await makeCall(fx, { associate: fx.a1, status: from });
    await expectMoved(await as(fx.e1), fx.e1, call.id, from, 'on_rescheduling', false);
  });

  it('associate can also send a confirmed call back for rescheduling', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'confirmed' });
    await expectMoved(await as(fx.a1), fx.a1, call.id, 'confirmed', 'on_rescheduling', false);
  });

  it('founder runs the invoice chain (no override)', async () => {
    const c = await as(fx.founder);
    const call = await makeCall(fx, { associate: fx.a1, status: 'finished' });
    // Invoicing needs the Profile's rate on the call's platform.
    await c.put(`/profiles/${fx.approvedProfile.id}/platforms/${fx.platform.id}`, { rate: 1000 });
    await expectMoved(c, fx.founder, call.id, 'finished', 'invoice_submit', false);
    await expectMoved(c, fx.founder, call.id, 'invoice_submit', 'invoice_approve', false);
    await expectMoved(c, fx.founder, call.id, 'invoice_approve', 'process_to_bank', false);
    const detail = await c.get(`/calls/${call.id}`);
    expect(detail.body.allowedTransitions).toEqual([]);
    expect(detail.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      'finished', 'invoice_submit', 'invoice_approve', 'process_to_bank',
    ]);
  });

  it('GET /calls/:id/history returns the rows with actor refs and overrides', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    await transition(await as(fx.m1), call.id, 'scheduled');
    const res = await (await as(fx.a1)).get(`/calls/${call.id}/history`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[1]).toMatchObject({ fromStatus: 'on_scheduling', toStatus: 'scheduled', isOverride: true, actor: { id: fx.m1.id, role: 'manager', nickname: 'ManagerOne' } });
    expect(Object.keys(res.body[1].actor).sort()).toEqual(['avatarId', 'id', 'nickname', 'photoId', 'role']);
  });
});

describe('cancelling a call (§4.5)', () => {
  it.each(['on_scheduling', 'scheduled', 'confirmed', 'on_rescheduling'] as const)(
    'the associate running it calls it off from %s (no override)',
    async (from) => {
      const call = await makeCall(fx, { associate: fx.a1, status: from });
      await expectMoved(await as(fx.a1), fx.a1, call.id, from, 'cancelled', false);
    },
  );

  it('any manager and the founder may call it off; the expert may not', async () => {
    const mine = await makeCall(fx, { associate: fx.a3, status: 'scheduled' });
    // m1 manages a1/a2, but every Manager runs every Associate's calls.
    await expectMoved(await as(fx.m1), fx.m1, mine.id, 'scheduled', 'cancelled', true);

    const theirs = await makeCall(fx, { associate: fx.a1, status: 'confirmed', scheduledAt: '2027-02-02T09:00:00Z' });
    await expectMoved(await as(fx.founder), fx.founder, theirs.id, 'confirmed', 'cancelled', true);

    const expertCall = await makeCall(fx, { associate: fx.a1, status: 'confirmed', scheduledAt: '2027-02-03T09:00:00Z' });
    expectError(await transition(await as(fx.e1), expertCall.id, 'cancelled'), 403, 'forbidden');
    expect((await (await as(fx.e1)).get(`/calls/${expertCall.id}`)).body.allowedTransitions).not.toContain('cancelled');
  });

  it('a call that has run cannot be called off, and a cancelled call is final', async () => {
    const finished = await makeCall(fx, { associate: fx.a1, status: 'finished' });
    expectError(await transition(await as(fx.a1), finished.id, 'cancelled'), 409, 'invalid_transition');

    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: '2027-03-01T09:00:00Z' });
    await expectMoved(await as(fx.a1), fx.a1, call.id, 'scheduled', 'cancelled', false);
    const detail = await (await as(fx.a1)).get(`/calls/${call.id}`);
    expect(detail.body.allowedTransitions).toEqual([]);
    expectError(await transition(await as(fx.a1), call.id, 'scheduled'), 409, 'invalid_transition');
  });

  it('frees the Expert’s slot and earns nothing', async () => {
    const at = '2027-04-01T09:00:00Z';
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: at });
    // The slot is taken while the call stands.
    const clash = {
      profileId: fx.approvedProfile.id,
      platformId: fx.platform.id,
      expertId: fx.e1.id,
      scheduledAt: at,
      durationMinutes: 60,
      projectDetails: 'Another call at the same time',
      platformAssociateName: 'Jordan at GLG',
    };
    const a1 = await as(fx.a1);
    const booked = await a1.post('/calls', clash);
    expect(booked.status, booked.text).toBe(201);
    // While the first call stands, the second cannot take the same slot.
    expectError(await transition(a1, booked.body.id, 'scheduled'), 409, 'expert_busy');

    await expectMoved(a1, fx.a1, call.id, 'scheduled', 'cancelled', false);
    expect((await transition(a1, booked.body.id, 'scheduled')).status).toBe(200);
    // A cancelled call is off the calendar; its slot belongs to the new one.
    const cal = await a1.get('/calendar', { from: '2027-04-01T00:00:00Z', to: '2027-04-02T00:00:00Z' });
    expect(cal.body.calls.map((c: { id: string }) => c.id)).toEqual([booked.body.id]);
  });
});

describe('starting and finishing need the Expert’s input', () => {
  const post = (client: Client, callId: string, body: Record<string, unknown>) => client.post(`/calls/${callId}/transition`, body);

  it('ongoing requires a valid Ninja link, which is stored on the call', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'confirmed' });
    const e1 = await as(fx.e1);
    const missing = await post(e1, call.id, { to: 'ongoing' });
    expectError(missing, 400, 'validation_error');
    expect(missing.body.error.details.issues).toContainEqual(expect.objectContaining({ path: 'ninjaLink' }));
    expectError(await post(e1, call.id, { to: 'ongoing', ninjaLink: 'not a link' }), 400, 'validation_error');
    expect((await prisma.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe('confirmed');

    const res = await post(e1, call.id, { to: 'ongoing', ninjaLink: 'https://vdo.ninja/?room=abc' });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ status: 'ongoing', ninjaLink: 'https://vdo.ninja/?room=abc' });
    // The meeting link is for the Expert and the Founder only.
    expect((await (await as(fx.founder)).get(`/calls/${call.id}`)).body.ninjaLink).toBe('https://vdo.ninja/?room=abc');
    expect((await (await as(fx.a1)).get(`/calls/${call.id}`)).body.ninjaLink).toBeNull();
    expect((await (await as(fx.m1)).get(`/calls/${call.id}`)).body.ninjaLink).toBeNull();
    const listed = (await (await as(fx.m1)).get('/calls')).body.items as Array<{ id: string; ninjaLink: string | null }>;
    expect(listed.find((c) => c.id === call.id)?.ninjaLink).toBeNull();
  });

  it('finished needs only the actual duration', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'ongoing' });
    const e1 = await as(fx.e1);
    const missing = await post(e1, call.id, { to: 'finished' });
    expectError(missing, 400, 'validation_error');
    expect(missing.body.error.details.issues.map((i: { path: string }) => i.path)).toEqual(['actualDurationMinutes']);
    for (const bad of [{ actualDurationMinutes: 0 }, { actualDurationMinutes: 601 }, { actualDurationMinutes: 30.5 }]) {
      expectError(await post(e1, call.id, { to: 'finished', ...bad }), 400, 'validation_error');
    }
    const res = await post(e1, call.id, { to: 'finished', actualDurationMinutes: 42 });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ status: 'finished', actualDurationMinutes: 42, rating: null, feedback: null });
    // The booked duration (and so the calendar slot) is untouched.
    expect(res.body.durationMinutes).toBe(60);
  });

  it('the rating range is enforced by the database too', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    await expect(prisma.call.update({ where: { id: call.id }, data: { rating: 9 } })).rejects.toThrow(/calls_rating_range/);
  });
});

describe('403 for the wrong role on a valid edge', () => {
  it.each<[keyof Fixtures, CallStatus, CallStatus]>([
    ['e1', 'on_scheduling', 'scheduled'],
    ['e1', 'on_rescheduling', 'scheduled'],
    ['a1', 'scheduled', 'confirmed'],
    ['m1', 'scheduled', 'confirmed'],
    ['a1', 'confirmed', 'ongoing'],
    ['a1', 'confirmed', 'finished'],
    ['m1', 'ongoing', 'finished'],
    ['a1', 'finished', 'invoice_submit'],
    ['m1', 'finished', 'invoice_submit'],
    ['e1', 'invoice_submit', 'invoice_approve'],
  ])('%s cannot move %s → %s', async (who, from, to) => {
    const call = await makeCall(fx, { associate: fx.a1, status: from });
    expectError(await transition(await as(fx[who] as FixtureUser), call.id, to), 403, 'forbidden');
    expect((await prisma.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe(from);
    expect(await prisma.callStatusHistory.count({ where: { callId: call.id } })).toBe(1);
  });
});

describe('409 for an invalid edge', () => {
  it.each<[CallStatus, CallStatus]>([
    ['on_scheduling', 'finished'],
    ['on_scheduling', 'on_scheduling'],
    ['scheduled', 'invoice_submit'],
    ['finished', 'scheduled'],
    ['process_to_bank', 'on_scheduling'],
  ])('%s → %s', async (from, to) => {
    const call = await makeCall(fx, { associate: fx.a1, status: from });
    const res = await transition(await as(fx.founder), call.id, to);
    expectError(res, 409, 'invalid_transition');
    expect(res.body.error.details).toEqual({ from, to });
  });

  it('rejects an unknown status name with 400', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    expectError(await (await as(fx.founder)).post(`/calls/${call.id}/transition`, { to: 'abandoned' }), 400, 'validation_error');
  });
});

describe('404 for a call the user cannot see', () => {
  it.each<keyof Fixtures>(['a2', 'a3', 'e2'])('%s gets 404 on a1’s call', async (who) => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled' });
    const client = await as(fx[who] as FixtureUser);
    expectError(await transition(client, call.id, 'on_rescheduling'), 404, 'not_found');
    expectError(await client.get(`/calls/${call.id}`), 404, 'not_found');
  });

  it('a manager’s own call is 404 for another manager', async () => {
    const call = await makeCall(fx, { associate: fx.m1, expert: fx.e1, status: 'scheduled' });
    const m2 = await as(fx.m2);
    expectError(await transition(m2, call.id, 'on_rescheduling'), 404, 'not_found');
    expectError(await m2.get(`/calls/${call.id}`), 404, 'not_found');
  });

  it('unknown and malformed ids are 404', async () => {
    const c = await as(fx.founder);
    expectError(await transition(c, '00000000-0000-4000-8000-000000000000', 'scheduled'), 404);
    expectError(await transition(c, 'not-a-uuid', 'scheduled'), 404);
  });
});

describe('expert_required', () => {
  it('scheduling without an expert is 409 expert_required', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: null });
    expectError(await transition(await as(fx.a1), call.id, 'scheduled'), 409, 'expert_required');
    expect((await prisma.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe('on_scheduling');
  });
});

describe('notifications on transition', () => {
  it('everyone else involved gets call.status_changed; the actor does not', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1 });
    const cs = await clientsFor(fx, ['a1', 'm1', 'e1', 'founder', 'a2', 'm2', 'e2']);
    expect((await transition(cs.a1, call.id, 'scheduled')).status).toBe(200);

    for (const who of ['m1', 'e1', 'founder'] as const) {
      const res = await cs[who].get('/notifications');
      expect(res.status).toBe(200);
      const n = res.body.items.find((i: { type: string }) => i.type === 'call.status_changed');
      expect(n, `${who} notification`).toMatchObject({
        payload: { callId: call.id, from: 'on_scheduling', to: 'scheduled', actor: { nickname: 'AssocOne', role: 'associate' } },
        readAt: null,
      });
      expect(res.body.unreadCount).toBeGreaterThanOrEqual(1);
      expect(res.headers['x-unread-count']).toBe(String(res.body.unreadCount));
    }
    for (const who of ['a1', 'a2', 'm2', 'e2'] as const) {
      const res = await cs[who].get('/notifications');
      expect(res.body.items, who).toEqual([]);
    }
  });

  it('a second active founder is notified too, an inactive one is not', async () => {
    const extra = await prisma.user.create({
      data: { nickname: 'FounderTwo', role: 'founder', email: 'foundertwo@fixtures.test', passwordHash: 'x', avatarId: 'founder-02' },
    });
    const gone = await prisma.user.create({
      data: { nickname: 'FounderGone', role: 'founder', email: 'foundergone@fixtures.test', passwordHash: 'x', avatarId: 'founder-03', isActive: false },
    });
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    await transition(await as(fx.e1), call.id, 'confirmed');
    expect(await prisma.notification.count({ where: { userId: extra.id, type: 'call.status_changed' } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: gone.id } })).toBe(0);
  });

  it('marking notifications read updates the unread count', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    const m1 = await as(fx.m1);
    await transition(await as(fx.a1), call.id, 'scheduled');
    const list = await m1.get('/notifications', { unread: 'true' });
    expect(list.body.items).toHaveLength(1);
    const read = await m1.post('/notifications/read', { ids: [list.body.items[0].id] });
    expect(read.body).toEqual({ updated: 1, unreadCount: 0 });
    expect((await m1.get('/notifications', { unread: 'true' })).body.items).toEqual([]);
  });
});

describe('allowedTransitions in the call DTO', () => {
  it('reflects the viewer', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    const [a1, e1, founder, m1] = await Promise.all([as(fx.a1), as(fx.e1), as(fx.founder), as(fx.m1)]);
    expect((await a1.get(`/calls/${call.id}`)).body.allowedTransitions).toEqual(['on_rescheduling', 'cancelled']);
    expect((await m1.get(`/calls/${call.id}`)).body.allowedTransitions).toEqual(['on_rescheduling', 'cancelled']);
    // The Expert confirms or asks for another time, but never calls a call off.
    expect([...(await e1.get(`/calls/${call.id}`)).body.allowedTransitions].sort()).toEqual(['confirmed', 'on_rescheduling']);
    expect([...(await founder.get(`/calls/${call.id}`)).body.allowedTransitions].sort()).toEqual(['cancelled', 'confirmed', 'on_rescheduling']);
  });
});

describe('expert confirmation and rescheduling rules', () => {
  it('an expert must give a reason to request rescheduling; others need not', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'confirmed' });
    const res = await (await as(fx.e1)).post(`/calls/${call.id}/transition`, { to: 'on_rescheduling' });
    expectError(res, 400, 'validation_error');
    expect(res.body.error.details.issues).toContainEqual(expect.objectContaining({ path: 'comment' }));
    expect((await prisma.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe('confirmed');
    const other = await makeCall(fx, { associate: fx.a1, status: 'confirmed', scheduledAt: '2027-03-01T09:00:00Z' });
    expect((await (await as(fx.a1)).post(`/calls/${other.id}/transition`, { to: 'on_rescheduling' })).status).toBe(200);
  });

  it('the associate is notified when the expert requests rescheduling', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    await transition(await as(fx.e1), call.id, 'on_rescheduling', 'Conflict on Monday');
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: fx.a1.id, type: 'call.status_changed' } });
    expect(n.payload).toMatchObject({ from: 'scheduled', to: 'on_rescheduling', actor: { role: 'expert' } });
  });

  it('moving a confirmed call to a new time sends it back to scheduled', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'confirmed' });
    const a1 = await as(fx.a1);
    // Other edits keep the confirmation.
    expect((await a1.patch(`/calls/${call.id}`, { notes: 'Bring the deck' })).body.status).toBe('confirmed');
    const res = await a1.patch(`/calls/${call.id}`, { scheduledAt: '2027-02-01T11:00:00Z' });
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe('scheduled');
    expect(await lastHistory(call.id)).toMatchObject({ fromStatus: 'confirmed', toStatus: 'scheduled', actorId: fx.a1.id });
    expect((await (await as(fx.e1)).get(`/calls/${call.id}`)).body.allowedTransitions.sort()).toEqual(['confirmed', 'on_rescheduling']);
  });

  it('a confirmed call blocks the expert’s time', async () => {
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'confirmed', scheduledAt: '2027-02-01T09:00:00Z' });
    await expect(
      makeCall(fx, { associate: fx.a3, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T09:30:00Z' }),
    ).rejects.toThrow(/calls_expert_no_overlap/);
  });
});

describe('a finished call cannot be invoiced without a rate', () => {
  const rateUrl = (profileId: string, platformId: string) => `/profiles/${profileId}/platforms/${platformId}`;

  it('blocks invoice_submit until the Profile has a rate on the call’s platform', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'finished' });
    const founder = await as(fx.founder);

    const blocked = await transition(founder, call.id, 'invoice_submit');
    expectError(blocked, 409, 'rate_required');
    expect(blocked.body.error.message).toMatch(/hourly rate/i);
    expect((await prisma.call.findUniqueOrThrow({ where: { id: call.id } })).status).toBe('finished');

    // It shows up in the Founder's pending tasks meanwhile.
    const tasks = (await founder.get('/dashboard')).body.tasks;
    expect(tasks.profilesNeedingRate).toEqual([
      { profile: expect.objectContaining({ id: fx.approvedProfile.id }), platform: { id: fx.platform.id, name: 'GLG' }, finishedCalls: 1 },
    ]);

    await founder.put(rateUrl(fx.approvedProfile.id, fx.platform.id), { rate: 1200 });
    expect((await transition(founder, call.id, 'invoice_submit')).status).toBe(200);
    expect((await founder.get('/dashboard')).body.tasks.profilesNeedingRate).toEqual([]);
  });

  it('a rate set on the call itself is enough', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'finished' });
    const founder = await as(fx.founder);
    expect((await founder.patch(`/calls/${call.id}`, { rateOverride: 900 })).status).toBe(200);
    expect((await transition(founder, call.id, 'invoice_submit')).status).toBe(200);
    expect((await founder.get('/dashboard')).body.tasks.profilesNeedingRate).toEqual([]);
  });
});

describe('processing to bank records what actually arrived', () => {
  it('requires the real income, and stores it', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'invoice_approve' });
    const founder = await as(fx.founder);
    const missing = await founder.post(`/calls/${call.id}/transition`, { to: 'process_to_bank' });
    expectError(missing, 400, 'validation_error');
    expect(missing.body.error.details.issues).toContainEqual(expect.objectContaining({ path: 'realIncome' }));
    expectError(await founder.post(`/calls/${call.id}/transition`, { to: 'process_to_bank', realIncome: -5 }), 400);

    const res = await founder.post(`/calls/${call.id}/transition`, { to: 'process_to_bank', realIncome: 980.4 });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ status: 'process_to_bank', realIncome: 980.4 });
  });
});
