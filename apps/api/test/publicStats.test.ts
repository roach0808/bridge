import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetPublicStats } from '../src/public/public.routes';
import { anon, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

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

  it('counts only calls that took place, and only the income that arrived', async () => {
    await makeCall(fx, { associate: fx.a1, status: 'finished', durationMinutes: 60 });
    await makeCall(fx, { associate: fx.a2, status: 'process_to_bank', realIncome: 2500, durationMinutes: 45, scheduledAt: '2027-02-02T09:00:00Z' });
    await makeCall(fx, { associate: fx.a3, status: 'invoice_submit', durationMinutes: 15, scheduledAt: '2027-02-03T09:00:00Z' });
    // Not delivered.
    await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: '2027-02-04T09:00:00Z' });
    await makeCall(fx, { associate: fx.a1, status: 'cancelled', scheduledAt: '2027-02-05T09:00:00Z' });
    const res = await anon.get('/public/stats');
    expect(res.body).toEqual({ deliveredCalls: 3, hoursDelivered: 2, incomeAtLeast: 2000 });
  });

  it('uses the real length of a call where one was reported', async () => {
    const call = await makeCall(fx, { associate: fx.a1, status: 'finished', durationMinutes: 60 });
    await prisma.call.update({ where: { id: call.id }, data: { actualDurationMinutes: 150 } });
    expect((await anon.get('/public/stats')).body.hoursDelivered).toBe(2);
  });

  it('keeps income rounded down, so one call’s income cannot be read from the total', async () => {
    await makeCall(fx, { associate: fx.a1, status: 'process_to_bank', realIncome: 999.99 });
    expect((await anon.get('/public/stats')).body.incomeAtLeast).toBe(0);
    forgetPublicStats();
    await makeCall(fx, { associate: fx.a2, status: 'process_to_bank', realIncome: 300, scheduledAt: '2027-02-02T09:00:00Z' });
    expect((await anon.get('/public/stats')).body.incomeAtLeast).toBe(1000);
  });

  it('changes only every so often, and says nothing about any one call or person', async () => {
    await makeCall(fx, { associate: fx.a1, status: 'finished', notes: 'private-note' });
    const first = await anon.get('/public/stats');
    expect(Object.keys(first.body).sort()).toEqual(['deliveredCalls', 'hoursDelivered', 'incomeAtLeast']);
    expect(first.text).not.toContain('private-note');
    expect(first.headers['cache-control']).toContain('max-age=600');
    await makeCall(fx, { associate: fx.a2, status: 'finished', scheduledAt: '2027-02-02T09:00:00Z' });
    expect((await anon.get('/public/stats')).body.deliveredCalls).toBe(1);
  });
});
