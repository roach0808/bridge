import { deflateSync } from 'node:zlib';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, as, expectError, makeBank, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const bankBody = (over: Record<string, unknown> = {}) => ({
  nickname: 'Morgan main',
  bankType: 'Checking',
  bankName: 'First Bank',
  bankAddress: '270 Park Ave, New York, NY',
  routingNumber: '021000021',
  accountNumber: '000123456789',
  swiftCode: 'CHASUS33',
  email: 'morgan@example.org',
  password: 'hunter2-secret',
  signInLocation: 'AdsPower profile 7',
  ...over,
});

/** Audit entries are written just after the response: wait for them. */
async function auditCount(action: string, expected: number) {
  for (let i = 0; i < 60; i++) {
    const n = await prisma.auditLog.count({ where: { action } });
    if (n >= expected) return n;
    await new Promise((r) => setTimeout(r, 25));
  }
  return prisma.auditLog.count({ where: { action } });
}

/** A valid 1×1 PNG as a data URL. */
function pngDataUrl() {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

describe('profile banks', () => {
  it('the Founder adds, edits and deletes banks; Managers and Associates read them without the secrets; Experts get nothing', async () => {
    const path = `/profiles/${fx.approvedProfile.id}/banks`;
    const founder = await as(fx.founder);
    for (const who of ['m1', 'a1', 'e1'] as const) expectError(await (await as(fx[who])).post(path, bankBody()), 403);

    const created = await founder.post(path, bankBody());
    expect(created.status, created.text).toBe(201);
    expect(created.body).toMatchObject({
      nickname: 'Morgan main', bankType: 'Checking', bankName: 'First Bank', bankAddress: '270 Park Ave, New York, NY',
      routingNumber: '021000021', accountNumber: '000123456789', swiftCode: 'CHASUS33', email: 'morgan@example.org',
      hasPassword: true, signInLocation: 'AdsPower profile 7', isActive: true,
    });
    // The password never comes back with the bank, and is not stored as typed.
    expect(created.text).not.toContain('hunter2-secret');
    const row = await prisma.profileBank.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.passwordEnc).toMatch(/^v1:/);
    expect(row.passwordEnc).not.toContain('hunter2');

    // Managers and Associates who can see the Profile read everything but the login secrets.
    for (const who of ['m1', 'a1'] as const) {
      const res = await (await as(fx[who])).get(path);
      expect(res.status, res.text).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ accountNumber: '000123456789', email: 'morgan@example.org', hasPassword: null, signInLocation: null })]);
      expect(res.text).not.toContain('AdsPower');
      expectError(await (await as(fx[who])).get(`/banks/${created.body.id}/password`), 403);
      expectError(await (await as(fx[who])).get('/banks'), 403);
      expectError(await (await as(fx[who])).patch(`/banks/${created.body.id}`, { bankName: 'x' }), 403);
      expectError(await (await as(fx[who])).delete(`/banks/${created.body.id}`), 403);
    }
    // Experts: not a single field.
    const e1 = await as(fx.e1);
    expectError(await e1.get(path), 403);
    expectError(await e1.get('/banks'), 403);
    expectError(await e1.get(`/banks/${created.body.id}/password`), 403);
    // A Profile the Associate cannot see: its banks do not exist for them.
    expectError(await (await as(fx.a1)).get(`/profiles/${fx.pendingProfileTeam2.id}/banks`), 404);

    // The Founder reveals the password on purpose; it is in the audit trail.
    const revealed = await founder.get(`/banks/${created.body.id}/password`);
    expect(revealed.body).toEqual({ password: 'hunter2-secret' });
    expect(await auditCount('bank.password', 1)).toBe(1);

    // Leaving the password out keeps it; an empty one removes it.
    let updated = await founder.patch(`/banks/${created.body.id}`, { nickname: 'Morgan old', isActive: false });
    expect(updated.status, updated.text).toBe(200);
    expect(updated.body).toMatchObject({ nickname: 'Morgan old', isActive: false, hasPassword: true });
    expect((await founder.get(`/banks/${created.body.id}/password`)).body).toEqual({ password: 'hunter2-secret' });
    updated = await founder.patch(`/banks/${created.body.id}`, { password: 'n3w', signInLocation: '' });
    expect(updated.body).toMatchObject({ hasPassword: true, signInLocation: null });
    expect((await founder.get(`/banks/${created.body.id}/password`)).body).toEqual({ password: 'n3w' });
    updated = await founder.patch(`/banks/${created.body.id}`, { password: '' });
    expect(updated.body.hasPassword).toBe(false);
    expect((await founder.get(`/banks/${created.body.id}/password`)).body).toEqual({ password: null });

    expect((await founder.delete(`/banks/${created.body.id}`)).status).toBe(204);
    expect((await founder.get(path)).body).toEqual([]);
  });

  it('requires type, bank name, routing and account numbers; the rest is optional', async () => {
    const founder = await as(fx.founder);
    const path = `/profiles/${fx.approvedProfile.id}/banks`;
    for (const field of ['bankType', 'bankName', 'routingNumber', 'accountNumber']) {
      expectError(await founder.post(path, bankBody({ [field]: '  ' })), 400, 'validation_error');
    }
    expectError(await founder.post(path, bankBody({ email: 'not-an-email' })), 400, 'validation_error');
    const minimal = await founder.post(path, { bankType: 'Savings', bankName: 'Ally', routingNumber: '124003116', accountNumber: '42' });
    expect(minimal.status, minimal.text).toBe(201);
    expect(minimal.body).toMatchObject({ nickname: null, bankAddress: null, swiftCode: null, email: null, hasPassword: false, signInLocation: null, isActive: true });
    expectError(await founder.patch(`/banks/${minimal.body.id}`, { routingNumber: '' }), 400, 'validation_error');
    expectError(await founder.post('/profiles/00000000-0000-4000-8000-000000000000/banks', bankBody()), 404);
  });

  it('the Founder’s bank page lists every bank with its Profile, and the types in use', async () => {
    const founder = await as(fx.founder);
    await founder.post(`/profiles/${fx.approvedProfile.id}/banks`, bankBody());
    await founder.post(`/profiles/${fx.pendingProfile.id}/banks`, bankBody({ bankType: 'Wise', nickname: null }));
    await founder.post(`/profiles/${fx.pendingProfile.id}/banks`, bankBody({ bankType: 'Checking', nickname: 'P2' }));
    const res = await founder.get('/banks');
    expect(res.status, res.text).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0]).toMatchObject({ profile: { id: expect.any(String), name: expect.any(String), isActive: true }, hasPassword: true, signInLocation: 'AdsPower profile 7' });
    expect(res.text).not.toContain('hunter2');
    expect((await founder.get('/banks/types')).body).toEqual(['Checking', 'Wise']);
    expect(await auditCount('bank.read', 1)).toBe(1);
  });

  it('a bank with invoices cannot be deleted, only deactivated', async () => {
    const bank = await makeBank(fx);
    const call = await makeCall(fx, { associate: fx.a1, status: 'invoice_submit' });
    await prisma.call.update({ where: { id: call.id }, data: { bankId: bank.id } });
    const founder = await as(fx.founder);
    expectError(await founder.delete(`/banks/${bank.id}`), 409, 'bank_in_use');
    expect((await founder.patch(`/banks/${bank.id}`, { isActive: false })).body.isActive).toBe(false);
  });

  it('profiles report bankCount and needsBank to the Founder only', async () => {
    await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    const founder = await as(fx.founder);
    let profile = (await founder.get(`/profiles/${fx.approvedProfile.id}`)).body;
    expect(profile).toMatchObject({ bankCount: 0, needsBank: true });

    const mine = (await (await as(fx.a1)).get(`/profiles/${fx.approvedProfile.id}`)).body;
    expect(mine).toMatchObject({ bankCount: null, needsBank: null });

    const bank = (await founder.post(`/profiles/${fx.approvedProfile.id}/banks`, bankBody())).body;
    expect(bank.isActive).toBe(true);
    profile = (await founder.get(`/profiles/${fx.approvedProfile.id}`)).body;
    expect(profile).toMatchObject({ bankCount: 1, needsBank: false });

    // A deactivated account stays on file but no longer counts: the Profile needs a bank again.
    const closed = await founder.patch(`/banks/${bank.id}`, { isActive: false });
    expect(closed.body.isActive).toBe(false);
    profile = (await founder.get(`/profiles/${fx.approvedProfile.id}`)).body;
    expect(profile).toMatchObject({ bankCount: 0, needsBank: true });
    expect((await founder.get(`/profiles/${fx.approvedProfile.id}/banks`)).body).toHaveLength(1);

    expect((await founder.patch(`/banks/${bank.id}`, { isActive: true })).body.isActive).toBe(true);
    expect((await founder.get(`/profiles/${fx.approvedProfile.id}`)).body).toMatchObject({ bankCount: 1, needsBank: false });
  });
});

describe('photos', () => {
  it('any user uploads, replaces and removes their own photo; old pictures are deleted', async () => {
    const e1 = await as(fx.e1);
    const first = await e1.put('/me/photo', { dataUrl: pngDataUrl() });
    expect(first.status, first.text).toBe(200);
    const photoId = first.body.photoId as string;
    expect(photoId).toBeTruthy();

    const image = await anon.get(`/photos/${photoId}`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');

    const second = await e1.put('/me/photo', { dataUrl: pngDataUrl() });
    expect(second.body.photoId).not.toBe(photoId);
    expect(await prisma.photo.count({ where: { id: photoId } })).toBe(0);

    const removed = await e1.delete('/me/photo');
    expect(removed.body.photoId).toBeNull();
    expect(await prisma.photo.count()).toBe(0);
  });

  it('the photo id appears on user references seen by others', async () => {
    await (await as(fx.e1)).put('/me/photo', { dataUrl: pngDataUrl() });
    const users = (await (await as(fx.founder)).get('/users', { role: 'expert' })).body as Array<{ id: string; photoId: string | null }>;
    expect(users.find((u) => u.id === fx.e1.id)?.photoId).toBeTruthy();
  });

  it('rejects files that are not the image type they claim', async () => {
    const c = await as(fx.a1);
    expectError(await c.put('/me/photo', { dataUrl: 'data:image/png;base64,aGVsbG8=' }), 400, 'validation_error');
    expectError(await c.put('/me/photo', { dataUrl: 'data:text/html;base64,PGgxPg==' }), 400, 'validation_error');
    const big = `data:image/png;base64,${Buffer.alloc(420 * 1024).toString('base64')}`;
    expect((await c.put('/me/photo', { dataUrl: big })).status).toBeGreaterThanOrEqual(400);
  });

  it('only the Founder sets profile photos', async () => {
    const path = `/profiles/${fx.approvedProfile.id}/photo`;
    expectError(await (await as(fx.a1)).put(path, { dataUrl: pngDataUrl() }), 403);
    const res = await (await as(fx.founder)).put(path, { dataUrl: pngDataUrl() });
    expect(res.status, res.text).toBe(200);
    expect(res.body.photoId).toBeTruthy();
    const call = await makeCall(fx, { associate: fx.a1 });
    const detail = await (await as(fx.a1)).get(`/calls/${call.id}`);
    expect(detail.body.profile.photoId).toBe(res.body.photoId);
    expect((await (await as(fx.founder)).delete(path)).body.photoId).toBeNull();
  });

  it('unknown photos are 404', async () => {
    expectError(await anon.get('/photos/00000000-0000-4000-8000-000000000000'), 404);
    expectError(await anon.get('/photos/not-a-uuid'), 404);
  });
});

describe('GET /dashboard', () => {
  const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

  it('groups today’s calls into ongoing, coming up and finished', async () => {
    // Keep test calls inside today's New York day regardless of when the suite runs.
    const now = new Date();
    const nyHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now));
    const safe = (offset: number) => Math.min(Math.max(offset, -nyHour + 0.1), 23.5 - nyHour);
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'ongoing', scheduledAt: at(safe(-0.2)), durationMinutes: 15 });
    await makeCall(fx, { associate: fx.a1, expert: fx.e2, status: 'scheduled', scheduledAt: at(safe(1)), durationMinutes: 15 });
    await makeCall(fx, { associate: fx.a1, expert: fx.e3, status: 'invoice_submit', scheduledAt: at(safe(-0.5)), durationMinutes: 15 });
    await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'on_scheduling', scheduledAt: at(safe(2)), durationMinutes: 15 });
    await makeCall(fx, { associate: fx.a1, expert: fx.e2, status: 'scheduled', scheduledAt: at(72), durationMinutes: 15 });

    const res = await (await as(fx.founder)).get('/dashboard');
    expect(res.status, res.text).toBe(200);
    expect(res.body.today.zone).toBe('America/New_York');
    expect(res.body.today.ongoing).toHaveLength(1);
    expect(res.body.today.upcoming).toHaveLength(1);
    expect(res.body.today.finished).toHaveLength(1);
    expect(res.body.today.finished[0].status).toBe('invoice_submit');
  });

  it('scopes today’s calls to what the viewer can see', async () => {
    await makeCall(fx, { associate: fx.a3, expert: fx.e1, status: 'ongoing', scheduledAt: at(-0.1), durationMinutes: 15 });
    const a1 = (await (await as(fx.a1)).get('/dashboard')).body;
    expect(a1.today.ongoing).toHaveLength(0);
    expect(a1.tasks).toBeUndefined();
    expect(a1.database).toBeUndefined();
    const e1 = (await (await as(fx.e1)).get('/dashboard')).body;
    expect(e1.today.ongoing).toHaveLength(1);
    expect(e1.today.zone).toBe(fx.e1.timeZone);
  });

  it('gives the Founder pending tasks and the database size', async () => {
    await makeCall(fx, { associate: fx.a1, status: 'finished', scheduledAt: '2026-01-05T10:00:00Z' });
    await makeCall(fx, { associate: fx.a2, status: 'invoice_submit', scheduledAt: '2026-01-06T10:00:00Z' });
    await makeCall(fx, { associate: fx.a1, status: 'scheduled', scheduledAt: '2030-03-01T10:00:00Z' });

    const founder = await as(fx.founder);
    let body = (await founder.get('/dashboard')).body;
    expect(body.tasks.invoicesToSubmit.map((c: { status: string }) => c.status)).toEqual(['finished']);
    expect(body.tasks.profilesNeedingBank).toHaveLength(1);
    expect(body.tasks.profilesNeedingBank[0]).toMatchObject({
      profile: { id: fx.approvedProfile.id },
      bookedCalls: 3,
      nextCallAt: '2030-03-01T10:00:00.000Z',
    });
    expect(body.database.sizeBytes).toBeGreaterThan(0);
    expect(body.database.tables.map((t: { name: string }) => t.name)).toContain('calls');

    await founder.post(`/profiles/${fx.approvedProfile.id}/banks`, bankBody());
    body = (await founder.get('/dashboard')).body;
    expect(body.tasks.profilesNeedingBank).toHaveLength(0);
  });

  it('tentative calls alone do not require a bank', async () => {
    await makeCall(fx, { associate: fx.a1, status: 'on_scheduling' });
    const body = (await (await as(fx.founder)).get('/dashboard')).body;
    expect(body.tasks.profilesNeedingBank).toHaveLength(0);
  });

  it('managers also get their team', async () => {
    const body = (await (await as(fx.m1)).get('/dashboard')).body;
    expect(body.team.map((t: { associate: { id: string } }) => t.associate.id).sort()).toEqual([fx.a1.id, fx.a2.id].sort());
  });
});
