import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, expectError, prisma, seedFixtures, type Fixtures } from './helpers';

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

  it.each(['m1', 'e1'] as const)('%s cannot create profiles', async (who) => {
    expectError(await (await as(fx[who])).post('/profiles', profileBody()), 403, 'forbidden');
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
    expectError(await (await as(fx.a1)).get(`/profiles/${res.body.id}`), 404);
    expectError(await (await as(fx.m2)).get(`/profiles/${res.body.id}`), 404);

    // It cannot be used for a call until approved.
    const call = { platformId: fx.platform.id, profileId: res.body.id, expertId: fx.e1.id, scheduledAt: '2027-05-01T10:00:00Z', durationMinutes: 30, projectDetails: 'x', platformAssociateName: 'y' };
    expectError(await (await as(fx.a2)).post('/calls', call), 409, 'profile_not_approved');
    expect((await (await as(fx.founder)).post(`/profiles/${res.body.id}/approve`)).status).toBe(200);
    expect((await (await as(fx.a2)).post('/calls', call)).status).toBe(201);
  });

  it('an associate resubmitting after a rejection notifies the founders again; approved profiles are locked', async () => {
    const f = await as(fx.founder);
    const a1 = await as(fx.a1);
    await f.post(`/profiles/${fx.pendingProfile.id}/reject`, { reason: 'Add the career history' });
    const res = await a1.patch(`/profiles/${fx.pendingProfile.id}`, { careerHistory: 'VP at X' });
    expect(res.body).toMatchObject({ status: 'pending', careerHistory: 'VP at X' });
    expect(await prisma.notification.count({ where: { type: 'profile.submitted', userId: fx.founder.id } })).toBe(1);
    await f.post(`/profiles/${fx.pendingProfile.id}/approve`);
    expectError(await a1.patch(`/profiles/${fx.pendingProfile.id}`, { name: 'Changed' }), 403);
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

  it('founder sees everything', async () => {
    expect(names(await (await as(fx.founder)).get('/profiles'))).toEqual(['Dana Approved', 'Pat Pending', 'Quinn Pending']);
  });

  it('associate sees approved plus their own pending', async () => {
    const a1 = await as(fx.a1);
    expect(names(await a1.get('/profiles'))).toEqual(['Dana Approved', 'Pat Pending']);
    expectError(await a1.get(`/profiles/${fx.pendingProfileTeam2.id}`), 404);
  });

  it('manager sees approved plus their team’s pending', async () => {
    expect(names(await (await as(fx.m1)).get('/profiles'))).toEqual(['Dana Approved', 'Pat Pending']);
    expect(names(await (await as(fx.m2)).get('/profiles'))).toEqual(['Dana Approved', 'Quinn Pending']);
  });

  it('another associate on the same team does not see a1’s pending profile', async () => {
    expect(names(await (await as(fx.a2)).get('/profiles'))).toEqual(['Dana Approved']);
  });

  it('filters by status', async () => {
    expect(names(await (await as(fx.founder)).get('/profiles', { status: 'pending' }))).toEqual(['Pat Pending', 'Quinn Pending']);
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
  it('associate cannot edit a profile they did not author', async () => {
    expectError(await (await as(fx.a1)).patch(`/profiles/${fx.approvedProfile.id}`, { name: 'Hacked' }), 403);
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
  it('every platform is listed, defaulting to not_registered at a rate of 1000', async () => {
    const res = await (await as(fx.a1)).get(`/profiles/${fx.approvedProfile.id}`);
    expect(res.body.platformStatuses).toEqual([
      { platform: { id: fx.platform.id, name: 'GLG', priority: 1 }, status: 'not_registered', rate: 1000 },
      { platform: { id: fx.platform2.id, name: 'AlphaSights', priority: 2 }, status: 'not_registered', rate: 1000 },
    ]);
  });

  it('the founder sets a rate per platform without touching the status, and back', async () => {
    const f = await as(fx.founder);
    const url = (platformId: string) => `/profiles/${fx.approvedProfile.id}/platforms/${platformId}`;
    let res = await f.put(url(fx.platform.id), { rate: 1250.5 });
    expect(res.status, res.text).toBe(200);
    expect(res.body.platformStatuses).toEqual([
      expect.objectContaining({ status: 'not_registered', rate: 1250.5 }),
      expect.objectContaining({ status: 'not_registered', rate: 1000 }),
    ]);
    res = await f.put(url(fx.platform.id), { status: 'registered' });
    expect(res.body.platformStatuses[0]).toMatchObject({ status: 'registered', rate: 1250.5 });
    res = await f.put(url(fx.platform2.id), { status: 'banned', rate: 0 });
    expect(res.body.platformStatuses[1]).toMatchObject({ status: 'banned', rate: 0 });

    // Managers and associates see the rates; only the founder changes them.
    expect((await (await as(fx.m1)).get(`/profiles/${fx.approvedProfile.id}`)).body.platformStatuses[0].rate).toBe(1250.5);
    expectError(await (await as(fx.a1)).put(url(fx.platform.id), { rate: 1 }), 403);

    for (const bad of [{}, { rate: -1 }, { rate: 'abc' }, { rate: 12.345 }, { rate: 2_000_000 }]) {
      expectError(await f.put(url(fx.platform.id), bad), 400);
    }
  });

  it('the founder sets a status; managers and associates see it but cannot change it', async () => {
    const url = `/profiles/${fx.approvedProfile.id}/platforms/${fx.platform2.id}`;
    const f = await as(fx.founder);
    const res = await f.put(url, { status: 'banned' });
    expect(res.status, res.text).toBe(200);
    expect(res.body.platformStatuses[1]).toMatchObject({ status: 'banned' });
    expect((await f.put(url, { status: 'registered' })).body.platformStatuses[1].status).toBe('registered');

    const m1 = await as(fx.m1);
    expect((await m1.get('/profiles')).body.find((p: { id: string }) => p.id === fx.approvedProfile.id).platformStatuses[1].status).toBe('registered');
    expectError(await m1.put(url, { status: 'banned' }), 403);
    expectError(await (await as(fx.a1)).put(url, { status: 'banned' }), 403);
  });

  it('validates the status and the ids', async () => {
    const f = await as(fx.founder);
    expectError(await f.put(`/profiles/${fx.approvedProfile.id}/platforms/${fx.platform.id}`, { status: 'pending' }), 400);
    expectError(await f.put(`/profiles/${fx.approvedProfile.id}/platforms/00000000-0000-4000-8000-000000000000`, { status: 'registered' }), 404);
    expectError(await f.put(`/profiles/00000000-0000-4000-8000-000000000000/platforms/${fx.platform.id}`, { status: 'registered' }), 404);
  });
});

describe('current address is founder-only', () => {
  it('only the founder can set and see it', async () => {
    const f = await as(fx.founder);
    const created = await f.post('/profiles', profileBody({ currentAddress: '12 Harbour Rd, Busan' }));
    expect(created.body.currentAddress).toBe('12 Harbour Rd, Busan');
    expect((await f.get(`/profiles/${created.body.id}`)).body.currentAddress).toBe('12 Harbour Rd, Busan');

    for (const who of ['m1', 'a1'] as const) {
      const res = await (await as(fx[who])).get(`/profiles/${created.body.id}`);
      expect(res.status).toBe(200);
      expect(res.body.currentAddress, who).toBeNull();
    }
    // An associate's submission cannot set it.
    const submitted = await (await as(fx.a1)).post('/profiles', profileBody({ name: 'Sam Submit', currentAddress: 'Somewhere' }));
    expect(submitted.status).toBe(201);
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: submitted.body.id } })).currentAddress).toBeNull();
  });
});
