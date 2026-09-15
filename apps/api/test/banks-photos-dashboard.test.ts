import { deflateSync } from 'node:zlib';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { anon, as, expectError, makeCall, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const bankBody = (over: Record<string, unknown> = {}) => ({
  bankName: 'First Bank',
  accountHolder: 'Morgan Expertise',
  accountNumber: 'DE89370400440532013000',
  swiftBic: 'COBADEFFXXX',
  country: 'de',
  currency: 'eur',
  ...over,
});

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
  it('only the Founder can list, add, edit and delete banks', async () => {
    const path = `/profiles/${fx.approvedProfile.id}/banks`;
    for (const who of ['m1', 'a1', 'e1'] as const) {
      const c = await as(fx[who]);
      expectError(await c.get(path), 403);
      expectError(await c.post(path, bankBody()), 403);
    }
    const founder = await as(fx.founder);
    const created = await founder.post(path, bankBody());
    expect(created.status, created.text).toBe(201);
    expect(created.body).toMatchObject({ bankName: 'First Bank', country: 'DE', currency: 'EUR', isPrimary: true });

    const a1 = await as(fx.a1);
    expectError(await a1.patch(`/banks/${created.body.id}`, { bankName: 'x' }), 403);
    expectError(await a1.delete(`/banks/${created.body.id}`), 403);

    const updated = await founder.patch(`/banks/${created.body.id}`, { notes: 'Pay monthly' });
    expect(updated.status).toBe(200);
    expect(updated.body.notes).toBe('Pay monthly');
    expect((await founder.delete(`/banks/${created.body.id}`)).status).toBe(204);
    expect((await founder.get(path)).body).toEqual([]);
  });

  it('validates required fields and codes', async () => {
    const founder = await as(fx.founder);
    const path = `/profiles/${fx.approvedProfile.id}/banks`;
    expectError(await founder.post(path, bankBody({ bankName: '  ' })), 400, 'validation_error');
    expectError(await founder.post(path, bankBody({ accountNumber: '' })), 400, 'validation_error');
    expectError(await founder.post(path, bankBody({ currency: 'EURO' })), 400, 'validation_error');
    expectError(await founder.post('/profiles/00000000-0000-4000-8000-000000000000/banks', bankBody()), 404);
  });

  it('keeps exactly one primary bank', async () => {
    const founder = await as(fx.founder);
    const path = `/profiles/${fx.approvedProfile.id}/banks`;
    const first = (await founder.post(path, bankBody({ bankName: 'One' }))).body;
    const second = (await founder.post(path, bankBody({ bankName: 'Two', isPrimary: true }))).body;
    let list = (await founder.get(path)).body as Array<{ id: string; isPrimary: boolean }>;
    expect(list.filter((b) => b.isPrimary).map((b) => b.id)).toEqual([second.id]);

    await founder.patch(`/banks/${first.id}`, { isPrimary: true });
    list = (await founder.get(path)).body;
    expect(list.filter((b) => b.isPrimary).map((b) => b.id)).toEqual([first.id]);

    await founder.delete(`/banks/${first.id}`);
    list = (await founder.get(path)).body;
    expect(list).toHaveLength(1);
    expect(list[0]!.isPrimary).toBe(true);
  });

  it('profiles report bankCount and needsBank to the Founder only', async () => {
    await makeCall(fx, { associate: fx.a1, status: 'scheduled' });
    const founder = await as(fx.founder);
    let profile = (await founder.get(`/profiles/${fx.approvedProfile.id}`)).body;
    expect(profile).toMatchObject({ bankCount: 0, needsBank: true });

    const mine = (await (await as(fx.a1)).get(`/profiles/${fx.approvedProfile.id}`)).body;
    expect(mine).toMatchObject({ bankCount: null, needsBank: null });

    await founder.post(`/profiles/${fx.approvedProfile.id}/banks`, bankBody());
    profile = (await founder.get(`/profiles/${fx.approvedProfile.id}`)).body;
    expect(profile).toMatchObject({ bankCount: 1, needsBank: false });
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
