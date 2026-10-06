import { DateTime } from 'luxon';
import { z } from 'zod';
import { CALL_DURATIONS } from './callStatus';
import type { Role } from './roles';

/**
 * An Expert and the team (a Manager or an Associate) chat only to schedule
 * calls: each message is one of the sentences below, with its blanks filled
 * from fixed choices — a day, a time, a length, a reason. Nothing typed by hand
 * goes through, so contact details, rates and side deals stay out of it.
 *
 * Times are kept as instants and written out in each reader's own zone, so the
 * Expert in Seoul and the Manager in New York both read their own clock.
 */

/** Who may send a sentence: the Expert, or the Manager or Associate on the other side. */
export type SchedulingSide = 'expert' | 'team';

export const schedulingSideOf = (role: Role): SchedulingSide => (role === 'expert' ? 'expert' : 'team');

export const SCHEDULING_REASONS = ['conflict', 'illness', 'travel', 'emergency'] as const;
export type SchedulingReason = (typeof SCHEDULING_REASONS)[number];
export const SCHEDULING_REASON_LABELS: Record<SchedulingReason, string> = {
  conflict: 'a schedule conflict',
  illness: 'illness',
  travel: 'travel',
  emergency: 'an emergency',
};

export const SCHEDULING_LATE_MINUTES = [5, 10, 15] as const;

/** At most this many times offered in one message. */
export const SCHEDULING_MAX_SLOTS = 3;

/**
 * The kinds of blank:
 * - `datetime`: one moment;
 * - `datetimes`: one to three moments to choose from;
 * - `range`: from one moment to a later one, within a week;
 * - `day`: a calendar day (yyyy-mm-dd), the same wherever you read it;
 * - `days`: from one day to another, within a month;
 * - `duration`: a call length (15, 30, 45 or 60 minutes);
 * - `late`: 5, 10 or 15 minutes;
 * - `reason`: why someone needs to move a call.
 */
export type SchedulingSlotType = 'datetime' | 'datetimes' | 'range' | 'day' | 'days' | 'duration' | 'late' | 'reason';

export const SCHEDULING_GROUPS = ['times', 'confirm', 'reschedule', 'cancel', 'day_of', 'replies'] as const;
export type SchedulingGroup = (typeof SCHEDULING_GROUPS)[number];
export const SCHEDULING_GROUP_LABELS: Record<SchedulingGroup, string> = {
  times: 'Finding a time',
  confirm: 'Confirming',
  reschedule: 'Rescheduling',
  cancel: 'Cancelling',
  day_of: 'On the day',
  replies: 'Short replies',
};

export interface SchedulingTemplate {
  group: SchedulingGroup;
  /** Who may send it; `both` is either side. */
  from: SchedulingSide | 'both';
  /** The sentence, with `{name}` where each blank goes. */
  text: string;
  /** The blanks, by name. */
  slots: Record<string, SchedulingSlotType>;
}

const t = (group: SchedulingGroup, from: SchedulingTemplate['from'], text: string, slots: SchedulingTemplate['slots'] = {}): SchedulingTemplate => ({
  group,
  from,
  text,
  slots,
});

/** Every sentence there is. A key, once used, is never renamed: messages store it. */
export const SCHEDULING_TEMPLATES = {
  // Finding a time
  ask_available: t('times', 'team', 'Are you available for a {duration} call on {at}?', { duration: 'duration', at: 'datetime' }),
  ask_times_on_day: t('times', 'team', 'Which times work for you on {day}?', { day: 'day' }),
  ask_availability: t('times', 'team', 'Please share your availability for {days}.', { days: 'days' }),
  available_window: t('times', 'expert', 'I’m available {range}.', { range: 'range' }),
  available_slots: t('times', 'expert', 'I’m available at any of these times: {slots}.', { slots: 'datetimes' }),
  not_available_day: t('times', 'expert', 'I’m not available on {day}.', { day: 'day' }),
  only_duration: t('times', 'expert', 'I’m only available for {duration}.', { duration: 'duration' }),
  // Confirming
  time_works: t('confirm', 'expert', 'Yes, {at} works for me.', { at: 'datetime' }),
  call_scheduled: t('confirm', 'team', 'Your call is scheduled for {at}.', { at: 'datetime' }),
  please_confirm: t('confirm', 'team', 'Please confirm you can attend the call on {at}.', { at: 'datetime' }),
  confirmed: t('confirm', 'expert', 'Confirmed. I’ll be there.'),
  research_ready: t('confirm', 'team', 'The research for your call is ready. Please review it before the call.'),
  research_reviewed: t('confirm', 'expert', 'I’ve reviewed the research.'),
  // Rescheduling
  reschedule_to: t('reschedule', 'expert', 'I need to reschedule. Could we move it to {at}?', { at: 'datetime' }),
  reschedule_reason: t('reschedule', 'expert', 'I need to reschedule because of {reason}.', { reason: 'reason' }),
  client_reschedule: t('reschedule', 'team', 'The client asked to reschedule. Are you available on {at}?', { at: 'datetime' }),
  call_moved: t('reschedule', 'team', 'The call has been moved to {at}.', { at: 'datetime' }),
  how_about: t('reschedule', 'both', 'That time doesn’t work for me. How about {at}?', { at: 'datetime' }),
  // Cancelling
  call_cancelled: t('cancel', 'team', 'The call on {at} has been cancelled.', { at: 'datetime' }),
  cannot_do: t('cancel', 'expert', 'I can’t do this call. Please cancel it.'),
  // On the day
  reminder: t('day_of', 'team', 'Reminder: your call starts at {at}.', { at: 'datetime' }),
  running_late: t('day_of', 'expert', 'I’ll be {late} late.', { late: 'late' }),
  ready_to_join: t('day_of', 'expert', 'I’m ready and waiting to join.'),
  link_problem: t('day_of', 'expert', 'I can’t open the meeting link.'),
  details_updated: t('day_of', 'team', 'The joining details have been updated. Please check the call page.'),
  client_not_joined: t('day_of', 'expert', 'The client hasn’t joined yet.'),
  client_late: t('day_of', 'team', 'The client is running {late} late.', { late: 'late' }),
  // Short replies
  ok_thanks: t('replies', 'both', 'OK, thank you.'),
  received: t('replies', 'both', 'Received.'),
  check_details: t('replies', 'both', 'Please check the call details.'),
  get_back: t('replies', 'both', 'Let me check and get back to you.'),
} as const satisfies Record<string, SchedulingTemplate>;

export type SchedulingTemplateKey = keyof typeof SCHEDULING_TEMPLATES;
export const SCHEDULING_TEMPLATE_KEYS = Object.keys(SCHEDULING_TEMPLATES) as SchedulingTemplateKey[];

export const isSchedulingTemplateKey = (key: string): key is SchedulingTemplateKey => Object.hasOwn(SCHEDULING_TEMPLATES, key);

/** The sentences one side may send, in the catalog's order. */
export const schedulingTemplatesFor = (side: SchedulingSide): SchedulingTemplateKey[] =>
  SCHEDULING_TEMPLATE_KEYS.filter((key) => {
    const from = SCHEDULING_TEMPLATES[key].from;
    return from === 'both' || from === side;
  });

/** A filled-in sentence, as it is sent and stored. */
export interface SchedulingMessage {
  key: SchedulingTemplateKey;
  params: Record<string, SchedulingSlotValue>;
}
export type SchedulingSlotValue = string | number | string[] | { start: string; end: string } | { from: string; to: string };

// --- Checking the blanks ------------------------------------------------------------

const instant = z.string().datetime({ offset: true, message: 'Choose a date and time' });
const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a day')
  .refine((d) => DateTime.fromISO(d).isValid, 'Choose a day');

const slotSchemas: Record<SchedulingSlotType, z.ZodTypeAny> = {
  datetime: instant,
  datetimes: z.array(instant).min(1, 'Offer at least one time').max(SCHEDULING_MAX_SLOTS, `Offer at most ${SCHEDULING_MAX_SLOTS} times`),
  range: z
    .object({ start: instant, end: instant })
    .refine((r) => Date.parse(r.end) > Date.parse(r.start), 'The end must come after the start')
    .refine((r) => Date.parse(r.end) - Date.parse(r.start) <= 7 * 24 * 60 * 60 * 1000, 'Keep it within a week'),
  day: calendarDay,
  days: z
    .object({ from: calendarDay, to: calendarDay })
    .refine((r) => r.to >= r.from, 'The last day must not come before the first')
    .refine((r) => DateTime.fromISO(r.to).diff(DateTime.fromISO(r.from), 'days').days <= 31, 'Keep it within a month'),
  duration: z.number().refine((n) => (CALL_DURATIONS as readonly number[]).includes(n), 'Choose 15, 30, 45 or 60 minutes'),
  late: z.number().refine((n) => (SCHEDULING_LATE_MINUTES as readonly number[]).includes(n), 'Choose 5, 10 or 15 minutes'),
  reason: z.enum(SCHEDULING_REASONS, { errorMap: () => ({ message: 'Choose a reason' }) }),
};

/** A sentence from the catalog with every blank filled, and nothing else. */
export const schedulingMessageSchema = z
  .object({
    key: z.string().refine(isSchedulingTemplateKey, 'Choose one of the scheduling messages'),
    params: z.record(z.unknown()).default({}),
  })
  .superRefine((m, ctx) => {
    if (!isSchedulingTemplateKey(m.key)) return;
    const slots: Record<string, SchedulingSlotType> = SCHEDULING_TEMPLATES[m.key].slots;
    for (const name of Object.keys(m.params)) {
      if (!(name in slots)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['params', name], message: 'This message has no such blank' });
    }
    for (const [name, type] of Object.entries(slots)) {
      const parsed = slotSchemas[type].safeParse(m.params[name]);
      if (!parsed.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['params', name], message: parsed.error.issues[0]?.message ?? 'Fill this in' });
      }
    }
  })
  .transform((m) => m as SchedulingMessage);

// --- Writing it out -------------------------------------------------------------------

const at = (iso: string, zone: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);
/** "2 PM", or "2:30 PM" off the hour. */
const clock = (dt: DateTime) => dt.toFormat(dt.minute ? 'h:mm a' : 'h a');
const dayOf = (dt: DateTime) => dt.toFormat('ccc, LLL d');

/** "Mon, Oct 6 at 2 PM EDT" */
export function formatSchedulingMoment(iso: string, zone: string): string {
  const dt = at(iso, zone);
  return `${dayOf(dt)} at ${clock(dt)} ${dt.toFormat('ZZZZ')}`;
}

function formatValue(type: SchedulingSlotType, value: unknown, zone: string): string {
  switch (type) {
    case 'datetime':
      return formatSchedulingMoment(value as string, zone);
    case 'datetimes': {
      const list = (value as string[]).map((iso) => formatSchedulingMoment(iso, zone));
      return list.length > 1 ? `${list.slice(0, -1).join('; ')} or ${list.at(-1)}` : (list[0] ?? '');
    }
    case 'range': {
      const { start, end } = value as { start: string; end: string };
      const s = at(start, zone);
      const e = at(end, zone);
      return s.hasSame(e, 'day')
        ? `on ${dayOf(s)} from ${clock(s)} to ${clock(e)} ${e.toFormat('ZZZZ')}`
        : `from ${dayOf(s)} at ${clock(s)} to ${dayOf(e)} at ${clock(e)} ${e.toFormat('ZZZZ')}`;
    }
    case 'day':
      return dayOf(DateTime.fromISO(value as string));
    case 'days': {
      const { from, to } = value as { from: string; to: string };
      return from === to ? dayOf(DateTime.fromISO(from)) : `${dayOf(DateTime.fromISO(from))} – ${dayOf(DateTime.fromISO(to))}`;
    }
    case 'duration':
      return `${value as number}-minute`;
    case 'late':
      return `${value as number} minutes`;
    case 'reason':
      return SCHEDULING_REASON_LABELS[value as SchedulingReason] ?? String(value);
  }
}

/**
 * The sentence with its blanks written out for someone reading in `zone`. A key
 * this version doesn't know (a newer one) gives null, and the reader falls back
 * on the stored text.
 */
export function renderSchedulingMessage(m: { key: string; params: Record<string, unknown> }, zone: string): string | null {
  if (!isSchedulingTemplateKey(m.key)) return null;
  const template: SchedulingTemplate = SCHEDULING_TEMPLATES[m.key];
  return template.text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const type = template.slots[name];
    const value = m.params[name];
    if (!type || value === undefined) return whole;
    return formatValue(type, value, zone);
  });
}
