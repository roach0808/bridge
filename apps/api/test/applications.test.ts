import { DateTime } from 'luxon';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
  // The first team's Profile is registered on GLG and banned on AlphaSights; the second team's is registered on GLG.
  await prisma.profilePlatformStatus.createMany({
    data: [
      { profileId: fx.approvedProfile.id, platformId: fx.platform.id, status: 'registered', rate: 600 },
      { profileId: fx.approvedProfile.id, platformId: fx.platform2.id, status: 'banned' },
      { profileId: fx.approvedProfileTeam2.id, platformId: fx.platform.id, status: 'registered', rate: 500 },
    ],
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});

type Who = Parameters<typeof as>[0];
const board = async (who: Who, date?: string) => (await (await as(who)).get('/applications', date ? { date } : {})).body;
const put = async (who: Who, profileId: string, platformId: string, date: string, applied: number | null) =>
  (await as(who)).put(`/profiles/${profileId}/platforms/${platformId}/applications/${date}`, { applied });

describe('the project applications board', () => {
  it('shows each team its approved Profiles × every platform, not updated until someone fills a cell in', async () => {
    const m1 = await board(fx.m1);
    expect(m1.date).toBe(m1.today);
    expect(m1.canEdit).toBe(true);
    expect(m1.platforms.map((p: { name: string }) => p.name)).toEqual(['GLG', 'AlphaSights']);
    // Approved Profiles of the first team only: not the pending one, not the second team's.
    expect(m1.rows.map((r: { profile: { name: string } }) => r.profile.name)).toEqual([fx.approvedProfile.name]);
    expect(m1.rows[0].cells).toEqual([
      { status: 'registered', applied: null, updatedBy: null, updatedAt: null },
      { status: 'banned', applied: null, updatedBy: null, updatedAt: null },
    ]);
    expect((await board(fx.founder)).rows).toHaveLength(2);
    expect((await (await as(fx.e1)).get('/applications')).status).toBe(403);
  });

  it('an Associate records a day, zero is not the same as not updated, and null clears it', async () => {
    const { today } = await board(fx.a1);
    const res = await put(fx.a1, fx.approvedProfile.id, fx.platform.id, today, 3);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'registered', applied: 3, updatedBy: { id: fx.a1.id } });
    // The Manager sees it, and changes it to zero: zero is a figure.
    expect((await board(fx.m1)).rows[0].cells[0]).toMatchObject({ applied: 3, updatedBy: { id: fx.a1.id } });
    expect((await put(fx.m1, fx.approvedProfile.id, fx.platform.id, today, 0)).body).toMatchObject({ applied: 0, updatedBy: { id: fx.m1.id } });
    expect((await board(fx.a2)).rows[0].cells[0].applied).toBe(0);
    expect((await put(fx.a1, fx.approvedProfile.id, fx.platform.id, today, null)).body).toEqual({ status: 'registered', applied: null, updatedBy: null, updatedAt: null });
    expect((await board(fx.a1)).rows[0].cells[0].applied).toBeNull();
  });

  it('each day is its own: an earlier day can be filled in, a day to come cannot', async () => {
    const { today } = await board(fx.a1);
    const yesterday = DateTime.fromISO(today).minus({ days: 1 }).toISODate()!;
    const later = DateTime.fromISO(today).plus({ days: 1 }).toISODate()!;
    expect((await put(fx.a1, fx.approvedProfile.id, fx.platform.id, yesterday, 5)).status).toBe(200);
    expect((await board(fx.a1, yesterday)).rows[0].cells[0].applied).toBe(5);
    expect((await board(fx.a1)).rows[0].cells[0].applied).toBeNull();
    expect((await put(fx.a1, fx.approvedProfile.id, fx.platform.id, later, 1)).status).toBe(400);
    expect((await put(fx.a1, fx.approvedProfile.id, fx.platform.id, 'yesterday', 1)).status).toBe(400);
  });

  it('only where the Profile is registered, only within the team, never by an Expert', async () => {
    const { today } = await board(fx.a1);
    expect((await put(fx.a1, fx.approvedProfile.id, fx.platform2.id, today, 1)).body.error.code).toBe('not_registered');
    expect((await put(fx.a1, fx.approvedProfileTeam2.id, fx.platform.id, today, 1)).status).toBe(404);
    expect((await put(fx.a1, fx.pendingProfile.id, fx.platform.id, today, 1)).status).toBe(404);
    expect((await put(fx.e1, fx.approvedProfile.id, fx.platform.id, today, 1)).status).toBe(403);
    expect((await put(fx.a1, fx.approvedProfile.id, fx.platform.id, today, -1)).status).toBe(400);
    expect((await put(fx.founder, fx.approvedProfileTeam2.id, fx.platform.id, today, 2)).status).toBe(200);
  });

  it('the Profiles page adds up every day as applied projects', async () => {
    const { today } = await board(fx.a1);
    await put(fx.a1, fx.approvedProfile.id, fx.platform.id, today, 3);
    await put(fx.a1, fx.approvedProfile.id, fx.platform.id, DateTime.fromISO(today).minus({ days: 3 }).toISODate()!, 4);
    const profile = (await (await as(fx.m1)).get(`/profiles/${fx.approvedProfile.id}`)).body;
    expect(profile.platformStatuses.find((s: { platform: { id: string } }) => s.platform.id === fx.platform.id).appliedProjects).toBe(7);
  });
});
