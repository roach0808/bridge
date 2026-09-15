import { DateTime } from 'luxon';
import { isValidTimeZone } from './timezones';

export const BLOCK_KINDS = ['available', 'unavailable'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export const FREQUENCIES = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const EDIT_SCOPES = ['this', 'following', 'all'] as const;
export type EditScope = (typeof EDIT_SCOPES)[number];

export const MAX_SERIES_DAYS = 1096;
export const SET_POSITIONS = [1, 2, 3, 4, -1] as const;

export interface RepeatRule {
  frequency: Frequency;
  interval: number;
  /** Weekly: 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  monthDay: number | null;
  setPosition: number | null;
  weekday: number | null;
  month: number | null;
  /** ISO date, inclusive. Required when the block repeats. */
  untilDate: string | null;
}

export interface BlockRule {
  id?: string;
  kind: BlockKind;
  timeZone: string;
  /** ISO date (yyyy-mm-dd), wall-clock in `timeZone`. */
  startDate: string;
  allDay: boolean;
  startMinute: number;
  durationMinutes: number;
  repeat: RepeatRule;
  exceptionDates: string[];
  note?: string | null;
}

export interface Occurrence {
  blockId: string | null;
  kind: BlockKind;
  /** Local date of the occurrence in the block's zone. */
  date: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  isRecurring: boolean;
}

export const NO_REPEAT: RepeatRule = {
  frequency: 'none',
  interval: 1,
  weekdays: [],
  monthDay: null,
  setPosition: null,
  weekday: null,
  month: null,
  untilDate: null,
};

// ---------------------------------------------------------------------------
// Pure date helpers. Calendar dates are handled as UTC-midnight DateTimes so
// arithmetic never touches daylight saving.

const DAY_MS = 86_400_000;

function parseDate(iso: string): DateTime {
  return DateTime.fromISO(iso, { zone: 'utc' }).startOf('day');
}

function epochDay(d: DateTime): number {
  return Math.round(d.toMillis() / DAY_MS);
}

function toIsoDate(d: DateTime): string {
  return d.toISODate()!;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDate(value).isValid;
}

export function addDays(iso: string, days: number): string {
  return toIsoDate(parseDate(iso).plus({ days }));
}

function monthIndex(d: DateTime): number {
  return d.year * 12 + (d.month - 1);
}

function dayOfMonthMatches(date: DateTime, repeat: RepeatRule, start: DateTime): boolean {
  if (repeat.setPosition != null && repeat.weekday != null) {
    if (date.weekday !== repeat.weekday) return false;
    if (repeat.setPosition === -1) return date.plus({ days: 7 }).month !== date.month;
    return Math.ceil(date.day / 7) === repeat.setPosition;
  }
  return date.day === (repeat.monthDay ?? start.day);
}

/** Whether the rule produces an occurrence on the given local date. */
export function occursOn(rule: BlockRule, isoDate: string): boolean {
  const date = parseDate(isoDate);
  const start = parseDate(rule.startDate);
  const { repeat } = rule;
  if (date < start) return false;
  if (rule.exceptionDates.includes(isoDate)) return false;
  if (repeat.frequency === 'none') return epochDay(date) === epochDay(start);
  if (repeat.untilDate && date > parseDate(repeat.untilDate)) return false;
  const interval = Math.max(1, repeat.interval);

  switch (repeat.frequency) {
    case 'daily':
      return (epochDay(date) - epochDay(start)) % interval === 0;
    case 'weekly': {
      const weekdays = repeat.weekdays.length ? repeat.weekdays : [start.weekday];
      if (!weekdays.includes(date.weekday)) return false;
      const startMonday = epochDay(start) - (start.weekday - 1);
      const dateMonday = epochDay(date) - (date.weekday - 1);
      return ((dateMonday - startMonday) / 7) % interval === 0;
    }
    case 'monthly':
      if ((monthIndex(date) - monthIndex(start)) % interval !== 0) return false;
      return dayOfMonthMatches(date, repeat, start);
    case 'yearly':
      if ((date.year - start.year) % interval !== 0) return false;
      if (date.month !== (repeat.month ?? start.month)) return false;
      return dayOfMonthMatches(date, repeat, start);
  }
}

/** Wall-clock start and end instants of an occurrence on a local date. */
export function occurrenceBounds(
  rule: Pick<BlockRule, 'timeZone' | 'allDay' | 'startMinute' | 'durationMinutes'>,
  isoDate: string,
): { start: DateTime; end: DateTime } {
  const d = parseDate(isoDate);
  const base = DateTime.fromObject(
    { year: d.year, month: d.month, day: d.day },
    { zone: rule.timeZone },
  );
  if (rule.allDay) {
    return { start: base, end: base.plus({ days: 1 }) };
  }
  const start = base.set({
    hour: Math.floor(rule.startMinute / 60),
    minute: rule.startMinute % 60,
  });
  return { start, end: start.plus({ minutes: rule.durationMinutes }) };
}

/**
 * Expands a block into concrete occurrences overlapping [from, to).
 * `from` and `to` are UTC instants (ISO strings).
 */
export function expandBlock(rule: BlockRule, from: string, to: string): Occurrence[] {
  const fromDt = DateTime.fromISO(from, { zone: 'utc' });
  const toDt = DateTime.fromISO(to, { zone: 'utc' });
  if (!fromDt.isValid || !toDt.isValid || toDt <= fromDt) return [];

  // Occurrences can start up to a day before the range and still overlap it.
  let cursor = parseDate(fromDt.setZone(rule.timeZone).toISODate()!).minus({ days: 1 });
  const last = parseDate(toDt.setZone(rule.timeZone).toISODate()!).plus({ days: 1 });
  const start = parseDate(rule.startDate);
  if (cursor < start) cursor = start;
  const until =
    rule.repeat.frequency === 'none' ? start : rule.repeat.untilDate ? parseDate(rule.repeat.untilDate) : last;
  const end = until < last ? until : last;

  const out: Occurrence[] = [];
  for (let d = cursor; d <= end; d = d.plus({ days: 1 })) {
    const iso = toIsoDate(d);
    if (!occursOn(rule, iso)) continue;
    const bounds = occurrenceBounds(rule, iso);
    if (bounds.start >= toDt || bounds.end <= fromDt) continue;
    out.push({
      blockId: rule.id ?? null,
      kind: rule.kind,
      date: iso,
      startsAt: bounds.start.toUTC().toISO({ suppressMilliseconds: true })!,
      endsAt: bounds.end.toUTC().toISO({ suppressMilliseconds: true })!,
      allDay: rule.allDay,
      isRecurring: rule.repeat.frequency !== 'none',
    });
  }
  return out;
}

export function expandBlocks(rules: BlockRule[], from: string, to: string): Occurrence[] {
  return rules
    .flatMap((r) => expandBlock(r, from, to))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** True if the series still has at least one date. */
export function hasAnyOccurrence(rule: BlockRule): boolean {
  if (rule.repeat.frequency === 'none') return !rule.exceptionDates.includes(rule.startDate);
  const start = parseDate(rule.startDate);
  const until = rule.repeat.untilDate
    ? parseDate(rule.repeat.untilDate)
    : start.plus({ days: MAX_SERIES_DAYS });
  for (let d = start; d <= until; d = d.plus({ days: 1 })) {
    if (occursOn(rule, toIsoDate(d))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Validation

export interface BlockValidationIssue {
  path: string;
  message: string;
}

/** Normalises fields that don't apply to the chosen shape. */
export function normalizeBlock(rule: BlockRule): BlockRule {
  const repeat = { ...rule.repeat, weekdays: [...new Set(rule.repeat.weekdays)].sort((a, b) => a - b) };
  if (repeat.frequency === 'none') {
    Object.assign(repeat, NO_REPEAT);
  } else {
    if (repeat.frequency !== 'weekly') repeat.weekdays = [];
    if (repeat.frequency === 'daily' || repeat.frequency === 'weekly') {
      repeat.monthDay = null;
      repeat.setPosition = null;
      repeat.weekday = null;
      repeat.month = null;
    } else {
      if (repeat.setPosition != null) repeat.monthDay = null;
      else {
        repeat.weekday = null;
        if (repeat.monthDay == null) repeat.monthDay = parseDate(rule.startDate).day;
      }
      if (repeat.frequency === 'monthly') repeat.month = null;
      else if (repeat.month == null) repeat.month = parseDate(rule.startDate).month;
    }
  }
  const allDay = rule.allDay;
  return {
    ...rule,
    startMinute: allDay ? 0 : rule.startMinute,
    durationMinutes: allDay ? 1440 : rule.durationMinutes,
    repeat,
    exceptionDates: [...new Set(rule.exceptionDates)].sort(),
  };
}

const int = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export function validateBlock(rule: BlockRule): BlockValidationIssue[] {
  const issues: BlockValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const { repeat } = rule;

  if (!BLOCK_KINDS.includes(rule.kind)) add('kind', 'Kind must be available or unavailable');
  if (!isValidTimeZone(rule.timeZone)) add('timeZone', 'Time zone must be an IANA name such as Asia/Seoul');
  if (!isIsoDate(rule.startDate)) add('startDate', 'Start date must be yyyy-mm-dd');
  if (!int(rule.startMinute) || rule.startMinute < 0 || rule.startMinute > 1439)
    add('startMinute', 'Start time must be between 00:00 and 23:59');
  if (!int(rule.durationMinutes) || rule.durationMinutes < 5 || rule.durationMinutes > 1440)
    add('durationMinutes', 'Duration must be between 5 minutes and 24 hours');
  if (!FREQUENCIES.includes(repeat.frequency)) add('repeat.frequency', 'Unknown repeat frequency');
  if (!int(repeat.interval) || repeat.interval < 1 || repeat.interval > 99)
    add('repeat.interval', 'Repeat interval must be between 1 and 99');

  if (repeat.frequency === 'none') return issues;

  if (!repeat.untilDate) {
    add('repeat.untilDate', 'A repeating block needs an end date');
  } else if (!isIsoDate(repeat.untilDate)) {
    add('repeat.untilDate', 'End date must be yyyy-mm-dd');
  } else if (isIsoDate(rule.startDate)) {
    const span = epochDay(parseDate(repeat.untilDate)) - epochDay(parseDate(rule.startDate));
    if (span < 0) add('repeat.untilDate', 'End date must be on or after the start date');
    else if (span > MAX_SERIES_DAYS) add('repeat.untilDate', 'A series can run for at most 3 years');
  }

  if (repeat.frequency === 'weekly') {
    if (!repeat.weekdays.length) add('repeat.weekdays', 'Pick at least one weekday');
    if (repeat.weekdays.some((d) => !int(d) || d < 1 || d > 7))
      add('repeat.weekdays', 'Weekdays must be 1 (Monday) to 7 (Sunday)');
  }

  if (repeat.frequency === 'monthly' || repeat.frequency === 'yearly') {
    const byPosition = repeat.setPosition != null || repeat.weekday != null;
    if (byPosition) {
      if (!SET_POSITIONS.includes(repeat.setPosition as (typeof SET_POSITIONS)[number]))
        add('repeat.setPosition', 'Position must be 1–4 or -1 for the last');
      if (!int(repeat.weekday) || repeat.weekday < 1 || repeat.weekday > 7)
        add('repeat.weekday', 'Weekday must be 1 (Monday) to 7 (Sunday)');
    } else if (repeat.monthDay != null && (!int(repeat.monthDay) || repeat.monthDay < 1 || repeat.monthDay > 31)) {
      add('repeat.monthDay', 'Day of month must be 1–31');
    }
    if (repeat.frequency === 'yearly' && repeat.month != null && (!int(repeat.month) || repeat.month < 1 || repeat.month > 12))
      add('repeat.month', 'Month must be 1–12');
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Editing a series like a desktop calendar (§6.9)

export interface BlockChanges {
  kind?: BlockKind;
  startDate?: string;
  allDay?: boolean;
  startMinute?: number;
  durationMinutes?: number;
  repeat?: Partial<RepeatRule>;
  note?: string | null;
}

export interface ScopeResult {
  /** The original block after the edit, or null when it should be deleted. */
  original: BlockRule | null;
  /** New blocks to insert. */
  created: BlockRule[];
}

function applyChanges(rule: BlockRule, changes: BlockChanges): BlockRule {
  const { repeat, ...rest } = changes;
  const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  return normalizeBlock({
    ...rule,
    ...clean,
    repeat: { ...rule.repeat, ...(repeat ?? {}) },
  } as BlockRule);
}

function keepIfAlive(rule: BlockRule): BlockRule | null {
  return hasAnyOccurrence(rule) ? rule : null;
}

function withoutId(rule: BlockRule): BlockRule {
  const { id: _id, ...rest } = rule;
  return rest;
}

export function editBlock(
  rule: BlockRule,
  scope: EditScope,
  changes: BlockChanges,
  occurrenceDate?: string,
): ScopeResult {
  const repeating = rule.repeat.frequency !== 'none';
  if (!repeating || scope === 'all' || !occurrenceDate) {
    return { original: keepIfAlive(applyChanges(rule, changes)), created: [] };
  }

  if (scope === 'this') {
    const original = keepIfAlive({
      ...rule,
      exceptionDates: [...new Set([...rule.exceptionDates, occurrenceDate])].sort(),
    });
    const oneOff = applyChanges(
      { ...withoutId(rule), startDate: occurrenceDate, repeat: { ...NO_REPEAT }, exceptionDates: [] },
      { ...changes, repeat: { ...NO_REPEAT } },
    );
    return { original, created: [oneOff] };
  }

  // following
  if (occurrenceDate <= rule.startDate) {
    return { original: keepIfAlive(applyChanges(rule, changes)), created: [] };
  }
  const head = keepIfAlive({
    ...rule,
    repeat: { ...rule.repeat, untilDate: addDays(occurrenceDate, -1) },
    exceptionDates: rule.exceptionDates.filter((d) => d < occurrenceDate),
  });
  const tail = applyChanges(
    {
      ...withoutId(rule),
      startDate: occurrenceDate,
      exceptionDates: rule.exceptionDates.filter((d) => d >= occurrenceDate),
    },
    changes,
  );
  return { original: head, created: hasAnyOccurrence(tail) ? [tail] : [] };
}

export function deleteBlock(rule: BlockRule, scope: EditScope, occurrenceDate?: string): ScopeResult {
  const repeating = rule.repeat.frequency !== 'none';
  if (!repeating || scope === 'all' || !occurrenceDate) return { original: null, created: [] };
  if (scope === 'this') {
    return {
      original: keepIfAlive({
        ...rule,
        exceptionDates: [...new Set([...rule.exceptionDates, occurrenceDate])].sort(),
      }),
      created: [],
    };
  }
  if (occurrenceDate <= rule.startDate) return { original: null, created: [] };
  return {
    original: keepIfAlive({
      ...rule,
      repeat: { ...rule.repeat, untilDate: addDays(occurrenceDate, -1) },
      exceptionDates: rule.exceptionDates.filter((d) => d < occurrenceDate),
    }),
    created: [],
  };
}

/** Human summary such as "Every 2 weeks on Mon, Wed until Dec 31, 2026". */
export function describeRepeat(rule: Pick<BlockRule, 'startDate' | 'repeat'>): string {
  const r = rule.repeat;
  if (r.frequency === 'none') return 'Does not repeat';
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.frequency];
  let text = r.interval === 1 ? `Every ${unit}` : `Every ${r.interval} ${unit}s`;
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const ordinal = (n: number) => (n === -1 ? 'last' : ['first', 'second', 'third', 'fourth'][n - 1]);
  if (r.frequency === 'weekly' && r.weekdays.length) {
    text += ` on ${r.weekdays.map((d) => dayNames[d - 1]).join(', ')}`;
  }
  if (r.frequency === 'monthly' || r.frequency === 'yearly') {
    const monthName =
      r.frequency === 'yearly' && r.month ? ` of ${DateTime.fromObject({ month: r.month }).toFormat('LLLL')}` : '';
    if (r.setPosition != null && r.weekday != null) {
      text += ` on the ${ordinal(r.setPosition)} ${dayNames[r.weekday - 1]}${monthName}`;
    } else {
      text += ` on day ${r.monthDay ?? parseDate(rule.startDate).day}${monthName}`;
    }
  }
  if (r.untilDate) text += ` until ${parseDate(r.untilDate).toFormat('LLL d, yyyy')}`;
  return text;
}
