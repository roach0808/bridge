import { describe, expect, it } from 'vitest';
import { NO_REPEAT, deleteBlock, editBlock, expandBlock, validateBlock, type BlockRule } from '../src';
import { dates, rule } from './helpers';

/** Mon–Fri 09:00–10:00 for two weeks: Jan 5–9 and Jan 12–16, 2026. */
const series = (extra: Partial<BlockRule> = {}): BlockRule => ({
  ...rule({ id: 'series-1', startDate: '2026-01-05', repeat: { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], untilDate: '2026-01-16' } }),
  ...extra,
});
const ALL_DATES = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16'];
const span = (r: BlockRule | null | undefined) => (r ? dates(r, '2026-01-01', '2026-02-01') : []);

describe('editBlock: non-repeating', () => {
  it.each(['this', 'following', 'all'] as const)('scope %s just changes the block in place', (scope) => {
    const res = editBlock(rule({ id: 'one' }), scope, { startMinute: 600, note: 'moved' }, '2026-01-05');
    expect(res.created).toEqual([]);
    expect(res.original).toMatchObject({ id: 'one', startMinute: 600, note: 'moved', startDate: '2026-01-05' });
  });

  it('changing kind and duration', () => {
    const res = editBlock(rule(), 'all', { kind: 'available', durationMinutes: 30 });
    expect(res.original).toMatchObject({ kind: 'available', durationMinutes: 30 });
  });

  it('undefined change values do not overwrite fields', () => {
    const res = editBlock(rule({ startMinute: 420 }), 'all', { startMinute: undefined, durationMinutes: 90 });
    expect(res.original).toMatchObject({ startMinute: 420, durationMinutes: 90 });
  });

  it('turning a single block into a series', () => {
    const res = editBlock(rule(), 'all', { repeat: { frequency: 'daily', untilDate: '2026-01-07' } });
    expect(span(res.original)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
  });

  it('switching to all-day is normalised', () => {
    const res = editBlock(rule(), 'all', { allDay: true });
    expect(res.original).toMatchObject({ allDay: true, startMinute: 0, durationMinutes: 1440 });
  });
});

describe('editBlock: scope all', () => {
  it('applies to the whole series and keeps the id', () => {
    const res = editBlock(series(), 'all', { startMinute: 13 * 60 }, '2026-01-07');
    expect(res.created).toEqual([]);
    expect(res.original).toMatchObject({ id: 'series-1', startMinute: 780 });
    expect(span(res.original)).toEqual(ALL_DATES);
  });

  it('keeps existing exception dates', () => {
    const res = editBlock(series({ exceptionDates: ['2026-01-07'] }), 'all', { durationMinutes: 30 });
    expect(res.original!.exceptionDates).toEqual(['2026-01-07']);
  });

  it('merges partial repeat changes', () => {
    const res = editBlock(series(), 'all', { repeat: { weekdays: [2, 4] } });
    expect(res.original!.repeat).toMatchObject({ frequency: 'weekly', weekdays: [2, 4], untilDate: '2026-01-16' });
    expect(span(res.original)).toEqual(['2026-01-06', '2026-01-08', '2026-01-13', '2026-01-15']);
  });

  it('removes the series when the change leaves no dates', () => {
    const res = editBlock(series({ exceptionDates: ['2026-01-10'] }), 'all', { repeat: { weekdays: [6], untilDate: '2026-01-10' } });
    expect(res).toEqual({ original: null, created: [] });
  });

  it('a missing occurrence date means all', () => {
    const res = editBlock(series(), 'this', { note: 'x' });
    expect(res.created).toEqual([]);
    expect(res.original).toMatchObject({ id: 'series-1', note: 'x' });
    expect(span(res.original)).toEqual(ALL_DATES);
  });
});

describe('editBlock: scope this', () => {
  it('excludes the date from the series and creates a one-off with the change', () => {
    const res = editBlock(series(), 'this', { startMinute: 14 * 60, durationMinutes: 30 }, '2026-01-07');
    expect(res.original).toMatchObject({ id: 'series-1', startMinute: 540, exceptionDates: ['2026-01-07'] });
    expect(span(res.original)).toEqual(ALL_DATES.filter((d) => d !== '2026-01-07'));
    expect(res.created).toHaveLength(1);
    const [oneOff] = res.created;
    expect(oneOff!.id).toBeUndefined();
    expect(oneOff).toMatchObject({ startDate: '2026-01-07', startMinute: 840, durationMinutes: 30, exceptionDates: [] });
    expect(oneOff!.repeat).toEqual(NO_REPEAT);
    expect(expandBlock(oneOff!, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toEqual([
      expect.objectContaining({ date: '2026-01-07', startsAt: '2026-01-07T14:00:00Z', endsAt: '2026-01-07T14:30:00Z', isRecurring: false }),
    ]);
  });

  it('the one-off ignores repeat changes', () => {
    const res = editBlock(series(), 'this', { repeat: { frequency: 'daily', untilDate: '2026-03-01' } }, '2026-01-07');
    expect(res.created[0]!.repeat).toEqual(NO_REPEAT);
  });

  it('keeps previous exceptions and adds the new one sorted', () => {
    const res = editBlock(series({ exceptionDates: ['2026-01-14'] }), 'this', { note: 'n' }, '2026-01-06');
    expect(res.original!.exceptionDates).toEqual(['2026-01-06', '2026-01-14']);
  });

  it('editing the only remaining date removes the series but still creates the one-off', () => {
    const r = series({ exceptionDates: ALL_DATES.filter((d) => d !== '2026-01-09') });
    const res = editBlock(r, 'this', { kind: 'available' }, '2026-01-09');
    expect(res.original).toBeNull();
    expect(res.created).toEqual([expect.objectContaining({ startDate: '2026-01-09', kind: 'available' })]);
  });

  it('the results are valid blocks', () => {
    const res = editBlock(series(), 'this', { startMinute: 600 }, '2026-01-12');
    for (const r of [res.original!, ...res.created]) expect(validateBlock(r)).toEqual([]);
  });
});

describe('editBlock: scope following', () => {
  it('splits the series: the head ends the day before, the tail starts on the date with the change', () => {
    const res = editBlock(series(), 'following', { startMinute: 15 * 60 }, '2026-01-12');
    expect(res.original).toMatchObject({ id: 'series-1', startMinute: 540 });
    expect(res.original!.repeat.untilDate).toBe('2026-01-11');
    expect(span(res.original)).toEqual(ALL_DATES.slice(0, 5));
    expect(res.created).toHaveLength(1);
    const [tail] = res.created;
    expect(tail!.id).toBeUndefined();
    expect(tail).toMatchObject({ startDate: '2026-01-12', startMinute: 900 });
    expect(tail!.repeat).toMatchObject({ frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], untilDate: '2026-01-16' });
    expect(span(tail)).toEqual(ALL_DATES.slice(5));
  });

  it('together head and tail cover exactly the original dates', () => {
    const res = editBlock(series(), 'following', { note: 'x' }, '2026-01-08');
    expect([...span(res.original), ...span(res.created[0])]).toEqual(ALL_DATES);
  });

  it('splits exception dates between head and tail', () => {
    const res = editBlock(series({ exceptionDates: ['2026-01-06', '2026-01-13'] }), 'following', { note: 'x' }, '2026-01-12');
    expect(res.original!.exceptionDates).toEqual(['2026-01-06']);
    expect(res.created[0]!.exceptionDates).toEqual(['2026-01-13']);
  });

  it('on the first date it behaves like all', () => {
    const res = editBlock(series(), 'following', { startMinute: 600 }, '2026-01-05');
    expect(res.created).toEqual([]);
    expect(res.original).toMatchObject({ id: 'series-1', startMinute: 600, startDate: '2026-01-05' });
  });

  it('removes the head when no earlier dates are left', () => {
    const r = series({ exceptionDates: ['2026-01-05'] });
    const res = editBlock(r, 'following', { startMinute: 600 }, '2026-01-06');
    expect(res.original).toBeNull();
    expect(span(res.created[0])).toEqual(ALL_DATES.slice(1));
  });

  it('drops the tail when the change leaves it without dates', () => {
    const res = editBlock(series(), 'following', { repeat: { weekdays: [6] } }, '2026-01-16');
    expect(span(res.original)).toEqual(ALL_DATES.slice(0, 9));
    expect(res.created).toEqual([]);
  });

  it('keeps the phase of an every-2-days series', () => {
    const r = rule({ id: 'd', startDate: '2026-01-01', repeat: { frequency: 'daily', interval: 2, untilDate: '2026-01-11' } });
    const res = editBlock(r, 'following', { durationMinutes: 15 }, '2026-01-05');
    expect(span(res.original)).toEqual(['2026-01-01', '2026-01-03']);
    expect(span(res.created[0])).toEqual(['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-11']);
  });

  it('works for a monthly by-position series', () => {
    const r = rule({ id: 'm', startDate: '2026-01-01', repeat: { frequency: 'monthly', setPosition: -1, weekday: 5, untilDate: '2026-06-30' } });
    const res = editBlock(r, 'following', { startMinute: 0 }, '2026-04-24');
    expect(dates(res.original!, '2026-01-01', '2026-07-01')).toEqual(['2026-01-30', '2026-02-27', '2026-03-27']);
    expect(dates(res.created[0]!, '2026-01-01', '2026-07-01')).toEqual(['2026-04-24', '2026-05-29', '2026-06-26']);
  });
});

describe('deleteBlock', () => {
  it.each(['this', 'following', 'all'] as const)('a non-repeating block is removed for scope %s', (scope) => {
    expect(deleteBlock(rule(), scope, '2026-01-05')).toEqual({ original: null, created: [] });
  });

  it('scope all removes the series', () => {
    expect(deleteBlock(series(), 'all', '2026-01-07')).toEqual({ original: null, created: [] });
  });

  it('scope this adds an exception date', () => {
    const res = deleteBlock(series(), 'this', '2026-01-07');
    expect(res.created).toEqual([]);
    expect(res.original).toMatchObject({ id: 'series-1', exceptionDates: ['2026-01-07'] });
    expect(span(res.original)).toEqual(ALL_DATES.filter((d) => d !== '2026-01-07'));
  });

  it('scope this on the last remaining date removes the series', () => {
    const r = series({ exceptionDates: ALL_DATES.slice(1) });
    expect(deleteBlock(r, 'this', '2026-01-05')).toEqual({ original: null, created: [] });
  });

  it('scope following truncates the series', () => {
    const res = deleteBlock(series({ exceptionDates: ['2026-01-06', '2026-01-14'] }), 'following', '2026-01-13');
    expect(res.created).toEqual([]);
    expect(res.original!.repeat.untilDate).toBe('2026-01-12');
    expect(res.original!.exceptionDates).toEqual(['2026-01-06']);
    expect(span(res.original)).toEqual(['2026-01-05', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12']);
  });

  it('scope following from the first date removes the series', () => {
    expect(deleteBlock(series(), 'following', '2026-01-05')).toEqual({ original: null, created: [] });
  });

  it('scope following removes the series when no earlier dates remain', () => {
    const r = series({ exceptionDates: ['2026-01-05'] });
    expect(deleteBlock(r, 'following', '2026-01-06')).toEqual({ original: null, created: [] });
  });

  it('does not mutate the input rule', () => {
    const r = series();
    deleteBlock(r, 'this', '2026-01-07');
    editBlock(r, 'following', { note: 'x' }, '2026-01-12');
    expect(r).toEqual(series());
  });
});
