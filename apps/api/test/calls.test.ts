import { FEATURES } from '@god/shared';
import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, clientsFor, expectError, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const body = (over: Record<string, unknown> = {}) => ({
  platformId: fx.platform.id,
  profileId: fx.approvedProfile.id,
  scheduledAt: '2027-03-01T15:00:00Z',
  durationMinutes: 45,
  projectDetails: 'Supply chain of lithium refiners',
  platformAssociateName: 'Riley at GLG',
  notes: 'Bring the deck',
  ...over,
});

describe('POST /calls', () => {
  it('associate creates a call for themselves in on_scheduling with a history row', async () => {
    const res = await (await as(fx.a1)).post('/calls', body({ expertId: fx.e1.id }));
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      status: 'on_scheduling',
      associate: { id: fx.a1.id },
      manager: { id: fx.m1.id },
      expert: { id: fx.e1.id },
      durationMinutes: 45,
      scheduledAt: '2027-03-01T15:00:00.000Z',
      endsAt: '2027-03-01T15:45:00.000Z',
      allowedTransitions: ['scheduled', 'cancelled'],
      permissions: { edit: true, reassignAssociate: false, reassignExpert: true, editIncome: false, editGptLink: false, editRate: true },
    });
    const history = await prisma.callStatusHistory.findMany({ where: { callId: res.body.id } });
    expect(history).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'on_scheduling', actorId: fx.a1.id, isOverride: false })]);
  });

  it('notifies: expert gets call.assigned, manager and founder get call.created, creator nothing', async () => {
    const res = await (await as(fx.a1)).post('/calls', body({ expertId: fx.e1.id }));
    const types = async (userId: string) => (await prisma.notification.findMany({ where: { userId } })).map((n) => n.type);
    expect(await types(fx.e1.id)).toEqual(['call.assigned']);
    expect(await types(fx.m1.id)).toEqual(['call.created']);
    expect(await types(fx.founder.id)).toEqual(['call.created']);
    expect(await types(fx.a1.id)).toEqual([]);
    expect(await types(fx.m2.id)).toEqual([]);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: fx.e1.id } });
    expect(n.payload).toMatchObject({ callId: res.body.id });
  });

  it('associate cannot create for another associate', async () => {
    expectError(await (await as(fx.a1)).post('/calls', body({ associateId: fx.a2.id })), 403);
  });

  it('manager creates for any associate or runs the call themselves', async () => {
    const m1 = await as(fx.m1);
    expect((await m1.post('/calls', body({ associateId: fx.a2.id }))).status).toBe(201);
    expect((await m1.post('/calls', body({ associateId: fx.a3.id }))).status).toBe(201);
    expectError(await m1.post('/calls', body({ associateId: fx.m2.id })), 403);
    // Without an Associate, or choosing themselves, the Manager owns the call.
    const own = await m1.post('/calls', body());
    expect(own.status, own.text).toBe(201);
    expect(own.body.associate).toMatchObject({ id: fx.m1.id, role: 'manager' });
    expect((await m1.post('/calls', body({ associateId: fx.m1.id }))).body.associate.id).toBe(fx.m1.id);
  });

  it('a manager runs their own call like an associate: scheduling without override, hand-off to the team', async () => {
    const m1 = await as(fx.m1);
    const call = (await m1.post('/calls', body({ expertId: fx.e1.id }))).body;
    expect(call.permissions).toMatchObject({ edit: true, reassignAssociate: true, reassignExpert: true });
    expect(call.allowedTransitions).toEqual(['scheduled', 'cancelled']);

    const moved = await m1.post(`/calls/${call.id}/transition`, { to: 'scheduled' });
    expect(moved.status, moved.text).toBe(200);
    const history = await prisma.callStatusHistory.findFirstOrThrow({ where: { callId: call.id, toStatus: 'scheduled' } });
    expect(history.isOverride).toBe(false);

    // A Manager's own call stays theirs: other Managers and Associates don't see it.
    expectError(await (await as(fx.m2)).get(`/calls/${call.id}`), 404);
    expectError(await (await as(fx.a1)).get(`/calls/${call.id}`), 404);
    expect((await (await as(fx.founder)).get(`/calls/${call.id}`)).status).toBe(200);
    expect((await m1.get('/calls')).body.items.map((c: { id: string }) => c.id)).toContain(call.id);

    expectError(await m1.patch(`/calls/${call.id}`, { associateId: fx.m2.id }), 403);
    expect((await m1.patch(`/calls/${call.id}`, { associateId: fx.a2.id })).body.associate.id).toBe(fx.a2.id);
  });

  it('the founder can give a call to a manager, but not to an expert', async () => {
    const founder = await as(fx.founder);
    expect((await founder.post('/calls', body({ associateId: fx.m2.id }))).body.associate.id).toBe(fx.m2.id);
    expectError(await founder.post('/calls', body({ associateId: fx.e1.id })), 400, 'validation_error');
    expectError(await founder.post('/calls', body()), 400, 'validation_error');
  });

  it('a call cannot be booked in the past, or moved there', async () => {
    const a1 = await as(fx.a1);
    expectError(await a1.post('/calls', body({ scheduledAt: '2020-01-01T10:00:00Z' })), 400, 'validation_error');
    const call = (await a1.post('/calls', body())).body;
    expectError(await a1.patch(`/calls/${call.id}`, { scheduledAt: '2020-01-01T10:00:00Z' }), 400, 'validation_error');
    // Five minutes of slack covers a slow form.
    const justNow = new Date(Date.now() - 60_000).toISOString();
    expect((await a1.patch(`/calls/${call.id}`, { scheduledAt: justNow })).status).toBe(200);
  });

  it('counts the calls waiting on each role, for the sidebar badge', async () => {
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'on_scheduling' });
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-03-02T09:00:00Z' });
    await makeCall(fx, { associate: fx.a3, expert: fx.e2, status: 'finished', scheduledAt: '2027-03-03T09:00:00Z' });
    const waiting = async (user: typeof fx.a1) => (await (await as(user)).get('/calls/waiting')).body.count;
    expect(await waiting(fx.a1)).toBe(1); // one to schedule
    expect(await waiting(fx.e1)).toBe(1); // one to confirm
    expect(await waiting(fx.founder)).toBe(1); // one to invoice
    expect(await waiting(fx.m1)).toBe(1); // scheduling steps across every associate
    expect(await waiting(fx.a2)).toBe(0);
  });

  it('expert cannot create calls', async () => {
    expectError(await (await as(fx.e1)).post('/calls', body()), 403);
  });

  it.each(['pendingProfile', 'rejected'] as const)('a %s profile is 409 profile_not_approved', async (kind) => {
    let profileId = fx.pendingProfile.id;
    if (kind === 'rejected') {
      const p = await prisma.profile.create({
        data: { name: 'Rex Rejected', avatarId: 'profile-04', status: 'rejected', rejectionReason: 'dup', createdById: fx.a1.id },
      });
      profileId = p.id;
    }
    expectError(await (await as(fx.a1)).post('/calls', body({ profileId })), 409, 'profile_not_approved');
    expect(await prisma.call.count()).toBe(0);
  });

  it.each([[20], [0], [90]])('duration %s is 400', async (durationMinutes) => {
    expectError(await (await as(fx.a1)).post('/calls', body({ durationMinutes })), 400, 'validation_error');
  });

  it('blank project details are 400', async () => {
    expectError(await (await as(fx.a1)).post('/calls', body({ projectDetails: '   ' })), 400, 'validation_error');
  });

  it('an inactive or non-expert expertId is 400', async () => {
    const a1 = await as(fx.a1);
    expectError(await a1.post('/calls', body({ expertId: fx.a2.id })), 400);
    await prisma.user.update({ where: { id: fx.e2.id }, data: { isActive: false } });
    expectError(await a1.post('/calls', body({ expertId: fx.e2.id })), 400);
  });

  it('accepts snake_case bodies', async () => {
    const res = await (await as(fx.a1)).post('/calls', {
      platform_id: fx.platform.id,
      profile_id: fx.approvedProfile.id,
      scheduled_at: '2027-03-01T15:00:00Z',
      duration_minutes: 30,
      project_details: 'Snake case',
      platform_associate_name: 'Sam',
    });
    expect(res.status, res.text).toBe(201);
  });
});

describe('GET /calls visibility', () => {
  it('each role sees its calls: managers follow every associate', async () => {
    const c1 = await makeCall(fx, { associate: fx.a1, expert: fx.e1, scheduledAt: '2027-02-01T09:00:00Z' });
    const c2 = await makeCall(fx, { associate: fx.a2, expert: fx.e2, scheduledAt: '2027-02-02T09:00:00Z' });
    const c3 = await makeCall(fx, { associate: fx.a3, expert: fx.e1, scheduledAt: '2027-02-03T09:00:00Z' });
    const cs = await clientsFor(fx, ['founder', 'm1', 'm2', 'a1', 'e1', 'e3']);
    const ids = async (k: keyof typeof cs) => {
      const res = await cs[k].get('/calls', { sort: 'scheduledAt' });
      expect(res.status).toBe(200);
      return res.body.items.map((c: { id: string }) => c.id);
    };
    expect(await ids('founder')).toEqual([c1.id, c2.id, c3.id]);
    expect(await ids('m1')).toEqual([c1.id, c2.id, c3.id]);
    expect(await ids('m2')).toEqual([c1.id, c2.id, c3.id]);
    expect(await ids('a1')).toEqual([c1.id]);
    expect(await ids('e1')).toEqual([c1.id, c3.id]);
    expect(await ids('e3')).toEqual([]);
  });

  it('filters by status and paginates', async () => {
    for (let i = 0; i < 5; i++) {
      await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: i < 2 ? 'scheduled' : 'on_scheduling', scheduledAt: `2027-02-0${i + 1}T09:00:00Z` });
    }
    const a1 = await as(fx.a1);
    const scheduled = await a1.get('/calls', { status: 'scheduled' });
    expect(scheduled.body.total).toBe(2);
    const page = await a1.get('/calls', { pageSize: 2, page: 2, sort: 'scheduledAt' });
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect(page.body.items.map((c: { scheduledAt: string }) => c.scheduledAt)).toEqual(['2027-02-03T09:00:00.000Z', '2027-02-04T09:00:00.000Z']);
  });
});

describe('PATCH /calls/:id permissions', () => {
  it('associate may change the expert while on_scheduling', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1 });
    const res = await (await as(fx.a1)).patch(`/calls/${call.id}`, { expertId: fx.e2.id });
    expect(res.status, res.text).toBe(200);
    expect(res.body.expert.id).toBe(fx.e2.id);
    expect(await prisma.notification.count({ where: { userId: fx.e2.id, type: 'call.assigned' } })).toBe(1);
  });

  it.each(['scheduled', 'confirmed', 'on_rescheduling'] as const)(
    'associate may still change the expert while %s (they own scheduling)',
    async (status) => {
      const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status });
      const res = await (await as(fx.a1)).patch(`/calls/${call.id}`, { expertId: fx.e2.id });
      expect(res.status, res.text).toBe(200);
      expect(res.body.expert.id).toBe(fx.e2.id);
    },
  );

  it.each(['ongoing', 'finished'] as const)('associate may not change the expert once %s', async (status) => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status });
    expectError(await (await as(fx.a1)).patch(`/calls/${call.id}`, { expertId: fx.e2.id }), 403);
    expect((await prisma.call.findUniqueOrThrow({ where: { id: call.id } })).expertId).toBe(fx.e1.id);
  });

  it('an associate cannot remove the Expert from a scheduled call', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled' });
    expectError(await (await as(fx.a1)).patch(`/calls/${call.id}`, { expertId: null }), 409, 'expert_required');
  });

  it('manager may change the expert during rescheduling but not remove it', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'on_rescheduling' });
    const m1 = await as(fx.m1);
    expect((await m1.patch(`/calls/${call.id}`, { expertId: fx.e2.id })).status).toBe(200);
    expectError(await m1.patch(`/calls/${call.id}`, { expertId: null }), 409, 'expert_required');
  });

  it('associate may edit scheduling details while scheduling but not after', async () => {
    const early = await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: '2027-02-01T09:00:00Z' });
    const late = await makeCall(fx, { associate: fx.a1, status: 'ongoing', scheduledAt: '2027-02-02T09:00:00Z' });
    const a1 = await as(fx.a1);
    const ok = await a1.patch(`/calls/${early.id}`, { notes: 'new notes', durationMinutes: 30 });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.body).toMatchObject({ notes: 'new notes', durationMinutes: 30, endsAt: '2027-02-01T09:30:00.000Z' });
    expectError(await a1.patch(`/calls/${late.id}`, { notes: 'too late' }), 403);
    expect((await (await as(fx.founder)).patch(`/calls/${late.id}`, { notes: 'founder can' })).status).toBe(200);
  });

  it('real income: only the founder corrects it, and only once the call is paid', async () => {
    const cs = await clientsFor(fx, ['a1', 'm1', 'e1', 'founder']);
    const unpaid = await makeCall(fx, { associate: fx.a1, status: 'finished' });
    expectError(await cs.founder.patch(`/calls/${unpaid.id}`, { realIncome: 100 }), 409);

    const paid = await makeCall(fx, { associate: fx.a1, status: 'invoice_approve', scheduledAt: '2027-03-01T09:00:00Z' });
    expect((await cs.founder.post(`/calls/${paid.id}/transition`, { to: 'process_to_bank', realIncome: 150.5 })).status).toBe(200);
    for (const who of ['a1', 'm1', 'e1'] as const) {
      const res = await cs[who].patch(`/calls/${paid.id}`, { realIncome: 1 });
      expect([403, 404], res.text).toContain(res.status);
    }
    const res = await cs.founder.patch(`/calls/${paid.id}`, { realIncome: 149.99 });
    expect(res.status, res.text).toBe(200);
    expect(res.body.realIncome).toBe(149.99);
    expectError(await cs.founder.patch(`/calls/${paid.id}`, { realIncome: null }), 400);
    expectError(await cs.founder.patch(`/calls/${paid.id}`, { realIncome: 12.345 }), 400);
  });

  it('expected price is the rate for the minutes the call really took', async () => {
    const f = await as(fx.founder);
    await f.put(`/profiles/${fx.approvedProfile.id}/platforms/${fx.platform.id}`, { status: 'registered', rate: 1200 });
    const call = await makeCall(fx, { associate: fx.a1, status: 'finished' });
    expect((await f.get(`/calls/${call.id}`)).body.expectedPrice).toBeNull(); // no duration yet
    await prisma.call.update({ where: { id: call.id }, data: { actualDurationMinutes: 45 } });
    expect((await f.get(`/calls/${call.id}`)).body.expectedPrice).toBe(900);
    // A special rate on the call wins.
    await f.patch(`/calls/${call.id}`, { rateOverride: 1000 });
    expect((await f.get(`/calls/${call.id}`)).body.expectedPrice).toBe(750);
    await prisma.call.update({ where: { id: call.id }, data: { actualDurationMinutes: 7 } });
    expect((await f.get(`/calls/${call.id}`)).body.expectedPrice).toBe(116.67);
  });

  it('associate reassignment: managers to any associate, associates never', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    expectError(await (await as(fx.a1)).patch(`/calls/${call.id}`, { associateId: fx.a2.id }), 403);
    const m1 = await as(fx.m1);
    // Another team's Associate is fine now; another Manager is not.
    expect((await m1.patch(`/calls/${call.id}`, { associateId: fx.a3.id })).body.associate.id).toBe(fx.a3.id);
    expectError(await m1.patch(`/calls/${call.id}`, { associateId: fx.m2.id }), 403);
    expect((await m1.patch(`/calls/${call.id}`, { associateId: fx.a2.id })).body.associate.id).toBe(fx.a2.id);
  });

  it('expert cannot edit call details', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    expectError(await (await as(fx.e1)).patch(`/calls/${call.id}`, { notes: 'hi' }), 403);
  });

  it('a user who cannot see the call gets 404', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    expectError(await (await as(fx.a3)).patch(`/calls/${call.id}`, { notes: 'x' }), 404);
    // One Manager's own call is invisible to another Manager.
    const ownCall = await makeCall(fx, { associate: fx.m1 });
    expectError(await (await as(fx.m2)).patch(`/calls/${ownCall.id}`, { notes: 'x' }), 404);
  });

  it('an empty patch is 400', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    expectError(await (await as(fx.a1)).patch(`/calls/${call.id}`, {}), 400);
  });
});

describe('double booking', () => {
  const schedule = async (who: Awaited<ReturnType<typeof as>>, id: string) => who.post(`/calls/${id}/transition`, { to: 'scheduled' });

  it('scheduling an overlapping call for the same expert is 409 expert_busy', async () => {
    await makeCall(fx, { associate: fx.a3, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T09:00:00Z', durationMinutes: 60 });
    const b = await makeCall(fx, { associate: fx.a1, expert: fx.e1, scheduledAt: '2027-02-01T09:45:00Z', durationMinutes: 30 });
    const res = await schedule(await as(fx.a1), b.id);
    expectError(res, 409, 'expert_busy');
    expect((await prisma.call.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('on_scheduling');
    expect(await prisma.callStatusHistory.count({ where: { callId: b.id } })).toBe(1);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('a call fully containing another is busy too', async () => {
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'ongoing', scheduledAt: '2027-02-01T09:15:00Z', durationMinutes: 15 });
    const b = await makeCall(fx, { associate: fx.a1, expert: fx.e1, scheduledAt: '2027-02-01T09:00:00Z', durationMinutes: 60 });
    expectError(await schedule(await as(fx.a1), b.id), 409, 'expert_busy');
  });

  it.each(['confirmed', 'on_rescheduling', 'finished', 'process_to_bank'] as const)('an existing %s call blocks', async (status) => {
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status, scheduledAt: '2027-02-01T09:00:00Z' });
    const b = await makeCall(fx, { associate: fx.a1, expert: fx.e1, scheduledAt: '2027-02-01T09:30:00Z' });
    expectError(await schedule(await as(fx.a1), b.id), 409, 'expert_busy');
  });

  it('back-to-back calls (end 10:00, start 10:00) are fine', async () => {
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T09:00:00Z', durationMinutes: 60 });
    const before = await makeCall(fx, { associate: fx.a1, expert: fx.e1, scheduledAt: '2027-02-01T08:45:00Z', durationMinutes: 15 });
    const after = await makeCall(fx, { associate: fx.a1, expert: fx.e1, scheduledAt: '2027-02-01T10:00:00Z', durationMinutes: 30 });
    const a1 = await as(fx.a1);
    expect((await schedule(a1, after.id)).status).toBe(200);
    expect((await schedule(a1, before.id)).status).toBe(200);
  });

  it('the same time with a different expert is fine', async () => {
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T09:00:00Z' });
    const b = await makeCall(fx, { associate: fx.a1, expert: fx.e2, scheduledAt: '2027-02-01T09:00:00Z' });
    expect((await schedule(await as(fx.a1), b.id)).status).toBe(200);
  });

  it('on_scheduling calls never block', async () => {
    const a = await makeCall(fx, { associate: fx.a1, expert: fx.e1, scheduledAt: '2027-02-01T09:00:00Z' });
    const b = await makeCall(fx, { associate: fx.a3, expert: fx.e1, scheduledAt: '2027-02-01T09:00:00Z' });
    const c = await makeCall(fx, { associate: fx.a1, expert: fx.e1, scheduledAt: '2027-02-01T09:30:00Z' });
    expect((await schedule(await as(fx.a1), a.id)).status).toBe(200);
    // b and c overlap a (now blocking) but can still be edited while on_scheduling.
    expect((await (await as(fx.a1)).patch(`/calls/${c.id}`, { durationMinutes: 60 })).status).toBe(200);
    expect((await prisma.call.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('on_scheduling');
  });

  it('rescheduling back to scheduled is also checked', async () => {
    const a = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'on_rescheduling', scheduledAt: '2027-02-01T09:00:00Z' });
    // on_rescheduling already blocks, so the overlap arises by moving a scheduled_at under an on_scheduling call.
    const b = await makeCall(fx, { associate: fx.a3, expert: fx.e1, scheduledAt: '2027-02-01T12:00:00Z' });
    expect((await schedule(await as(fx.a3), b.id)).status).toBe(200);
    expectError(await (await as(fx.a1)).patch(`/calls/${a.id}`, { scheduledAt: '2027-02-01T12:30:00Z' }), 409, 'expert_busy');
  });

  it('PATCH moving a scheduled call onto another is 409 expert_busy', async () => {
    await makeCall(fx, { associate: fx.a3, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T09:00:00Z' });
    const b = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T11:00:00Z' });
    const a1 = await as(fx.a1);
    expectError(await a1.patch(`/calls/${b.id}`, { scheduledAt: '2027-02-01T09:30:00Z' }), 409, 'expert_busy');
    const unchanged = await prisma.call.findUniqueOrThrow({ where: { id: b.id } });
    expect(unchanged.scheduledAt.toISOString()).toBe('2027-02-01T11:00:00.000Z');
    // Moving to exactly the end of the other call is fine.
    expect((await a1.patch(`/calls/${b.id}`, { scheduledAt: '2027-02-01T10:00:00Z' })).status).toBe(200);
  });

  it('PATCH extending the duration into another call is 409, reassigning onto a busy expert too', async () => {
    await makeCall(fx, { associate: fx.a3, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T10:00:00Z' });
    const b = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T09:30:00Z', durationMinutes: 30 });
    expectError(await (await as(fx.a1)).patch(`/calls/${b.id}`, { durationMinutes: 45 }), 409, 'expert_busy');

    await makeCall(fx, { associate: fx.a3, expert: fx.e2, status: 'scheduled', scheduledAt: '2027-03-01T10:00:00Z' });
    const c = await makeCall(fx, { associate: fx.a1, expert: fx.e3, status: 'scheduled', scheduledAt: '2027-03-01T10:15:00Z', durationMinutes: 15 });
    expectError(await (await as(fx.m1)).patch(`/calls/${c.id}`, { expertId: fx.e2.id }), 409, 'expert_busy');
  });
});

describe('messages are switched off', () => {
  it('message routes are 404 and the detail carries no messages', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1 });
    await prisma.message.create({ data: { callId: call.id, senderId: fx.a1.id, body: 'old' } });
    const a1 = await as(fx.a1);
    expectError(await a1.post(`/calls/${call.id}/messages`, { body: 'hi' }), 404, 'not_found');
    expectError(await a1.get(`/calls/${call.id}/messages`), 404, 'not_found');
    expect((await a1.get(`/calls/${call.id}`)).body.messages).toEqual([]);
    expect(await prisma.notification.count({ where: { type: 'call.message' } })).toBe(0);
  });

  it('call DTOs no longer carry the platform link', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    const res = await (await as(fx.a1)).get(`/calls/${call.id}`);
    expect(Object.keys(res.body.platform).sort()).toEqual(['country', 'id', 'name', 'priority']);
  });
});

describe.runIf(FEATURES.messages)('messages', () => {
  it('posting a message returns it and notifies the other participants', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1 });
    const res = await (await as(fx.e1)).post(`/calls/${call.id}/messages`, { body: '  Hello team  ' });
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ callId: call.id, body: 'Hello team', sender: { id: fx.e1.id, role: 'expert', nickname: 'ExpertSeoul' } });
    const recipients = (await prisma.notification.findMany({ where: { type: 'call.message' } })).map((n) => n.userId).sort();
    expect(recipients).toEqual([fx.a1.id, fx.m1.id, fx.founder.id].sort());
    expect((await (await as(fx.a1)).get(`/calls/${call.id}`)).body.messages).toHaveLength(1);
  });

  it('blank messages are 400; strangers get 404', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    expectError(await (await as(fx.a1)).post(`/calls/${call.id}/messages`, { body: '   ' }), 400);
    expectError(await (await as(fx.a3)).post(`/calls/${call.id}/messages`, { body: 'hi' }), 404);
    expectError(await (await as(fx.e2)).get(`/calls/${call.id}/messages`), 404);
  });

  it('cursor pagination walks newest page first, oldest-to-newest inside a page', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    const base = Date.parse('2027-01-01T00:00:00Z');
    for (let i = 1; i <= 7; i++) {
      await prisma.message.create({ data: { callId: call.id, senderId: fx.a1.id, body: `m${i}`, createdAt: new Date(base + i * 1000) } });
    }
    const a1 = await as(fx.a1);
    const seen: string[][] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const res = await a1.get(`/calls/${call.id}/messages`, { limit: 3, ...(cursor ? { cursor } : {}) });
      expect(res.status).toBe(200);
      seen.push(res.body.items.map((m: { body: string }) => m.body));
      cursor = res.body.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toEqual([['m5', 'm6', 'm7'], ['m2', 'm3', 'm4'], ['m1']]);
  });

  it('pagination neither skips nor repeats messages sharing a timestamp', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    const at = new Date('2027-01-01T00:00:00Z');
    for (let i = 1; i <= 5; i++) {
      await prisma.message.create({ data: { callId: call.id, senderId: fx.a1.id, body: `same${i}`, createdAt: at } });
    }
    const a1 = await as(fx.a1);
    const all: string[] = [];
    let cursor: string | undefined;
    do {
      const res = await a1.get(`/calls/${call.id}/messages`, { limit: 2, ...(cursor ? { cursor } : {}) });
      all.push(...res.body.items.map((m: { body: string }) => m.body));
      cursor = res.body.nextCursor ?? undefined;
    } while (cursor);
    expect(all.sort()).toEqual(['same1', 'same2', 'same3', 'same4', 'same5']);
  });

  it('exactly limit messages gives no next cursor; an invalid cursor is 400', async () => {
    const call = await makeCall(fx, { associate: fx.a1 });
    const a1 = await as(fx.a1);
    await a1.post(`/calls/${call.id}/messages`, { body: 'one' });
    await a1.post(`/calls/${call.id}/messages`, { body: 'two' });
    const res = await a1.get(`/calls/${call.id}/messages`, { limit: 2 });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.nextCursor).toBeNull();
    expectError(await a1.get(`/calls/${call.id}/messages`, { cursor: 'bm9wZQ' }), 400);
  });
});

describe('database constraints', () => {
  const insert = (over: Partial<Record<'project' | 'duration' | 'status' | 'expert' | 'income', string | number | null>> = {}) =>
    prisma.$executeRaw`
      INSERT INTO calls (id, status, platform_id, profile_id, associate_id, expert_id, scheduled_at, duration_minutes,
                         project_details, platform_associate_name, real_income, created_by, updated_at)
      VALUES (gen_random_uuid(), ${over.status ?? 'on_scheduling'}::"CallStatus", ${fx.platform.id}::uuid, ${fx.approvedProfile.id}::uuid,
              ${fx.a1.id}::uuid, ${over.expert === undefined ? fx.e1.id : over.expert}::uuid, '2027-02-01T09:00:00Z', ${over.duration ?? 30},
              ${over.project ?? 'Details'}, 'Pat', ${over.income ?? null}::numeric, ${fx.a1.id}::uuid, now())`;

  it('a valid raw insert works and the trigger sets ends_at', async () => {
    expect(await insert()).toBe(1);
    const row = await prisma.call.findFirstOrThrow();
    expect(row.endsAt.toISOString()).toBe('2027-02-01T09:30:00.000Z');
  });

  it.each(['', '   ', '\n\t'])('blank project_details %j violates calls_project_details_present', async (project) => {
    await expect(insert({ project })).rejects.toThrow(/calls_project_details_present/);
  });

  it('a duration outside 15/30/45/60 is rejected', async () => {
    await expect(insert({ duration: 20 })).rejects.toThrow(/calls_duration_allowed/);
  });

  it('a scheduled call without an expert is rejected', async () => {
    await expect(insert({ status: 'scheduled', expert: null })).rejects.toThrow(/calls_expert_required_when_scheduled/);
  });

  it('a paid call needs a real income, and it cannot be negative', async () => {
    await expect(insert({ status: 'process_to_bank' })).rejects.toThrow(/calls_paid_has_real_income/);
    await expect(insert({ income: -1 })).rejects.toThrow(/calls_real_income_nonnegative/);
    expect(await insert({ status: 'process_to_bank', income: 500 })).toBe(1);
  });

  it('the exclusion constraint rejects overlapping blocking calls', async () => {
    await insert({ status: 'scheduled' });
    await expect(insert({ status: 'scheduled' })).rejects.toThrow(/calls_expert_no_overlap/);
    // …but not an on_scheduling one.
    expect(await insert({ status: 'on_scheduling' })).toBe(1);
  });

  it('ends_at cannot be forged', async () => {
    const call = await makeCall(fx, { associate: fx.a1, scheduledAt: '2027-02-01T09:00:00Z', durationMinutes: 15 });
    await prisma.call.update({ where: { id: call.id }, data: { endsAt: new Date('2030-01-01T00:00:00Z') } });
    const row = await prisma.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(row.endsAt.toISOString()).toBe('2027-02-01T09:15:00.000Z');
  });

  it('a rejected profile needs a reason', async () => {
    await expect(
      prisma.profile.create({ data: { name: 'X', avatarId: 'profile-05', status: 'rejected', createdById: fx.a1.id } }),
    ).rejects.toThrow(Prisma.PrismaClientUnknownRequestError);
  });
});

describe('GPT link', () => {
  it('the founder sets it; only the founder and the expert can read it', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled' });
    const f = await as(fx.founder);
    const link = 'https://chatgpt.com/share/abc123';
    const saved = await f.patch(`/calls/${call.id}`, { gptLink: link });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.gptLink).toBe(link);

    expect((await (await as(fx.e1)).get(`/calls/${call.id}`)).body.gptLink).toBe(link);
    for (const who of ['a1', 'm1'] as const) {
      const res = await (await as(fx[who])).get(`/calls/${call.id}`);
      expect(res.body.gptLink, who).toBeNull();
      expect(res.body.permissions.editGptLink).toBe(false);
      expect(res.text).not.toContain('chatgpt.com');
    }
    // Nobody but the founder may write it, and it must be a link.
    expectError(await (await as(fx.a1)).patch(`/calls/${call.id}`, { gptLink: 'https://x.test' }), 403);
    expectError(await (await as(fx.e1)).patch(`/calls/${call.id}`, { gptLink: 'https://x.test' }), 403);
    expectError(await f.patch(`/calls/${call.id}`, { gptLink: 'not a link' }), 400);
    expect((await f.patch(`/calls/${call.id}`, { gptLink: null })).body.gptLink).toBeNull();
  });

  it('the expert is notified when the link is added, but not about money-only edits', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'finished' });
    const f = await as(fx.founder);
    await f.patch(`/calls/${call.id}`, { gptLink: 'https://chatgpt.com/share/xyz' });
    expect(await prisma.notification.count({ where: { userId: fx.e1.id, type: 'call.updated' } })).toBe(1);
    await f.patch(`/calls/${call.id}`, { rateOverride: 1500 });
    expect(await prisma.notification.count({ where: { userId: fx.e1.id } })).toBe(1);
  });
});

describe('call rate', () => {
  it('shows the platform rate, takes a special rate for one call, and hides both from the expert', async () => {
    const f = await as(fx.founder);
    await f.put(`/profiles/${fx.approvedProfile.id}/platforms/${fx.platform.id}`, { status: 'registered', rate: 1100 });
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled' });

    const a1 = await as(fx.a1);
    let res = await a1.get(`/calls/${call.id}`);
    expect(res.body).toMatchObject({ platformRate: 1100, rateOverride: null, permissions: { editRate: true } });

    // The associate sets a special rate for this project only.
    res = await a1.patch(`/calls/${call.id}`, { rateOverride: 1750.25 });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ platformRate: 1100, rateOverride: 1750.25 });
    expect((await a1.patch(`/calls/${call.id}`, { rateOverride: null })).body.rateOverride).toBeNull();
    expectError(await a1.patch(`/calls/${call.id}`, { rateOverride: -5 }), 400);

    // The manager may too; the Expert sees nothing and cannot write it.
    expect((await (await as(fx.m1)).patch(`/calls/${call.id}`, { rateOverride: 1200 })).status).toBe(200);
    const expertView = await (await as(fx.e1)).get(`/calls/${call.id}`);
    expect(expertView.body).toMatchObject({ platformRate: null, rateOverride: null, permissions: { editRate: false } });
    expect(expertView.text).not.toMatch(/1100|1200/);
    expectError(await (await as(fx.e1)).patch(`/calls/${call.id}`, { rateOverride: 1 }), 403);
  });
});

describe('DELETE /calls/:id', () => {
  it('the founder deletes a call with its history, messages and notifications', async () => {
    const founder = await as(fx.founder);
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'process_to_bank', realIncome: 500 });
    await prisma.callStatusHistory.create({ data: { callId: call.id, fromStatus: 'invoice_approve', toStatus: 'process_to_bank', actorId: fx.founder.id } });
    await prisma.message.create({ data: { callId: call.id, senderId: fx.a1.id, body: 'Wrapped up' } });
    await prisma.notification.create({ data: { userId: fx.a1.id, type: 'call.status_changed', payload: { callId: call.id, summary: 'Paid' } } });
    const other = await prisma.notification.create({ data: { userId: fx.a1.id, type: 'todo.assigned', payload: { todoId: 'x' } } });

    expectError(await (await as(fx.m1)).delete(`/calls/${call.id}`), 403);
    expectError(await (await as(fx.a1)).delete(`/calls/${call.id}`), 403);
    expect((await founder.delete(`/calls/${call.id}`)).status).toBe(204);

    expect(await prisma.call.count({ where: { id: call.id } })).toBe(0);
    expect(await prisma.callStatusHistory.count({ where: { callId: call.id } })).toBe(0);
    expect(await prisma.message.count({ where: { callId: call.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: fx.a1.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { id: other.id } })).toBe(1);
    expectError(await founder.get(`/calls/${call.id}`), 404);
    // Its money no longer counts anywhere.
    expect((await founder.get('/stats/profiles')).body.find((r: { profile: { id: string } }) => r.profile.id === fx.approvedProfile.id).totalIncome).toBe(0);
  });
});
