import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, expectError, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** A call that went all the way to the bank: 60 minutes at 450/h, of which 437.25 arrived. */
async function invoicedCall() {
  const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'invoice_approve', scheduledAt: '2027-02-01T09:00:00Z' });
  await prisma.profilePlatformStatus.create({ data: { profileId: fx.approvedProfile.id, platformId: fx.platform.id, status: 'registered', rate: 450 } });
  await prisma.call.update({ where: { id: call.id }, data: { actualDurationMinutes: 60, status: 'process_to_bank', realIncome: 437.25, managerSharePercent: 15, associateSharePercent: 10, payeeManagerId: fx.m1.id } });
  const at = (h: number) => new Date(Date.UTC(2027, 1, 1, h));
  await prisma.callStatusHistory.createMany({
    data: [
      { callId: call.id, fromStatus: 'confirmed', toStatus: 'finished', actorId: fx.e1.id, createdAt: at(10) },
      { callId: call.id, fromStatus: 'finished', toStatus: 'invoice_submit', actorId: fx.founder.id, createdAt: at(11) },
      { callId: call.id, fromStatus: 'invoice_submit', toStatus: 'invoice_approve', actorId: fx.founder.id, createdAt: at(12) },
      { callId: call.id, fromStatus: 'invoice_approve', toStatus: 'process_to_bank', actorId: fx.founder.id, createdAt: at(13) },
    ],
  });
  return call;
}

describe('experts do not see invoicing', () => {
  it('an invoiced call looks finished to the expert, with no amount and no invoicing history', async () => {
    const call = await invoicedCall();
    const e1 = await as(fx.e1);
    const detail = (await e1.get(`/calls/${call.id}`)).body;
    expect(detail).toMatchObject({ status: 'finished', expectedPrice: null, realIncome: null, allowedTransitions: [] });
    expect(detail.history.map((h: { toStatus: string }) => h.toStatus)).not.toContain('invoice_submit');
    expect(detail.history.map((h: { toStatus: string }) => h.toStatus)).not.toContain('invoice_approve');
    expect((await e1.get(`/calls/${call.id}/history`)).body.every((h: { toStatus: string }) => !h.toStatus.startsWith('invoice'))).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/invoice_(submit|approve)|process_to_bank|"(expectedPrice|realIncome)":\d|437\.25/);

    // The founder and managers still see the real status and both payment figures; the Associate the status only.
    const m1 = (await (await as(fx.m1)).get(`/calls/${call.id}`)).body;
    expect(m1).toMatchObject({ status: 'process_to_bank', expectedPrice: 450, realIncome: 437.25 });
    const a1 = (await (await as(fx.a1)).get(`/calls/${call.id}`)).body;
    expect(a1).toMatchObject({ status: 'process_to_bank', expectedPrice: null, realIncome: null });
  });

  it('list, filters, calendar and dashboard counts', async () => {
    const call = await invoicedCall();
    const e1 = await as(fx.e1);
    expect((await e1.get('/calls')).body.items[0]).toMatchObject({ id: call.id, status: 'finished' });
    expect((await e1.get('/calls', { status: 'finished' })).body.total).toBe(1);
    expect((await e1.get('/calls', { status: 'invoice_approve' })).body.total).toBe(0);

    const cal = (await e1.get('/calendar', { from: '2027-01-31T00:00:00Z', to: '2027-02-03T00:00:00Z' })).body;
    expect(cal.calls.map((c: { status: string }) => c.status)).toEqual(['finished']);

    const dash = (await e1.get('/dashboard')).body;
    expect(dash.byStatus).toMatchObject({ finished: 1, invoice_submit: 0, invoice_approve: 0, process_to_bank: 0 });
  });

  it('experts are not notified about invoicing steps or income corrections', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'invoice_approve' });
    const founder = await as(fx.founder);
    expect((await founder.post(`/calls/${call.id}/transition`, { to: 'process_to_bank', realIncome: 910 })).status).toBe(200);
    expect((await founder.patch(`/calls/${call.id}`, { realIncome: 905.5 })).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: fx.e1.id } })).toBe(0);
    // The associate still hears about both.
    expect(await prisma.notification.count({ where: { userId: fx.a1.id } })).toBe(2);
  });

  it('nothing about money reaches an expert: no invoice figures, rates or bank data', async () => {
    const call = await invoicedCall();
    await (await as(fx.founder)).put(`/profiles/${fx.approvedProfile.id}/platforms/${fx.platform.id}`, { rate: 1500 });
    await prisma.profileBank.create({
      data: { profileId: fx.approvedProfile.id, bankName: 'Bank', accountHolder: 'Dana', accountNumber: 'GB00', isPrimary: true, createdById: fx.founder.id },
    });
    const e1 = await as(fx.e1);
    const responses = [
      await e1.get(`/calls/${call.id}`),
      await e1.get('/calls'),
      await e1.get('/dashboard'),
      await e1.get('/profiles'),
      await e1.get(`/profiles/${fx.approvedProfile.id}`),
      await e1.get('/calendar', { from: '2027-01-31T00:00:00Z', to: '2027-02-03T00:00:00Z' }),
    ];
    for (const res of responses) {
      expect(res.status, res.text).toBe(200);
      expect(res.text).not.toMatch(/"(rate|platformRate|rateOverride|expectedPrice|realIncome)":\d|"bankCount":\d|"needsBank":(true|false)|437\.25/);
    }
    const profile = responses[4]!.body;
    expect(profile).toMatchObject({ platformStatuses: null, bankCount: null, needsBank: null, addresses: null, email: null });
    expectError(await e1.get(`/profiles/${fx.approvedProfile.id}/banks`), 403);
  });
});
