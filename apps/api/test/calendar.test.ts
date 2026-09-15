import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, expectError, makeCall, prisma, seedFixtures, type Client, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const RANGE = { from: '2027-01-31T00:00:00Z', to: '2027-02-07T00:00:00Z' };

/** e1's week: calls from a1, a2 (same team as a1) and a3 (other team), plus a private block. */
async function seedExpertWeek() {
  const c1 = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T09:00:00Z', durationMinutes: 60, notes: 'secret-call-note' });
  const c2 = await makeCall(fx, { associate: fx.a3, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-01T12:00:00Z', durationMinutes: 30 });
  await prisma.call.update({ where: { id: c2.id }, data: { platformId: fx.platform2.id } });
  const c3 = await makeCall(fx, { associate: fx.a3, expert: fx.e1, status: 'on_scheduling', scheduledAt: '2027-02-01T14:00:00Z' });
  const c4 = await makeCall(fx, { associate: fx.a2, expert: fx.e1, status: 'ongoing', scheduledAt: '2027-02-02T09:00:00Z', durationMinutes: 45 });
  const other = await makeCall(fx, { associate: fx.a1, expert: fx.e2, status: 'scheduled', scheduledAt: '2027-02-01T09:00:00Z' });
  const block = await prisma.scheduleBlock.create({
    data: {
      expertId: fx.e1.id, createdById: fx.e1.id, kind: 'unavailable', note: 'private-block-note', timeZone: 'Asia/Seoul',
      startDate: new Date('2027-02-01T00:00:00Z'), startMinute: 600, durationMinutes: 60,
      frequency: 'weekly', weekdays: [1], untilDate: new Date('2027-03-01T00:00:00Z'),
    },
  });
  return { c1, c2, c3, c4, other, block };
}

const ids = (arr: Array<{ id: string }>) => arr.map((c) => c.id).sort();
const calendarOf = (client: Client, expertId?: string, range = RANGE) => client.get('/calendar', { ...range, ...(expertId ? { expertId } : {}) });

describe('GET /calendar privacy', () => {
  it('associate: own calls in full, other associates’ blocking calls only as busy time', async () => {
    const w = await seedExpertWeek();
    const res = await calendarOf(await as(fx.a1), fx.e1.id);
    expect(res.status, res.text).toBe(200);
    expect(res.body.expert).toMatchObject({ id: fx.e1.id, timeZone: 'Asia/Seoul' });
    expect(res.body.canEditBlocks).toBe(false);
    expect(ids(res.body.calls)).toEqual([w.c1.id]);
    expect(res.body.calls[0]).toMatchObject({ platform: { name: 'GLG' }, profile: { name: 'Dana Approved' }, associate: { id: fx.a1.id } });
    expect(res.body.busy).toEqual([
      { startsAt: '2027-02-01T12:00:00.000Z', endsAt: '2027-02-01T12:30:00.000Z' },
      { startsAt: '2027-02-02T09:00:00.000Z', endsAt: '2027-02-02T09:45:00.000Z' },
    ]);
    for (const b of res.body.busy) expect(Object.keys(b).sort()).toEqual(['endsAt', 'startsAt']);
    expect(res.body.rules).toEqual([]);
    expect(res.body.occurrences).toEqual([
      expect.objectContaining({ date: '2027-02-01', startsAt: '2027-02-01T01:00:00Z', kind: 'unavailable' }),
    ]);
    // Nothing identifying the hidden calls or the private notes leaks anywhere.
    for (const secret of [w.c2.id, w.c3.id, w.c4.id, 'AssocThree', 'AssocTwo', 'AlphaSights', 'secret-call-note', 'private-block-note']) {
      expect(res.text).not.toContain(secret);
    }
  });

  it('on_scheduling calls of others appear neither in calls nor busy', async () => {
    const w = await seedExpertWeek();
    const res = await calendarOf(await as(fx.a1), fx.e1.id);
    expect(res.body.busy.some((b: { startsAt: string }) => b.startsAt.startsWith('2027-02-01T14'))).toBe(false);
    expect(res.text).not.toContain(w.c3.id);
  });

  it('manager: team calls in full, other team as busy, no rules or notes', async () => {
    const w = await seedExpertWeek();
    const res = await calendarOf(await as(fx.m1), fx.e1.id);
    expect(ids(res.body.calls)).toEqual(ids([w.c1, w.c4]));
    expect(res.body.busy).toEqual([{ startsAt: '2027-02-01T12:00:00.000Z', endsAt: '2027-02-01T12:30:00.000Z' }]);
    expect(res.body.rules).toEqual([]);
    expect(res.text).not.toContain('private-block-note');
  });

  it('founder sees every call, no busy, and the rules with notes', async () => {
    const w = await seedExpertWeek();
    const res = await calendarOf(await as(fx.founder), fx.e1.id);
    expect(ids(res.body.calls)).toEqual(ids([w.c1, w.c2, w.c3, w.c4]));
    expect(res.body.busy).toEqual([]);
    expect(res.body.canEditBlocks).toBe(true);
    expect(res.body.rules).toEqual([expect.objectContaining({ id: w.block.id, note: 'private-block-note', timeZone: 'Asia/Seoul' })]);
  });

  it('expert gets their own calendar by default with rules', async () => {
    const w = await seedExpertWeek();
    const res = await calendarOf(await as(fx.e1));
    expect(res.status).toBe(200);
    expect(res.body.expert.id).toBe(fx.e1.id);
    expect(ids(res.body.calls)).toEqual(ids([w.c1, w.c2, w.c3, w.c4]));
    expect(res.body.busy).toEqual([]);
    expect(res.body.canEditBlocks).toBe(true);
    expect(res.body.rules).toHaveLength(1);
    expect(res.body.rules[0].note).toBe('private-block-note');
  });

  it('expert asking for another expert is 403', async () => {
    await seedExpertWeek();
    expectError(await calendarOf(await as(fx.e1), fx.e2.id), 403, 'forbidden');
  });

  it('without expertId, non-experts get their visible calls only', async () => {
    const w = await seedExpertWeek();
    const res = await calendarOf(await as(fx.a1));
    expect(res.body.expert).toBeNull();
    expect(ids(res.body.calls)).toEqual(ids([w.c1, w.other]));
    expect(res.body).toMatchObject({ busy: [], occurrences: [], rules: [] });
  });

  it('range over 62 days, inverted range, missing params are 400', async () => {
    const a1 = await as(fx.a1);
    expectError(await calendarOf(a1, fx.e1.id, { from: '2027-01-01T00:00:00Z', to: '2027-03-05T00:00:00Z' }), 400, 'validation_error');
    expectError(await calendarOf(a1, fx.e1.id, { from: '2027-02-02T00:00:00Z', to: '2027-02-01T00:00:00Z' }), 400);
    expectError(await a1.get('/calendar'), 400);
    expect((await calendarOf(a1, fx.e1.id, { from: '2027-01-01T00:00:00Z', to: '2027-03-04T00:00:00Z' })).status).toBe(200);
  });

  it('unknown expert or a non-expert id is 404', async () => {
    const f = await as(fx.founder);
    expectError(await calendarOf(f, '00000000-0000-4000-8000-000000000000'), 404);
    expectError(await calendarOf(f, fx.a1.id), 404);
  });

  it('only calls overlapping the range are returned', async () => {
    // RANGE is [2027-01-31T00:00Z, 2027-02-07T00:00Z).
    await makeCall(fx, { associate: fx.a1, expert: fx.e2, status: 'scheduled', scheduledAt: '2027-01-30T23:30:00Z', durationMinutes: 30 }); // ends at from
    await makeCall(fx, { associate: fx.a1, expert: fx.e2, status: 'scheduled', scheduledAt: '2027-02-07T00:00:00Z' }); // starts at to
    const spillIn = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-01-30T23:45:00Z', durationMinutes: 30 });
    const spillOut = await makeCall(fx, { associate: fx.a1, expert: fx.e1, status: 'scheduled', scheduledAt: '2027-02-06T23:45:00Z', durationMinutes: 30 });
    const a1 = await as(fx.a1);
    expect(ids((await calendarOf(a1, fx.e1.id)).body.calls)).toEqual(ids([spillIn, spillOut]));
    expect(ids((await calendarOf(a1, fx.e2.id)).body.calls)).toEqual([]);
    expect(ids((await calendarOf(a1)).body.calls)).toEqual(ids([spillIn, spillOut]));
  });
});

describe('GET /calendar/experts', () => {
  it('is 403 for experts', async () => {
    expectError(await (await as(fx.e1)).get('/calendar/experts', RANGE), 403, 'forbidden');
  });

  it('associate gets one column per active expert with the same privacy rules', async () => {
    const w = await seedExpertWeek();
    await prisma.user.update({ where: { id: fx.e3.id }, data: { isActive: false } });
    const res = await (await as(fx.a1)).get('/calendar/experts', RANGE);
    expect(res.status, res.text).toBe(200);
    expect(res.body.experts.map((c: { expert: { id: string }; slot: number }) => [c.expert.id, c.slot])).toEqual([
      [fx.e1.id, 0],
      [fx.e2.id, 1],
    ]);
    const col = res.body.experts[0];
    expect(Object.keys(col).sort()).toEqual(['busy', 'calls', 'expert', 'occurrences', 'slot']);
    expect(ids(col.calls)).toEqual([w.c1.id]);
    expect(col.busy).toHaveLength(2);
    expect(col.occurrences).toHaveLength(1);
    expect(ids(res.body.experts[1].calls)).toEqual([w.other.id]);
    expect(res.text).not.toContain('private-block-note');
    expect(res.text).not.toContain('AssocThree');
  });

  it('rejects a range over 62 days', async () => {
    expectError(await (await as(fx.founder)).get('/calendar/experts', { from: '2027-01-01T00:00:00Z', to: '2027-04-01T00:00:00Z' }), 400);
  });
});

// ---------------------------------------------------------------------------

const seriesBody = (over: Record<string, unknown> = {}) => ({
  kind: 'unavailable',
  startDate: '2027-02-01',
  startMinute: 540,
  durationMinutes: 60,
  repeat: { frequency: 'weekly', weekdays: [3, 1], untilDate: '2027-02-28' },
  note: 'gym',
  ...over,
});
const d = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const rowsOf = (expertId: string) =>
  prisma.scheduleBlock.findMany({ where: { expertId }, orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] });

describe('POST /experts/:expertId/schedule-blocks', () => {
  it('expert creates their own block in their zone, normalised', async () => {
    const res = await (await as(fx.e1)).post(`/experts/${fx.e1.id}/schedule-blocks`, seriesBody());
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      expertId: fx.e1.id,
      timeZone: 'Asia/Seoul',
      kind: 'unavailable',
      startDate: '2027-02-01',
      repeat: { frequency: 'weekly', weekdays: [1, 3], untilDate: '2027-02-28', monthDay: null },
      exceptionDates: [],
      note: 'gym',
    });
    const [row] = await rowsOf(fx.e1.id);
    expect(row).toMatchObject({ createdById: fx.e1.id, weekdays: [1, 3], timeZone: 'Asia/Seoul' });
  });

  it('expert cannot create a block for another expert', async () => {
    const res = await (await as(fx.e1)).post(`/experts/${fx.e2.id}/schedule-blocks`, seriesBody());
    expect([403, 404]).toContain(res.status);
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it.each(['a1', 'm1'] as const)('%s cannot create blocks', async (who) => {
    expectError(await (await as(fx[who])).post(`/experts/${fx.e1.id}/schedule-blocks`, seriesBody()), 403);
  });

  it('founder creates a block for any expert', async () => {
    const res = await (await as(fx.founder)).post(`/experts/${fx.e2.id}/schedule-blocks`, seriesBody({ allDay: true, repeat: { frequency: 'none' } }));
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ timeZone: 'Europe/London', allDay: true, startMinute: 0, durationMinutes: 1440 });
    expect((await rowsOf(fx.e2.id))[0]!.createdById).toBe(fx.founder.id);
  });

  it('a non-expert target is 404', async () => {
    expectError(await (await as(fx.founder)).post(`/experts/${fx.a1.id}/schedule-blocks`, seriesBody()), 404);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['weekly without weekdays', { repeat: { frequency: 'weekly', weekdays: [], untilDate: '2027-02-28' } }, 'repeat.weekdays'],
    ['repeating without end', { repeat: { frequency: 'daily' } }, 'repeat.untilDate'],
    ['series longer than 1096 days', { repeat: { frequency: 'daily', untilDate: '2030-02-02' } }, 'repeat.untilDate'],
    ['duration too short', { durationMinutes: 4 }, 'durationMinutes'],
    ['start minute too late', { startMinute: 1440 }, 'startMinute'],
    ['interval 100', { repeat: { frequency: 'daily', interval: 100, untilDate: '2027-02-28' } }, 'repeat.interval'],
  ])('%s is 400', async (_name, over, path) => {
    const res = await (await as(fx.e1)).post(`/experts/${fx.e1.id}/schedule-blocks`, seriesBody(over));
    expectError(res, 400, 'validation_error');
    expect(res.body.error.details.issues.map((i: { path: string }) => i.path)).toContain(path);
  });
});

describe('PATCH /schedule-blocks/:id scopes', () => {
  async function createSeries(client: Client) {
    const res = await client.post(`/experts/${fx.e1.id}/schedule-blocks`, seriesBody());
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  it('scope this: excludes the date and creates a one-off row', async () => {
    const e1 = await as(fx.e1);
    const id = await createSeries(e1);
    const res = await e1.patch(`/schedule-blocks/${id}`, { scope: 'this', occurrenceDate: '2027-02-10', changes: { startMinute: 600, note: 'dentist' } });
    expect(res.status, res.text).toBe(200);
    expect(res.body.updated).toMatchObject({ id, exceptionDates: ['2027-02-10'], startMinute: 540 });
    expect(res.body.deleted).toEqual([]);
    expect(res.body.created).toHaveLength(1);

    const rows = await rowsOf(fx.e1.id);
    expect(rows).toHaveLength(2);
    const original = rows.find((r) => r.id === id)!;
    const oneOff = rows.find((r) => r.id !== id)!;
    expect(original).toMatchObject({ exceptionDates: ['2027-02-10'], startMinute: 540, frequency: 'weekly', note: 'gym' });
    expect(d(original.untilDate)).toBe('2027-02-28');
    expect(oneOff).toMatchObject({ frequency: 'none', startMinute: 600, note: 'dentist', weekdays: [], exceptionDates: [], expertId: fx.e1.id });
    expect(d(oneOff.startDate)).toBe('2027-02-10');
    expect(oneOff.untilDate).toBeNull();

    const cal = await calendarOf(e1, undefined, { from: '2027-02-09T00:00:00Z', to: '2027-02-12T00:00:00Z' });
    expect(cal.body.occurrences.map((o: { date: string; startsAt: string; isRecurring: boolean }) => [o.date, o.startsAt, o.isRecurring])).toEqual([
      ['2027-02-10', '2027-02-10T01:00:00Z', false],
    ]);
  });

  it('scope following: truncates the original and inserts the tail', async () => {
    const e1 = await as(fx.e1);
    const id = await createSeries(e1);
    const res = await e1.patch(`/schedule-blocks/${id}`, { scope: 'following', occurrenceDate: '2027-02-15', changes: { durationMinutes: 30 } });
    expect(res.status, res.text).toBe(200);
    const rows = await rowsOf(fx.e1.id);
    expect(rows).toHaveLength(2);
    const [head, tail] = rows;
    expect(head!.id).toBe(id);
    expect(d(head!.untilDate)).toBe('2027-02-14');
    expect(head!.durationMinutes).toBe(60);
    expect(d(tail!.startDate)).toBe('2027-02-15');
    expect(d(tail!.untilDate)).toBe('2027-02-28');
    expect(tail).toMatchObject({ durationMinutes: 30, frequency: 'weekly', weekdays: [1, 3] });
  });

  it('scope all: updates the single row in place', async () => {
    const e1 = await as(fx.e1);
    const id = await createSeries(e1);
    const res = await e1.patch(`/schedule-blocks/${id}`, { scope: 'all', changes: { kind: 'available', repeat: { weekdays: [5] } } });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ updated: { id, kind: 'available' }, created: [], deleted: [] });
    const rows = await rowsOf(fx.e1.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, kind: 'available', weekdays: [5] });
  });

  it('scope this/following need a date that belongs to the series', async () => {
    const e1 = await as(fx.e1);
    const id = await createSeries(e1);
    expectError(await e1.patch(`/schedule-blocks/${id}`, { scope: 'this', changes: { startMinute: 600 } }), 400);
    expectError(await e1.patch(`/schedule-blocks/${id}`, { scope: 'following', occurrenceDate: '2027-02-02', changes: { startMinute: 600 } }), 400);
    expect(await prisma.scheduleBlock.count()).toBe(1);
  });

  it('an edit producing an invalid block is 400 and changes nothing', async () => {
    const e1 = await as(fx.e1);
    const id = await createSeries(e1);
    expectError(await e1.patch(`/schedule-blocks/${id}`, { scope: 'all', changes: { durationMinutes: 2 } }), 400);
    expect((await prisma.scheduleBlock.findUniqueOrThrow({ where: { id } })).durationMinutes).toBe(60);
  });

  it('other experts and non-founders cannot see the block (404); the founder can edit it', async () => {
    const id = await createSeries(await as(fx.e1));
    expectError(await (await as(fx.e2)).patch(`/schedule-blocks/${id}`, { changes: { note: 'x' } }), 404);
    expectError(await (await as(fx.a1)).patch(`/schedule-blocks/${id}`, { changes: { note: 'x' } }), 404);
    expectError(await (await as(fx.e2)).delete(`/schedule-blocks/${id}`), 404);
    const res = await (await as(fx.founder)).patch(`/schedule-blocks/${id}`, { changes: { note: 'founder note' } });
    expect(res.status).toBe(200);
    expect((await prisma.scheduleBlock.findUniqueOrThrow({ where: { id } })).note).toBe('founder note');
  });

  it('editing the only date of a series with scope this removes the series row', async () => {
    const e1 = await as(fx.e1);
    const created = await e1.post(`/experts/${fx.e1.id}/schedule-blocks`, seriesBody({ repeat: { frequency: 'daily', untilDate: '2027-02-01' } }));
    const id = created.body.id;
    const res = await e1.patch(`/schedule-blocks/${id}`, { scope: 'this', occurrenceDate: '2027-02-01', changes: { startMinute: 720 } });
    expect(res.status, res.text).toBe(200);
    expect(res.body.updated).toBeNull();
    expect(res.body.deleted).toEqual([id]);
    const rows = await rowsOf(fx.e1.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ frequency: 'none', startMinute: 720 });
  });
});

describe('DELETE /schedule-blocks/:id scopes', () => {
  async function createSeries(over: Record<string, unknown> = {}) {
    const e1 = await as(fx.e1);
    const res = await e1.post(`/experts/${fx.e1.id}/schedule-blocks`, seriesBody(over));
    expect(res.status, res.text).toBe(201);
    return { e1, id: res.body.id as string };
  }

  it('scope this adds an exception date', async () => {
    const { e1, id } = await createSeries();
    const res = await e1.delete(`/schedule-blocks/${id}`, { scope: 'this', date: '2027-02-03' });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ updated: { id, exceptionDates: ['2027-02-03'] }, deleted: [], created: [] });
    expect((await prisma.scheduleBlock.findUniqueOrThrow({ where: { id } })).exceptionDates).toEqual(['2027-02-03']);
  });

  it('scope following truncates the series', async () => {
    const { e1, id } = await createSeries();
    expect((await e1.delete(`/schedule-blocks/${id}`, { scope: 'following', date: '2027-02-15' })).status).toBe(200);
    expect(d((await prisma.scheduleBlock.findUniqueOrThrow({ where: { id } })).untilDate)).toBe('2027-02-14');
  });

  it('scope following from the first date removes the row', async () => {
    const { e1, id } = await createSeries();
    const res = await e1.delete(`/schedule-blocks/${id}`, { scope: 'following', date: '2027-02-01' });
    expect(res.body).toEqual({ updated: null, deleted: [id], created: [] });
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('scope all removes the row', async () => {
    const { e1, id } = await createSeries();
    const res = await e1.delete(`/schedule-blocks/${id}`, { scope: 'all' });
    expect(res.body).toEqual({ updated: null, deleted: [id], created: [] });
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('deleting the last remaining date removes the series', async () => {
    const { e1, id } = await createSeries({ repeat: { frequency: 'daily', untilDate: '2027-02-02' } });
    const first = await e1.delete(`/schedule-blocks/${id}`, { scope: 'this', date: '2027-02-01' });
    expect(first.body.updated).toMatchObject({ exceptionDates: ['2027-02-01'] });
    expect(await prisma.scheduleBlock.count()).toBe(1);
    const last = await e1.delete(`/schedule-blocks/${id}`, { scope: 'this', date: '2027-02-02' });
    expect(last.status).toBe(200);
    expect(last.body).toEqual({ updated: null, deleted: [id], created: [] });
    expect(await prisma.scheduleBlock.count()).toBe(0);
  });

  it('scope this needs a date of the series', async () => {
    const { e1, id } = await createSeries();
    expectError(await e1.delete(`/schedule-blocks/${id}`, { scope: 'this' }), 400);
    expectError(await e1.delete(`/schedule-blocks/${id}`, { scope: 'this', date: '2027-02-02' }), 400);
    expect(await prisma.scheduleBlock.count()).toBe(1);
  });

  it('a non-repeating block is deleted regardless of scope', async () => {
    const { e1, id } = await createSeries({ repeat: { frequency: 'none' } });
    const res = await e1.delete(`/schedule-blocks/${id}`, { scope: 'this', date: '2027-02-01' });
    expect(res.body.deleted).toEqual([id]);
  });
});
