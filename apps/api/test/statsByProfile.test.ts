import { DateTime } from 'luxon';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const NY = 'America/New_York';
/** Noon in New York on the Wednesday `weeksAgo` weeks back (plus `hour` hours): safely inside that week. */
const inWeek = (weeksAgo: number, hour = 12) => DateTime.fromISO(MONDAY, { zone: NY }).plus({ days: 2, hours: hour }).minus({ weeks: weeksAgo }).toUTC().toISO()!;
/** A fixed week, so the test never straddles a month or a year. */
const MONDAY = '2026-10-12';

async function delivered(opts: Parameters<typeof makeCall>[1], minutes: number) {
  const call = await makeCall(fx, opts);
  await prisma.call.update({ where: { id: call.id }, data: { actualDurationMinutes: minutes } });
  return call;
}

describe('GET /stats/by-profile', () => {
  beforeEach(async () => {
    // $600/h on the first team's Profile; the second team's Profile has no rate yet.
    await prisma.profilePlatformStatus.create({ data: { profileId: fx.approvedProfile.id, platformId: fx.platform.id, status: 'registered', rate: 600 } });
    await prisma.user.update({ where: { id: fx.a1.id }, data: { sharePercent: 50 } });
    // This week: two calls with the first team's Profile, one with the second team's.
    await delivered({ associate: fx.a1, expert: fx.e1, status: 'finished', scheduledAt: inWeek(0) }, 60);
    await delivered({ associate: fx.a2, expert: fx.e2, status: 'invoice_submit', scheduledAt: inWeek(0) }, 30);
    await delivered({ associate: fx.a3, expert: fx.e3, status: 'finished', scheduledAt: inWeek(0) }, 45);
    // Last week: one call.
    await delivered({ associate: fx.a1, expert: fx.e1, status: 'process_to_bank', scheduledAt: inWeek(1) }, 60);
    // Not delivered, or not a consultation: none of these count.
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', scheduledAt: inWeek(0, 3) });
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'cancelled', scheduledAt: inWeek(0, 5) });
    await delivered({ associate: fx.a1, expert: fx.e1, status: 'finished', kind: 'network', scheduledAt: inWeek(0, -3) }, 30);
    // The Expert's rate is copied onto a call when it finishes; these were inserted as finished.
    await prisma.call.updateMany({ where: { expertId: fx.e1.id, kind: 'consultation' }, data: { expertRate: 120 } });
  });

  const get = async (who: Parameters<typeof as>[0], query: Record<string, string>) => (await (await as(who)).get('/stats/by-profile', query)).body;

  it('the Founder sees every Profile at the invoice amount, for the week asked, against the week before', async () => {
    const body = await get(fx.founder, { period: 'week', date: '2026-10-15' });
    expect(body).toMatchObject({ zone: NY, period: 'week', start: '2026-10-12', end: '2026-10-19', money: 'invoice' });
    expect(body.rows).toEqual([
      { profile: { id: fx.approvedProfile.id, name: fx.approvedProfile.name }, calls: 2, minutes: 90, money: 900, unpriced: 0 },
      { profile: { id: fx.approvedProfileTeam2.id, name: fx.approvedProfileTeam2.name }, calls: 1, minutes: 45, money: 0, unpriced: 1 },
    ]);
    expect(body.total).toEqual({ calls: 3, minutes: 135, money: 900, unpriced: 1 });
    expect(body.previous).toEqual({ calls: 1, minutes: 60, money: 600, unpriced: 0 });
  });

  it('a day and a month work the same way', async () => {
    const day = await get(fx.founder, { period: 'day', date: '2026-10-14' });
    expect(day).toMatchObject({ start: '2026-10-14', end: '2026-10-15', total: { calls: 3 } });
    expect(day.previous.calls).toBe(0);
    const month = await get(fx.founder, { period: 'month', date: '2026-10-01' });
    expect(month).toMatchObject({ start: '2026-10-01', end: '2026-11-01', total: { calls: 4 } });
    expect(await get(fx.founder, { period: 'week', date: '2026-09-01' })).toMatchObject({ rows: [], total: { calls: 0 } });
  });

  it('a Manager sees their team, an Associate their own calls and part, an Expert their calls and pay', async () => {
    const m1 = await get(fx.m1, { period: 'week', date: '2026-10-15' });
    expect(m1.money).toBe('invoice');
    expect(m1.rows.map((r: { profile: { id: string } }) => r.profile.id)).toEqual([fx.approvedProfile.id]);

    const a1 = await get(fx.a1, { period: 'week', date: '2026-10-15' });
    // Only a1's own call; their part is half of the 15% Manager share: 600 × 7.5% = 45.
    expect(a1).toMatchObject({ money: 'part', total: { calls: 1, money: 45 } });

    const e1 = await get(fx.e1, { period: 'week', date: '2026-10-15' });
    expect(e1).toMatchObject({ money: 'pay', zone: 'Asia/Seoul' });
    // 60 minutes at $120/h.
    expect(e1.total).toMatchObject({ calls: 1, money: 120 });
  });
});

describe('GET /stats/trend', () => {
  it('gives each period in a row, quiet ones as zeros, ending with the one asked for, in the viewer’s scope', async () => {
    await prisma.profilePlatformStatus.create({ data: { profileId: fx.approvedProfile.id, platformId: fx.platform.id, status: 'registered', rate: 600 } });
    await delivered({ associate: fx.a1, expert: fx.e1, status: 'finished', scheduledAt: inWeek(0) }, 60);
    await delivered({ associate: fx.a3, expert: fx.e3, status: 'finished', scheduledAt: inWeek(0) }, 45);
    await delivered({ associate: fx.a1, expert: fx.e1, status: 'process_to_bank', scheduledAt: inWeek(2) }, 30);
    await delivered({ associate: fx.a1, expert: fx.e1, status: 'finished', kind: 'network', scheduledAt: inWeek(1) }, 30);

    const founder = (await (await as(fx.founder)).get('/stats/trend', { period: 'week', date: '2026-10-15' })).body;
    expect(founder).toMatchObject({ zone: 'America/New_York', period: 'week', money: 'invoice' });
    expect(founder.points).toHaveLength(12);
    expect(founder.points.at(-1)).toEqual({ start: '2026-10-12', calls: 2, minutes: 105, money: 600, unpriced: 1 });
    expect(founder.points.at(-2)).toEqual({ start: '2026-10-05', calls: 0, minutes: 0, money: 0, unpriced: 0 });
    expect(founder.points.at(-3)).toMatchObject({ start: '2026-09-28', calls: 1, money: 300 });

    const days = (await (await as(fx.founder)).get('/stats/trend', { period: 'day', date: '2026-10-14' })).body;
    expect(days.points).toHaveLength(30);
    expect(days.points.at(-1)).toMatchObject({ start: '2026-10-14', calls: 2 });
    const months = (await (await as(fx.founder)).get('/stats/trend', { period: 'month', date: '2026-10-01', count: 3 })).body;
    expect(months.points.map((p: { start: string; calls: number }) => [p.start, p.calls])).toEqual([['2026-08-01', 0], ['2026-09-01', 1], ['2026-10-01', 2]]);

    // The second team's Manager sees only their team's call.
    const m2 = (await (await as(fx.m2)).get('/stats/trend', { period: 'week', date: '2026-10-15' })).body;
    expect(m2.points.reduce((t: number, p: { calls: number }) => t + p.calls, 0)).toBe(1);
  });
});
