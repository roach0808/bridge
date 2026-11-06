import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetPublicStats } from '../src/public/public.routes';
import { PASSWORD, anon, as, expectError, loginRaw, makeBank, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
  forgetPublicStats();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const setRate = (rate = 600) =>
  prisma.profilePlatformStatus.create({ data: { profileId: fx.approvedProfile.id, platformId: fx.platform.id, status: 'registered', rate } });

describe('ETA when the invoice is submitted', () => {
  it('the Founder can give the ETA with the bank, and it is kept on the call', async () => {
    await setRate();
    const bank = await makeBank(fx);
    const call = await makeCall(fx, { associate: fx.a1, status: 'finished' });
    await prisma.call.update({ where: { id: call.id }, data: { actualDurationMinutes: 60 } });
    const founder = await as(fx.founder);
    const res = await founder.post(`/calls/${call.id}/transition`, { to: 'invoice_submit', bankId: bank.id, paymentEta: '2027-03-15' });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ status: 'invoice_submit', paymentEta: '2027-03-15' });
  });

  it('is optional, and only goes with submitting the invoice', async () => {
    await setRate();
    const bank = await makeBank(fx);
    const call = await makeCall(fx, { associate: fx.a1, status: 'finished' });
    await prisma.call.update({ where: { id: call.id }, data: { actualDurationMinutes: 60 } });
    const founder = await as(fx.founder);
    expect((await founder.post(`/calls/${call.id}/transition`, { to: 'invoice_submit', bankId: bank.id })).body.paymentEta).toBeNull();
    expectError(await founder.post(`/calls/${call.id}/transition`, { to: 'invoice_approve', paymentEta: '2027-03-15' }), 400);
  });
});

describe('Founder resets a password', () => {
  it('the new password works, the old one no longer does, and every device is signed out', async () => {
    const first = await loginRaw(fx.a1.email);
    expect(first.status).toBe(200);
    const founder = await as(fx.founder);
    const res = await founder.post(`/users/${fx.a1.id}/password`, { password: 'A-brand-new-pass-77' });
    expect(res.status, res.text).toBe(204);
    expect((await loginRaw(fx.a1.email, PASSWORD)).status).toBe(401);
    expect((await loginRaw(fx.a1.email, 'A-brand-new-pass-77')).status).toBe(200);
    // The session from before the reset is over.
    const refreshed = await anon.post('/auth/refresh', { refreshToken: first.body.refreshToken });
    expect(refreshed.status).toBe(401);
  });

  it('only the Founder, never for themselves, and the password is not in the audit trail', async () => {
    expectError(await (await as(fx.m1)).post(`/users/${fx.a1.id}/password`, { password: 'A-brand-new-pass-77' }), 403);
    const founder = await as(fx.founder);
    expectError(await founder.post(`/users/${fx.founder.id}/password`, { password: 'A-brand-new-pass-77' }), 400);
    expectError(await founder.post(`/users/${fx.a1.id}/password`, { password: 'short' }), 400);
    expect((await founder.post(`/users/${fx.e1.id}/password`, { password: 'A-brand-new-pass-77' })).status).toBe(204);
    // The trail is written after the response.
    await new Promise((r) => setTimeout(r, 300));
    const rows = await prisma.auditLog.findMany({ where: { action: 'user.password' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: fx.e1.id, summary: 'reset someone’s password' });
    expect(JSON.stringify(rows)).not.toContain('A-brand-new-pass-77');
  });
});

describe('Expertise field', () => {
  it('is saved with the Profile, kept when an edit leaves it out, and searchable', async () => {
    const founder = await as(fx.founder);
    const created = await founder.post('/profiles', { name: 'Sam Niche', briefExperience: '', avatarId: 'profile-07', expertise: 'Semiconductor supply chain' });
    expect(created.status, created.text).toBe(201);
    expect(created.body.expertise).toBe('Semiconductor supply chain');
    const kept = await founder.patch(`/profiles/${created.body.id}`, { name: 'Sam Niche', briefExperience: 'Changed', avatarId: 'profile-07' });
    expect(kept.body.expertise).toBe('Semiconductor supply chain');
    const found = await founder.get('/profiles', { q: 'semiconductor' });
    expect(found.body.map((p: { id: string }) => p.id)).toContain(created.body.id);
  });

  it('everyone who sees the Profile sees it, the Expert on their call included', async () => {
    await prisma.profile.update({ where: { id: fx.approvedProfile.id }, data: { expertise: 'Industrial pumps' } });
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled' });
    expect((await (await as(fx.e1)).get(`/calls/${call.id}`)).body.profile.expertise).toBe('Industrial pumps');
    expect((await (await as(fx.a1)).get(`/profiles/${fx.approvedProfile.id}`)).body.expertise).toBe('Industrial pumps');
    // An Associate of the team may edit it.
    const a1 = await as(fx.a1);
    const edited = await a1.patch(`/profiles/${fx.approvedProfile.id}`, { name: 'Dana Approved', briefExperience: '', avatarId: 'profile-01', expertise: 'Pumps and valves' });
    expect(edited.status, edited.text).toBe(200);
    expect(edited.body.expertise).toBe('Pumps and valves');
  });
});

describe('Network associate calls', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    kind: 'network',
    platformId: fx.platform.id,
    profileId: fx.approvedProfile.id,
    expertId: fx.e1.id,
    scheduledAt: '2027-03-01T15:00:00Z',
    durationMinutes: 30,
    projectDetails: 'Screening call for the pumps project',
    platformAssociateName: 'Riley at GLG',
    ...over,
  });

  it('are booked by the Founder only; calls default to consultations', async () => {
    const res = await (await as(fx.founder)).post('/calls', body({ associateId: fx.a1.id }));
    expect(res.status, res.text).toBe(201);
    expect(res.body.kind).toBe('network');
    for (const who of [fx.m1, fx.a1, fx.e1]) expectError(await (await as(who)).post('/calls', body()), 403);
    const plain = await (await as(fx.a1)).post('/calls', body({ kind: undefined, scheduledAt: '2027-03-02T15:00:00Z' }));
    expect(plain.body.kind).toBe('consultation');
  });

  it('are scheduled by the Founder only: the team sees them but cannot move, edit or cancel them', async () => {
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'on_scheduling', kind: 'network' });
    for (const who of [fx.a1, fx.a2, fx.m1]) {
      const c = await as(who);
      const seen = await c.get(`/calls/${call.id}`);
      expect(seen.status, who.nickname).toBe(200);
      expect(seen.body.allowedTransitions, who.nickname).toEqual([]);
      expect(seen.body.permissions, who.nickname).toMatchObject({ edit: false, reassignExpert: false, reassignAssociate: false, editMeeting: false });
      expectError(await c.post(`/calls/${call.id}/transition`, { to: 'scheduled' }), 403);
      expectError(await c.post(`/calls/${call.id}/transition`, { to: 'cancelled' }), 403);
      expectError(await c.patch(`/calls/${call.id}`, { durationMinutes: 45 }), 403);
    }
    const founder = await as(fx.founder);
    expect((await founder.get(`/calls/${call.id}`)).body.allowedTransitions).toEqual(expect.arrayContaining(['scheduled', 'cancelled']));
    expect((await founder.post(`/calls/${call.id}/transition`, { to: 'scheduled' })).status).toBe(200);
    // The Expert still confirms it.
    expect((await (await as(fx.e1)).post(`/calls/${call.id}/transition`, { to: 'confirmed' })).status).toBe(200);
  });

  it('end at Finished: no invoicing, no price and no pay, even with rates set', async () => {
    await setRate();
    await prisma.user.update({ where: { id: fx.e1.id }, data: { hourlyRate: 200 } });
    await makeBank(fx);
    const call = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'confirmed', kind: 'network' });
    const founder = await as(fx.founder);
    const finished = await founder.post(`/calls/${call.id}/transition`, { to: 'finished', actualDurationMinutes: 30 });
    expect(finished.status, finished.text).toBe(200);
    expect(finished.body).toMatchObject({ status: 'finished', kind: 'network', expectedPrice: null, allowedTransitions: [] });
    expect(finished.body.payouts).toMatchObject({ expert: null, manager: null, associate: null, canMark: [] });
    expect((await prisma.call.findUniqueOrThrow({ where: { id: call.id } })).expertRate).toBeNull();
    expectError(await founder.post(`/calls/${call.id}/transition`, { to: 'invoice_submit' }), 403);
    expectError(await founder.patch(`/calls/${call.id}`, { rateOverride: 900 }), 403);
    expectError(await founder.post('/finance/payouts', { payee: 'expert', callIds: [call.id], paid: true }), 409);
  });

  it('only the Founder sees them in Finance, and they count in no totals or tasks', async () => {
    await setRate();
    const network = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'finished', kind: 'network' });
    const client = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'finished', scheduledAt: '2027-02-02T09:00:00Z' });
    await prisma.call.updateMany({ where: { id: { in: [network.id, client.id] } }, data: { actualDurationMinutes: 60 } });
    await prisma.profilePlatformStatus.deleteMany({});

    const ids = (res: { body: { items: Array<{ id: string }> } }) => res.body.items.map((c) => c.id);
    expect(ids(await (await as(fx.founder)).get('/finance/calls'))).toEqual(expect.arrayContaining([network.id, client.id]));
    // …including the table of what is still to pay, where nothing is ever paid on a network call.
    expect(ids(await (await as(fx.founder)).get('/finance/calls', { paid: 'unpaid' }))).toEqual(expect.arrayContaining([network.id, client.id]));
    for (const who of [fx.e1, fx.m1, fx.a1]) {
      const seen = ids(await (await as(who)).get('/finance/calls'));
      expect(seen, who.nickname).toContain(client.id);
      expect(seen, who.nickname).not.toContain(network.id);
    }

    const tasks = (await (await as(fx.founder)).get('/dashboard')).body.tasks;
    expect(tasks.invoicesToSubmit.map((c: { id: string }) => c.id)).toEqual([client.id]);
    // Only the consultation lacks a rate.
    expect(tasks.profilesNeedingRate).toEqual([expect.objectContaining({ finishedCalls: 1 })]);

    const stats = (await anon.get('/public/stats')).body;
    expect(stats.deliveredCalls).toBe(1);
    expect(stats.hoursDelivered).toBe(1);

    const profile = (await (await as(fx.m1)).get(`/profiles/${fx.approvedProfile.id}`)).body;
    const glg = profile.platformStatuses.find((s: { platform: { id: string } }) => s.platform.id === fx.platform.id);
    expect(glg.deliveredCalls).toBe(1);
  });

  it('show on the calendar marked as network calls', async () => {
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', kind: 'network' });
    const cal = (await (await as(fx.e1)).get('/calendar', { from: '2027-01-31T00:00:00Z', to: '2027-02-03T00:00:00Z' })).body;
    expect(cal.calls.map((c: { kind: string }) => c.kind)).toEqual(['network']);
  });
});
