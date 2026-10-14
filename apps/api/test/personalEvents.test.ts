import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { as, expectError, prisma, seedFixtures, type Client, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const RANGE = { from: '2027-02-01T00:00:00Z', to: '2027-03-01T00:00:00Z' };

/** Mondays and Wednesdays at 9:00 AM in the Founder's zone (New York), through February. */
const weekly = (over: Record<string, unknown> = {}) => ({
  title: 'Board prep',
  startDate: '2027-02-01',
  startMinute: 540,
  durationMinutes: 60,
  repeat: { frequency: 'weekly', weekdays: [3, 1], untilDate: '2027-02-28' },
  note: 'bring the numbers',
  ...over,
});

const d = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const rows = () => prisma.personalEvent.findMany({ orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] });

async function createSeries(client: Client, over: Record<string, unknown> = {}) {
  const res = await client.post('/personal-events', weekly(over));
  expect(res.status, res.text).toBe(201);
  return res.body.id as string;
}

describe('POST /personal-events', () => {
  it('the Founder adds an event in their own zone, normalised', async () => {
    const res = await (await as(fx.founder)).post('/personal-events', weekly());
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Board prep',
      timeZone: 'America/New_York',
      startDate: '2027-02-01',
      startMinute: 540,
      repeat: { frequency: 'weekly', weekdays: [1, 3], untilDate: '2027-02-28', monthDay: null },
      exceptionDates: [],
      note: 'bring the numbers',
    });
    expect(res.body).not.toHaveProperty('kind');
    const [row] = await rows();
    expect(row).toMatchObject({ ownerId: fx.founder.id, title: 'Board prep', weekdays: [1, 3] });
  });

  it('an all-day event takes the whole day', async () => {
    const res = await (await as(fx.founder)).post('/personal-events', weekly({ allDay: true, repeat: { frequency: 'none' } }));
    expect(res.status, res.text).toBe(201);
    expect(res.body).toMatchObject({ allDay: true, startMinute: 0, durationMinutes: 1440, repeat: { frequency: 'none', untilDate: null } });
  });

  it.each(['m1', 'a1', 'e1'] as const)('%s has no personal calendar (403)', async (who) => {
    const client = await as(fx[who]);
    expectError(await client.post('/personal-events', weekly()), 403);
    expectError(await client.get('/personal-events', RANGE), 403);
    expect(await prisma.personalEvent.count()).toBe(0);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['no title', { title: '   ' }, 'title'],
    ['weekly without weekdays', { repeat: { frequency: 'weekly', weekdays: [], untilDate: '2027-02-28' } }, 'repeat.weekdays'],
    ['repeating without end', { repeat: { frequency: 'daily' } }, 'repeat.untilDate'],
    ['duration too short', { durationMinutes: 4 }, 'durationMinutes'],
  ])('%s is 400', async (_name, over, path) => {
    const res = await (await as(fx.founder)).post('/personal-events', weekly(over));
    expectError(res, 400, 'validation_error');
    expect(res.body.error.details.issues.map((i: { path: string }) => i.path)).toContain(path);
  });
});

describe('GET /personal-events', () => {
  it('expands the Founder’s events for the range, in their zone across daylight saving', async () => {
    const founder = await as(fx.founder);
    const id = await createSeries(founder, { startDate: '2027-03-08', repeat: { frequency: 'weekly', weekdays: [1], untilDate: '2027-03-22' } });
    const res = await founder.get('/personal-events', { from: '2027-03-01T00:00:00Z', to: '2027-03-31T00:00:00Z' });
    expect(res.status, res.text).toBe(200);
    // 9:00 AM New York stays 9:00 AM when the clocks change on March 14.
    expect(res.body.occurrences).toEqual([
      { eventId: id, date: '2027-03-08', startsAt: '2027-03-08T14:00:00Z', endsAt: '2027-03-08T15:00:00Z', allDay: false, isRecurring: true },
      { eventId: id, date: '2027-03-15', startsAt: '2027-03-15T13:00:00Z', endsAt: '2027-03-15T14:00:00Z', allDay: false, isRecurring: true },
      { eventId: id, date: '2027-03-22', startsAt: '2027-03-22T13:00:00Z', endsAt: '2027-03-22T14:00:00Z', allDay: false, isRecurring: true },
    ]);
    expect(res.body.events).toEqual([expect.objectContaining({ id, title: 'Board prep', note: 'bring the numbers' })]);
  });

  it('leaves out events outside the range', async () => {
    const founder = await as(fx.founder);
    await createSeries(founder, { startDate: '2027-04-05', repeat: { frequency: 'none' } });
    const res = await founder.get('/personal-events', RANGE);
    expect(res.body).toMatchObject({ occurrences: [], events: [] });
  });

  it('shows only the asker’s own events', async () => {
    // Someone else's row, as if the calendar is opened to more people later.
    await prisma.personalEvent.create({
      data: { ownerId: fx.m1.id, title: 'Not yours', timeZone: 'America/New_York', startDate: new Date('2027-02-02T00:00:00Z'), startMinute: 600, durationMinutes: 30 },
    });
    const res = await (await as(fx.founder)).get('/personal-events', RANGE);
    expect(res.status, res.text).toBe(200);
    expect(res.body.occurrences).toEqual([]);
    expect(res.text).not.toContain('Not yours');
  });

  it('a range over 62 days is 400', async () => {
    expectError(await (await as(fx.founder)).get('/personal-events', { from: RANGE.from, to: '2027-05-01T00:00:00Z' }), 400);
  });

  it('never shows on the Experts’ or anyone else’s calendar', async () => {
    await createSeries(await as(fx.founder));
    for (const client of [await as(fx.e1), await as(fx.a1), await as(fx.m1)]) {
      const res = await client.get('/calendar', { from: RANGE.from, to: '2027-02-08T00:00:00Z' });
      expect(res.status, res.text).toBe(200);
      expect(res.text).not.toContain('Board prep');
    }
  });
});

describe('PATCH /personal-events/:id', () => {
  it('scope this: the series keeps its title, the one-off takes the new one', async () => {
    const founder = await as(fx.founder);
    const id = await createSeries(founder);
    const res = await founder.patch(`/personal-events/${id}`, {
      scope: 'this',
      occurrenceDate: '2027-02-10',
      changes: { title: 'Investor call', startMinute: 600 },
    });
    expect(res.status, res.text).toBe(200);
    expect(res.body.updated).toMatchObject({ id, title: 'Board prep', exceptionDates: ['2027-02-10'], startMinute: 540 });
    expect(res.body.created).toEqual([expect.objectContaining({ title: 'Investor call', startDate: '2027-02-10', startMinute: 600, repeat: expect.objectContaining({ frequency: 'none' }) })]);
    expect(await prisma.personalEvent.count()).toBe(2);
  });

  it('scope following: the head keeps its title, the tail is renamed', async () => {
    const founder = await as(fx.founder);
    const id = await createSeries(founder);
    const res = await founder.patch(`/personal-events/${id}`, { scope: 'following', occurrenceDate: '2027-02-15', changes: { title: 'Weekly review' } });
    expect(res.status, res.text).toBe(200);
    const [head, tail] = await rows();
    expect(head).toMatchObject({ id, title: 'Board prep' });
    expect(d(head!.untilDate)).toBe('2027-02-14');
    expect(tail).toMatchObject({ title: 'Weekly review', frequency: 'weekly', weekdays: [1, 3] });
    expect(d(tail!.startDate)).toBe('2027-02-15');
  });

  it('scope all renames the whole series in place', async () => {
    const founder = await as(fx.founder);
    const id = await createSeries(founder);
    const res = await founder.patch(`/personal-events/${id}`, { scope: 'all', changes: { title: 'Board prep (moved)', startMinute: 600, note: null } });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ updated: { id, title: 'Board prep (moved)', startMinute: 600, note: null }, deleted: [], created: [] });
  });

  it('a one-off event is edited in place whatever the scope', async () => {
    const founder = await as(fx.founder);
    const id = await createSeries(founder, { repeat: { frequency: 'none' } });
    const res = await founder.patch(`/personal-events/${id}`, { scope: 'this', changes: { title: 'Dentist' } });
    expect(res.status, res.text).toBe(200);
    expect(res.body.updated).toMatchObject({ id, title: 'Dentist' });
    expect(await prisma.personalEvent.count()).toBe(1);
  });

  it('scope this needs a date of the series', async () => {
    const founder = await as(fx.founder);
    const id = await createSeries(founder);
    expectError(await founder.patch(`/personal-events/${id}`, { scope: 'this', changes: { title: 'x' } }), 400);
    expectError(await founder.patch(`/personal-events/${id}`, { scope: 'this', occurrenceDate: '2027-02-02', changes: { title: 'x' } }), 400);
  });

  it('an empty title is 400 and changes nothing', async () => {
    const founder = await as(fx.founder);
    const id = await createSeries(founder);
    expectError(await founder.patch(`/personal-events/${id}`, { scope: 'all', changes: { title: '' } }), 400, 'validation_error');
    expect((await prisma.personalEvent.findUniqueOrThrow({ where: { id } })).title).toBe('Board prep');
  });

  it('someone else’s event is 404', async () => {
    const row = await prisma.personalEvent.create({
      data: { ownerId: fx.m1.id, title: 'Not yours', timeZone: 'America/New_York', startDate: new Date('2027-02-02T00:00:00Z'), startMinute: 600, durationMinutes: 30 },
    });
    const founder = await as(fx.founder);
    expectError(await founder.patch(`/personal-events/${row.id}`, { changes: { title: 'Mine now' } }), 404);
    expectError(await founder.delete(`/personal-events/${row.id}`), 404);
    expect((await prisma.personalEvent.findUniqueOrThrow({ where: { id: row.id } })).title).toBe('Not yours');
  });
});

describe('DELETE /personal-events/:id', () => {
  it('scope this removes one date', async () => {
    const founder = await as(fx.founder);
    const id = await createSeries(founder);
    const res = await founder.delete(`/personal-events/${id}`, { scope: 'this', date: '2027-02-03' });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ updated: { id, title: 'Board prep', exceptionDates: ['2027-02-03'] }, deleted: [], created: [] });
  });

  it('scope all removes the event', async () => {
    const founder = await as(fx.founder);
    const id = await createSeries(founder);
    const res = await founder.delete(`/personal-events/${id}`, { scope: 'all' });
    expect(res.body).toEqual({ updated: null, deleted: [id], created: [] });
    expect(await prisma.personalEvent.count()).toBe(0);
  });

  it('is in the audit trail without the event’s details', async () => {
    const founder = await as(fx.founder);
    const id = await createSeries(founder);
    await founder.delete(`/personal-events/${id}`, { scope: 'all' });
    // The trail is written after the response, so give it a moment to land.
    const where = { action: { startsWith: 'personal_event' } };
    for (let i = 0; i < 60 && (await prisma.auditLog.count({ where })) < 2; i++) await new Promise((r) => setTimeout(r, 25));
    const entries = await prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } });
    expect(entries.map((e) => [e.action, e.summary])).toEqual([
      ['personal_event.create', 'added an event to their own calendar'],
      ['personal_event.delete', 'removed an event from their own calendar'],
    ]);
    expect(JSON.stringify(entries)).not.toContain('Board prep');
  });
});
