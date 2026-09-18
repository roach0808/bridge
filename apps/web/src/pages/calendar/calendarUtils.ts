import {
  CALL_DURATIONS,
  MAX_CALENDAR_RANGE_DAYS,
  type BusyInterval,
  type CalendarCall,
  type Occurrence,
} from '@god/shared';
import { DateTime } from 'luxon';

export type CalendarView = 'day' | 'week' | 'month';
export const CALENDAR_VIEWS: CalendarView[] = ['day', 'week', 'month'];

export const HOUR_HEIGHT = 48;
export const DAY_MINUTES = 1440;
export const GRID_HEIGHT = HOUR_HEIGHT * 24;
export const SNAP_MINUTES = 15;
export const DEFAULT_SCROLL_HOUR = 7;

// ---------------------------------------------------------------------------
// Browser-only preferences (never sent to the server)

const VIEW_KEY = 'god.calendar.view';
const CLIENT_ZONE_KEY = 'god.calendar.clientZone';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode, quota) — preference just isn't remembered */
  }
}

export function loadView(): CalendarView {
  const v = readStorage(VIEW_KEY);
  return CALENDAR_VIEWS.includes(v as CalendarView) ? (v as CalendarView) : 'week';
}
export const saveView = (v: CalendarView) => writeStorage(VIEW_KEY, v);

export function loadClientZone(): string | null {
  const z = readStorage(CLIENT_ZONE_KEY);
  return z && DateTime.now().setZone(z).isValid ? z : null;
}
export const saveClientZone = (z: string | null) => writeStorage(CLIENT_ZONE_KEY, z);

// ---------------------------------------------------------------------------
// Visible range, computed in the viewer's zone

export interface VisibleRange {
  /** Local midnights of every visible day, in the viewer zone. */
  days: DateTime[];
  /** Instant range sent to the API. */
  from: DateTime;
  to: DateTime;
  fromIso: string;
  toIso: string;
}

export function parseAnchor(value: string | null, zone: string): DateTime {
  if (value) {
    const d = DateTime.fromISO(value, { zone });
    if (d.isValid) return d.startOf('day');
  }
  return DateTime.now().setZone(zone).startOf('day');
}

export function visibleRange(view: CalendarView, anchor: DateTime): VisibleRange {
  let first: DateTime;
  let count: number;
  if (view === 'day') {
    first = anchor.startOf('day');
    count = 1;
  } else if (view === 'week') {
    first = anchor.startOf('week');
    count = 7;
  } else {
    first = anchor.startOf('month').startOf('week');
    count = 42;
  }
  // Build each day from calendar fields so DST transitions never shift midnights.
  const days = Array.from({ length: count }, (_, i) => first.plus({ days: i }).startOf('day'));
  const from = days[0]!;
  const to = days[days.length - 1]!.plus({ days: 1 }).startOf('day');
  if (to.diff(from, 'days').days > MAX_CALENDAR_RANGE_DAYS) throw new Error('Calendar range too large');
  return {
    days,
    from,
    to,
    fromIso: from.toUTC().toISO({ suppressMilliseconds: true })!,
    toIso: to.toUTC().toISO({ suppressMilliseconds: true })!,
  };
}

export function shiftAnchor(view: CalendarView, anchor: DateTime, dir: 1 | -1): DateTime {
  if (view === 'day') return anchor.plus({ days: dir });
  if (view === 'week') return anchor.plus({ weeks: dir });
  return anchor.startOf('month').plus({ months: dir });
}

export function rangeLabel(view: CalendarView, anchor: DateTime, days: DateTime[]): string {
  if (view === 'day') return anchor.toFormat('cccc, LLLL d, yyyy');
  if (view === 'month') return anchor.toFormat('LLLL yyyy');
  const a = days[0]!;
  const b = days[days.length - 1]!;
  if (a.year !== b.year) return `${a.toFormat('LLL d, yyyy')} – ${b.toFormat('LLL d, yyyy')}`;
  if (a.month !== b.month) return `${a.toFormat('LLL d')} – ${b.toFormat('LLL d, yyyy')}`;
  return `${a.toFormat('LLLL d')} – ${b.toFormat('d, yyyy')}`;
}

/** "EDT · New York" */
export const zoneLabel = (zone: string, at: DateTime = DateTime.now()) =>
  `${at.setZone(zone).toFormat('ZZZZ')} · ${zone.split('/').pop()?.replace(/_/g, ' ') ?? zone}`;

/** Hours in a local day (23 or 25 on DST transition days). */
export const dayLengthHours = (day: DateTime) => Math.round(day.plus({ days: 1 }).startOf('day').diff(day, 'hours').hours);

// ---------------------------------------------------------------------------
// Positioning on a wall-clock grid

/**
 * Wall-clock minute of `dt` within `day` (a local midnight), clamped to
 * [0, 1440]. Using wall-clock rather than elapsed minutes keeps every column
 * aligned with the hour labels, including on 23/25-hour DST days.
 */
export function minuteInDay(dt: DateTime, day: DateTime): number {
  const start = day;
  const end = day.plus({ days: 1 }).startOf('day');
  if (dt <= start) return 0;
  if (dt >= end) return DAY_MINUTES;
  const local = dt.setZone(day.zone);
  return local.hour * 60 + local.minute + local.second / 60;
}

/** The instant at a wall-clock minute of a local day. */
export function atMinute(day: DateTime, minute: number): DateTime {
  if (minute >= DAY_MINUTES) return day.plus({ days: 1 }).startOf('day');
  return day.set({ hour: Math.floor(minute / 60), minute: Math.round(minute % 60), second: 0, millisecond: 0 });
}

export const snap = (minute: number, step = SNAP_MINUTES) =>
  Math.max(0, Math.min(DAY_MINUTES, Math.round(minute / step) * step));
export const snapFloor = (minute: number, step = SNAP_MINUTES) =>
  Math.max(0, Math.min(DAY_MINUTES - step, Math.floor(minute / step) * step));

export const overlapsDay = (start: DateTime, end: DateTime, day: DateTime) =>
  start < day.plus({ days: 1 }).startOf('day') && end > day;

export function formatMinuteRange(day: DateTime, startMin: number, endMin: number): string {
  const s = atMinute(day, startMin);
  const e = atMinute(day, endMin);
  const same = s.toFormat('a') === e.toFormat('a');
  return `${s.toFormat(same ? 'h:mm' : 'h:mm a')} – ${e.toFormat('h:mm a')}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Round a selection to the nearest bookable call length (max 60). */
export function callDurationFor(minutes: number): number {
  let best: number = CALL_DURATIONS[0];
  for (const d of CALL_DURATIONS) if (Math.abs(d - minutes) < Math.abs(best - minutes)) best = d;
  return minutes >= 60 ? 60 : best;
}

/** A call can only be booked ahead of time, so past slots are not offered. */
export const isPastSlot = (start: DateTime) => start.toMillis() < Date.now();

export function newCallHref(start: DateTime, minutes: number, expertId?: string | null): string {
  const params = new URLSearchParams();
  if (expertId) params.set('expertId', expertId);
  params.set('start', start.toUTC().toISO({ suppressMilliseconds: true })!);
  params.set('duration', String(callDurationFor(minutes)));
  return `/calls/new?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Events

export type TimedEvent =
  | { type: 'call'; key: string; start: DateTime; end: DateTime; call: CalendarCall; tint?: string }
  | { type: 'busy'; key: string; start: DateTime; end: DateTime; busy: BusyInterval }
  | { type: 'timeoff'; key: string; start: DateTime; end: DateTime; occurrence: Occurrence };

export interface CalendarSource {
  calls: CalendarCall[];
  busy: BusyInterval[];
  occurrences: Occurrence[];
}

const utc = (iso: string, zone: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);

/**
 * True when an all-day occurrence lines up with whole local days in the viewer
 * zone. Otherwise (the Expert is in another zone) it is drawn as a timed block
 * so the hours it actually covers are honest.
 */
export function isAllDayInZone(o: Occurrence, zone: string): boolean {
  if (!o.allDay) return false;
  const s = utc(o.startsAt, zone);
  return s.hour === 0 && s.minute === 0;
}

export function buildEvents(source: CalendarSource, zone: string, availabilityEnabled: boolean, tint?: string) {
  const timed: TimedEvent[] = [];
  const allDay: Occurrence[] = [];
  const available: Occurrence[] = [];
  for (const call of source.calls) {
    timed.push({ type: 'call', key: `c:${call.id}`, start: utc(call.scheduledAt, zone), end: utc(call.endsAt, zone), call, tint });
  }
  source.busy.forEach((b, i) => {
    timed.push({ type: 'busy', key: `b:${b.startsAt}:${i}`, start: utc(b.startsAt, zone), end: utc(b.endsAt, zone), busy: b });
  });
  source.occurrences.forEach((o, i) => {
    if (o.kind === 'available') {
      if (availabilityEnabled) available.push(o);
      return;
    }
    if (isAllDayInZone(o, zone)) allDay.push(o);
    else
      timed.push({ type: 'timeoff', key: `o:${o.blockId}:${o.date}:${i}`, start: utc(o.startsAt, zone), end: utc(o.endsAt, zone), occurrence: o });
  });
  return { timed, allDay, available };
}

export interface PlacedEvent {
  event: TimedEvent;
  top: number;
  height: number;
  /** Fractions of the column width. */
  left: number;
  width: number;
  startMin: number;
  endMin: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Column packing: events are grouped into clusters of transitively
 * overlapping items, each cluster gets as many lanes as it needs, and every
 * event takes the first free lane (then stretches into empty lanes on its right).
 */
export function layoutDay(events: TimedEvent[], day: DateTime, minHeight = 18): PlacedEvent[] {
  const dayEnd = day.plus({ days: 1 }).startOf('day');
  const items = events
    .filter((e) => e.start < dayEnd && e.end > day)
    .map((event) => {
      const startMin = minuteInDay(event.start, day);
      const endMin = Math.max(minuteInDay(event.end, day), startMin + 1);
      return { event, startMin, endMin, visualEnd: Math.max(endMin, startMin + (minHeight / HOUR_HEIGHT) * 60) };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || typeOrder(a.event) - typeOrder(b.event));

  const placed: PlacedEvent[] = [];
  let cluster: Array<(typeof items)[number] & { lane: number }> = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const laneCount = Math.max(...cluster.map((c) => c.lane)) + 1;
    for (const c of cluster) {
      // Expand to the right while neighbouring lanes are free for this span.
      let span = 1;
      while (
        c.lane + span < laneCount &&
        !cluster.some((o) => o.lane === c.lane + span && o.startMin < c.visualEnd && o.visualEnd > c.startMin)
      )
        span++;
      placed.push({
        event: c.event,
        startMin: c.startMin,
        endMin: c.endMin,
        top: (c.startMin / 60) * HOUR_HEIGHT,
        height: Math.max(minHeight, ((c.endMin - c.startMin) / 60) * HOUR_HEIGHT),
        left: c.lane / laneCount,
        width: span / laneCount,
        continuesBefore: c.event.start < day,
        continuesAfter: c.event.end > dayEnd,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of items) {
    if (item.startMin >= clusterEnd) flush();
    const laneEnds: number[] = [];
    for (const c of cluster) laneEnds[c.lane] = Math.max(laneEnds[c.lane] ?? -1, c.visualEnd);
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) lane = laneEnds.length;
    cluster.push({ ...item, lane });
    clusterEnd = Math.max(clusterEnd, item.visualEnd);
  }
  flush();
  return placed;
}

const typeOrder = (e: TimedEvent) => (e.type === 'timeoff' ? 0 : e.type === 'busy' ? 1 : 2);

// ---------------------------------------------------------------------------
// Who is free (all-experts mode)

export type ConflictReason = 'call' | 'busy' | 'timeoff';

export function conflictsFor(source: CalendarSource, from: DateTime, to: DateTime): ConflictReason[] {
  const hit = (s: string, e: string) => DateTime.fromISO(s) < to && DateTime.fromISO(e) > from;
  const reasons = new Set<ConflictReason>();
  if (source.calls.some((c) => hit(c.scheduledAt, c.endsAt))) reasons.add('call');
  if (source.busy.some((b) => hit(b.startsAt, b.endsAt))) reasons.add('busy');
  if (source.occurrences.some((o) => o.kind === 'unavailable' && hit(o.startsAt, o.endsAt))) reasons.add('timeoff');
  return [...reasons];
}

export const CONFLICT_LABELS: Record<ConflictReason, string> = {
  call: 'Has a call',
  busy: 'Busy',
  timeoff: 'Time off',
};

// ---------------------------------------------------------------------------
// Extra time-axis gutters

/** Label for the hour row `hour` of `day` (viewer zone) as seen in `zone`. */
export function gutterLabel(day: DateTime, hour: number, zone: string): { text: string; dayShift: number } {
  const local = atMinute(day, hour * 60);
  const other = local.setZone(zone);
  const text = other.minute === 0 ? other.toFormat('h a') : other.toFormat('h:mm');
  const dayShift = Math.round(
    DateTime.fromISO(other.toISODate()!, { zone: 'utc' }).diff(DateTime.fromISO(local.toISODate()!, { zone: 'utc' }), 'days').days,
  );
  return { text, dayShift };
}
