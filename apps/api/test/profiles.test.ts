import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, expectError, makeBank, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const profileBody = (over: Record<string, unknown> = {}) => ({
  name: 'Morgan Expertise',
  linkedinUrl: 'https://www.linkedin.com/in/morgan',
  briefExperience: '20 years in logistics',
  avatarId: 'profile-07',
  ...over,
});

describe('POST /profiles', () => {
  it('founder creates an approved profile', async () => {
    const res = await (await as(fx.founder)).post('/profiles', profileBody());
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Morgan Expertise',
      status: 'approved',
      createdBy: { id: fx.founder.id, role: 'founder' },
      reviewedBy: { id: fx.founder.id },
      rejectionReason: null,
    });
  });

  it('experts cannot create profiles', async () => {
    expectError(await (await as(fx.e1)).post('/profiles', profileBody()), 403, 'forbidden');
  });

  it('a manager submits a pending profile like an associate', async () => {
    const res = await (await as(fx.m1)).post('/profiles', profileBody());
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', createdBy: { id: fx.m1.id }, reviewedBy: null });
    expect(await prisma.notification.count({ where: { type: 'profile.submitted', userId: fx.founder.id } })).toBe(1);
    expect((await (await as(fx.m1)).get(`/profiles/${res.body.id}`)).status).toBe(200);
    expectError(await (await as(fx.m2)).get(`/profiles/${res.body.id}`), 404);
  });

  it('an associate submits a pending profile and every active founder is notified', async () => {
    const res = await (await as(fx.a2)).post('/profiles', profileBody());
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', createdBy: { id: fx.a2.id }, reviewedBy: null, reviewedAt: null });
    const notes = await prisma.notification.findMany({ where: { type: 'profile.submitted' } });
    expect(notes.map((n) => n.userId)).toEqual([fx.founder.id]);
    expect(notes[0]!.payload).toMatchObject({ profileId: res.body.id, actor: { nickname: 'AssocTwo', role: 'associate' } });

    // Visible to the author, their manager and the founder, not to other teams.
    expect((await (await as(fx.m1)).get(`/profiles/${res.body.id}`)).status).toBe(200);
    // The submitter's team handles it, so a teammate sees it too; another team does not.
    expect((await (await as(fx.a1)).get(`/profiles/${res.body.id}`)).status).toBe(200);
    expectError(await (await as(fx.a3)).get(`/profiles/${res.body.id}`), 404);
    expectError(await (await as(fx.m2)).get(`/profiles/${res.body.id}`), 404);

    // It cannot be used for a call until approved.
    const call = { platformId: fx.platform.id, profileId: res.body.id, expertId: fx.e1.id, scheduledAt: '2027-05-01T10:00:00Z', durationMinutes: 30, projectDetails: 'x', platformAssociateName: 'y' };
    expectError(await (await as(fx.a2)).post('/calls', call), 409, 'profile_not_approved');
    expect((await (await as(fx.founder)).post(`/profiles/${res.body.id}/approve`)).status).toBe(200);
    expect((await (await as(fx.a2)).post('/calls', call)).status).toBe(201);
  });

  it('an associate resubmitting after a rejection notifies the founders again', async () => {
    const f = await as(fx.founder);
    const a1 = await as(fx.a1);
    await f.post(`/profiles/${fx.pendingProfile.id}/reject`, { reason: 'Add the career history' });
    const res = await a1.patch(`/profiles/${fx.pendingProfile.id}`, { careerHistory: 'VP at X' });
    expect(res.body).toMatchObject({ status: 'pending', careerHistory: 'VP at X' });
    expect(await prisma.notification.count({ where: { type: 'profile.submitted', userId: fx.founder.id } })).toBe(1);

    // Once approved it stays approved, and keeping it current asks nobody again.
    await f.post(`/profiles/${fx.pendingProfile.id}/approve`);
    const changed = await a1.patch(`/profiles/${fx.pendingProfile.id}`, { name: 'Changed' });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body).toMatchObject({ name: 'Changed', status: 'approved' });
    expect(await prisma.notification.count({ where: { type: 'profile.submitted', userId: fx.founder.id } })).toBe(1);
  });

  it('experts cannot create or review profiles', async () => {
    const e1 = await as(fx.e1);
    expectError(await e1.post('/profiles', profileBody()), 403);
    expectError(await e1.post(`/profiles/${fx.pendingProfile.id}/approve`), 403);
    expectError(await e1.put(`/profiles/${fx.approvedProfile.id}/platforms/${fx.platform.id}`, { status: 'registered' }), 403);
  });

  it('stores the personal details', async () => {
    const res = await (await as(fx.founder)).post(
      '/profiles',
      profileBody({ dateOfBirth: '1975-06-01', gender: 'Female', nationality: 'Korean', location: 'Seoul', education: 'KAIST', careerHistory: 'A\nB' }),
    );
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ dateOfBirth: '1975-06-01', gender: 'Female', nationality: 'Korean', location: 'Seoul', education: 'KAIST', careerHistory: 'A\nB' });
    const f = await as(fx.founder);
    expectError(await f.post('/profiles', profileBody({ dateOfBirth: '2999-01-01' })), 400);
    expectError(await f.post('/profiles', profileBody({ dateOfBirth: '01/02/1970' })), 400);
    // A partial edit leaves the other details alone; blank clears.
    const patched = await f.patch(`/profiles/${res.body.id}`, { location: '' });
    expect(patched.body).toMatchObject({ location: null, nationality: 'Korean', dateOfBirth: '1975-06-01' });
  });

  it('validates the avatar set and the linkedin url', async () => {
    const f = await as(fx.founder);
    expectError(await f.post('/profiles', profileBody({ avatarId: 'expert-01' })), 400);
    expectError(await f.post('/profiles', profileBody({ linkedinUrl: 'not a url' })), 400);
    expect((await f.post('/profiles', profileBody({ linkedinUrl: '' }))).body.linkedinUrl).toBeNull();
  });
});

describe('GET /profiles visibility', () => {
  const names = (res: { body: Array<{ name: string }> }) => res.body.map((p) => p.name).sort();

  it('founder sees everything, every team’s', async () => {
    expect(names(await (await as(fx.founder)).get('/profiles'))).toEqual(['Dana Approved', 'Pat Pending', 'Quinn Pending', 'Rowan Approved']);
  });

  it('associate sees their own team’s profiles, approved or pending, and no other team’s', async () => {
    const a1 = await as(fx.a1);
    expect(names(await a1.get('/profiles'))).toEqual(['Dana Approved', 'Pat Pending']);
    expectError(await a1.get(`/profiles/${fx.pendingProfileTeam2.id}`), 404);
    expectError(await a1.get(`/profiles/${fx.approvedProfileTeam2.id}`), 404);
  });

  it('manager sees their own team’s profiles only, approved or pending', async () => {
    expect(names(await (await as(fx.m1)).get('/profiles'))).toEqual(['Dana Approved', 'Pat Pending']);
    expect(names(await (await as(fx.m2)).get('/profiles'))).toEqual(['Quinn Pending', 'Rowan Approved']);
  });

  it('a teammate sees a1’s pending profile; the other team does not', async () => {
    expect(names(await (await as(fx.a2)).get('/profiles'))).toEqual(['Dana Approved', 'Pat Pending']);
    expect(names(await (await as(fx.a3)).get('/profiles'))).toEqual(['Quinn Pending', 'Rowan Approved']);
    expectError(await (await as(fx.a3)).get(`/profiles/${fx.pendingProfile.id}`), 404);
  });

  it('filters by status', async () => {
    expect(names(await (await as(fx.founder)).get('/profiles', { status: 'pending' }))).toEqual(['Pat Pending', 'Quinn Pending']);
  });
});

describe('team isolation', () => {
  it('another team’s approved profile is absent from the list and 404 on every route', async () => {
    const id = fx.approvedProfileTeam2.id;
    await makeBank(fx, { profileId: id });
    for (const who of ['m1', 'a1'] as const) {
      const c = await as(fx[who]);
      const list = await c.get('/profiles');
      expect(list.status).toBe(200);
      expect(list.body.some((p: { id: string }) => p.id === id), who).toBe(false);
      expectError(await c.get(`/profiles/${id}`), 404);
      expectError(await c.patch(`/profiles/${id}`, { name: 'Hijacked', phone: '+1 555 0199' }), 404);
      expectError(await c.put(`/profiles/${id}/platforms/${fx.platform.id}`, { status: 'banned' }), 404);
      expectError(await c.get(`/profiles/${id}/banks`), 404);
    }
    const row = await prisma.profile.findUniqueOrThrow({ where: { id }, include: { platformStatuses: true } });
    expect(row).toMatchObject({ name: 'Rowan Approved', phone: null });
    expect(row.platformStatuses).toEqual([]);
    // Its own team still works with it.
    expect((await (await as(fx.a3)).get(`/profiles/${id}`)).status).toBe(200);
    expect((await (await as(fx.m2)).get(`/profiles/${id}/banks`)).body).toHaveLength(1);
  });

  it('a profile no team handles is the Founder’s alone', async () => {
    const orphan = await prisma.profile.create({
      data: { name: 'Nora Nobody', avatarId: 'profile-05', status: 'approved', managerId: null, createdById: fx.founder.id, reviewedById: fx.founder.id, reviewedAt: new Date() },
    });
    const founder = await as(fx.founder);
    expect((await founder.get('/profiles')).body.some((p: { id: string }) => p.id === orphan.id)).toBe(true);
    expect((await founder.get(`/profiles/${orphan.id}`)).status).toBe(200);
    for (const who of ['m1', 'm2', 'a1', 'a3', 'e1'] as const) {
      const c = await as(fx[who]);
      expect((await c.get('/profiles')).body.some((p: { id: string }) => p.id === orphan.id), who).toBe(false);
      expectError(await c.get(`/profiles/${orphan.id}`), 404);
    }
  });
});

describe('approve / reject', () => {
  it('founder approves a pending profile and the author is notified', async () => {
    const res = await (await as(fx.founder)).post(`/profiles/${fx.pendingProfile.id}/approve`);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved', reviewedBy: { id: fx.founder.id }, reviewedAt: expect.any(String) });
    const notes = await prisma.notification.findMany({ where: { userId: fx.a1.id } });
    expect(notes).toEqual([expect.objectContaining({ type: 'profile.approved', payload: expect.objectContaining({ profileId: fx.pendingProfile.id }) })]);
  });

  it('reject needs a reason', async () => {
    const f = await as(fx.founder);
    expectError(await f.post(`/profiles/${fx.pendingProfile.id}/reject`, {}), 400, 'validation_error');
    expectError(await f.post(`/profiles/${fx.pendingProfile.id}/reject`, { reason: '   ' }), 400, 'validation_error');
    const res = await f.post(`/profiles/${fx.pendingProfile.id}/reject`, { reason: 'Duplicate of Dana' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'rejected', rejectionReason: 'Duplicate of Dana' });
    expect(await prisma.notification.count({ where: { userId: fx.a1.id, type: 'profile.rejected' } })).toBe(1);
  });

  it('only pending profiles can be reviewed', async () => {
    const f = await as(fx.founder);
    expectError(await f.post(`/profiles/${fx.approvedProfile.id}/approve`), 409, 'conflict');
    expectError(await f.post(`/profiles/${fx.approvedProfile.id}/reject`, { reason: 'x' }), 409, 'conflict');
    await f.post(`/profiles/${fx.pendingProfile.id}/reject`, { reason: 'no' });
    expectError(await f.post(`/profiles/${fx.pendingProfile.id}/approve`), 409, 'conflict');
  });

  it.each(['m1', 'a1'] as const)('%s cannot review', async (who) => {
    const c = await as(fx[who]);
    expectError(await c.post(`/profiles/${fx.pendingProfile.id}/approve`), 403);
    expectError(await c.post(`/profiles/${fx.pendingProfile.id}/reject`, { reason: 'x' }), 403);
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: fx.pendingProfile.id } })).status).toBe('pending');
  });
});

describe('PATCH /profiles/:id', () => {
  it('anyone on the profile’s team but an Expert edits it, whoever wrote it; another team cannot', async () => {
    const path = `/profiles/${fx.approvedProfile.id}`;
    // An Associate of the team who did not write it, and the team's Manager.
    for (const [who, name] of [
      [await as(fx.a2), 'Dana Corrected'],
      [await as(fx.m1), 'Dana Corrected Again'],
    ] as const) {
      const res = await who.patch(path, { name, phone: '+1 555 0100' });
      expect(res.status, res.text).toBe(200);
      expect(res.body).toMatchObject({ name, status: 'approved' });
    }
    // The other team does not even see it.
    for (const who of ['m2', 'a3'] as const) {
      expectError(await (await as(fx[who])).patch(path, { name: 'Taken Over' }), 404);
    }
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: fx.approvedProfile.id } })).name).toBe('Dana Corrected Again');
    // The Expert on a call with the Profile reads it and no more.
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled' });
    expectError(await (await as(fx.e1)).patch(path, { name: 'Hacked' }), 403);
  });

  it('the details a Founder alone decides are ignored from anyone else', async () => {
    const res = await (await as(fx.a1)).patch(`/profiles/${fx.approvedProfile.id}`, {
      name: 'Dana Approved',
      onboardedAt: '2020-01-01',
      managerSharePercent: 90,
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.onboardedAt).not.toBe('2020-01-01');
    const row = await prisma.profile.findUniqueOrThrow({ where: { id: fx.approvedProfile.id } });
    expect(Number(row.managerSharePercent)).not.toBe(90);
  });

  it('an author’s edit sends a rejected profile back to pending', async () => {
    await prisma.profile.update({
      where: { id: fx.pendingProfile.id },
      data: { status: 'rejected', rejectionReason: 'Fix the name', reviewedById: fx.founder.id, reviewedAt: new Date() },
    });
    const res = await (await as(fx.a1)).patch(`/profiles/${fx.pendingProfile.id}`, { name: 'Pat Fixed' });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ name: 'Pat Fixed', status: 'pending', rejectionReason: null, reviewedBy: null });
  });

  it('founder edits keep the status', async () => {
    const res = await (await as(fx.founder)).patch(`/profiles/${fx.approvedProfile.id}`, { briefExperience: 'Updated' });
    expect(res.body).toMatchObject({ status: 'approved', briefExperience: 'Updated' });
  });
});

describe('experts and profiles', () => {
  it('an expert sees only the profiles of their calls, without platform statuses', async () => {
    await prisma.call.create({
      data: {
        platformId: fx.platform.id, profileId: fx.approvedProfile.id, associateId: fx.a1.id, expertId: fx.e1.id,
        scheduledAt: new Date('2027-02-01T09:00:00Z'), durationMinutes: 30, projectDetails: 'x', platformAssociateName: 'y', createdById: fx.a1.id,
      },
    });
    const e1 = await as(fx.e1);
    const list = await e1.get('/profiles');
    expect(list.status, list.text).toBe(200);
    expect(list.body.map((p: { name: string }) => p.name)).toEqual(['Dana Approved']);
    expect(list.body[0].platformStatuses).toBeNull();
    expect((await e1.get(`/profiles/${fx.approvedProfile.id}`)).body).toMatchObject({ name: 'Dana Approved', platformStatuses: null });
    expectError(await e1.get(`/profiles/${fx.pendingProfile.id}`), 404);
    expect((await (await as(fx.e2)).get('/profiles')).body).toEqual([]);
  });
});

describe('platform statuses', () => {
  it('every platform is listed, not registered and with no rate yet', async () => {
    const res = await (await as(fx.a1)).get(`/profiles/${fx.approvedProfile.id}`);
    expect(res.body.platformStatuses).toEqual([
      { platform: { id: fx.platform.id, name: 'GLG', priority: 1 }, status: 'not_registered', rate: null },
      { platform: { id: fx.platform2.id, name: 'AlphaSights', priority: 2 }, status: 'not_registered', rate: null },
    ]);
  });

  it('a profile can be marked registered before it has a rate; the rate stays editable', async () => {
    const f = await as(fx.founder);
    const url = `/profiles/${fx.approvedProfile.id}/platforms/${fx.platform.id}`;
    expect((await f.put(url, { status: 'registered' })).body.platformStatuses[0]).toMatchObject({ status: 'registered', rate: null });

    // The rate can be set and changed afterwards.
    expect((await f.put(url, { status: 'registered', rate: 1200 })).body.platformStatuses[0]).toMatchObject({ status: 'registered', rate: 1200 });
    expect((await f.put(url, { rate: 1350 })).body.platformStatuses[0]).toMatchObject({ status: 'registered', rate: 1350 });
    // Not registered needs no rate at all.
    expect((await f.put(`/profiles/${fx.approvedProfile.id}/platforms/${fx.platform2.id}`, { status: 'banned' })).body.platformStatuses[1]).toMatchObject({
      status: 'banned',
      rate: null,
    });
  });

  it('the founder sets a rate per platform without touching the status, and back', async () => {
    const f = await as(fx.founder);
    const url = (platformId: string) => `/profiles/${fx.approvedProfile.id}/platforms/${platformId}`;
    let res = await f.put(url(fx.platform.id), { rate: 1250.5 });
    expect(res.status, res.text).toBe(200);
    expect(res.body.platformStatuses).toEqual([
      expect.objectContaining({ status: 'not_registered', rate: 1250.5 }),
      expect.objectContaining({ status: 'not_registered', rate: null }),
    ]);
    res = await f.put(url(fx.platform.id), { status: 'registered' });
    expect(res.body.platformStatuses[0]).toMatchObject({ status: 'registered', rate: 1250.5 });
    res = await f.put(url(fx.platform2.id), { status: 'banned', rate: 0 });
    expect(res.body.platformStatuses[1]).toMatchObject({ status: 'banned', rate: 0 });
    // Managers see the rates, Associates never; only the founder changes them.
    expect((await (await as(fx.m1)).get(`/profiles/${fx.approvedProfile.id}`)).body.platformStatuses[0].rate).toBe(1250.5);
    expect((await (await as(fx.a1)).get(`/profiles/${fx.approvedProfile.id}`)).body.platformStatuses[0].rate).toBeNull();
    expectError(await (await as(fx.a1)).put(url(fx.platform.id), { rate: 1 }), 403);
    expect((await f.put(url(fx.platform.id), { rate: null })).body.platformStatuses[0]).toMatchObject({ status: 'registered', rate: null });

    for (const bad of [{}, { rate: -1 }, { rate: 'abc' }, { rate: 12.345 }, { rate: 2_000_000 }]) {
      expectError(await f.put(url(fx.platform.id), bad), 400);
    }
  });

  it('the founder sets statuses and rates; managers and associates set statuses only', async () => {
    const url = `/profiles/${fx.approvedProfile.id}/platforms/${fx.platform2.id}`;
    const f = await as(fx.founder);
    const res = await f.put(url, { status: 'banned' });
    expect(res.status, res.text).toBe(200);
    expect(res.body.platformStatuses[1]).toMatchObject({ status: 'banned' });
    expect((await f.put(url, { status: 'registered', rate: 900 })).body.platformStatuses[1].status).toBe('registered');

    const m1 = await as(fx.m1);
    expect((await m1.get('/profiles')).body.find((p: { id: string }) => p.id === fx.approvedProfile.id).platformStatuses[1].status).toBe('registered');
    // The team handling the Profile sets its statuses, whoever on it.
    expect((await m1.put(url, { status: 'banned' })).status).toBe(200);
    const a2 = await as(fx.a2);
    expect((await a2.put(url, { status: 'not_registered' })).body.platformStatuses[1]).toMatchObject({ status: 'not_registered', rate: null });
    expectError(await a2.put(url, { rate: 100 }), 403);
    expectError(await (await as(fx.e1)).put(url, { status: 'banned' }), 403);
    // Another team cannot touch it.
    for (const who of ['m2', 'a3'] as const) {
      expectError(await (await as(fx[who])).put(url, { status: 'banned' }), 404);
    }
    expect((await prisma.profilePlatformStatus.findUniqueOrThrow({
      where: { profileId_platformId: { profileId: fx.approvedProfile.id, platformId: fx.platform2.id } },
    })).status).toBe('not_registered');
  });

  it('validates the status and the ids', async () => {
    const f = await as(fx.founder);
    expectError(await f.put(`/profiles/${fx.approvedProfile.id}/platforms/${fx.platform.id}`, { status: 'pending' }), 400);
    expectError(await f.put(`/profiles/${fx.approvedProfile.id}/platforms/00000000-0000-4000-8000-000000000000`, { status: 'registered', rate: 10 }), 404);
    expectError(await f.put(`/profiles/00000000-0000-4000-8000-000000000000/platforms/${fx.platform.id}`, { status: 'registered', rate: 10 }), 404);
  });
});

describe('addresses are founder-only', () => {
  it('only the founder can set and see them, as an ordered, labelled list', async () => {
    const f = await as(fx.founder);
    const created = await f.post(
      '/profiles',
      profileBody({ addresses: [{ label: 'Home', address: '12 Harbour Rd, Busan' }, { label: 'Mailing', address: 'PO Box 7, Seoul' }] }),
    );
    expect(created.status, created.text).toBe(201);
    expect(created.body.addresses).toEqual([
      { id: expect.any(String), label: 'Home', address: '12 Harbour Rd, Busan' },
      { id: expect.any(String), label: 'Mailing', address: 'PO Box 7, Seoul' },
    ]);

    // Replacing the list keeps the new order and drops what is left out.
    const patched = await f.patch(`/profiles/${created.body.id}`, { addresses: [{ label: 'Mailing', address: 'PO Box 9, Seoul' }] });
    expect(patched.body.addresses.map((a: { label: string; address: string }) => [a.label, a.address])).toEqual([['Mailing', 'PO Box 9, Seoul']]);

    // The Founder's own Profile reaches a team once handed to it.
    expect((await f.put(`/profiles/${created.body.id}/manager`, { managerId: fx.m1.id })).status).toBe(200);
    for (const who of ['m1', 'a1'] as const) {
      const res = await (await as(fx[who])).get(`/profiles/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.addresses, who).toBeNull();
    }
    // An associate's submission cannot set them.
    const submitted = await (await as(fx.a1)).post('/profiles', profileBody({ name: 'Sam Submit', addresses: [{ label: 'Home', address: 'x' }] }));
    expect(submitted.status).toBe(201);
    expect(await prisma.profileAddress.count({ where: { profileId: submitted.body.id } })).toBe(0);
    expectError(await f.patch(`/profiles/${created.body.id}`, { addresses: [{ label: '', address: 'x' }] }), 400);
  });
});

describe('profile email, phone and onboard date', () => {
  it('email and phone are for everyone but experts', async () => {
    const f = await as(fx.founder);
    const res = await f.post('/profiles', profileBody({ email: 'Dana.Morgan@Example.com', phone: '+44 20 7946 0958' }));
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ email: 'dana.morgan@example.com', phone: '+44 20 7946 0958' });
    // Handed to a1's team, which then sees them.
    expect((await f.put(`/profiles/${res.body.id}/manager`, { managerId: fx.m1.id })).status).toBe(200);
    expect((await (await as(fx.a1)).get(`/profiles/${res.body.id}`)).body).toMatchObject({ email: 'dana.morgan@example.com' });

    await prisma.call.create({
      data: {
        platformId: fx.platform.id, profileId: res.body.id, associateId: fx.a1.id, expertId: fx.e1.id,
        scheduledAt: new Date('2027-02-01T09:00:00Z'), durationMinutes: 30, projectDetails: 'x', platformAssociateName: 'y', createdById: fx.a1.id,
      },
    });
    expect((await (await as(fx.e1)).get(`/profiles/${res.body.id}`)).body).toMatchObject({ email: null, phone: null, onboardedAt: null, addresses: null });

    expectError(await f.post('/profiles', profileBody({ email: 'not an email' })), 400);
    expectError(await f.post('/profiles', profileBody({ phone: 'call me' })), 400);
  });

  it('a profile is onboarded when approved, and the founder can change the date', async () => {
    const f = await as(fx.founder);
    const created = await f.post('/profiles', profileBody());
    expect(created.body.onboardedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // An associate's pending submission is onboarded on approval, and cannot set its own date.
    const submitted = await (await as(fx.a1)).post('/profiles', profileBody({ name: 'Pending Pat', onboardedAt: '2020-01-01' }));
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: submitted.body.id } })).onboardedAt).toBeNull();
    const approved = await f.post(`/profiles/${submitted.body.id}/approve`);
    expect(approved.body.onboardedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const moved = await f.patch(`/profiles/${created.body.id}`, { onboardedAt: '2026-03-15' });
    expect(moved.body.onboardedAt).toBe('2026-03-15');
  });
});

describe('profile deactivation', () => {
  it('only the founder sees and books a deactivated profile', async () => {
    const f = await as(fx.founder);
    const res = await f.patch(`/profiles/${fx.approvedProfile.id}/active`, { isActive: false });
    expect(res.status, res.text).toBe(200);
    expect(res.body.isActive).toBe(false);

    // Hidden from everyone else, listed for the founder.
    expect((await f.get('/profiles')).body.some((p: { id: string }) => p.id === fx.approvedProfile.id)).toBe(true);
    for (const who of ['m1', 'a1'] as const) {
      const list = await (await as(fx[who])).get('/profiles');
      expect(list.body.some((p: { id: string }) => p.id === fx.approvedProfile.id), who).toBe(false);
      expectError(await (await as(fx[who])).get(`/profiles/${fx.approvedProfile.id}`), 404);
    }

    // It cannot be used for a new call while deactivated.
    const call = {
      platformId: fx.platform.id,
      profileId: fx.approvedProfile.id,
      expertId: fx.e1.id,
      scheduledAt: '2027-06-01T10:00:00Z',
      durationMinutes: 30,
      projectDetails: 'x',
      platformAssociateName: 'y',
    };
    expectError(await (await as(fx.a1)).post('/calls', call), 409, 'profile_not_approved');

    // Bringing it back restores everything.
    expect((await f.patch(`/profiles/${fx.approvedProfile.id}/active`, { isActive: true })).body.isActive).toBe(true);
    expect((await (await as(fx.a1)).get(`/profiles/${fx.approvedProfile.id}`)).status).toBe(200);
    expect((await (await as(fx.a1)).post('/calls', call)).status).toBe(201);
  });

  it('managers, associates and experts cannot deactivate a profile', async () => {
    for (const who of ['m1', 'a1', 'e1'] as const) {
      expectError(await (await as(fx[who])).patch(`/profiles/${fx.approvedProfile.id}/active`, { isActive: false }), 403);
    }
    // An Expert keeps seeing the profiles of their calls only while they are active.
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled' });
    expect((await (await as(fx.e1)).get('/profiles')).body).toHaveLength(1);
    await prisma.profile.update({ where: { id: fx.approvedProfile.id }, data: { isActive: false } });
    expect((await (await as(fx.e1)).get('/profiles')).body).toEqual([]);
  });
});

describe('DELETE /profiles/:id', () => {
  it('removes a profile without calls entirely, banks and addresses with it; founder only', async () => {
    const founder = await as(fx.founder);
    const created = (await founder.post('/profiles', { ...profileBody(), addresses: [{ label: 'Home', address: '1 Main St' }] })).body;
    await founder.post(`/profiles/${created.id}/banks`, { bankType: 'Checking', bankName: 'First Bank', routingNumber: '021000021', accountNumber: 'DE89370400440532013000' });

    expectError(await (await as(fx.m1)).delete(`/profiles/${created.id}`), 403);
    expect((await founder.delete(`/profiles/${created.id}`)).status).toBe(204);
    expect(await prisma.profile.count({ where: { id: created.id } })).toBe(0);
    expect(await prisma.profileBank.count({ where: { profileId: created.id } })).toBe(0);
    expectError(await founder.get(`/profiles/${created.id}`), 404);
  });

  it('keeps the calls of a profile that had some, erasing its personal details', async () => {
    const founder = await as(fx.founder);
    await prisma.profile.update({ where: { id: fx.approvedProfile.id }, data: { email: 'dana@example.org', phone: '+1 555 0100' } });
    const call = await makeCall(fx, { associate: fx.a1, status: 'process_to_bank', realIncome: 800 });

    expect((await founder.delete(`/profiles/${fx.approvedProfile.id}`)).status).toBe(204);
    const row = await prisma.profile.findUniqueOrThrow({ where: { id: fx.approvedProfile.id } });
    expect(row).toMatchObject({ name: 'Removed profile', email: null, phone: null, isActive: false });
    expect(row.deletedAt).not.toBeNull();

    // Gone from every list, but its call and income are intact.
    expect((await founder.get('/profiles')).body.some((p: { id: string }) => p.id === fx.approvedProfile.id)).toBe(false);
    expectError(await founder.get(`/profiles/${fx.approvedProfile.id}`), 404);
    expect((await founder.get('/stats/profiles')).body.some((r: { profile: { id: string } }) => r.profile.id === fx.approvedProfile.id)).toBe(false);
    const kept = (await founder.get(`/calls/${call.id}`)).body;
    expect(kept).toMatchObject({ profile: { name: 'Removed profile' }, realIncome: 800 });
  });

  it('refuses while the profile has calls still to finish', async () => {
    const founder = await as(fx.founder);
    await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    expectError(await founder.delete(`/profiles/${fx.approvedProfile.id}`), 409);
  });
});
