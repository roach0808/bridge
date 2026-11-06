import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, expectError, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /dashboard/delivered', () => {
  it('gives an Expert their delivered consultations, day by day in their own zone', async () => {
    // e1 is in Seoul (UTC+9): 20:00 UTC on Feb 1 is already Feb 2 there.
    const late = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'finished', scheduledAt: '2027-02-01T20:00:00Z' });
    const morning = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'process_to_bank', scheduledAt: '2027-02-02T03:00:00Z' });
    const earlier = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'invoice_submit', scheduledAt: '2027-01-15T02:00:00Z', durationMinutes: 30 });
    await prisma.call.update({ where: { id: late.id }, data: { actualDurationMinutes: 50 } });
    await prisma.call.update({ where: { id: morning.id }, data: { actualDurationMinutes: 65 } });
    // Without a reported length, a call counts for what was booked.
    expect(earlier.durationMinutes).toBe(30);
    // Not delivered, not theirs, or not a consultation: none of these count.
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-03-01T09:00:00Z' });
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'cancelled', scheduledAt: '2027-02-03T09:00:00Z' });
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'finished', kind: 'network', scheduledAt: '2027-02-04T09:00:00Z' });
    await makeCall(fx, { associate: fx.a1, expert: fx.e2, status: 'finished', scheduledAt: '2027-02-05T09:00:00Z' });

    const res = await (await as(fx.e1)).get('/dashboard/delivered');
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({
      zone: 'Asia/Seoul',
      days: [
        { date: '2027-01-15', minutes: 30, calls: 1 },
        { date: '2027-02-02', minutes: 115, calls: 2 },
      ],
    });
  });

  it('is an Expert’s own chart: nobody else can read it', async () => {
    for (const who of [fx.founder, fx.m1, fx.a1]) expectError(await (await as(who)).get('/dashboard/delivered'), 403);
    expect((await (await as(fx.e2)).get('/dashboard/delivered')).body).toEqual({ zone: 'Europe/London', days: [] });
  });
});
