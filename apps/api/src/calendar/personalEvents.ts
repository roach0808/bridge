import {
  PERSONAL_CALENDAR_ROLES,
  addDays,
  blockDeleteQuerySchema,
  calendarRangeSchema,
  deleteBlock,
  displayZoneFor,
  editBlock,
  expandBlocks,
  normalizeBlock,
  occursOn,
  personalEventBodySchema,
  personalEventPatchSchema,
  validateBlock,
  type BlockRule,
  type PersonalEventDTO,
  type PersonalEventMutationResult,
  type PersonalEventsResponse,
} from '@god/shared';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { prisma } from '../db';
import { badRequest, notFound } from '../errors';
import { dateOnly, fromDateOnly, idParam, iso, parseBody, parseQuery } from '../http';

/**
 * A Founder's own events (§6.9b). They repeat exactly like an Expert's time
 * off, so they go through the same rule engine; the engine carries a block
 * kind along, which means nothing for an event and is dropped on the way out.
 */
export const personalEventsRouter = Router();

type EventRow = Prisma.PersonalEventGetPayload<object>;
type EventRule = BlockRule & { title: string };

const AS_BLOCK = 'unavailable' as const;

function rowToRule(row: EventRow): EventRule {
  return {
    id: row.id,
    kind: AS_BLOCK,
    title: row.title,
    timeZone: row.timeZone,
    startDate: dateOnly(row.startDate),
    allDay: row.allDay,
    startMinute: row.startMinute,
    durationMinutes: row.durationMinutes,
    repeat: {
      frequency: row.frequency,
      interval: row.interval,
      weekdays: row.weekdays,
      monthDay: row.monthDay,
      setPosition: row.setPosition,
      weekday: row.weekday,
      month: row.month,
      untilDate: row.untilDate ? dateOnly(row.untilDate) : null,
    },
    exceptionDates: row.exceptionDates,
    note: row.note,
  };
}

function toEventDTO(row: EventRow): PersonalEventDTO {
  const { kind: _kind, ...rule } = rowToRule(row);
  return { ...rule, id: row.id, note: row.note, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) };
}

/** Columns for insert/update from a rule (id and owner are set by the caller). */
function ruleToData(rule: EventRule) {
  return {
    title: rule.title,
    timeZone: rule.timeZone,
    startDate: fromDateOnly(rule.startDate),
    allDay: rule.allDay,
    startMinute: rule.startMinute,
    durationMinutes: rule.durationMinutes,
    frequency: rule.repeat.frequency,
    interval: rule.repeat.interval,
    weekdays: rule.repeat.weekdays,
    monthDay: rule.repeat.monthDay,
    setPosition: rule.repeat.setPosition,
    weekday: rule.repeat.weekday,
    month: rule.repeat.month,
    untilDate: rule.repeat.untilDate ? fromDateOnly(rule.repeat.untilDate) : null,
    exceptionDates: rule.exceptionDates,
    note: rule.note ?? null,
  } satisfies Omit<Prisma.PersonalEventUncheckedCreateInput, 'ownerId'>;
}

function assertValid(rule: BlockRule) {
  const issues = validateBlock(rule);
  if (issues.length) throw badRequest(issues[0]!.message, { issues });
}

function assertOccurrence(rule: BlockRule, scope: string, date: string | undefined) {
  if (rule.repeat.frequency === 'none' || scope === 'all') return;
  if (!date) throw badRequest('Say which date of the series you mean', { issues: [{ path: 'occurrenceDate', message: 'Required' }] });
  if (!occursOn(rule, date)) throw badRequest('That date is not part of the series');
}

/** Only the owner ever learns an event exists. */
async function loadEvent(actor: Actor, id: string | null) {
  if (!id) throw notFound('Event');
  const row = await prisma.personalEvent.findUnique({ where: { id } });
  if (!row || row.ownerId !== actor.id) throw notFound('Event');
  return row;
}

const onlyOwners = [requireAuth, requireRole(...PERSONAL_CALENDAR_ROLES)];

personalEventsRouter.get('/personal-events', ...onlyOwners, async (req, res) => {
  const actor = actorOf(req);
  const query = parseQuery(calendarRangeSchema, req);
  const from = new Date(query.from);
  const to = new Date(query.to);
  // Rows that could produce a date in the range, in any zone (as for schedule blocks).
  const fromDate = fromDateOnly(addDays(from.toISOString().slice(0, 10), -2));
  const toDate = fromDateOnly(addDays(to.toISOString().slice(0, 10), 2));
  const rows = await prisma.personalEvent.findMany({
    where: {
      ownerId: actor.id,
      startDate: { lte: toDate },
      OR: [{ untilDate: null, frequency: 'none', startDate: { gte: fromDate } }, { untilDate: { gte: fromDate } }],
    },
    orderBy: [{ startDate: 'asc' }, { startMinute: 'asc' }],
  });
  const occurrences = expandBlocks(rows.map(rowToRule), from.toISOString(), to.toISOString()).map((o) => ({
    eventId: o.blockId!,
    date: o.date,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    allDay: o.allDay,
    isRecurring: o.isRecurring,
  }));
  const body: PersonalEventsResponse = { from: query.from, to: query.to, occurrences, events: rows.map(toEventDTO) };
  res.json(body);
});

personalEventsRouter.post('/personal-events', ...onlyOwners, async (req, res) => {
  const actor = actorOf(req);
  const input = parseBody(personalEventBodySchema, req);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { role: true, timeZone: true } });
  const rule: EventRule = {
    ...normalizeBlock({
      kind: AS_BLOCK,
      // The zone their calendar is drawn in, so 9:00 AM stays 9:00 AM on it.
      timeZone: displayZoneFor(owner),
      startDate: input.startDate,
      allDay: input.allDay,
      startMinute: input.startMinute,
      durationMinutes: input.durationMinutes,
      repeat: input.repeat,
      exceptionDates: [],
      note: input.note ?? null,
    }),
    title: input.title,
  };
  assertValid(rule);
  const row = await prisma.personalEvent.create({ data: { ...ruleToData(rule), ownerId: actor.id } });
  res.status(201).json(toEventDTO(row));
});

/**
 * Writes what the rule engine decided. `titles` says what each side is called:
 * the original row and the rows split off it can differ after a rename.
 */
async function applyScopeResult(
  row: EventRow,
  result: { original: BlockRule | null; created: BlockRule[] },
  titles: { original: string; created: string },
): Promise<PersonalEventMutationResult> {
  for (const rule of [result.original, ...result.created]) if (rule) assertValid(rule);
  return prisma.$transaction(async (tx) => {
    const updated = result.original
      ? await tx.personalEvent.update({ where: { id: row.id }, data: ruleToData({ ...result.original, title: titles.original }) })
      : (await tx.personalEvent.delete({ where: { id: row.id } }), null);
    const created = [];
    for (const rule of result.created) {
      created.push(await tx.personalEvent.create({ data: { ...ruleToData({ ...rule, title: titles.created }), ownerId: row.ownerId } }));
    }
    return {
      updated: updated ? toEventDTO(updated) : null,
      deleted: updated ? [] : [row.id],
      created: created.map(toEventDTO),
    };
  });
}

personalEventsRouter.patch('/personal-events/:id', ...onlyOwners, async (req, res) => {
  const actor = actorOf(req);
  const row = await loadEvent(actor, idParam(req));
  const { scope, occurrenceDate, changes } = parseBody(personalEventPatchSchema, req);
  const rule = rowToRule(row);
  assertOccurrence(rule, scope, occurrenceDate);
  const { title, ...ruleChanges } = changes;
  const newTitle = title ?? row.title;
  // As in editBlock: the row itself is the edited event unless "this" or "following"
  // split part of a series off it, and then only the part split off is renamed.
  const splits =
    rule.repeat.frequency !== 'none' &&
    occurrenceDate != null &&
    (scope === 'this' || (scope === 'following' && occurrenceDate > rule.startDate));
  const result = editBlock(rule, scope, ruleChanges, occurrenceDate);
  res.json(await applyScopeResult(row, result, { original: splits ? row.title : newTitle, created: newTitle }));
});

personalEventsRouter.delete('/personal-events/:id', ...onlyOwners, async (req, res) => {
  const actor = actorOf(req);
  const row = await loadEvent(actor, idParam(req));
  const { scope, date } = parseQuery(blockDeleteQuerySchema, req);
  const rule = rowToRule(row);
  assertOccurrence(rule, scope, date);
  res.json(await applyScopeResult(row, deleteBlock(rule, scope, date), { original: row.title, created: row.title }));
});
