import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetPublicStats } from '../src/public/public.routes';
import { anon, as, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
  forgetPublicStats();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /public/stats', () => {
  it('needs no sign-in, and counts nothing before there is anything to count', async () => {
    const res = await anon.get('/public/stats');
    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ deliveredCalls: 0, hoursDelivered: 0, incomeAtLeast: 0 });
  });

  /** A call that took place, at a rate for how long it really ran: its invoice amount is rate × minutes / 60. */
  const delivered = async (opts: Parameters<typeof makeCall>[1], rate: number | null, minutes: number) => {
    const call = await makeCall(fx, opts);
    await prisma.call.update({ where: { id: call.id }, data: { rateOverride: rate, actualDurationMinutes: minutes } });
    return call;
  };

  it('counts only calls that took place, and their invoice amounts', async () => {
    await delivered({ associate: fx.a1, status: 'finished' }, 1000, 60); // $1,000
    await delivered({ associate: fx.a2, status: 'invoice_submit', scheduledAt: '2027-02-02T09:00:00Z' }, 1000, 30); // $500
    // The invoice amount counts, not what reached the bank.
    await delivered({ associate: fx.a3, status: 'process_to_bank', realIncome: 10, scheduledAt: '2027-02-03T09:00:00Z' }, 1000, 90); // $1,500
    // Not delivered.
    await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: '2027-02-04T09:00:00Z' });
    await delivered({ associate: fx.a1, status: 'cancelled', scheduledAt: '2027-02-05T09:00:00Z' }, 1000, 600);
    const res = await anon.get('/public/stats');
    expect(res.body).toEqual({ deliveredCalls: 3, hoursDelivered: 3, incomeAtLeast: 3000 });
  });

  it('uses the Profile’s rate on the platform where the call has no special one, and agrees with the Finance table', async () => {
    await prisma.profilePlatformStatus.create({ data: { profileId: fx.approvedProfile.id, platformId: fx.platform.id, status: 'registered', rate: 2000 } });
    await delivered({ associate: fx.a1, status: 'finished' }, null, 60); // $2,000
    await delivered({ associate: fx.a2, status: 'finished', scheduledAt: '2027-02-02T09:00:00Z' }, 3000, 60); // $3,000 at its special rate
    expect((await anon.get('/public/stats')).body.incomeAtLeast).toBe(5000);
    const finance = await (await as(fx.founder)).get('/finance/calls', { page: 1, pageSize: 100 });
    const total = finance.body.items.reduce((t: number, c: { expectedPrice: number | null }) => t + (c.expectedPrice ?? 0), 0);
    expect(total).toBe(5000);
  });

  it('a call with no rate has no invoice amount yet, but is still a call delivered', async () => {
    await delivered({ associate: fx.a1, status: 'finished' }, null, 60);
    expect((await anon.get('/public/stats')).body).toEqual({ deliveredCalls: 1, hoursDelivered: 1, incomeAtLeast: 0 });
  });

  it('uses the real length of a call where one was reported', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'finished', durationMinutes: 60 });
    await prisma.call.update({ where: { id: call.id }, data: { actualDurationMinutes: 150 } });
    expect((await anon.get('/public/stats')).body.hoursDelivered).toBe(2);
  });

  it('keeps income rounded down, so one call’s income cannot be read from the total', async () => {
    await delivered({ associate: fx.a1, status: 'finished' }, 999.99, 60);
    expect((await anon.get('/public/stats')).body.incomeAtLeast).toBe(0);
    forgetPublicStats();
    await delivered({ associate: fx.a2, status: 'finished', scheduledAt: '2027-02-02T09:00:00Z' }, 300, 60);
    expect((await anon.get('/public/stats')).body.incomeAtLeast).toBe(1000);
  });

  it('changes only every so often, and says nothing about any one call or person', async () => {
    await makeCall(fx, { associate: fx.a1, status: 'finished', notes: 'private-note' });
    const first = await anon.get('/public/stats');
    expect(Object.keys(first.body).sort()).toEqual(['deliveredCalls', 'hoursDelivered', 'incomeAtLeast']);
    expect(first.text).not.toContain('private-note');
    expect(first.headers['cache-control']).toContain('max-age=60');
    await makeCall(fx, { associate: fx.a2, status: 'finished', scheduledAt: '2027-02-02T09:00:00Z' });
    expect((await anon.get('/public/stats')).body.deliveredCalls).toBe(1);
  });
});
