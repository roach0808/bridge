import {
  BLOCKING_STATUSES,
  CALL_STATUSES,
  displayZoneFor,
  type CallDTO,
  type CallStatus,
  type DashboardSummary,
} from '@god/shared';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { actorOf, requireAuth, type Actor } from '../auth/middleware';
import { visibleCallsWhere } from '../calls/calls.access';
import { callInclude, toCallDTO } from '../calls/calls.serialize';
import { prisma } from '../db';
import { iso } from '../http';
import { toUserRef, userRefSelect } from '../serializers';

const emptyCounts = (): Record<CallStatus, number> =>
  Object.fromEntries(CALL_STATUSES.map((s) => [s, 0])) as Record<CallStatus, number>;

const FINISHED: CallStatus[] = ['finished', 'invoice_submit', 'invoice_approve', 'process_to_bank'];
const COMING: CallStatus[] = ['scheduled', 'confirmed', 'on_rescheduling'];

/** Today's booked calls in the viewer's zone (§9.3), plus anything ongoing right now. */
async function todayFor(actor: Actor): Promise<DashboardSummary['today']> {
  const zone = displayZoneFor(actor);
  const start = DateTime.now().setZone(zone).startOf('day');
  const end = start.plus({ days: 1 });
  const rows = await prisma.call.findMany({
    where: {
      AND: [
        visibleCallsWhere(actor),
        {
          OR: [
            { status: 'ongoing' },
            {
              status: { in: [...BLOCKING_STATUSES] },
              scheduledAt: { gte: start.toJSDate(), lt: end.toJSDate() },
            },
          ],
        },
      ],
    },
    include: callInclude,
    orderBy: { scheduledAt: 'asc' },
  });
  const calls = rows.map((c) => toCallDTO(c, actor));
  const by = (statuses: CallStatus[]) => calls.filter((c: CallDTO) => statuses.includes(c.status));
  return {
    date: start.toISODate()!,
    zone,
    ongoing: by(['ongoing']),
    upcoming: by(COMING),
    finished: by(FINISHED),
  };
}

async function founderTasks(actor: Actor): Promise<NonNullable<DashboardSummary['tasks']>> {
  const booked = { status: { in: [...BLOCKING_STATUSES] } };
  const [invoices, profiles] = await Promise.all([
    prisma.call.findMany({
      where: { status: 'finished' },
      include: callInclude,
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    }),
    prisma.profile.findMany({
      where: { banks: { none: {} }, calls: { some: booked } },
      select: {
        id: true,
        name: true,
        avatarId: true,
        photoId: true,
        _count: { select: { calls: { where: booked } } },
      },
      orderBy: { name: 'asc' },
    }),
  ]);
  const next = profiles.length
    ? await prisma.call.groupBy({
        by: ['profileId'],
        where: { ...booked, profileId: { in: profiles.map((p) => p.id) }, scheduledAt: { gte: new Date() } },
        _min: { scheduledAt: true },
      })
    : [];
  const nextBy = new Map(next.map((n) => [n.profileId, n._min.scheduledAt]));

  return {
    invoicesToSubmit: invoices.map((c) => toCallDTO(c, actor)),
    profilesNeedingBank: profiles
      .map((p) => {
        const nextAt = nextBy.get(p.id);
        return {
          profile: { id: p.id, name: p.name, avatarId: p.avatarId, photoId: p.photoId },
          bookedCalls: p._count.calls,
          nextCallAt: nextAt ? iso(nextAt) : null,
        };
      })
      // Soonest upcoming call first; profiles with only past calls after.
      .sort((a, b) => (a.nextCallAt ?? '9999').localeCompare(b.nextCallAt ?? '9999')),
  };
}

async function databaseStats(): Promise<NonNullable<DashboardSummary['database']>> {
  const [size] = await prisma.$queryRaw<Array<{ size: bigint }>>`
    SELECT pg_database_size(current_database())::bigint AS size`;
  const tables = await prisma.$queryRaw<Array<{ name: string; bytes: bigint; rows: bigint }>>`
    SELECT c.relname AS name,
           pg_total_relation_size(c.oid)::bigint AS bytes,
           GREATEST(c.reltuples, 0)::bigint AS rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
    ORDER BY bytes DESC`;
  return {
    sizeBytes: Number(size?.size ?? 0),
    tables: tables.map((t) => ({ name: t.name, bytes: Number(t.bytes), rows: Number(t.rows) })),
  };
}

export const dashboardRouter = Router();

/** Role landing data (§9.2) in one round trip. */
dashboardRouter.get('/dashboard', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const isFounder = actor.role === 'founder';

  const [today, grouped, tasks, database] = await Promise.all([
    todayFor(actor),
    prisma.call.groupBy({ by: ['status'], where: visibleCallsWhere(actor), _count: { _all: true } }),
    isFounder ? founderTasks(actor) : undefined,
    isFounder ? databaseStats() : undefined,
  ]);

  const byStatus = emptyCounts();
  for (const g of grouped) byStatus[g.status] = g._count._all;
  const body: DashboardSummary = { today, byStatus, ...(tasks ? { tasks } : {}), ...(database ? { database } : {}) };

  if (actor.role === 'manager') {
    const associates = await prisma.user.findMany({
      where: { role: 'associate', isActive: true, managerId: actor.id },
      select: userRefSelect,
      orderBy: { nickname: 'asc' },
    });
    const counts = await prisma.call.groupBy({
      by: ['associateId', 'status'],
      where: { associateId: { in: associates.map((a) => a.id) } },
      _count: { _all: true },
    });
    body.team = associates.map((a) => {
      const byStatus = emptyCounts();
      for (const c of counts) if (c.associateId === a.id) byStatus[c.status] = c._count._all;
      return { associate: toUserRef(a), byStatus };
    });
  }

  res.json(body);
});
