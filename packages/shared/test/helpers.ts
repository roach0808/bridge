import { NO_REPEAT, expandBlock, type BlockRule, type RepeatRule } from '../src';

export type RuleOverrides = Partial<Omit<BlockRule, 'repeat'>> & { repeat?: Partial<RepeatRule> };

/** A 09:00–10:00 non-repeating UTC block on 2026-01-05 unless overridden. */
export function rule(overrides: RuleOverrides = {}): BlockRule {
  const { repeat, ...rest } = overrides;
  return {
    kind: 'unavailable',
    timeZone: 'UTC',
    startDate: '2026-01-05',
    allDay: false,
    startMinute: 540,
    durationMinutes: 60,
    exceptionDates: [],
    note: null,
    ...rest,
    repeat: { ...NO_REPEAT, ...(repeat ?? {}) },
  };
}

/** Local dates of the occurrences overlapping [from, to). Bare dates mean UTC midnight. */
export function dates(r: BlockRule, from: string, to: string): string[] {
  const norm = (s: string) => (s.length === 10 ? `${s}T00:00:00Z` : s);
  return expandBlock(r, norm(from), norm(to)).map((o) => o.date);
}

/** Every ISO date from `from` to `to` inclusive. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
