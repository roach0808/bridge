import { DateTime, FixedOffsetZone, IANAZone } from 'luxon';

/**
 * Times typed the way people write them in a message — "3pm", "3:30 PM ET",
 * "15:30", "9.30am KST", "noon", "10 am UTC+9" — instead of picked from a clock.
 * Without a zone, the time is on the writer's own clock.
 */

/** Zone words people type, each to the place whose clock it means (daylight saving included). */
const ZONE_WORDS: Record<string, string> = {
  et: 'America/New_York',
  est: 'America/New_York',
  edt: 'America/New_York',
  eastern: 'America/New_York',
  ny: 'America/New_York',
  ct: 'America/Chicago',
  cst: 'America/Chicago',
  cdt: 'America/Chicago',
  central: 'America/Chicago',
  mt: 'America/Denver',
  mst: 'America/Denver',
  mdt: 'America/Denver',
  mountain: 'America/Denver',
  pt: 'America/Los_Angeles',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  pacific: 'America/Los_Angeles',
  akt: 'America/Anchorage',
  akst: 'America/Anchorage',
  akdt: 'America/Anchorage',
  ht: 'Pacific/Honolulu',
  hst: 'Pacific/Honolulu',
  brt: 'America/Sao_Paulo',
  utc: 'UTC',
  gmt: 'UTC',
  z: 'UTC',
  uk: 'Europe/London',
  bst: 'Europe/London',
  london: 'Europe/London',
  cet: 'Europe/Paris',
  cest: 'Europe/Paris',
  eet: 'Europe/Athens',
  eest: 'Europe/Athens',
  msk: 'Europe/Moscow',
  sast: 'Africa/Johannesburg',
  gst: 'Asia/Dubai',
  pkt: 'Asia/Karachi',
  ist: 'Asia/Kolkata',
  sgt: 'Asia/Singapore',
  hkt: 'Asia/Hong_Kong',
  jst: 'Asia/Tokyo',
  kst: 'Asia/Seoul',
  aet: 'Australia/Sydney',
  aest: 'Australia/Sydney',
  aedt: 'Australia/Sydney',
  nzt: 'Pacific/Auckland',
  nzst: 'Pacific/Auckland',
  nzdt: 'Pacific/Auckland',
};

/** The zones a person can type, for hints. */
export const TYPED_ZONE_EXAMPLES = 'ET, CT, PT, UTC, KST, or UTC+9';

/** The zone a typed word means ("ET", "UTC+9", "Asia/Seoul"), or null. */
export function zoneFromWord(word: string): string | null {
  const w = word.trim();
  if (!w) return null;
  const known = ZONE_WORDS[w.toLowerCase()];
  if (known) return known;
  const offset = /^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(w);
  if (offset) {
    const hours = Number(offset[2]);
    const minutes = Number(offset[3] ?? 0);
    if (hours > 14 || minutes > 59) return null;
    const total = (offset[1] === '-' ? -1 : 1) * (hours * 60 + minutes);
    return FixedOffsetZone.instance(total).name;
  }
  return w.includes('/') && IANAZone.isValidZone(w) ? w : null;
}

export interface TypedTime {
  hour: number;
  minute: number;
  /** The zone it is on: the one typed, or the writer's own. */
  zone: string;
  /** A zone was typed. */
  zoned: boolean;
}

export type TypedTimeResult = { ok: true; time: TypedTime } | { ok: false; error: string };

const MERIDIEM = String.raw`a\.?m?\.?|p\.?m?\.?`;
const TIME_RE = new RegExp(String.raw`^(?:(noon|midday|midnight)|(\d{1,2})(?:\s*[:.h]\s*(\d{2}))?|(\d{1,2})(\d{2}))\s*(${MERIDIEM})?$`, 'i');

/**
 * Reads a typed time. Empty text gives null (nothing typed yet). An hour from 1
 * to 11 needs AM or PM, unless it is written as on a 24-hour clock ("09:30").
 */
export function parseTypedTime(text: string, ownZone: string): TypedTimeResult | null {
  const typed = text.trim().replace(/\s+/g, ' ');
  if (!typed) return null;

  // The zone, if any, comes last: "3pm ET", "3pmET", "15:30 UTC+9", "9am (Asia/Seoul)".
  let clock = typed;
  let zone = ownZone;
  let zoned = false;
  if (!TIME_RE.test(typed)) {
    const split = splitZone(typed);
    if (split && !split.zone) return { ok: false, error: `Unknown time zone “${split.word}”. Try ${TYPED_ZONE_EXAMPLES}` };
    if (split?.zone) {
      clock = split.clock;
      zone = split.zone;
      zoned = true;
    }
  }

  const m = TIME_RE.exec(clock);
  if (!m) return { ok: false, error: 'Type a time like 3pm, 3:30 PM ET or 15:30' };
  const meridiem = m[6]?.toLowerCase().startsWith('p') ? 'pm' : m[6] ? 'am' : null;

  let hour: number;
  let minute: number;
  if (m[1]) {
    if (meridiem) return { ok: false, error: 'Type a time like 3pm, 3:30 PM ET or 15:30' };
    hour = m[1].toLowerCase() === 'midnight' ? 0 : 12;
    minute = 0;
  } else {
    const hourText = (m[2] ?? m[4])!;
    hour = Number(hourText);
    minute = Number(m[3] ?? m[5] ?? 0);
    if (minute > 59) return { ok: false, error: 'Minutes go up to 59' };
    if (meridiem) {
      if (hour < 1 || hour > 12) return { ok: false, error: 'With AM or PM, the hour is 1 to 12' };
      hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
    } else {
      if (hour > 23) return { ok: false, error: 'The hour is 0 to 23, or 1 to 12 with AM or PM' };
      if (hour >= 1 && hour <= 11 && !hourText.startsWith('0')) return { ok: false, error: 'Add AM or PM (or write it as 09:00)' };
    }
  }
  return { ok: true, time: { hour, minute, zone, zoned } };
}

/**
 * Splits "3pm ET" into a clock and a zone. Letters run together ("3pmET"), so
 * each place they could split is tried, the longest zone first. A clock followed
 * by a word that is no zone gives that word, with no zone; no clock at all gives null.
 */
function splitZone(typed: string): { clock: string; word: string; zone: string | null } | null {
  const offset = /^(.*?)\s*\(?((?:utc|gmt)\s*[+-]\s*\d{1,2}(?::?\d{2})?)\)?$/i.exec(typed);
  if (offset && TIME_RE.test(offset[1]!)) return { clock: offset[1]!, word: offset[2]!, zone: zoneFromWord(offset[2]!) };
  const letters = /\(?([a-z][a-z_/]*)\)?$/i.exec(typed);
  if (!letters) return null;
  const run = letters[1]!;
  let unknown: { clock: string; word: string; zone: null } | null = null;
  for (let i = 0; i < run.length; i++) {
    const clock = (typed.slice(0, letters.index) + run.slice(0, i)).trim();
    const word = run.slice(i);
    if (!TIME_RE.test(clock)) continue;
    const zone = zoneFromWord(word);
    if (zone) return { clock, word, zone };
    // The clock that keeps the most letters is the one meant: "3pm xyz" names "xyz".
    unknown = { clock, word, zone: null };
  }
  return unknown;
}

/** The instant a calendar day (yyyy-mm-dd) and a typed time make, as an ISO string. */
export function typedInstant(day: string, time: TypedTime): string | null {
  const dt = DateTime.fromISO(day, { zone: time.zone }).set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

// --- Finding a time and a day in what someone types ------------------------------------

const ZONE_TOKEN = String.raw`(?:utc|gmt)\s*[+-]\s*\d{1,2}(?::?\d{2})?|[a-z]{1,8}(?:\/[a-z_]+)?`;
const FIND_TIME_RE = new RegExp(
  String.raw`(?:^|[^\w:])(noon|midday|midnight|\d{1,2}(?:\s*[:.]\s*\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|a|p)|\d{1,2}:\d{2})(?![\w:])(?:(?:\s+\(?|\s*\()(${ZONE_TOKEN})\)?)?(?=$|[^\w:])`,
  'gi',
);

/**
 * The first time written in a sentence ("can we do 3pm ET tomorrow?" → "3pm ET"),
 * as it was typed, or null. A word after it counts as its zone only when it is one.
 */
export function findTypedTime(text: string): string | null {
  for (const m of text.matchAll(FIND_TIME_RE)) {
    const clock = m[1]!.trim();
    const phrase = m[2] && zoneFromWord(m[2]) ? `${clock} ${m[2]}` : clock;
    if (parseTypedTime(phrase, 'UTC')?.ok) return phrase;
  }
  return null;
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * A day named in a sentence — "today", "tomorrow", or a weekday (the next one,
 * today included) — as yyyy-mm-dd in the zone, or null.
 */
export function findTypedDay(text: string, zone: string, now: DateTime = DateTime.now()): string | null {
  const today = now.setZone(zone).startOf('day');
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (word === 'today' || word === 'tonight') return today.toISODate();
    if (TOMORROW.includes(word)) return today.plus({ days: 1 }).toISODate();
    const index = weekdayOf(word);
    if (index >= 0) return today.plus({ days: (index + 1 - today.weekday + 7) % 7 }).toISODate();
  }
  return null;
}

const TOMORROW = ['tomorrow', 'tmr', 'tmrw'];
/** "wed", "thurs", "friday" → 0 for Monday … 6 for Sunday; -1 for any other word. */
const weekdayOf = (word: string) => (word.length >= 3 ? WEEKDAYS.findIndex((d) => d.startsWith(word)) : -1);

/** Words that name a day; they say when, not which sentence. */
export const isDayWord = (word: string) => ['today', 'tonight', ...TOMORROW].includes(word) || weekdayOf(word) >= 0;
