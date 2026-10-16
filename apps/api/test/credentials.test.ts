import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, expectError, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const login = (over: Record<string, unknown> = {}) => ({
  nickname: 'Main GLG login',
  platform: 'GLG',
  login: 'dana@example.com',
  password: 'S3cret-pass!',
  ...over,
});

/** The trail is written after the response, so give it a moment to land. */
async function trail(action: string, expected = 1) {
  for (let i = 0; i < 60 && (await prisma.auditLog.count({ where: { action } })) < expected; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return prisma.auditLog.findMany({ where: { action } });
}

describe('a Profile’s password manager', () => {
  it('the team handling the Profile saves a login; the password never comes back with it and is stored encrypted', async () => {
    const a1 = await as(fx.a1);
    const res = await a1.post(`/profiles/${fx.approvedProfile.id}/credentials`, login());
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      profileId: fx.approvedProfile.id,
      teamId: null,
      nickname: 'Main GLG login',
      platform: 'GLG',
      login: 'dana@example.com',
      hasPassword: true,
      createdBy: { id: fx.a1.id },
      updatedBy: { id: fx.a1.id },
    });
    expect(res.text).not.toContain('S3cret-pass!');
    const row = await prisma.credential.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.passwordEnc).toMatch(/^v1:/);
    expect(row.passwordEnc).not.toContain('S3cret-pass!');

    // The whole team and the Founder list it.
    for (const who of [fx.a1, fx.a2, fx.m1, fx.founder]) {
      const list = await (await as(who)).get(`/profiles/${fx.approvedProfile.id}/credentials`);
      expect(list.status, list.text).toBe(200);
      expect(list.body.map((c: { id: string }) => c.id)).toEqual([res.body.id]);
      expect(list.text).not.toContain('S3cret-pass!');
    }
  });

  it('another team and Experts neither see nor add logins', async () => {
    const id = (await (await as(fx.a1)).post(`/profiles/${fx.approvedProfile.id}/credentials`, login())).body.id as string;
    for (const who of [fx.a3, fx.m2]) {
      const client = await as(who);
      expectError(await client.get(`/profiles/${fx.approvedProfile.id}/credentials`), 404);
      expectError(await client.post(`/profiles/${fx.approvedProfile.id}/credentials`, login()), 404);
      expectError(await client.get(`/credentials/${id}/password`), 404);
      expectError(await client.patch(`/credentials/${id}`, { nickname: 'mine now' }), 404);
      expectError(await client.delete(`/credentials/${id}`), 404);
    }
    // An Expert on a call with the Profile still gets nothing.
    await makeCall(fx, { associate: fx.a1, expert: fx.e1 });
    const e1 = await as(fx.e1);
    expectError(await e1.get(`/profiles/${fx.approvedProfile.id}/credentials`), 403);
    expectError(await e1.get(`/credentials/${id}/password`), 403);
    expect((await prisma.credential.findUniqueOrThrow({ where: { id } })).nickname).toBe('Main GLG login');
  });

  it('reveals the password to the team on request, and records each reveal', async () => {
    const id = (await (await as(fx.a1)).post(`/profiles/${fx.approvedProfile.id}/credentials`, login())).body.id as string;
    const shown = await (await as(fx.a2)).get(`/credentials/${id}/password`);
    expect(shown.status, shown.text).toBe(200);
    expect(shown.body).toEqual({ password: 'S3cret-pass!' });

    const [entry] = await trail('credential.password');
    expect(entry).toMatchObject({ userId: fx.a2.id, summary: 'revealed a saved login’s password', entityId: id });
    // Saving it is recorded too, and the trail never holds the password.
    const all = await trail('credential.create');
    expect(all).toHaveLength(1);
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain('S3cret-pass!');
  });

  it('anyone in the team changes it: leaving the password out keeps it, an empty one removes it', async () => {
    const id = (await (await as(fx.a1)).post(`/profiles/${fx.approvedProfile.id}/credentials`, login())).body.id as string;
    const a2 = await as(fx.a2);
    const changed = await a2.patch(`/credentials/${id}`, { login: 'dana.w@example.com', nickname: 'GLG (new email)' });
    expect(changed.status, changed.text).toBe(200);
    expect(changed.body).toMatchObject({ login: 'dana.w@example.com', nickname: 'GLG (new email)', hasPassword: true, createdBy: { id: fx.a1.id }, updatedBy: { id: fx.a2.id } });
    expect((await a2.get(`/credentials/${id}/password`)).body.password).toBe('S3cret-pass!');

    expect((await (await as(fx.m1)).patch(`/credentials/${id}`, { password: 'N3w-pass' })).body.hasPassword).toBe(true);
    expect((await a2.get(`/credentials/${id}/password`)).body.password).toBe('N3w-pass');

    const cleared = await a2.patch(`/credentials/${id}`, { password: '' });
    expect(cleared.body.hasPassword).toBe(false);
    expect((await a2.get(`/credentials/${id}/password`)).body).toEqual({ password: null });
  });

  it('anyone in the team deletes it', async () => {
    const id = (await (await as(fx.a1)).post(`/profiles/${fx.approvedProfile.id}/credentials`, login())).body.id as string;
    expect((await (await as(fx.a2)).delete(`/credentials/${id}`)).status).toBe(204);
    expect(await prisma.credential.count()).toBe(0);
  });

  it('a nickname and a platform are required; email and password are not', async () => {
    const a1 = await as(fx.a1);
    for (const [over, path] of [
      [{ nickname: '  ' }, 'nickname'],
      [{ platform: '' }, 'platform'],
    ] as const) {
      const res = await a1.post(`/profiles/${fx.approvedProfile.id}/credentials`, login(over));
      expectError(res, 400, 'validation_error');
      expect(res.body.error.details.issues.map((i: { path: string }) => i.path)).toContain(path);
    }
    const bare = await a1.post(`/profiles/${fx.approvedProfile.id}/credentials`, { nickname: 'LinkedIn', platform: 'LinkedIn' });
    expect(bare.status, bare.text).toBe(201);
    expect(bare.body).toMatchObject({ login: null, hasPassword: false });
  });

  it('the logins follow the Profile to its new team', async () => {
    const id = (await (await as(fx.a1)).post(`/profiles/${fx.approvedProfile.id}/credentials`, login())).body.id as string;
    expect((await (await as(fx.founder)).put(`/profiles/${fx.approvedProfile.id}/manager`, { managerId: fx.m2.id })).status).toBe(200);
    expect((await (await as(fx.a3)).get(`/credentials/${id}/password`)).body.password).toBe('S3cret-pass!');
    expectError(await (await as(fx.a1)).get(`/credentials/${id}/password`), 404);
  });

  it('go when the Profile is deleted, even when its calls are kept', async () => {
    await (await as(fx.a1)).post(`/profiles/${fx.approvedProfile.id}/credentials`, login());
    await makeCall(fx, { associate: fx.a1, status: 'cancelled' });
    const res = await (await as(fx.founder)).delete(`/profiles/${fx.approvedProfile.id}`);
    expect(res.status, res.text).toBeLessThan(300);
    expect(await prisma.credential.count()).toBe(0);
  });
});

describe('a team’s password manager', () => {
  it('the team saves, reveals and changes its own logins; the Founder every team’s', async () => {
    const a1 = await as(fx.a1);
    const res = await a1.post(`/teams/${fx.m1.id}/credentials`, login({ nickname: 'Team Zoom', platform: 'Zoom', login: 'team1@example.com' }));
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ teamId: fx.m1.id, profileId: null, nickname: 'Team Zoom', hasPassword: true });

    for (const who of [fx.m1, fx.a2, fx.founder]) {
      const client = await as(who);
      const list = await client.get(`/teams/${fx.m1.id}/credentials`);
      expect(list.body.map((c: { nickname: string }) => c.nickname)).toEqual(['Team Zoom']);
      expect((await client.get(`/credentials/${res.body.id}/password`)).body.password).toBe('S3cret-pass!');
    }
    expect((await (await as(fx.m1)).patch(`/credentials/${res.body.id}`, { platform: 'Zoom Pro' })).body.platform).toBe('Zoom Pro');

    // The Founder keeps any team's logins.
    const founder = await as(fx.founder);
    expect((await founder.post(`/teams/${fx.m2.id}/credentials`, login({ nickname: 'Team 2 Zoom' }))).status).toBe(201);
    expect((await founder.get(`/teams/${fx.m2.id}/credentials`)).body).toHaveLength(1);
  });

  it('is closed to other teams and to Experts', async () => {
    const id = (await (await as(fx.m1)).post(`/teams/${fx.m1.id}/credentials`, login())).body.id as string;
    for (const who of [fx.m2, fx.a3]) {
      const client = await as(who);
      expectError(await client.get(`/teams/${fx.m1.id}/credentials`), 404);
      expectError(await client.post(`/teams/${fx.m1.id}/credentials`, login()), 404);
      expectError(await client.get(`/credentials/${id}/password`), 404);
      expectError(await client.patch(`/credentials/${id}`, { nickname: 'x' }), 404);
      expectError(await client.delete(`/credentials/${id}`), 404);
    }
    expectError(await (await as(fx.e1)).get(`/teams/${fx.m1.id}/credentials`), 403);
    // A team is named by its Manager; anyone else is no team.
    expectError(await (await as(fx.founder)).get(`/teams/${fx.a1.id}/credentials`), 404);
    expect(await prisma.credential.count()).toBe(1);
  });

  it('keeps a team’s logins apart from its Profiles’', async () => {
    const a1 = await as(fx.a1);
    await a1.post(`/teams/${fx.m1.id}/credentials`, login({ nickname: 'Team Gmail', platform: 'Gmail' }));
    await a1.post(`/profiles/${fx.approvedProfile.id}/credentials`, login());
    expect((await a1.get(`/teams/${fx.m1.id}/credentials`)).body.map((c: { nickname: string }) => c.nickname)).toEqual(['Team Gmail']);
    expect((await a1.get(`/profiles/${fx.approvedProfile.id}/credentials`)).body.map((c: { nickname: string }) => c.nickname)).toEqual(['Main GLG login']);
  });
});
