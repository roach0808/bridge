import { DateTime } from 'luxon';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { statsPeriods } from '../src/stats/stats.routes';
import { as, expectError, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

// Wednesday, Sept 16 2026, noon in New York.
const NOW = new Date('2026-09-16T16:00:00Z');

let fx: Fixtures;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  fx = await seedFixtures();
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function setRate(profileId: string, platformId: string, rate: number) {
  await prisma.profilePlatformStatus.upsert({
    where: { profileId_platformId: { profileId, platformId } },
    create: { profileId, platformId, status: 'registered', rate },
    update: { status: 'registered', rate },
  });
}

describe('statsPeriods', () => {
  const now = DateTime.fromISO('2026-09-16T12:00:00', { zone: 'America/New_York' });

  it('weeks start on Monday, oldest first, ending with the current week', () => {
    const periods = statsPeriods('week', 3, now);
    expect(periods.map((p) => [p.start.toISODate(), p.end.toISODate(), p.label])).toEqual([
      ['2026-08-31', '2026-09-07', 'Aug 31 – Sep 6'],
      ['2026-09-07', '2026-09-14', 'Sep 7 – 13'],
      ['2026-09-14', '2026-09-21', 'Sep 14 – 20'],
    ]);
  });

  it('bi-weekly periods line up on a fixed Monday; months are calendar months', () => {
    const [prev, cur] = statsPeriods('biweek', 2, now);
    expect([prev!.start.toISODate(), cur!.start.toISODate(), cur!.end.toISODate()]).toEqual(['2026-08-31', '2026-09-14', '2026-09-28']);
    expect(statsPeriods('month', 2, now).map((p) => p.label)).toEqual(['Aug 2026', 'Sep 2026']);
  });
});

describe('statistics by associate', () => {
  it('counts scheduled calls and potential money per period, booked duration before finishing', async () => {
    await setRate(fx.approvedProfile.id, fx.platform.id, 600);
    // This week: a booked 2-hour call and a finished call that really took 45 minutes.
    await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: '2026-09-17T14:00:00Z', durationMinutes: 45 });
    await makeCall(fx, { associate: fx.a1, status: 'finished', scheduledAt: '2026-09-15T14:00:00Z', durationMinutes: 60 });
    await prisma.call.updateMany({ where: { status: 'finished' }, data: { actualDurationMinutes: 45 } });
    // Last week, another team.
    await makeCall(fx, { associate: fx.a3, status: 'scheduled', scheduledAt: '2026-09-09T14:00:00Z' });
    // Before the range.
    await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: '2026-01-09T14:00:00Z' });

    const res = await (await as(fx.founder)).get('/stats/associates', { period: 'week', count: 2 });
    expect(res.status, res.text).toBe(200);
    expect(res.body.periods.map((p: { start: string }) => p.start)).toEqual(['2026-09-07', '2026-09-14']);
    const a1 = res.body.rows.find((r: { associate: { id: string } }) => r.associate.id === fx.a1.id);
    expect(a1.manager.id).toBe(fx.m1.id);
    expect(a1.periods[1]).toEqual({ calls: 2, finishedCalls: 1, potential: 900, unpriced: 0 });
    expect(a1.periods[0]).toEqual({ calls: 0, finishedCalls: 0, potential: 0, unpriced: 0 });
    expect(res.body.total).toEqual({ calls: 3, finishedCalls: 1, potential: 1500, unpriced: 0 });
    expect(res.body.rows).toHaveLength(4);
  });

  it('calls without a rate are counted as unpriced', async () => {
    await makeCall(fx, { associate: fx.a2, status: 'scheduled', scheduledAt: '2026-09-17T14:00:00Z' });
    const res = await (await as(fx.founder)).get('/stats/associates', { period: 'month', count: 1 });
    expect(res.body.total).toEqual({ calls: 1, finishedCalls: 0, potential: 0, unpriced: 1 });
  });

  it('founders see everyone, managers their team, associates themselves, experts nothing', async () => {
    const ids = async (user: typeof fx.a1) =>
      (await (await as(user)).get('/stats/associates')).body.rows.map((r: { associate: { id: string } }) => r.associate.id).sort();
    expect(await ids(fx.founder)).toEqual([fx.a1.id, fx.a2.id, fx.a3.id, fx.a4.id].sort());
    expect(await ids(fx.m1)).toEqual([fx.a1.id, fx.a2.id].sort());
    expect(await ids(fx.a3)).toEqual([fx.a3.id]);
    expectError(await (await as(fx.e1)).get('/stats/associates'), 403);
  });

  it('a manager’s totals leave out other teams’ calls', async () => {
    await setRate(fx.approvedProfile.id, fx.platform.id, 600);
    await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: '2026-09-17T14:00:00Z' });
    await makeCall(fx, { associate: fx.a3, status: 'scheduled', scheduledAt: '2026-09-17T16:00:00Z' });
    expect((await (await as(fx.m1)).get('/stats/associates')).body.total).toMatchObject({ calls: 1, potential: 600 });
  });

  it('a deactivated associate shows only while they have calls in the range', async () => {
    await prisma.user.update({ where: { id: fx.a4.id }, data: { isActive: false } });
    const founder = await as(fx.founder);
    const has = async () => (await founder.get('/stats/associates')).body.rows.some((r: { associate: { id: string } }) => r.associate.id === fx.a4.id);
    expect(await has()).toBe(false);
    await makeCall(fx, { associate: fx.a4, status: 'scheduled', scheduledAt: '2026-09-10T14:00:00Z' });
    expect(await has()).toBe(true);
  });
});

describe('statistics by profile', () => {
  it('lists every profile with onboarding, status, email, bank and total income; founder only', async () => {
    await setRate(fx.approvedProfile.id, fx.platform.id, 600);
    await prisma.profile.update({
      where: { id: fx.approvedProfile.id },
      data: { email: 'dana@example.org', onboardedAt: new Date('2026-03-02'), isActive: false },
    });
    await prisma.profileBank.createMany({
      data: [
        { profileId: fx.approvedProfile.id, bankName: 'Second Bank', accountHolder: 'Dana', accountNumber: '1', createdById: fx.founder.id },
        { profileId: fx.approvedProfile.id, bankName: 'Main Bank', accountHolder: 'Dana', accountNumber: '2', isPrimary: true, currency: 'USD', createdById: fx.founder.id },
      ],
    });
    const paid = await makeCall(fx, { associate: fx.a1, status: 'process_to_bank', scheduledAt: '2026-05-01T14:00:00Z', realIncome: 580.5 });
    const paid2 = await makeCall(fx, { associate: fx.a1, status: 'process_to_bank', scheduledAt: '2026-06-01T14:00:00Z', realIncome: 250 });
    await prisma.call.updateMany({ where: { id: { in: [paid.id, paid2.id] } }, data: { actualDurationMinutes: 60 } });
    await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: '2026-09-20T14:00:00Z' });

    const res = await (await as(fx.founder)).get('/stats/profiles');
    expect(res.status, res.text).toBe(200);
    expect(res.body.map((r: { profile: { name: string } }) => r.profile.name)).toEqual(['Dana Approved', 'Pat Pending', 'Quinn Pending']);
    expect(res.body[0]).toMatchObject({
      status: 'approved',
      isActive: false,
      onboardedAt: '2026-03-02',
      email: 'dana@example.org',
      bank: { bankName: 'Main Bank', currency: 'USD', count: 2 },
      calls: 3,
      paidCalls: 2,
      expectedIncome: 1200,
      totalIncome: 830.5,
      // The call on the 20th hasn't happened yet.
      lastCallAt: '2026-06-01T14:00:00.000Z',
    });
    expect(res.body[1]).toMatchObject({ status: 'pending', bank: null, calls: 0, totalIncome: 0, lastCallAt: null });

    expectError(await (await as(fx.m1)).get('/stats/profiles'), 403);
    expectError(await (await as(fx.a1)).get('/stats/profiles'), 403);
    expect(await prisma.auditLog.count({ where: { action: 'stats.profiles' } })).toBeGreaterThan(0);
  });
});

describe('financial statistics', () => {
  it('compares expected and real income per period, platform and profile; founder only', async () => {
    await setRate(fx.approvedProfile.id, fx.platform.id, 600);
    const paid = await makeCall(fx, { associate: fx.a1, status: 'process_to_bank', scheduledAt: '2026-09-15T14:00:00Z', realIncome: 570 });
    const approved = await makeCall(fx, { associate: fx.a1, status: 'invoice_approve', scheduledAt: '2026-09-08T14:00:00Z' });
    await prisma.call.update({ where: { id: paid.id }, data: { actualDurationMinutes: 60 } });
    await prisma.call.update({ where: { id: approved.id }, data: { actualDurationMinutes: 30 } });
    await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: '2026-09-17T14:00:00Z' });

    const res = await (await as(fx.founder)).get('/stats/finance', { period: 'week', count: 2 });
    expect(res.status, res.text).toBe(200);
    expect(res.body.byPeriod).toEqual([
      { calls: 1, finishedCalls: 1, paidCalls: 0, expected: 300, paidExpected: 0, real: 0, gap: 0, unpriced: 0 },
      { calls: 2, finishedCalls: 1, paidCalls: 1, expected: 600, paidExpected: 600, real: 570, gap: 30, unpriced: 0 },
    ]);
    expect(res.body.total).toMatchObject({ expected: 900, real: 570, gap: 30 });
    expect(res.body.byPlatform).toEqual([{ platform: fx.platform, cell: res.body.total }]);
    expect(res.body.byProfile[0]).toMatchObject({ profile: { id: fx.approvedProfile.id, isActive: true }, cell: { real: 570 } });

    expectError(await (await as(fx.m1)).get('/stats/finance'), 403);
  });
});
