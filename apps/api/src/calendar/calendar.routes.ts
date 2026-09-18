import {
  BLOCKING_STATUSES,
  addDays,
  blockBodySchema,
  blockDeleteQuerySchema,
  blockPatchSchema,
  calendarQuerySchema,
  deleteBlock,
  editBlock,
  expandBlocks,
  normalizeBlock,
  occursOn,
  validateBlock,
  statusForRole,
  type BlockRule,
  type BusyInterval,
  type CalendarCall,
  type CalendarResponse,
  type ExpertColumn,
  type ExpertRef,
  type ExpertsCalendarResponse,
  type Occurrence,
  type ScheduleBlockDTO,
} from '@god/shared';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { visibleCallsWhere } from '../calls/calls.access';
import { prisma } from '../db';
import { badRequest, forbidden, notFound } from '../errors';
import { fromDateOnly, idParam, iso, parseBody, parseQuery } from '../http';
import { toUserRef, userRefSelect } from '../serializers';
import { rowToRule, ruleToData, toBlockDTO } from './blocks';

export const calendarRouter = Router();

const calendarCallSelect = {
  id: true,
  status: true,
  scheduledAt: true,
  endsAt: true,
  durationMinutes: true,
  expertId: true,
  platform: { select: { id: true, name: true } },
  profile: { select: { id: true, name: true, avatarId: true, photoId: true } },
  associate: { select: userRefSelect },
  expert: { select: userRefSelect },
} satisfies Prisma.CallSelect;

type CalendarCallRow = Prisma.CallGetPayload<{ select: typeof calendarCallSelect }>;

const toCalendarCall = (c: CalendarCallRow, viewer: Pick<Actor, 'role'>): CalendarCall => ({
  id: c.id,
  status: statusForRole(viewer.role, c.status),
  scheduledAt: iso(c.scheduledAt),
  endsAt: iso(c.endsAt),
  durationMinutes: c.durationMinutes,
  platform: c.platform,
  profile: c.profile,
  associate: toUserRef(c.associate),
  expert: c.expert ? toUserRef(c.expert) : null,
});

const expertRefSelect = { ...userRefSelect, timeZone: true, createdAt: true } satisfies Prisma.UserSelect;
type ExpertRow = Prisma.UserGetPayload<{ select: typeof expertRefSelect }>;
const toExpertRef = (e: ExpertRow): ExpertRef => ({ ...toUserRef(e), timeZone: e.timeZone });

const overlaps = (from: Date, to: Date): Prisma.CallWhereInput => ({
  scheduledAt: { lt: to },
  endsAt: { gt: from },
});

/** Blocks that could produce an occurrence in the range, in any zone. */
async function loadBlocks(expertIds: string[], from: Date, to: Date) {
  const fromDate = fromDateOnly(addDays(from.toISOString().slice(0, 10), -2));
  const toDate = fromDateOnly(addDays(to.toISOString().slice(0, 10), 2));
  return prisma.scheduleBlock.findMany({
    where: {
      expertId: { in: expertIds },
      startDate: { lte: toDate },
      OR: [{ untilDate: null, frequency: 'none', startDate: { gte: fromDate } }, { untilDate: { gte: fromDate } }],
    },
    orderBy: [{ startDate: 'asc' }, { startMinute: 'asc' }],
  });
}

interface ExpertCalendar {
  calls: CalendarCall[];
  busy: BusyInterval[];
  occurrences: Occurrence[];
  rules: ScheduleBlockDTO[];
}

/**
 * The privacy rules of §6.9 for one or many Experts: calls the viewer could
 * already see come back in full; the Expert's other blocking calls only as
 * busy time; notes and editable rules only for the Expert and the Founder.
 */
async function buildExpertCalendars(
  actor: Actor,
  expertIds: string[],
  from: Date,
  to: Date,
): Promise<Map<string, ExpertCalendar>> {
  const [calls, blocks] = await Promise.all([
    prisma.call.findMany({
      where: { expertId: { in: expertIds }, ...overlaps(from, to) },
      select: { ...calendarCallSelect, associateId: true, associate: { select: { ...userRefSelect, managerId: true } } },
      orderBy: { scheduledAt: 'asc' },
    }),
    loadBlocks(expertIds, from, to),
  ]);
  const visibleIds = new Set(
    (
      await prisma.call.findMany({
        where: { AND: [visibleCallsWhere(actor), { id: { in: calls.map((c) => c.id) } }] },
        select: { id: true },
      })
    ).map((c) => c.id),
  );
  const seesRules = (expertId: string) => actor.role === 'founder' || actor.id === expertId;

  const result = new Map<string, ExpertCalendar>();
  for (const id of expertIds) result.set(id, { calls: [], busy: [], occurrences: [], rules: [] });

  for (const call of calls) {
    const entry = result.get(call.expertId!)!;
    if (visibleIds.has(call.id)) entry.calls.push(toCalendarCall(call, actor));
    // Everyone sees that a slot is taken, including calls still being scheduled.
    else if ((BLOCKING_STATUSES as string[]).includes(call.status))
      entry.busy.push({ startsAt: iso(call.scheduledAt), endsAt: iso(call.endsAt) });
    else if (call.status === 'on_scheduling')
      entry.busy.push({ startsAt: iso(call.scheduledAt), endsAt: iso(call.endsAt), tentative: true });
  }

  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const byExpert = new Map<string, typeof blocks>();
  for (const b of blocks) byExpert.set(b.expertId, [...(byExpert.get(b.expertId) ?? []), b]);
  for (const [expertId, rows] of byExpert) {
    const entry = result.get(expertId)!;
    entry.occurrences = expandBlocks(rows.map(rowToRule), fromIso, toIso);
    if (seesRules(expertId)) entry.rules = rows.map(toBlockDTO);
  }
  return result;
}

calendarRouter.get('/calendar', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const query = parseQuery(calendarQuerySchema, req);
  const from = new Date(query.from);
  const to = new Date(query.to);

  let expertId = query.expertId;
  if (actor.role === 'expert') {
    if (expertId && expertId !== actor.id) throw forbidden('Experts can only open their own calendar');
    expertId = actor.id;
  }

  if (!expertId) {
    const calls = await prisma.call.findMany({
      where: { AND: [visibleCallsWhere(actor), overlaps(from, to)] },
      select: calendarCallSelect,
      orderBy: { scheduledAt: 'asc' },
    });
    const body: CalendarResponse = {
      from: query.from,
      to: query.to,
      expert: null,
      canEditBlocks: false,
      calls: calls.map((c) => toCalendarCall(c, actor)),
      busy: [],
      occurrences: [],
      rules: [],
    };
    return res.json(body);
  }

  const expert = await prisma.user.findFirst({ where: { id: expertId, role: 'expert' }, select: expertRefSelect });
  if (!expert) throw notFound('Expert');
  const cal = (await buildExpertCalendars(actor, [expert.id], from, to)).get(expert.id)!;
  const canEditBlocks = actor.role === 'founder' || actor.id === expert.id;
  const body: CalendarResponse = {
    from: query.from,
    to: query.to,
    expert: toExpertRef(expert),
    canEditBlocks,
    calls: cal.calls,
    busy: cal.busy,
    occurrences: cal.occurrences,
    rules: canEditBlocks ? cal.rules : [],
  };
  res.json(body);
});

calendarRouter.get('/calendar/experts', requireAuth, requireRole('founder', 'manager', 'associate'), async (req, res) => {
  const actor = actorOf(req);
  const query = parseQuery(calendarQuerySchema, req);
  const from = new Date(query.from);
  const to = new Date(query.to);

  // Slot = position by join date among every Expert, so colours stay stable.
  const allExperts = await prisma.user.findMany({
    where: { role: 'expert' },
    select: { ...expertRefSelect, isActive: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const active = allExperts.map((e, slot) => ({ e, slot })).filter(({ e }) => e.isActive);
  const calendars = await buildExpertCalendars(actor, active.map(({ e }) => e.id), from, to);

  const experts: ExpertColumn[] = active.map(({ e, slot }) => {
    const cal = calendars.get(e.id)!;
    return { expert: toExpertRef(e), slot, calls: cal.calls, busy: cal.busy, occurrences: cal.occurrences };
  });
  const body: ExpertsCalendarResponse = { from: query.from, to: query.to, experts };
  res.json(body);
});

// --- Schedule blocks ---------------------------------------------------------

function assertCanEditBlocks(actor: Actor, expertId: string) {
  if (actor.role !== 'founder' && actor.id !== expertId) {
    throw forbidden('Only the Expert and the Founder manage this calendar');
  }
}

function assertValid(rule: BlockRule) {
  const issues = validateBlock(rule);
  if (issues.length) throw badRequest(issues[0]!.message, { issues });
}

async function loadBlock(actor: Actor, id: string | null) {
  if (!id) throw notFound('Schedule block');
  const block = await prisma.scheduleBlock.findUnique({ where: { id } });
  if (!block) throw notFound('Schedule block');
  // Hide the block's existence from people who cannot manage it.
  if (actor.role !== 'founder' && actor.id !== block.expertId) throw notFound('Schedule block');
  return block;
}

calendarRouter.post('/experts/:expertId/schedule-blocks', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const expertId = idParam(req, 'expertId');
  const expert = expertId
    ? await prisma.user.findFirst({ where: { id: expertId, role: 'expert' }, select: { id: true, timeZone: true } })
    : null;
  if (!expert) throw notFound('Expert');
  assertCanEditBlocks(actor, expert.id);

  const input = parseBody(blockBodySchema, req);
  const rule = normalizeBlock({
    kind: input.kind,
    timeZone: expert.timeZone,
    startDate: input.startDate,
    allDay: input.allDay,
    startMinute: input.startMinute,
    durationMinutes: input.durationMinutes,
    repeat: input.repeat,
    exceptionDates: [],
    note: input.note ?? null,
  });
  assertValid(rule);
  const row = await prisma.scheduleBlock.create({
    data: { ...ruleToData(rule), expertId: expert.id, createdById: actor.id },
  });
  res.status(201).json(toBlockDTO(row));
});

function assertOccurrence(rule: BlockRule, scope: string, date: string | undefined) {
  if (rule.repeat.frequency === 'none' || scope === 'all') return;
  if (!date) throw badRequest('Say which date of the series you mean', { issues: [{ path: 'occurrenceDate', message: 'Required' }] });
  if (!occursOn(rule, date)) throw badRequest('That date is not part of the series');
}

async function applyScopeResult(
  actor: Actor,
  row: { id: string; expertId: string },
  result: { original: BlockRule | null; created: BlockRule[] },
) {
  for (const rule of [result.original, ...result.created]) if (rule) assertValid(rule);
  return prisma.$transaction(async (tx) => {
    const updated = result.original
      ? await tx.scheduleBlock.update({ where: { id: row.id }, data: ruleToData(result.original) })
      : (await tx.scheduleBlock.delete({ where: { id: row.id } }), null);
    const created = [];
    for (const rule of result.created) {
      created.push(
        await tx.scheduleBlock.create({ data: { ...ruleToData(rule), expertId: row.expertId, createdById: actor.id } }),
      );
    }
    return {
      updated: updated ? toBlockDTO(updated) : null,
      deleted: updated ? [] : [row.id],
      created: created.map(toBlockDTO),
    };
  });
}

calendarRouter.patch('/schedule-blocks/:id', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const row = await loadBlock(actor, idParam(req));
  const { scope, occurrenceDate, changes } = parseBody(blockPatchSchema, req);
  const rule = rowToRule(row);
  assertOccurrence(rule, scope, occurrenceDate);
  const result = editBlock(rule, scope, changes, occurrenceDate);
  res.json(await applyScopeResult(actor, row, result));
});

calendarRouter.delete('/schedule-blocks/:id', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const row = await loadBlock(actor, idParam(req));
  const { scope, date } = parseQuery(blockDeleteQuerySchema, req);
  const rule = rowToRule(row);
  assertOccurrence(rule, scope, date);
  res.json(await applyScopeResult(actor, row, deleteBlock(rule, scope, date)));
});
