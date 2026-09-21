import type { CallDTO, CallStatus, FinanceCallsPage } from '@god/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, clientsFor, expectError, makeCall, prisma, seedFixtures, type Client, type Fixtures } from './helpers';

let fx: Fixtures;
let c: Record<'founder' | 'm1' | 'm2' | 'a1' | 'a2' | 'e1' | 'e2', Client>;

beforeEach(async () => {
  fx = await seedFixtures();
  // An Expert paid 200/h, Associates with 10% (a1) and 4% (a2) of real income, and a rate on the Profile.
  await prisma.user.update({ where: { id: fx.e1.id }, data: { hourlyRate: 200 } });
  await prisma.user.update({ where: { id: fx.a1.id }, data: { sharePercent: 10 } });
  await prisma.user.update({ where: { id: fx.a2.id }, data: { sharePercent: 4 } });
  await prisma.profilePlatformStatus.create({
    data: { profileId: fx.approvedProfile.id, platformId: fx.platform.id, status: 'registered', rate: 1000 },
  });
  c = await clientsFor(fx, ['founder', 'm1', 'm2', 'a1', 'a2', 'e1', 'e2']);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const move = (client: Client, id: string, to: CallStatus, extra: Record<string, unknown> = {}) =>
  client.post(`/calls/${id}/transition`, { to, ...extra });

/** Each fixture call gets its own day, so the Expert is never double-booked. */
let day = 0;
const nextSlot = () => new Date(Date.UTC(2027, 1, 1 + day++, 9)).toISOString();

/** A confirmed call finished by the Expert after `minutes`. */
async function finishedCall(associate = fx.a1, minutes = 30) {
  const call = await makeCall(fx, { associate, expert: fx.e1, status: 'confirmed', scheduledAt: nextSlot() });
  const res = await move(c.e1, call.id, 'finished', { actualDurationMinutes: minutes });
  expect(res.status, res.text).toBe(200);
  return call;
}

/** Finished, invoiced and paid to bank with `income`. */
async function bankedCall(associate = fx.a1, income = 1000) {
  const call = await finishedCall(associate);
  for (const to of ['invoice_submit', 'invoice_approve'] as const) expect((await move(c.founder, call.id, to)).status).toBe(200);
  const res = await move(c.founder, call.id, 'process_to_bank', { realIncome: income });
  expect(res.status, res.text).toBe(200);
  return call;
}

const view = async (client: Client, id: string) => {
  const res = await client.get(`/calls/${id}`);
  expect(res.status, res.text).toBe(200);
  return res.body as CallDTO;
};

describe('the Expert is paid at the rate they had when the call finished', () => {
  it('fixes the rate on the call, so a later change only affects calls to come', async () => {
    const call = await finishedCall(fx.a1, 30);
    expect((await prisma.call.findUniqueOrThrow({ where: { id: call.id } })).expertRate?.toNumber()).toBe(200);

    // The Founder raises the rate afterwards.
    const res = await c.founder.patch(`/users/${fx.e1.id}`, { hourlyRate: 300 });
    expect(res.status, res.text).toBe(200);
    expect(res.body.hourlyRate).toBe(300);

    const seen = await view(c.e1, call.id);
    expect(seen.payouts.expert).toMatchObject({ rate: 200, minutes: 30, amount: 100, paidAt: null });
    // The Expert sees their own pay, and still no income.
    expect(seen.expectedPrice).toBeNull();
    expect(seen.payouts.manager).toBeNull();
    expect(seen.payouts.associate).toBeNull();

    const next = await finishedCall(fx.a1, 60);
    expect((await view(c.founder, next.id)).payouts.expert).toMatchObject({ rate: 300, amount: 300 });
  });

  it('a call that finished without a rate can take one: per call, or the Expert’s new rate for all of them', async () => {
    await prisma.user.update({ where: { id: fx.e1.id }, data: { hourlyRate: null } });
    const a = await finishedCall(fx.a1, 30);
    const b = await finishedCall(fx.a1, 60);
    expect((await view(c.founder, a.id)).payouts.expert).toMatchObject({ rate: null, amount: null });
    expect((await view(c.founder, a.id)).payouts.canMark).not.toContain('expert');

    const set = await c.founder.patch(`/calls/${a.id}`, { expertRate: 120 });
    expect(set.status, set.text).toBe(200);
    expect(set.body.payouts.expert).toMatchObject({ rate: 120, amount: 60 });

    const all = await c.founder.patch(`/users/${fx.e1.id}`, { hourlyRate: 150, applyRateToUnpricedCalls: true });
    expect(all.status, all.text).toBe(200);
    // Only the call without a rate took the new one.
    expect((await view(c.founder, a.id)).payouts.expert?.rate).toBe(120);
    expect((await view(c.founder, b.id)).payouts.expert).toMatchObject({ rate: 150, amount: 150 });
  });

  it('only the Founder sets pay, and only for the right roles', async () => {
    expectError(await c.m1.patch(`/users/${fx.a1.id}`, { sharePercent: 50 }), 403);
    expectError(await c.founder.patch(`/users/${fx.a1.id}`, { hourlyRate: 100 }), 400);
    expectError(await c.founder.patch(`/users/${fx.e1.id}`, { sharePercent: 10 }), 400);
    expectError(await c.founder.patch(`/users/${fx.a1.id}`, { sharePercent: 101 }), 400);
    const call = await finishedCall();
    expectError(await c.m1.patch(`/calls/${call.id}`, { expertRate: 10 }), 403);

    // A new Associate starts with 10%; a Manager never sees rates or shares.
    const created = await c.founder.post('/users', {
      nickname: 'NewAssoc', role: 'associate', email: 'new.assoc@fixtures.test', password: 'Correct-Horse-Battery-1', managerId: fx.m1.id,
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body.sharePercent).toBe(10);
    const listed = (await c.m1.get('/users')).body as Array<{ id: string; sharePercent: number | null; hourlyRate: number | null }>;
    expect(listed.every((u) => u.sharePercent === null && u.hourlyRate === null)).toBe(true);
    // Everyone sees their own.
    expect((await c.e1.get('/me')).body.hourlyRate).toBe(200);
    expect((await c.a1.get('/me')).body.sharePercent).toBe(10);
  });
});

describe('shares are settled when the call is paid to bank', () => {
  it('15% to the Manager, of which the Associate’s 10% is passed on', async () => {
    const call = await bankedCall(fx.a1, 1000);
    const row = await prisma.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(row.managerSharePercent?.toNumber()).toBe(15);
    expect(row.associateSharePercent?.toNumber()).toBe(10);
    expect(row.payeeManagerId).toBe(fx.m1.id);

    const founder = (await view(c.founder, call.id)).payouts;
    expect(founder.manager).toMatchObject({ user: { id: fx.m1.id }, percent: 15, amount: 150, keeps: 50, paidAt: null });
    expect(founder.associate).toMatchObject({ user: { id: fx.a1.id }, percent: 10, amount: 100, paidAt: null });
    expect(founder.expert).toMatchObject({ amount: 100 });
    expect(founder.canMark.sort()).toEqual(['associate', 'expert', 'manager']);

    const manager = (await view(c.m1, call.id)).payouts;
    expect(manager.manager).toMatchObject({ amount: 150, keeps: 50 });
    expect(manager.associate).toMatchObject({ amount: 100 });
    expect(manager.expert).toBeNull();
    expect(manager.canMark).toEqual(['associate']);

    const associate = (await view(c.a1, call.id)).payouts;
    expect(associate.associate).toMatchObject({ amount: 100 });
    expect(associate.manager).toBeNull();
    expect(associate.expert).toBeNull();
    expect(associate.canMark).toEqual([]);

    // Another Manager oversees the call but is not paid for it.
    const other = (await view(c.m2, call.id)).payouts;
    expect(other).toMatchObject({ expert: null, manager: null, associate: null, canMark: [] });
  });

  it('uses the Profile’s Manager share, and later changes leave paid calls alone', async () => {
    const set = await c.founder.patch(`/profiles/${fx.approvedProfile.id}`, { managerSharePercent: 20 });
    expect(set.status, set.text).toBe(200);
    expect(set.body.managerSharePercent).toBe(20);
    const call = await bankedCall(fx.a2, 500);
    await c.founder.patch(`/profiles/${fx.approvedProfile.id}`, { managerSharePercent: 5 });
    await c.founder.patch(`/users/${fx.a2.id}`, { sharePercent: 1 });
    expect((await view(c.founder, call.id)).payouts).toMatchObject({
      manager: { percent: 20, amount: 100, keeps: 80 },
      associate: { percent: 4, amount: 20 },
    });
    // Only the Founder sets the Profile's share.
    const tried = await c.m1.patch(`/profiles/${fx.approvedProfile.id}`, { managerSharePercent: 50 });
    expect(tried.status).toBe(403);
  });

  it('a Manager running the call themselves keeps the whole share', async () => {
    const call = await bankedCall(fx.m1, 1000);
    const p = (await view(c.m1, call.id)).payouts;
    expect(p.manager).toMatchObject({ user: { id: fx.m1.id }, amount: 150, keeps: 150 });
    expect(p.associate).toBeNull();
  });

  it('the Associate’s part never exceeds the Manager’s share', async () => {
    await prisma.user.update({ where: { id: fx.a1.id }, data: { sharePercent: 40 } });
    const call = await bankedCall(fx.a1, 1000);
    expect((await view(c.founder, call.id)).payouts).toMatchObject({ manager: { amount: 150, keeps: 0 }, associate: { percent: 15, amount: 150 } });
  });

  it('the call can no longer be handed to another Associate', async () => {
    const call = await bankedCall();
    expect((await view(c.founder, call.id)).permissions.reassignAssociate).toBe(false);
    expectError(await c.founder.patch(`/calls/${call.id}`, { associateId: fx.a2.id }), 403);
  });
});

describe('marking people paid', () => {
  it('the Founder pays the Expert and the Manager; the Manager pays the Associate; each is told', async () => {
    const call = await bankedCall();
    let res = await c.founder.post('/finance/payouts', { payee: 'expert', callIds: [call.id] });
    expect(res.status, res.text).toBe(200);
    expect(res.body.updated).toBe(1);
    res = await c.founder.post('/finance/payouts', { payee: 'manager', callIds: [call.id] });
    expect(res.body.updated).toBe(1);
    // Marking twice changes nothing.
    expect((await c.founder.post('/finance/payouts', { payee: 'manager', callIds: [call.id] })).body.updated).toBe(0);

    expectError(await c.m1.post('/finance/payouts', { payee: 'manager', callIds: [call.id] }), 403);
    expectError(await c.a1.post('/finance/payouts', { payee: 'associate', callIds: [call.id] }), 403);
    expectError(await c.m2.post('/finance/payouts', { payee: 'associate', callIds: [call.id] }), 409, 'payout_unavailable');
    res = await c.m1.post('/finance/payouts', { payee: 'associate', callIds: [call.id] });
    expect(res.status, res.text).toBe(200);

    const seen = (await view(c.a1, call.id)).payouts;
    expect(seen.associate?.paidAt).toBeTruthy();
    const told = await prisma.notification.findMany({ where: { type: 'call.paid' }, select: { userId: true } });
    expect(told.map((n) => n.userId).sort()).toEqual([fx.m1.id, fx.a1.id, fx.e1.id].sort());

    // Undo a payment that did not happen.
    res = await c.founder.post('/finance/payouts', { payee: 'expert', callIds: [call.id], paid: false });
    expect(res.body.updated).toBe(1);
    expect((await view(c.e1, call.id)).payouts.expert?.paidAt).toBeNull();
  });

  it('shares cannot be paid before the bank has paid, and the Expert not without a rate', async () => {
    const call = await finishedCall();
    expectError(await c.founder.post('/finance/payouts', { payee: 'manager', callIds: [call.id] }), 409, 'payout_unavailable');
    const running = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'confirmed', scheduledAt: nextSlot() });
    expectError(await c.founder.post('/finance/payouts', { payee: 'expert', callIds: [call.id, running.id] }), 409);
    // All or nothing: the finished call was not marked either.
    expect((await prisma.call.findUniqueOrThrow({ where: { id: call.id } })).expertPaidAt).toBeNull();
    expectError(await c.founder.post('/finance/payouts', { payee: 'expert', callIds: ['00000000-0000-4000-8000-000000000000'] }), 404);
  });

  it('paid amounts are protected: the real income and the Expert’s rate wait for an unmark', async () => {
    const call = await bankedCall();
    await c.founder.post('/finance/payouts', { payee: 'manager', callIds: [call.id] });
    expectError(await c.founder.patch(`/calls/${call.id}`, { realIncome: 900 }), 409);
    await c.founder.post('/finance/payouts', { payee: 'manager', callIds: [call.id], paid: false });
    expect((await c.founder.patch(`/calls/${call.id}`, { realIncome: 900 })).status).toBe(200);

    await c.founder.post('/finance/payouts', { payee: 'expert', callIds: [call.id] });
    expect((await view(c.founder, call.id)).permissions.editExpertRate).toBe(false);
    expectError(await c.founder.patch(`/calls/${call.id}`, { expertRate: 10 }), 409);
  });
});

describe('the Finance tab', () => {
  it('lists each person’s own calls that took place, with their totals', async () => {
    const paid = await bankedCall(fx.a1, 1000); // e1: 100, m1: 150 (a1: 100)
    await bankedCall(fx.a3, 2000); // m2's team: e1: 100, m2: 300
    const finished = await finishedCall(fx.a2, 60); // not paid to bank yet: e1: 200
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'confirmed', scheduledAt: nextSlot() });
    await c.founder.post('/finance/payouts', { payee: 'expert', callIds: [paid.id] });

    const get = async (client: Client, query: Record<string, unknown> = {}) => {
      const res = await client.get('/finance/calls', query);
      expect(res.status, res.text).toBe(200);
      return res.body as FinanceCallsPage;
    };

    const founder = await get(c.founder);
    expect(founder.total).toBe(3);
    expect(founder.summary.expert).toMatchObject({ paid: 100, unpaid: 300, unpriced: 0, minutes: 120 });
    expect(founder.summary.manager).toEqual({ paid: 0, unpaid: 450 });
    expect(founder.summary.income).toMatchObject({ real: 3000, expected: 1000 });

    const m1 = await get(c.m1);
    // Their paid call and their team's finished one; not the other team's.
    expect(m1.items.map((i) => i.id).sort()).toEqual([paid.id, finished.id].sort());
    expect(m1.summary).toMatchObject({ manager: { paid: 0, unpaid: 150 }, associate: { paid: 0, unpaid: 100 }, keeps: 50, expert: null });

    const a1 = await get(c.a1);
    expect(a1.items.map((i) => i.id)).toEqual([paid.id]);
    expect(a1.summary).toMatchObject({ associate: { unpaid: 100 }, manager: null, expert: null });

    const e1 = await get(c.e1);
    expect(e1.total).toBe(3);
    expect(e1.summary).toMatchObject({ income: null, expert: { paid: 100, unpaid: 300 } });
    // The Expert still sees invoiced calls as finished.
    expect(e1.items.every((i) => i.status === 'finished')).toBe(true);
    expect((await get(c.e1, { paid: 'paid' })).items.map((i) => i.id)).toEqual([paid.id]);
    expect((await get(c.e1, { paid: 'unpaid' })).total).toBe(2);
    // Filters narrow the rows but not the totals.
    expect((await get(c.e1, { paid: 'paid' })).summary.expert?.unpaid).toBe(300);

    expect((await get(c.e2)).total).toBe(0);
  });
});

describe('profiles are looked after by an Associate', () => {
  it('a submission is looked after by whoever submitted it', async () => {
    const res = await c.a1.post('/profiles', { name: 'Robin Handled', avatarId: 'profile-04' });
    expect(res.status, res.text).toBe(201);
    expect(res.body.associate).toMatchObject({ id: fx.a1.id });
    expect(res.body.canAssign).toBe(false);
  });

  it('the Founder hands a Profile to anyone; a Manager only within their team', async () => {
    const path = `/profiles/${fx.approvedProfile.id}/associate`;
    let res = await c.founder.put(path, { associateId: fx.a1.id });
    expect(res.status, res.text).toBe(200);
    expect(res.body.associate.id).toBe(fx.a1.id);

    // m1's team: move it between a1, a2 and m1 themselves.
    res = await c.m1.put(path, { associateId: fx.a2.id });
    expect(res.status, res.text).toBe(200);
    res = await c.m1.put(path, { associateId: fx.m1.id });
    expect(res.status, res.text).toBe(200);
    expectError(await c.m1.put(path, { associateId: fx.a3.id }), 403);
    expectError(await c.m1.put(path, { associateId: null }), 403);
    expectError(await c.m1.put(path, { associateId: fx.e1.id }), 400);

    // Not m2's to move, and never an Associate's.
    expect((await c.m2.get(`/profiles/${fx.approvedProfile.id}`)).body.canAssign).toBe(false);
    expectError(await c.m2.put(path, { associateId: fx.a3.id }), 403);
    expectError(await c.a1.put(path, { associateId: fx.a1.id }), 403);

    res = await c.founder.put(path, { associateId: null });
    expect(res.body.associate).toBeNull();
    // Experts never see who looks after it.
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, scheduledAt: nextSlot() });
    await c.founder.put(path, { associateId: fx.a1.id });
    expect((await c.e1.get(`/profiles/${fx.approvedProfile.id}`)).body).toMatchObject({ associate: null, managerSharePercent: null });
  });
});

describe('tasks can be handed to someone else', () => {
  it('the giver moves an open task onto another person’s panel', async () => {
    const created = await c.founder.post('/todos', { assigneeId: fx.founder.id, title: 'Chase the invoice' });
    expect(created.status, created.text).toBe(201);
    const id = created.body.id as string;

    let res = await c.founder.post(`/todos/${id}/move`, { assigneeId: fx.a1.id });
    expect(res.status, res.text).toBe(200);
    expect(res.body.assignee.id).toBe(fx.a1.id);
    expect(await prisma.notification.count({ where: { userId: fx.a1.id, type: 'todo.assigned' } })).toBe(1);

    // Only the giver hands it on, only to people they may give tasks to, only while open.
    expectError(await c.a1.post(`/todos/${id}/move`, { assigneeId: fx.a1.id }), 403);
    const mine = (await c.m1.post('/todos', { assigneeId: fx.a1.id, title: 'Tidy the notes' })).body.id as string;
    expectError(await c.m1.post(`/todos/${mine}/move`, { assigneeId: fx.e1.id }), 403);
    await c.a1.post(`/todos/${id}/done`, {});
    expectError(await c.founder.post(`/todos/${id}/move`, { assigneeId: fx.a2.id }), 409);
  });
});
