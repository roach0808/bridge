import type { CallDTO, CallStatus, FinanceCallsPage } from '@god/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, clientsFor, expectError, makeCall, prisma, seedFixtures, type Client, type Fixtures } from './helpers';

let fx: Fixtures;
let c: Record<'founder' | 'm1' | 'm2' | 'a1' | 'a2' | 'e1' | 'e2', Client>;

beforeEach(async () => {
  fx = await seedFixtures();
  // An Expert paid 200/h; a1 gets half of their Manager's share, a2 a fifth; the Profile earns 1000/h.
  await prisma.user.update({ where: { id: fx.e1.id }, data: { hourlyRate: 200 } });
  await prisma.user.update({ where: { id: fx.a1.id }, data: { sharePercent: 50 } });
  await prisma.user.update({ where: { id: fx.a2.id }, data: { sharePercent: 20 } });
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

/** A call ready to run, finished by the Expert after `minutes`. */
async function finishedCall(associate = fx.a1, minutes = 30, expert = fx.e1) {
  const call = await makeCall(fx, { associate, expert, status: 'research_ready', scheduledAt: nextSlot() });
  const client = expert.id === fx.e1.id ? c.e1 : c.e2;
  const res = await move(client, call.id, 'finished', { actualDurationMinutes: minutes });
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

  it('the Founder sets Experts’ rates; the Founder or the Associate’s own Manager sets an Associate’s share', async () => {
    expectError(await c.m1.patch(`/users/${fx.e1.id}`, { hourlyRate: 100 }), 403);
    expectError(await c.founder.patch(`/users/${fx.a1.id}`, { hourlyRate: 100 }), 400);
    expectError(await c.founder.patch(`/users/${fx.e1.id}`, { sharePercent: 10 }), 400);
    expectError(await c.founder.patch(`/users/${fx.a1.id}`, { sharePercent: 101 }), 400);
    const call = await finishedCall();
    expectError(await c.m1.patch(`/calls/${call.id}`, { expertRate: 10 }), 403);

    // m1 sets their own Associate's share and sees it; m2 may not touch it.
    const set = await c.m1.patch(`/users/${fx.a1.id}`, { sharePercent: 60 });
    expect(set.status, set.text).toBe(200);
    expect(set.body.sharePercent).toBe(60);
    expect(((await c.m1.get('/users/me/team')).body as Array<{ id: string; sharePercent: number }>).find((u) => u.id === fx.a1.id)?.sharePercent).toBe(60);
    expectError(await c.m2.patch(`/users/${fx.a1.id}`, { sharePercent: 10 }), 403);
    // Another team's Associates keep their share to themselves.
    const listed = (await c.m2.get('/users')).body as Array<{ id: string; sharePercent: number | null; hourlyRate: number | null }>;
    expect(listed.find((u) => u.id === fx.a1.id)?.sharePercent).toBeNull();
    expect(listed.every((u) => u.hourlyRate === null)).toBe(true);

    // A Manager adds an Associate to their team directly, with a share; a new one starts at half.
    const created = await c.m1.post('/users', {
      nickname: 'NewAssoc', role: 'associate', email: 'new.assoc@fixtures.test', password: 'Correct-Horse-Battery-1', sharePercent: 30,
    });
    expect(created.status, created.text).toBe(201);
    expect(created.body).toMatchObject({ managerId: fx.m1.id, sharePercent: 30 });
    const plain = await c.founder.post('/users', {
      nickname: 'PlainAssoc', role: 'associate', email: 'plain.assoc@fixtures.test', password: 'Correct-Horse-Battery-1', managerId: fx.m2.id,
    });
    expect(plain.body.sharePercent).toBe(50);
    // Everyone sees their own.
    expect((await c.e1.get('/me')).body.hourlyRate).toBe(200);
    expect((await c.a1.get('/me')).body.sharePercent).toBe(60);
  });
});

describe('the Associate’s part is a portion of the Manager’s share', () => {
  it('shows what the shares should come to once the call took place, and settles them when the bank pays', async () => {
    // 30 min at 1000/h: $500 expected. Manager 15% = $75, of which a1 gets half = $37.50.
    const call = await finishedCall(fx.a1, 30);
    let founder = (await view(c.founder, call.id)).payouts;
    expect(founder.manager).toMatchObject({ user: { id: fx.m1.id }, percent: 15, expected: 75, amount: null, keeps: 37.5, settled: false });
    expect(founder.associate).toMatchObject({ user: { id: fx.a1.id }, percent: 50, expected: 37.5, amount: null });
    expect(founder.canMark).toEqual(['expert']);

    for (const to of ['invoice_submit', 'invoice_approve'] as const) await move(c.founder, call.id, to);
    await move(c.founder, call.id, 'process_to_bank', { realIncome: 1000 });
    const row = await prisma.call.findUniqueOrThrow({ where: { id: call.id } });
    expect([row.managerSharePercent?.toNumber(), row.associateSharePercent?.toNumber(), row.payeeManagerId]).toEqual([15, 50, fx.m1.id]);
    expect(row.bankedAt).toBeTruthy();

    // $1,000 arrived: the Manager's 15% is $150, half of it ($75) for a1.
    founder = (await view(c.founder, call.id)).payouts;
    expect(founder.manager).toMatchObject({ percent: 15, expected: 75, amount: 150, keeps: 75, settled: true });
    expect(founder.associate).toMatchObject({ percent: 50, expected: 37.5, amount: 75 });
    expect([...founder.canMark].sort()).toEqual(['associate', 'expert', 'manager']);

    const manager = (await view(c.m1, call.id)).payouts;
    expect(manager.manager).toMatchObject({ amount: 150, keeps: 75, percent: 15 });
    expect(manager.associate).toMatchObject({ amount: 75, percent: 50 });
    expect(manager.expert).toBeNull();
    expect(manager.canMark).toEqual(['associate']);

    // The Associate sees their Manager's share and their part of it, never the call's income or the Manager's percent.
    const associateView = await view(c.a1, call.id);
    expect(associateView).toMatchObject({ expectedPrice: null, realIncome: null, platformRate: null });
    expect(associateView.payouts.manager).toMatchObject({ amount: 150, expected: 75, percent: null });
    expect(associateView.payouts.associate).toMatchObject({ amount: 75, percent: 50 });
    expect(associateView.payouts.expert).toBeNull();
    expect(associateView.payouts.canMark).toEqual([]);

    // Another Manager oversees the call but is not paid for it.
    expect((await view(c.m2, call.id)).payouts).toMatchObject({ expert: null, manager: null, associate: null, canMark: [] });
  });

  it('uses the Profile’s Manager share, and later changes leave paid calls alone', async () => {
    const set = await c.founder.patch(`/profiles/${fx.approvedProfile.id}`, { managerSharePercent: 20 });
    expect(set.status, set.text).toBe(200);
    expect(set.body.managerSharePercent).toBe(20);
    const call = await bankedCall(fx.a2, 500);
    await c.founder.patch(`/profiles/${fx.approvedProfile.id}`, { managerSharePercent: 5 });
    await c.founder.patch(`/users/${fx.a2.id}`, { sharePercent: 1 });
    // $500 × 20% = $100 for the Manager, a fifth of it ($20) for a2.
    expect((await view(c.founder, call.id)).payouts).toMatchObject({
      manager: { percent: 20, amount: 100, keeps: 80 },
      associate: { percent: 20, amount: 20 },
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

  it('an Associate on 100% gets the whole Manager share', async () => {
    await prisma.user.update({ where: { id: fx.a1.id }, data: { sharePercent: 100 } });
    const call = await bankedCall(fx.a1, 1000);
    expect((await view(c.founder, call.id)).payouts).toMatchObject({ manager: { amount: 150, keeps: 0 }, associate: { percent: 100, amount: 150 } });
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

    // Undo a payment that did not happen (the month is still open).
    res = await c.founder.post('/finance/payouts', { payee: 'expert', callIds: [call.id], paid: false });
    expect(res.body.updated).toBe(1);
    expect((await view(c.e1, call.id)).payouts.expert?.paidAt).toBeNull();
  });

  it('shares cannot be paid before the bank has paid, and the Expert not before the call took place', async () => {
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
    const paid = await bankedCall(fx.a1, 1000); // e1: 100 · m1: 150, of which a1: 75
    await bankedCall(fx.a3, 2000); // m2's team: e1: 100 · m2: 300 (a3 has no share)
    const finished = await finishedCall(fx.a2, 60); // e1: 200 · expected: m1 150, of which a2 30
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
    expect(founder.summary.manager).toEqual({ paid: 0, unpaid: 450, expected: 150 });
    expect(founder.summary.associate).toEqual({ paid: 0, unpaid: 75, expected: 30 });
    expect(founder.summary.income).toMatchObject({ real: 3000, expected: 1000 });

    const m1 = await get(c.m1);
    // Their paid call and their team's finished one; not the other team's.
    expect(m1.items.map((i) => i.id).sort()).toEqual([paid.id, finished.id].sort());
    expect(m1.summary).toMatchObject({ manager: { paid: 0, unpaid: 150, expected: 150 }, associate: { paid: 0, unpaid: 75, expected: 30 }, keeps: 75, expert: null });

    // The Associate: their Manager's share and their part, never the income.
    const a1 = await get(c.a1);
    expect(a1.items.map((i) => i.id)).toEqual([paid.id]);
    expect(a1.summary).toMatchObject({ income: null, expert: null, manager: { unpaid: 150 }, associate: { unpaid: 75 } });
    expect(JSON.stringify(a1.items)).not.toMatch(/"(expectedPrice|realIncome)":\d/);

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

describe('monthly payment cycles', () => {
  it('closing the month pays everyone the Founder owes, keeps the record, and starts the next cycle from zero', async () => {
    const banked = await bankedCall(fx.a1, 1000); // e1: 100 · m1: 150 (a1: 75)
    await finishedCall(fx.a2, 60); // e1: 200; not paid to bank yet (expected $1,000)
    await prisma.user.update({ where: { id: fx.e2.id }, data: { hourlyRate: null } });
    await finishedCall(fx.a2, 30, fx.e2); // e2 has no rate: cannot be paid yet
    // The Expert of the paid call was paid during the month.
    await c.founder.post('/finance/payouts', { payee: 'expert', callIds: [banked.id] });

    let current = (await c.founder.get('/finance/cycle')).body;
    expect(current).toMatchObject({
      startedAt: null,
      income: 1000,
      paid: { experts: 100, managers: 0, associates: 0 },
      balance: 900,
      expectedPipeline: 1500,
      unpricedExpertCalls: 1,
    });
    expect(current.toPay.map((l: { user: { id: string }; kind: string; amount: number }) => [l.user.id, l.kind, l.amount])).toEqual([
      [fx.e1.id, 'expert', 200],
      [fx.m1.id, 'manager', 150],
    ]);
    expect(current.suggestedLabel).toMatch(/^[A-Z][a-z]+ \d{4}$/);

    // Only the Founder closes it, and sees the open cycle.
    expectError(await c.m1.get('/finance/cycle'), 403);
    expectError(await c.m1.post('/finance/cycles', { label: 'September 2026' }), 403);

    const closed = await c.founder.post('/finance/cycles', { label: 'September 2026' });
    expect(closed.status, closed.text).toBe(201);
    expect(closed.body).toMatchObject({
      label: 'September 2026',
      startedAt: null,
      totals: { income: 1000, paidExperts: 300, paidManagers: 150, paidAssociates: 0, balance: 550 },
    });
    expect(closed.body.lines.map((l: { user: { id: string }; amount: number; calls: number }) => [l.user.id, l.amount, l.calls])).toEqual([
      [fx.e1.id, 300, 2],
      [fx.m1.id, 150, 1],
    ]);
    // Everyone paid on the day hears about it, with the month.
    const told = await prisma.notification.findMany({ where: { type: 'call.paid' }, select: { userId: true, payload: true } });
    expect(told.filter((n) => JSON.stringify(n.payload).includes('September 2026')).map((n) => n.userId).sort()).toEqual([fx.e1.id, fx.m1.id].sort());

    // A new cycle: nothing in, nothing out, nothing owed (the unpriced call waits for its rate).
    current = (await c.founder.get('/finance/cycle')).body;
    expect(current).toMatchObject({ income: 0, paid: { experts: 0, managers: 0 }, balance: 0, toPay: [], unpricedExpertCalls: 1 });
    expect(current.startedAt).toBe(closed.body.closedAt);

    // A payment inside a closed month stays in it; closing twice in a row is refused.
    expectError(await c.founder.post('/finance/payouts', { payee: 'expert', callIds: [banked.id], paid: false }), 409, 'payout_closed');
    expectError(await c.founder.post('/finance/cycles', { label: 'Again' }), 409);

    // The Manager's payment to the Associate afterwards belongs to the new cycle.
    expect((await c.m1.post('/finance/payouts', { payee: 'associate', callIds: [banked.id] })).status).toBe(200);
    expect((await c.founder.get('/finance/cycle')).body.paid.associates).toBe(75);

    // The record: everything for the Founder; each person only their own line.
    const all = (await c.founder.get('/finance/cycles')).body;
    expect(all).toHaveLength(1);
    const mine = (await c.m1.get('/finance/cycles')).body;
    expect(mine).toEqual([expect.objectContaining({ label: 'September 2026', totals: null, lines: [expect.objectContaining({ kind: 'manager', amount: 150 })] })]);
    expect((await c.e1.get('/finance/cycles')).body[0].lines).toEqual([expect.objectContaining({ kind: 'expert', amount: 300 })]);
    expect((await c.a1.get('/finance/cycles')).body).toEqual([]);
  });
});

describe('the research step is the Founder’s, hidden from Associates and Managers', () => {
  it('needs the research data link, and reads as confirmed to the Associate and the Manager', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'confirmed', scheduledAt: nextSlot() });
    expectError(await move(c.founder, call.id, 'research_ready'), 400, 'validation_error');
    expectError(await move(c.a1, call.id, 'research_ready'), 403);
    const ready = await move(c.founder, call.id, 'research_ready', { researchLink: 'https://chatgpt.com/share/prep' });
    expect(ready.status, ready.text).toBe(200);
    expect(ready.body).toMatchObject({ status: 'research_ready', researchLink: 'https://chatgpt.com/share/prep' });

    // The Expert is told and sees the step; the Associate and the Manager see nothing changed.
    expect((await view(c.e1, call.id)).status).toBe('research_ready');
    expect(await prisma.notification.count({ where: { userId: fx.e1.id, type: 'call.status_changed' } })).toBe(1);
    for (const who of ['a1', 'm1'] as const) {
      const seen = (await c[who].get(`/calls/${call.id}`)).body;
      expect(seen.status, who).toBe('confirmed');
      expect(JSON.stringify(seen), who).not.toContain('research_ready');
      expect(seen.allowedTransitions.sort()).toEqual(['cancelled', 'on_rescheduling']);
      expect(await prisma.notification.count({ where: { userId: fx[who].id, type: 'call.status_changed' } }), who).toBe(0);
    }
    // Their filters and lists agree.
    expect((await c.a1.get('/calls', { status: 'confirmed' })).body.total).toBe(1);
    expect((await c.a1.get('/calls', { status: 'research_ready' })).body.total).toBe(0);

    // When the Expert starts, the Associate hears "Confirmed → Ongoing".
    await move(c.e1, call.id, 'ongoing', { ninjaLink: 'https://vdo.ninja/?room=r' });
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: fx.a1.id, type: 'call.status_changed' } });
    expect(note.payload).toMatchObject({ from: 'confirmed', to: 'ongoing' });
    const history = (await c.a1.get(`/calls/${call.id}/history`)).body as Array<{ fromStatus: string | null; toStatus: string }>;
    expect(history.at(-1)).toMatchObject({ fromStatus: 'confirmed', toStatus: 'ongoing' });
    expect(JSON.stringify(history)).not.toContain('research_ready');
  });

  it('moving a ready call sends it back for the Expert to confirm again', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'research_ready', scheduledAt: '2027-05-01T09:00:00Z' });
    const res = await c.a1.patch(`/calls/${call.id}`, { scheduledAt: '2027-05-01T11:00:00Z' });
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe('scheduled');
  });
});

describe('platform statuses', () => {
  it('the Founder, the Associate looking after the Profile and their Manager set them; only the Founder sets rates', async () => {
    await c.founder.put(`/profiles/${fx.approvedProfile.id}/associate`, { associateId: fx.a1.id });
    const url = `/profiles/${fx.approvedProfile.id}/platforms/${fx.platform2.id}`;

    expect((await c.a1.get(`/profiles/${fx.approvedProfile.id}`)).body.canEditPlatforms).toBe(true);
    let res = await c.a1.put(url, { status: 'registered' });
    expect(res.status, res.text).toBe(200);
    expect(res.body.platformStatuses[1]).toMatchObject({ status: 'registered', rate: null });
    expect((await c.m1.put(url, { status: 'banned' })).status).toBe(200);

    for (const who of ['a2', 'm2'] as const) {
      expect((await c[who].get(`/profiles/${fx.approvedProfile.id}`)).body.canEditPlatforms, who).toBe(false);
      expectError(await c[who].put(url, { status: 'registered' }), 403);
    }
    expectError(await c.a1.put(url, { rate: 900 }), 403);
    expectError(await c.m1.put(url, { rate: 900 }), 403);
    expectError(await c.e1.put(url, { status: 'registered' }), 403);
    res = await c.founder.put(url, { status: 'registered', rate: 900 });
    expect(res.body.platformStatuses[1]).toMatchObject({ status: 'registered', rate: 900 });
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
