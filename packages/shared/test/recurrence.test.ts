import { describe, expect, it } from 'vitest';
import {
  expandBlock,
  expandBlocks,
  hasAnyOccurrence,
  occurrenceBounds,
  occursOn,
  type BlockRule,
} from '../src';
import { dates, eachDate, rule } from './helpers';

// ---------------------------------------------------------------------------
// An independent, deliberately naive oracle built on plain JS Dates.

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoWeekday = (iso: string) => ((new Date(ms(iso)).getUTCDay() + 6) % 7) + 1;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function oracle(r: BlockRule, iso: string): boolean {
  if (iso < r.startDate || r.exceptionDates.includes(iso)) return false;
  const rp = r.repeat;
  if (rp.frequency === 'none') return iso === r.startDate;
  if (rp.untilDate && iso > rp.untilDate) return false;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const [sy, sm, sd] = r.startDate.split('-').map(Number) as [number, number, number];
  const dayMatch = () => {
    if (rp.setPosition != null && rp.weekday != null) {
      if (isoWeekday(iso) !== rp.weekday) return false;
      if (rp.setPosition === -1) return d + 7 > daysInMonth(y, m);
      return Math.floor((d - 1) / 7) + 1 === rp.setPosition;
    }
    return d === (rp.monthDay ?? sd);
  };
  switch (rp.frequency) {
    case 'daily':
      return Math.round((ms(iso) - ms(r.startDate)) / DAY) % rp.interval === 0;
    case 'weekly': {
      const wds = rp.weekdays.length ? rp.weekdays : [isoWeekday(r.startDate)];
      if (!wds.includes(isoWeekday(iso))) return false;
      const monday = (s: string) => ms(s) - (isoWeekday(s) - 1) * DAY;
      return Math.round((monday(iso) - monday(r.startDate)) / (7 * DAY)) % rp.interval === 0;
    }
    case 'monthly':
      return ((y - sy) * 12 + (m - sm)) % rp.interval === 0 && dayMatch();
    case 'yearly':
      return (y - sy) % rp.interval === 0 && m === (rp.month ?? sm) && dayMatch();
  }
}

const ORACLE_RULES: Array<[string, BlockRule]> = [
  ['daily every 1', rule({ startDate: '2026-01-01', repeat: { frequency: 'daily', untilDate: '2026-12-31' } })],
  ['daily every 3', rule({ startDate: '2026-01-02', repeat: { frequency: 'daily', interval: 3, untilDate: '2027-06-30' } })],
  ['daily every 10 with exceptions', rule({ startDate: '2026-02-01', exceptionDates: ['2026-02-11', '2026-03-03'], repeat: { frequency: 'daily', interval: 10, untilDate: '2026-12-31' } })],
  ['weekly weekdays', rule({ startDate: '2026-01-01', repeat: { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], untilDate: '2026-12-31' } })],
  ['weekly every 2 Mon/Wed from a Wednesday', rule({ startDate: '2026-01-07', repeat: { frequency: 'weekly', interval: 2, weekdays: [1, 3], untilDate: '2027-01-07' } })],
  ['weekly every 3 on Sunday', rule({ startDate: '2026-03-04', repeat: { frequency: 'weekly', interval: 3, weekdays: [7], untilDate: '2027-03-04' } })],
  ['weekly every 4 Sat/Sun', rule({ startDate: '2026-05-16', repeat: { frequency: 'weekly', interval: 4, weekdays: [6, 7], untilDate: '2027-05-16' } })],
  ['monthly day 31', rule({ startDate: '2026-01-31', repeat: { frequency: 'monthly', monthDay: 31, untilDate: '2027-12-31' } })],
  ['monthly day 29 every 1', rule({ startDate: '2026-01-29', repeat: { frequency: 'monthly', monthDay: 29, untilDate: '2028-12-31' } })],
  ['monthly every 2 on the 15th', rule({ startDate: '2026-01-15', repeat: { frequency: 'monthly', interval: 2, monthDay: 15, untilDate: '2027-12-31' } })],
  ['monthly 2nd Tuesday', rule({ startDate: '2026-01-01', repeat: { frequency: 'monthly', setPosition: 2, weekday: 2, untilDate: '2027-12-31' } })],
  ['monthly last Friday', rule({ startDate: '2026-01-01', repeat: { frequency: 'monthly', setPosition: -1, weekday: 5, untilDate: '2027-12-31' } })],
  ['monthly 4th Sunday every 3', rule({ startDate: '2026-02-01', repeat: { frequency: 'monthly', interval: 3, setPosition: 4, weekday: 7, untilDate: '2028-12-31' } })],
  ['yearly Sep 14', rule({ startDate: '2026-09-14', repeat: { frequency: 'yearly', month: 9, monthDay: 14, untilDate: '2029-09-14' } })],
  ['yearly Feb 29', rule({ startDate: '2024-02-29', repeat: { frequency: 'yearly', month: 2, monthDay: 29, untilDate: '2027-02-28' } })],
  ['yearly 4th Thursday of November', rule({ startDate: '2026-01-01', repeat: { frequency: 'yearly', month: 11, setPosition: 4, weekday: 4, untilDate: '2028-12-31' } })],
  ['yearly last Monday of May every 2', rule({ startDate: '2026-01-01', repeat: { frequency: 'yearly', interval: 2, month: 5, setPosition: -1, weekday: 1, untilDate: '2028-12-31' } })],
];

describe('occursOn agrees with an independent oracle on every day of the span', () => {
  it.each(ORACLE_RULES)('%s', (_name, r) => {
    const first = r.startDate < '2026-01-01' ? r.startDate : '2025-12-01';
    const mismatches = eachDate(first, '2029-12-31').filter((d) => occursOn(r, d) !== oracle(r, d));
    expect(mismatches).toEqual([]);
  });

  it.each(ORACLE_RULES)('expandBlock over a whole year equals the occursOn dates: %s', (_name, r) => {
    const expected = eachDate('2026-01-01', '2026-12-31').filter((d) => oracle(r, d));
    expect(dates(r, '2026-01-01', '2027-01-01')).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------

describe('non-repeating blocks', () => {
  it('produce exactly one occurrence', () => {
    const occ = expandBlock(rule({ id: 'b1' }), '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(occ).toEqual([
      {
        blockId: 'b1',
        kind: 'unavailable',
        date: '2026-01-05',
        startsAt: '2026-01-05T09:00:00Z',
        endsAt: '2026-01-05T10:00:00Z',
        allDay: false,
        isRecurring: false,
      },
    ]);
  });

  it('blockId is null without an id', () => {
    expect(expandBlock(rule(), '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')[0]!.blockId).toBeNull();
  });

  it('carry the kind', () => {
    expect(expandBlock(rule({ kind: 'available' }), '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')[0]!.kind).toBe('available');
  });

  it('occur only on their start date', () => {
    const r = rule();
    expect(occursOn(r, '2026-01-05')).toBe(true);
    expect(occursOn(r, '2026-01-04')).toBe(false);
    expect(occursOn(r, '2026-01-06')).toBe(false);
    expect(occursOn(r, '2027-01-05')).toBe(false);
  });

  it('ignore a stray untilDate', () => {
    const r = rule({ repeat: { untilDate: '2026-02-01' } });
    expect(dates(r, '2026-01-01', '2026-03-01')).toEqual(['2026-01-05']);
  });

  it('vanish when the start date is an exception', () => {
    expect(dates(rule({ exceptionDates: ['2026-01-05'] }), '2026-01-01', '2026-02-01')).toEqual([]);
  });
});

describe('daily', () => {
  it('every day, until_date inclusive', () => {
    const r = rule({ startDate: '2026-01-05', repeat: { frequency: 'daily', untilDate: '2026-01-09' } });
    expect(dates(r, '2026-01-01', '2026-02-01')).toEqual(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09']);
  });

  it('every 3 days', () => {
    const r = rule({ startDate: '2026-01-01', repeat: { frequency: 'daily', interval: 3, untilDate: '2026-01-15' } });
    expect(dates(r, '2026-01-01', '2026-02-01')).toEqual(['2026-01-01', '2026-01-04', '2026-01-07', '2026-01-10', '2026-01-13']);
  });

  it('every N days keeps its phase across a month boundary and range start', () => {
    const r = rule({ startDate: '2026-01-30', repeat: { frequency: 'daily', interval: 2, untilDate: '2026-03-01' } });
    expect(dates(r, '2026-02-02', '2026-02-07')).toEqual(['2026-02-03', '2026-02-05']);
  });

  it('until date on a non-matching day stops before it', () => {
    const r = rule({ startDate: '2026-01-01', repeat: { frequency: 'daily', interval: 7, untilDate: '2026-01-14' } });
    expect(dates(r, '2026-01-01', '2026-02-01')).toEqual(['2026-01-01', '2026-01-08']);
  });

  it('skips exception dates', () => {
    const r = rule({ startDate: '2026-01-05', exceptionDates: ['2026-01-06', '2026-01-08'], repeat: { frequency: 'daily', untilDate: '2026-01-09' } });
    expect(dates(r, '2026-01-01', '2026-02-01')).toEqual(['2026-01-05', '2026-01-07', '2026-01-09']);
  });

  it('occurrences are marked recurring', () => {
    const r = rule({ repeat: { frequency: 'daily', untilDate: '2026-01-06' } });
    expect(expandBlock(r, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z').every((o) => o.isRecurring)).toBe(true);
  });

  it('nothing before the start date even if the range starts earlier', () => {
    const r = rule({ startDate: '2026-01-10', repeat: { frequency: 'daily', untilDate: '2026-01-11' } });
    expect(dates(r, '2025-12-01', '2026-01-31')).toEqual(['2026-01-10', '2026-01-11']);
  });
});

describe('weekly', () => {
  it('chosen weekdays (Mon, Wed, Fri)', () => {
    const r = rule({ startDate: '2026-01-05', repeat: { frequency: 'weekly', weekdays: [1, 3, 5], untilDate: '2026-01-18' } });
    expect(dates(r, '2026-01-01', '2026-02-01')).toEqual(['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12', '2026-01-14', '2026-01-16']);
  });

  it('every 2 weeks on Mon and Wed, anchored to the start week even when starting mid-week', () => {
    const r = rule({ startDate: '2026-01-07', repeat: { frequency: 'weekly', interval: 2, weekdays: [1, 3], untilDate: '2026-02-10' } });
    expect(dates(r, '2026-01-01', '2026-03-01')).toEqual(['2026-01-07', '2026-01-19', '2026-01-21', '2026-02-02', '2026-02-04']);
  });

  it('every 3 weeks on Sunday', () => {
    const r = rule({ startDate: '2026-01-05', repeat: { frequency: 'weekly', interval: 3, weekdays: [7], untilDate: '2026-02-28' } });
    // Week of Jan 5 → Sun Jan 11; + 3 weeks → Feb 1; + 3 weeks → Feb 22.
    expect(dates(r, '2026-01-01', '2026-03-01')).toEqual(['2026-01-11', '2026-02-01', '2026-02-22']);
  });

  it('empty weekdays falls back to the start weekday', () => {
    const r = rule({ startDate: '2026-01-08', repeat: { frequency: 'weekly', weekdays: [], untilDate: '2026-01-31' } });
    expect(dates(r, '2026-01-01', '2026-02-01')).toEqual(['2026-01-08', '2026-01-15', '2026-01-22', '2026-01-29']);
  });

  it('exception dates remove single weekdays', () => {
    const r = rule({ startDate: '2026-01-05', exceptionDates: ['2026-01-07'], repeat: { frequency: 'weekly', weekdays: [1, 3], untilDate: '2026-01-14' } });
    expect(dates(r, '2026-01-01', '2026-02-01')).toEqual(['2026-01-05', '2026-01-12', '2026-01-14']);
  });

  it('crosses a year boundary', () => {
    const r = rule({ startDate: '2026-12-28', repeat: { frequency: 'weekly', weekdays: [1, 5], untilDate: '2027-01-11' } });
    expect(dates(r, '2026-12-01', '2027-02-01')).toEqual(['2026-12-28', '2027-01-01', '2027-01-04', '2027-01-08', '2027-01-11']);
  });
});

describe('monthly by day of month', () => {
  it('on the 31st skips short months', () => {
    const r = rule({ startDate: '2026-01-31', repeat: { frequency: 'monthly', monthDay: 31, untilDate: '2026-12-31' } });
    expect(dates(r, '2026-01-01', '2027-01-01')).toEqual([
      '2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31', '2026-10-31', '2026-12-31',
    ]);
  });

  it('on the 30th skips February only', () => {
    const r = rule({ startDate: '2026-01-30', repeat: { frequency: 'monthly', monthDay: 30, untilDate: '2026-04-30' } });
    expect(dates(r, '2026-01-01', '2026-05-01')).toEqual(['2026-01-30', '2026-03-30', '2026-04-30']);
  });

  it('on the 29th hits February only in leap years', () => {
    const r = rule({ startDate: '2027-01-29', repeat: { frequency: 'monthly', monthDay: 29, untilDate: '2028-03-29' } });
    const got = dates(r, '2027-01-01', '2027-04-01').concat(dates(r, '2028-01-01', '2028-04-01'));
    expect(got).toEqual(['2027-01-29', '2027-03-29', '2028-01-29', '2028-02-29', '2028-03-29']);
  });

  it('monthDay null uses the start day', () => {
    const r = rule({ startDate: '2026-01-12', repeat: { frequency: 'monthly', untilDate: '2026-04-30' } });
    expect(dates(r, '2026-01-01', '2026-05-01')).toEqual(['2026-01-12', '2026-02-12', '2026-03-12', '2026-04-12']);
  });

  it('every 2 months', () => {
    const r = rule({ startDate: '2026-01-15', repeat: { frequency: 'monthly', interval: 2, monthDay: 15, untilDate: '2026-12-31' } });
    expect(dates(r, '2026-01-01', '2027-01-01')).toEqual(['2026-01-15', '2026-03-15', '2026-05-15', '2026-07-15', '2026-09-15', '2026-11-15']);
  });

  it('monthDay later than the start day still occurs in the start month', () => {
    const r = rule({ startDate: '2026-01-05', repeat: { frequency: 'monthly', monthDay: 20, untilDate: '2026-02-28' } });
    expect(dates(r, '2026-01-01', '2026-03-01')).toEqual(['2026-01-20', '2026-02-20']);
  });

  it('monthDay earlier than the start day starts next month', () => {
    const r = rule({ startDate: '2026-01-20', repeat: { frequency: 'monthly', monthDay: 5, untilDate: '2026-03-31' } });
    expect(dates(r, '2026-01-01', '2026-04-01')).toEqual(['2026-02-05', '2026-03-05']);
  });
});

describe('monthly by set position', () => {
  it('2nd Tuesday', () => {
    const r = rule({ startDate: '2026-01-01', repeat: { frequency: 'monthly', setPosition: 2, weekday: 2, untilDate: '2026-06-30' } });
    expect(dates(r, '2026-01-01', '2026-07-01')).toEqual(['2026-01-13', '2026-02-10', '2026-03-10', '2026-04-14', '2026-05-12', '2026-06-09']);
  });

  it('last Friday', () => {
    const r = rule({ startDate: '2026-01-01', repeat: { frequency: 'monthly', setPosition: -1, weekday: 5, untilDate: '2026-12-31' } });
    expect(dates(r, '2026-01-01', '2027-01-01')).toEqual([
      '2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24', '2026-05-29', '2026-06-26',
      '2026-07-31', '2026-08-28', '2026-09-25', '2026-10-30', '2026-11-27', '2026-12-25',
    ]);
  });

  it('first Monday', () => {
    const r = rule({ startDate: '2026-01-01', repeat: { frequency: 'monthly', setPosition: 1, weekday: 1, untilDate: '2026-04-30' } });
    expect(dates(r, '2026-01-01', '2026-05-01')).toEqual(['2026-01-05', '2026-02-02', '2026-03-02', '2026-04-06']);
  });

  it('4th Friday differs from last Friday in a five-Friday month', () => {
    const r = rule({ startDate: '2026-01-01', repeat: { frequency: 'monthly', setPosition: 4, weekday: 5, untilDate: '2026-01-31' } });
    expect(dates(r, '2026-01-01', '2026-02-01')).toEqual(['2026-01-23']);
  });

  it('every 3 months on the 2nd Tuesday', () => {
    const r = rule({ startDate: '2026-01-01', repeat: { frequency: 'monthly', interval: 3, setPosition: 2, weekday: 2, untilDate: '2026-12-31' } });
    expect(dates(r, '2026-01-01', '2027-01-01')).toEqual(['2026-01-13', '2026-04-14', '2026-07-14', '2026-10-13']);
  });

  it('a position date before the start date in the start month is skipped', () => {
    const r = rule({ startDate: '2026-01-14', repeat: { frequency: 'monthly', setPosition: 2, weekday: 2, untilDate: '2026-02-28' } });
    expect(dates(r, '2026-01-01', '2026-03-01')).toEqual(['2026-02-10']);
  });
});

describe('yearly', () => {
  it('by month and day', () => {
    const r = rule({ startDate: '2026-09-14', repeat: { frequency: 'yearly', month: 9, monthDay: 14, untilDate: '2028-09-14' } });
    expect(expandBlock(r, '2026-01-01T00:00:00Z', '2029-01-01T00:00:00Z').map((o) => o.date)).toEqual(['2026-09-14', '2027-09-14', '2028-09-14']);
  });

  it('month/day default to the start date', () => {
    const r = rule({ startDate: '2026-03-03', repeat: { frequency: 'yearly', untilDate: '2028-12-31' } });
    expect(expandBlock(r, '2026-01-01T00:00:00Z', '2029-01-01T00:00:00Z').map((o) => o.date)).toEqual(['2026-03-03', '2027-03-03', '2028-03-03']);
  });

  it('every 2 years', () => {
    const r = rule({ startDate: '2026-07-04', repeat: { frequency: 'yearly', interval: 2, month: 7, monthDay: 4, untilDate: '2029-01-01' } });
    expect(expandBlock(r, '2026-01-01T00:00:00Z', '2029-01-01T00:00:00Z').map((o) => o.date)).toEqual(['2026-07-04', '2028-07-04']);
  });

  it('a month later than the start month occurs in the start year', () => {
    const r = rule({ startDate: '2026-01-01', repeat: { frequency: 'yearly', month: 7, monthDay: 4, untilDate: '2027-12-31' } });
    expect(expandBlock(r, '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z').map((o) => o.date)).toEqual(['2026-07-04', '2027-07-04']);
  });

  it('Feb 29 only in leap years', () => {
    const r = rule({ startDate: '2024-02-29', repeat: { frequency: 'yearly', month: 2, monthDay: 29, untilDate: '2027-02-28' } });
    const all = eachDate('2024-01-01', '2027-12-31').filter((d) => occursOn(r, d));
    expect(all).toEqual(['2024-02-29']);
  });

  it('by set position: 4th Thursday of November', () => {
    const r = rule({ startDate: '2026-01-01', repeat: { frequency: 'yearly', month: 11, setPosition: 4, weekday: 4, untilDate: '2028-12-31' } });
    expect(expandBlock(r, '2026-01-01T00:00:00Z', '2029-01-01T00:00:00Z').map((o) => o.date)).toEqual(['2026-11-26', '2027-11-25', '2028-11-23']);
  });

  it('by set position: last Monday of May', () => {
    const r = rule({ startDate: '2026-01-01', repeat: { frequency: 'yearly', month: 5, setPosition: -1, weekday: 1, untilDate: '2027-12-31' } });
    expect(expandBlock(r, '2026-01-01T00:00:00Z', '2028-01-01T00:00:00Z').map((o) => o.date)).toEqual(['2026-05-25', '2027-05-31']);
  });
});

describe('until date and exception dates', () => {
  it.each(['daily', 'weekly', 'monthly', 'yearly'] as const)('%s: until date is inclusive', (frequency) => {
    const r = rule({ startDate: '2026-01-05', repeat: { frequency, weekdays: [1], untilDate: '2026-01-05' } });
    expect(dates(r, '2026-01-01', '2027-01-01')).toEqual(['2026-01-05']);
    expect(occursOn(r, '2026-01-05')).toBe(true);
  });

  it.each(['daily', 'weekly', 'monthly', 'yearly'] as const)('%s: nothing after until date', (frequency) => {
    const r = rule({ startDate: '2026-01-05', repeat: { frequency, weekdays: [1], untilDate: '2026-01-05' } });
    expect(occursOn(r, '2026-01-12')).toBe(false);
    expect(occursOn(r, '2026-02-05')).toBe(false);
    expect(occursOn(r, '2027-01-05')).toBe(false);
  });

  it('exception dates that are not part of the series are harmless', () => {
    const r = rule({ startDate: '2026-01-05', exceptionDates: ['2026-01-06'], repeat: { frequency: 'weekly', weekdays: [1], untilDate: '2026-01-19' } });
    expect(dates(r, '2026-01-01', '2026-02-01')).toEqual(['2026-01-05', '2026-01-12', '2026-01-19']);
  });
});

describe('times, all-day and midnight', () => {
  it('startsAt/endsAt are ISO UTC without milliseconds', () => {
    const [o] = expandBlock(rule({ startMinute: 615, durationMinutes: 45 }), '2026-01-05T00:00:00Z', '2026-01-06T00:00:00Z');
    expect(o).toMatchObject({ startsAt: '2026-01-05T10:15:00Z', endsAt: '2026-01-05T11:00:00Z' });
  });

  it('all-day occurrences span local midnight to midnight', () => {
    const r = rule({ allDay: true, startMinute: 0, durationMinutes: 1440, repeat: { frequency: 'daily', untilDate: '2026-01-06' } });
    expect(expandBlock(r, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toEqual([
      expect.objectContaining({ date: '2026-01-05', startsAt: '2026-01-05T00:00:00Z', endsAt: '2026-01-06T00:00:00Z', allDay: true }),
      expect.objectContaining({ date: '2026-01-06', startsAt: '2026-01-06T00:00:00Z', endsAt: '2026-01-07T00:00:00Z', allDay: true }),
    ]);
  });

  it('all-day in Asia/Seoul starts at 15:00 UTC the previous day', () => {
    const [o] = expandBlock(rule({ timeZone: 'Asia/Seoul', allDay: true }), '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(o).toMatchObject({ date: '2026-01-05', startsAt: '2026-01-04T15:00:00Z', endsAt: '2026-01-05T15:00:00Z' });
  });

  it('all-day ignores startMinute and duration', () => {
    const b = occurrenceBounds({ timeZone: 'UTC', allDay: true, startMinute: 600, durationMinutes: 30 }, '2026-01-05');
    expect(b.end.diff(b.start, 'hours').hours).toBe(24);
    expect(b.start.hour).toBe(0);
  });

  it('a range that crosses midnight ends the next day', () => {
    const [o] = expandBlock(rule({ startMinute: 23 * 60, durationMinutes: 120 }), '2026-01-05T00:00:00Z', '2026-01-07T00:00:00Z');
    expect(o).toMatchObject({ date: '2026-01-05', startsAt: '2026-01-05T23:00:00Z', endsAt: '2026-01-06T01:00:00Z' });
  });

  it('includes an occurrence from the previous day that spills into the range', () => {
    const r = rule({ startMinute: 23 * 60, durationMinutes: 120, repeat: { frequency: 'daily', untilDate: '2026-01-31' } });
    const occ = expandBlock(r, '2026-01-10T00:00:00Z', '2026-01-10T12:00:00Z');
    expect(occ.map((o) => o.date)).toEqual(['2026-01-09']);
  });

  it('the maximum 1440-minute duration from 23:59 ends the next day at 23:59', () => {
    const [o] = expandBlock(rule({ startMinute: 1439, durationMinutes: 1440 }), '2026-01-05T00:00:00Z', '2026-01-08T00:00:00Z');
    expect(o).toMatchObject({ startsAt: '2026-01-05T23:59:00Z', endsAt: '2026-01-06T23:59:00Z' });
  });

  it('range bounds are half-open: ends-at-from and starts-at-to are excluded', () => {
    const r = rule({ repeat: { frequency: 'daily', untilDate: '2026-01-10' } }); // 09:00–10:00
    expect(dates(r, '2026-01-06T10:00:00Z', '2026-01-07T09:00:00Z')).toEqual([]);
    expect(dates(r, '2026-01-06T09:59:00Z', '2026-01-07T09:01:00Z')).toEqual(['2026-01-06', '2026-01-07']);
  });

  it('returns nothing for an empty, inverted or invalid range', () => {
    const r = rule({ repeat: { frequency: 'daily', untilDate: '2026-01-10' } });
    expect(expandBlock(r, '2026-01-06T00:00:00Z', '2026-01-06T00:00:00Z')).toEqual([]);
    expect(expandBlock(r, '2026-01-07T00:00:00Z', '2026-01-06T00:00:00Z')).toEqual([]);
    expect(expandBlock(r, 'garbage', '2026-01-06T00:00:00Z')).toEqual([]);
  });

  it('a local range in a far-east zone sees the right local dates', () => {
    const r = rule({ timeZone: 'Asia/Seoul', startMinute: 60, repeat: { frequency: 'daily', untilDate: '2026-01-31' } });
    // 01:00 KST on Jan 10 is 16:00 UTC Jan 9.
    const occ = expandBlock(r, '2026-01-09T12:00:00Z', '2026-01-09T20:00:00Z');
    expect(occ).toEqual([expect.objectContaining({ date: '2026-01-10', startsAt: '2026-01-09T16:00:00Z' })]);
  });
});

describe('daylight saving', () => {
  const weekdays9am = (timeZone: string, startDate: string, untilDate: string) =>
    rule({ timeZone, startDate, startMinute: 540, durationMinutes: 60, repeat: { frequency: 'weekly', weekdays: [1, 2, 3, 4, 5], untilDate } });

  it('Europe/London 9:00 every weekday stays 09:00 local across the March switch', () => {
    const occ = expandBlock(weekdays9am('Europe/London', '2026-03-23', '2026-04-03'), '2026-03-20T00:00:00Z', '2026-04-10T00:00:00Z');
    expect(occ.map((o) => o.startsAt)).toEqual([
      '2026-03-23T09:00:00Z', '2026-03-24T09:00:00Z', '2026-03-25T09:00:00Z', '2026-03-26T09:00:00Z', '2026-03-27T09:00:00Z',
      '2026-03-30T08:00:00Z', '2026-03-31T08:00:00Z', '2026-04-01T08:00:00Z', '2026-04-02T08:00:00Z', '2026-04-03T08:00:00Z',
    ]);
    expect(occ.every((o) => Date.parse(o.endsAt) - Date.parse(o.startsAt) === 3_600_000)).toBe(true);
  });

  it('Europe/London 9:00 every weekday stays 09:00 local across the October switch', () => {
    const occ = expandBlock(weekdays9am('Europe/London', '2026-10-19', '2026-10-30'), '2026-10-15T00:00:00Z', '2026-11-05T00:00:00Z');
    expect(occ.map((o) => o.startsAt)).toEqual([
      '2026-10-19T08:00:00Z', '2026-10-20T08:00:00Z', '2026-10-21T08:00:00Z', '2026-10-22T08:00:00Z', '2026-10-23T08:00:00Z',
      '2026-10-26T09:00:00Z', '2026-10-27T09:00:00Z', '2026-10-28T09:00:00Z', '2026-10-29T09:00:00Z', '2026-10-30T09:00:00Z',
    ]);
  });

  it('America/New_York 9:00 daily shifts UTC by an hour in March', () => {
    const r = rule({ timeZone: 'America/New_York', startDate: '2026-03-06', startMinute: 540, repeat: { frequency: 'daily', untilDate: '2026-03-10' } });
    expect(expandBlock(r, '2026-03-01T00:00:00Z', '2026-03-15T00:00:00Z').map((o) => o.startsAt)).toEqual([
      '2026-03-06T14:00:00Z', '2026-03-07T14:00:00Z', '2026-03-08T13:00:00Z', '2026-03-09T13:00:00Z', '2026-03-10T13:00:00Z',
    ]);
  });

  it('America/New_York 9:00 daily shifts UTC back in November', () => {
    const r = rule({ timeZone: 'America/New_York', startDate: '2026-10-30', startMinute: 540, repeat: { frequency: 'daily', untilDate: '2026-11-02' } });
    expect(expandBlock(r, '2026-10-25T00:00:00Z', '2026-11-05T00:00:00Z').map((o) => o.startsAt)).toEqual([
      '2026-10-30T13:00:00Z', '2026-10-31T13:00:00Z', '2026-11-01T14:00:00Z', '2026-11-02T14:00:00Z',
    ]);
  });

  it('America/New_York all-day on the spring-forward date lasts 23 hours', () => {
    const [o] = expandBlock(rule({ timeZone: 'America/New_York', startDate: '2026-03-08', allDay: true }), '2026-03-01T00:00:00Z', '2026-03-15T00:00:00Z');
    expect(o).toMatchObject({ startsAt: '2026-03-08T05:00:00Z', endsAt: '2026-03-09T04:00:00Z' });
  });

  it('America/New_York all-day on the fall-back date lasts 25 hours', () => {
    const [o] = expandBlock(rule({ timeZone: 'America/New_York', startDate: '2026-11-01', allDay: true }), '2026-10-25T00:00:00Z', '2026-11-05T00:00:00Z');
    expect(o).toMatchObject({ startsAt: '2026-11-01T04:00:00Z', endsAt: '2026-11-02T05:00:00Z' });
  });

  it('monthly 2nd Tuesday 17:30 in New York follows local time through DST', () => {
    const r = rule({ timeZone: 'America/New_York', startDate: '2026-01-01', startMinute: 17 * 60 + 30, repeat: { frequency: 'monthly', setPosition: 2, weekday: 2, untilDate: '2026-04-30' } });
    expect(expandBlock(r, '2026-01-01T00:00:00Z', '2026-05-01T00:00:00Z').map((o) => o.startsAt)).toEqual([
      '2026-01-13T22:30:00Z', '2026-02-10T22:30:00Z', '2026-03-10T21:30:00Z', '2026-04-14T21:30:00Z',
    ]);
  });

  it('Asia/Seoul (no DST) keeps the same UTC instant all year', () => {
    const r = rule({ timeZone: 'Asia/Seoul', startDate: '2026-01-01', startMinute: 540, repeat: { frequency: 'weekly', weekdays: [1], untilDate: '2026-12-31' } });
    const all = [
      ...expandBlock(r, '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
      ...expandBlock(r, '2026-03-01T00:00:00Z', '2026-05-01T00:00:00Z'),
      ...expandBlock(r, '2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z'),
    ];
    expect(all.length).toBeGreaterThan(20);
    expect(new Set(all.map((o) => o.startsAt.slice(11)))).toEqual(new Set(['00:00:00Z']));
  });

  it('the same wall-clock block in London and Seoul differs by 9h in winter and 8h in summer', () => {
    const at = (timeZone: string, startDate: string) =>
      Date.parse(expandBlock(rule({ timeZone, startDate }), '2025-12-01T00:00:00Z', '2027-01-01T00:00:00Z')[0]!.startsAt);
    const winter = (at('Europe/London', '2026-01-05') - at('Asia/Seoul', '2026-01-05')) / 3_600_000;
    const summer = (at('Europe/London', '2026-07-06') - at('Asia/Seoul', '2026-07-06')) / 3_600_000;
    expect(winter).toBe(9);
    expect(summer).toBe(8);
  });
});

describe('expandBlocks', () => {
  it('merges several rules sorted by start instant', () => {
    const a = rule({ id: 'a', startMinute: 600, repeat: { frequency: 'daily', untilDate: '2026-01-06' } });
    const b = rule({ id: 'b', startMinute: 480, repeat: { frequency: 'daily', untilDate: '2026-01-06' } });
    const occ = expandBlocks([a, b], '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(occ.map((o) => `${o.date}:${o.blockId}`)).toEqual(['2026-01-05:b', '2026-01-05:a', '2026-01-06:b', '2026-01-06:a']);
  });

  it('empty input gives empty output', () => {
    expect(expandBlocks([], '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')).toEqual([]);
  });
});

describe('hasAnyOccurrence', () => {
  it('single block: true, false when its date is an exception', () => {
    expect(hasAnyOccurrence(rule())).toBe(true);
    expect(hasAnyOccurrence(rule({ exceptionDates: ['2026-01-05'] }))).toBe(false);
  });

  it('series with every date excepted has none', () => {
    const r = rule({ startDate: '2026-01-05', exceptionDates: ['2026-01-05', '2026-01-06'], repeat: { frequency: 'daily', untilDate: '2026-01-06' } });
    expect(hasAnyOccurrence(r)).toBe(false);
  });

  it('series with one date left still has one', () => {
    const r = rule({ startDate: '2026-01-05', exceptionDates: ['2026-01-05'], repeat: { frequency: 'daily', untilDate: '2026-01-06' } });
    expect(hasAnyOccurrence(r)).toBe(true);
  });

  it('weekly series whose weekday never falls inside the window has none', () => {
    const r = rule({ startDate: '2026-01-05', repeat: { frequency: 'weekly', weekdays: [7], untilDate: '2026-01-10' } });
    expect(hasAnyOccurrence(r)).toBe(false);
  });

  it('monthly on the 31st across February only has none', () => {
    const r = rule({ startDate: '2026-02-01', repeat: { frequency: 'monthly', monthDay: 31, untilDate: '2026-02-28' } });
    expect(hasAnyOccurrence(r)).toBe(false);
  });
});
