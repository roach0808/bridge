import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** A call that went all the way to invoicing, with its history and an amount. */
async function invoicedCall() {
  const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'invoice_approve', scheduledAt: '2027-02-01T09:00:00Z' });
  await prisma.call.update({ where: { id: call.id }, data: { invoiceAmount: 450, invoiceCurrency: 'USD' } });
  const at = (h: number) => new Date(Date.UTC(2027, 1, 1, h));
  await prisma.callStatusHistory.createMany({
    data: [
      { callId: call.id, fromStatus: 'confirmed', toStatus: 'finished', actorId: fx.e1.id, createdAt: at(10) },
      { callId: call.id, fromStatus: 'finished', toStatus: 'invoice_submit', actorId: fx.founder.id, createdAt: at(11) },
      { callId: call.id, fromStatus: 'invoice_submit', toStatus: 'invoice_approve', actorId: fx.founder.id, createdAt: at(12) },
    ],
  });
  return call;
}

describe('experts do not see invoicing', () => {
  it('an invoiced call looks finished to the expert, with no amount and no invoicing history', async () => {
    const call = await invoicedCall();
    const e1 = await as(fx.e1);
    const detail = (await e1.get(`/calls/${call.id}`)).body;
    expect(detail).toMatchObject({ status: 'finished', invoiceAmount: null, invoiceCurrency: null, allowedTransitions: [] });
    expect(detail.history.map((h: { toStatus: string }) => h.toStatus)).not.toContain('invoice_submit');
    expect(detail.history.map((h: { toStatus: string }) => h.toStatus)).not.toContain('invoice_approve');
    expect((await e1.get(`/calls/${call.id}/history`)).body.every((h: { toStatus: string }) => !h.toStatus.startsWith('invoice'))).toBe(true);
    expect(JSON.stringify(detail)).not.toMatch(/invoice_(submit|approve)|process_to_bank|450/);

    // Everyone else still sees the real status and amount.
    const a1 = (await (await as(fx.a1)).get(`/calls/${call.id}`)).body;
    expect(a1).toMatchObject({ status: 'invoice_approve', invoiceAmount: '450.00' });
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

  it('experts are not notified about invoicing steps or invoice edits', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'finished' });
    const founder = await as(fx.founder);
    expect((await founder.post(`/calls/${call.id}/transition`, { to: 'invoice_submit' })).status).toBe(200);
    expect((await founder.patch(`/calls/${call.id}`, { invoiceAmount: 300, invoiceCurrency: 'EUR' })).status).toBe(200);
    expect(await prisma.notification.count({ where: { userId: fx.e1.id } })).toBe(0);
    // The associate still hears about both.
    expect(await prisma.notification.count({ where: { userId: fx.a1.id } })).toBe(2);
  });
});
