import { describe, expect, it } from 'vitest';
import { MAX_SERIES_DAYS, addDays, describeRepeat, isIsoDate, normalizeBlock, validateBlock } from '../src';
import { rule, type RuleOverrides } from './helpers';

const paths = (o: RuleOverrides) => validateBlock(rule(o)).map((i) => i.path);
const repeating = (repeat: RuleOverrides['repeat'], extra: RuleOverrides = {}): RuleOverrides => ({
  startDate: '2026-01-05',
  ...extra,
  repeat: { untilDate: '2026-06-30', ...repeat },
});

describe('validateBlock: a valid block has no issues', () => {
  it.each<[string, RuleOverrides]>([
    ['single', {}],
    ['all-day', { allDay: true, startMinute: 0, durationMinutes: 1440 }],
    ['daily', repeating({ frequency: 'daily' })],
    ['weekly', repeating({ frequency: 'weekly', weekdays: [1, 7] })],
    ['monthly by day', repeating({ frequency: 'monthly', monthDay: 31 })],
    ['monthly by default day', repeating({ frequency: 'monthly' })],
    ['monthly last Friday', repeating({ frequency: 'monthly', setPosition: -1, weekday: 5 })],
    ['yearly by month/day', repeating({ frequency: 'yearly', month: 12, monthDay: 25 }, {})],
    ['yearly by position', repeating({ frequency: 'yearly', month: 11, setPosition: 4, weekday: 4 })],
    ['Asia/Seoul', { timeZone: 'Asia/Seoul' }],
    ['available kind', { kind: 'available' }],
  ])('%s', (_n, o) => {
    expect(validateBlock(rule(o))).toEqual([]);
  });
});

describe('validateBlock: start minute 0–1439', () => {
  it.each([[0, true], [1, true], [720, true], [1439, true], [-1, false], [1440, false], [9.5, false], [Number.NaN, false]])(
    'startMinute %s valid=%s',
    (startMinute, ok) => {
      expect(paths({ startMinute }).includes('startMinute')).toBe(!ok);
    },
  );
});

describe('validateBlock: duration 5–1440', () => {
  it.each([[5, true], [6, true], [60, true], [1440, true], [4, false], [0, false], [-30, false], [1441, false], [30.5, false]])(
    'durationMinutes %s valid=%s',
    (durationMinutes, ok) => {
      expect(paths({ durationMinutes }).includes('durationMinutes')).toBe(!ok);
    },
  );
});

describe('validateBlock: interval 1–99', () => {
  it.each([[1, true], [2, true], [99, true], [0, false], [100, false], [-1, false], [1.5, false]])('interval %s valid=%s', (interval, ok) => {
    expect(paths(repeating({ frequency: 'daily', interval })).includes('repeat.interval')).toBe(!ok);
  });

  it('interval is validated even for non-repeating blocks', () => {
    expect(paths({ repeat: { interval: 0 } })).toContain('repeat.interval');
  });
});

describe('validateBlock: basic fields', () => {
  it.each(['Mars/Olympus', '', '+09:00', 'UTC+9', 'GMT-5', '9'])('rejects time zone %j', (timeZone) => {
    expect(paths({ timeZone })).toContain('timeZone');
  });

  it.each(['Europe/London', 'America/New_York', 'Asia/Seoul', 'UTC'])('accepts time zone %s', (timeZone) => {
    expect(paths({ timeZone })).not.toContain('timeZone');
  });

  it.each(['2026-02-30', '2026-1-5', '05/01/2026', '', '2026-13-01'])('rejects start date %j', (startDate) => {
    expect(paths({ startDate })).toContain('startDate');
  });

  it('rejects an unknown kind', () => {
    expect(paths({ kind: 'busy' as never })).toContain('kind');
  });

  it('rejects an unknown frequency', () => {
    expect(paths({ repeat: { frequency: 'hourly' as never, untilDate: '2026-02-01' } })).toContain('repeat.frequency');
  });

  it('reports every problem at once', () => {
    expect(paths({ startMinute: -1, durationMinutes: 1, timeZone: 'nope' }).sort()).toEqual(['durationMinutes', 'startMinute', 'timeZone']);
  });

  it('non-repeating blocks skip repeat-specific rules', () => {
    expect(paths({ repeat: { frequency: 'none', weekdays: [], monthDay: 99, untilDate: null } })).toEqual([]);
  });
});

describe('validateBlock: until date', () => {
  it.each(['daily', 'weekly', 'monthly', 'yearly'] as const)('%s needs an until date', (frequency) => {
    expect(paths({ repeat: { frequency, weekdays: [1], untilDate: null } })).toContain('repeat.untilDate');
  });

  it('rejects a malformed until date', () => {
    expect(paths(repeating({ frequency: 'daily', untilDate: '2026/06/30' }))).toContain('repeat.untilDate');
  });

  it('rejects an until date before the start date', () => {
    expect(paths(repeating({ frequency: 'daily', untilDate: '2026-01-04' }))).toContain('repeat.untilDate');
  });

  it('accepts an until date equal to the start date', () => {
    expect(paths(repeating({ frequency: 'daily', untilDate: '2026-01-05' }))).toEqual([]);
  });

  it(`accepts exactly ${MAX_SERIES_DAYS} days after the start`, () => {
    expect(paths(repeating({ frequency: 'daily', untilDate: addDays('2026-01-05', MAX_SERIES_DAYS) }))).toEqual([]);
  });

  it(`rejects ${MAX_SERIES_DAYS + 1} days after the start`, () => {
    const issues = validateBlock(rule(repeating({ frequency: 'daily', untilDate: addDays('2026-01-05', MAX_SERIES_DAYS + 1) })));
    expect(issues).toEqual([{ path: 'repeat.untilDate', message: expect.stringMatching(/3 years/) }]);
  });

  it('MAX_SERIES_DAYS is 1096', () => {
    expect(MAX_SERIES_DAYS).toBe(1096);
  });
});

describe('validateBlock: weekly', () => {
  it('needs at least one weekday', () => {
    expect(paths(repeating({ frequency: 'weekly', weekdays: [] }))).toContain('repeat.weekdays');
  });

  it.each([[[0]], [[8]], [[1, 2, 9]], [[1.5]]])('rejects weekdays %j', (weekdays) => {
    expect(paths(repeating({ frequency: 'weekly', weekdays }))).toContain('repeat.weekdays');
  });

  it('accepts all seven weekdays', () => {
    expect(paths(repeating({ frequency: 'weekly', weekdays: [1, 2, 3, 4, 5, 6, 7] }))).toEqual([]);
  });

  it('daily does not care about weekdays', () => {
    expect(paths(repeating({ frequency: 'daily', weekdays: [] }))).toEqual([]);
  });
});

describe('validateBlock: monthly / yearly', () => {
  it.each(['monthly', 'yearly'] as const)('%s: set position must be 1–4 or -1', (frequency) => {
    for (const setPosition of [0, 5, -2]) {
      expect(paths(repeating({ frequency, setPosition, weekday: 2 }))).toContain('repeat.setPosition');
    }
    for (const setPosition of [1, 2, 3, 4, -1]) {
      expect(paths(repeating({ frequency, setPosition, weekday: 2 }))).not.toContain('repeat.setPosition');
    }
  });

  it.each(['monthly', 'yearly'] as const)('%s: weekday alone requires a set position', (frequency) => {
    expect(paths(repeating({ frequency, weekday: 2 }))).toContain('repeat.setPosition');
  });

  it.each(['monthly', 'yearly'] as const)('%s: set position alone requires a weekday', (frequency) => {
    expect(paths(repeating({ frequency, setPosition: 2 }))).toContain('repeat.weekday');
  });

  it.each([0, 8])('weekday %s is out of range', (weekday) => {
    expect(paths(repeating({ frequency: 'monthly', setPosition: 1, weekday }))).toContain('repeat.weekday');
  });

  it.each([[0, false], [1, true], [31, true], [32, false]])('monthDay %s valid=%s', (monthDay, ok) => {
    expect(paths(repeating({ frequency: 'monthly', monthDay })).includes('repeat.monthDay')).toBe(!ok);
  });

  it.each([[0, false], [1, true], [12, true], [13, false]])('yearly month %s valid=%s', (month, ok) => {
    expect(paths(repeating({ frequency: 'yearly', month })).includes('repeat.month')).toBe(!ok);
  });
});

describe('normalizeBlock', () => {
  it('none resets every repeat field', () => {
    const n = normalizeBlock(rule({ repeat: { frequency: 'none', interval: 5, weekdays: [1], monthDay: 3, untilDate: '2026-02-01' } }));
    expect(n.repeat).toEqual({ frequency: 'none', interval: 1, weekdays: [], monthDay: null, setPosition: null, weekday: null, month: null, untilDate: null });
  });

  it('weekly dedupes and sorts weekdays and clears monthly fields', () => {
    const n = normalizeBlock(rule(repeating({ frequency: 'weekly', weekdays: [5, 1, 5, 3], monthDay: 4, setPosition: 1, weekday: 2, month: 3 })));
    expect(n.repeat).toMatchObject({ weekdays: [1, 3, 5], monthDay: null, setPosition: null, weekday: null, month: null });
  });

  it('daily clears weekdays', () => {
    expect(normalizeBlock(rule(repeating({ frequency: 'daily', weekdays: [1, 2] }))).repeat.weekdays).toEqual([]);
  });

  it('monthly by day fills monthDay from the start date and clears weekday/month', () => {
    const n = normalizeBlock(rule(repeating({ frequency: 'monthly', weekday: 3, month: 4 }, { startDate: '2026-01-17' })));
    expect(n.repeat).toMatchObject({ monthDay: 17, weekday: null, setPosition: null, month: null });
  });

  it('monthly by position clears monthDay', () => {
    const n = normalizeBlock(rule(repeating({ frequency: 'monthly', setPosition: -1, weekday: 5, monthDay: 9 })));
    expect(n.repeat).toMatchObject({ monthDay: null, setPosition: -1, weekday: 5, month: null });
  });

  it('yearly fills month and day from the start date', () => {
    const n = normalizeBlock(rule(repeating({ frequency: 'yearly' }, { startDate: '2026-03-09' })));
    expect(n.repeat).toMatchObject({ month: 3, monthDay: 9 });
  });

  it('yearly keeps an explicit month', () => {
    expect(normalizeBlock(rule(repeating({ frequency: 'yearly', month: 11, setPosition: 4, weekday: 4 }))).repeat).toMatchObject({ month: 11, monthDay: null });
  });

  it('all-day forces 00:00 and 1440 minutes', () => {
    const n = normalizeBlock(rule({ allDay: true, startMinute: 600, durationMinutes: 30 }));
    expect([n.startMinute, n.durationMinutes]).toEqual([0, 1440]);
  });

  it('timed blocks keep their minutes', () => {
    const n = normalizeBlock(rule({ startMinute: 600, durationMinutes: 30 }));
    expect([n.startMinute, n.durationMinutes]).toEqual([600, 30]);
  });

  it('dedupes and sorts exception dates', () => {
    expect(normalizeBlock(rule({ exceptionDates: ['2026-02-01', '2026-01-01', '2026-02-01'] })).exceptionDates).toEqual(['2026-01-01', '2026-02-01']);
  });

  it('does not mutate its input', () => {
    const r = rule(repeating({ frequency: 'weekly', weekdays: [3, 1] }));
    normalizeBlock(r);
    expect(r.repeat.weekdays).toEqual([3, 1]);
  });
});

describe('date helpers', () => {
  it.each([['2026-01-01', true], ['2028-02-29', true], ['2026-02-29', false], ['2026-1-01', false], ['x', false]])('isIsoDate(%s) = %s', (s, ok) => {
    expect(isIsoDate(s)).toBe(ok);
  });

  it.each([['2026-01-31', 1, '2026-02-01'], ['2026-03-01', -1, '2026-02-28'], ['2028-03-01', -1, '2028-02-29'], ['2026-12-31', 1, '2027-01-01'], ['2026-03-08', 1, '2026-03-09']])(
    'addDays(%s, %s) = %s',
    (d, n, out) => {
      expect(addDays(d, n)).toBe(out);
    },
  );
});

describe('describeRepeat', () => {
  it.each<[RuleOverrides['repeat'], string]>([
    [{ frequency: 'none' }, 'Does not repeat'],
    [{ frequency: 'daily', untilDate: '2026-12-31' }, 'Every day until Dec 31, 2026'],
    [{ frequency: 'daily', interval: 3, untilDate: null }, 'Every 3 days'],
    [{ frequency: 'weekly', interval: 2, weekdays: [1, 3], untilDate: '2026-12-31' }, 'Every 2 weeks on Mon, Wed until Dec 31, 2026'],
    [{ frequency: 'monthly', monthDay: 31 }, 'Every month on day 31'],
    [{ frequency: 'monthly' }, 'Every month on day 5'],
    [{ frequency: 'monthly', setPosition: 2, weekday: 2 }, 'Every month on the second Tue'],
    [{ frequency: 'monthly', setPosition: -1, weekday: 5 }, 'Every month on the last Fri'],
    [{ frequency: 'yearly', month: 11, setPosition: 4, weekday: 4 }, 'Every year on the fourth Thu of November'],
    [{ frequency: 'yearly', month: 9, monthDay: 14 }, 'Every year on day 14 of September'],
  ])('%j → %s', (repeat, text) => {
    expect(describeRepeat(rule({ startDate: '2026-01-05', repeat }))).toBe(text);
  });
});
