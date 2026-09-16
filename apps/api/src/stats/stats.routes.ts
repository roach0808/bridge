import {
  expectedPrice,
  statsQuerySchema,
  TEAM_TIME_ZONE,
  type AssociateStats,
  type AssociateStatsCell,
  type FinanceCell,
  type FinanceStats,
  type ProfileStatsRow,
  type StatsPeriod,
  type StatsPeriodKind,
} from '@god/shared';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { actorOf, requireAuth, requireRole } from '../auth/middleware';
import { prisma } from '../db';
import { forbidden } from '../errors';
import { isoOrNull, parseQuery } from '../http';
import { toUserRef, userRefSelect } from '../serializers';

export const statsRouter = Router();
statsRouter.use('/stats', requireAuth);

// --- Periods -----------------------------------------------------------------------

/** Bi-weekly periods line up on this Monday. */
const BIWEEK_ANCHOR = '2026-01-05';

function periodStart(kind: StatsPeriodKind, now: DateTime): DateTime {
  if (kind === 'month') return now.startOf('month');
  if (kind === 'week') return now.startOf('week');
  const anchor = DateTime.fromISO(BIWEEK_ANCHOR, { zone: now.zone });
  const days = Math.round(now.startOf('day').diff(anchor, 'days').days);
  return anchor.plus({ weeks: 2 * Math.floor(days / 14) });
}

const step = (kind: StatsPeriodKind, n: number) =>
  kind === 'month' ? { months: n } : kind === 'week' ? { weeks: n } : { weeks: 2 * n };

function label(kind: StatsPeriodKind, start: DateTime, end: DateTime) {
  if (kind === 'month') return start.toFormat('LLL yyyy');
  const last = end.minus({ days: 1 });
  return last.month === start.month ? `${start.toFormat('LLL d')} – ${last.toFormat('d')}` : `${start.toFormat('LLL d')} – ${last.toFormat('LLL d')}`;
}

/** The last `count` periods in the team time zone, oldest first, ending with the current one. */
export function statsPeriods(kind: StatsPeriodKind, count: number, now = DateTime.now().setZone(TEAM_TIME_ZONE)) {
  const current = periodStart(kind, now);
  return Array.from({ length: count }, (_, i) => {
    const start = current.minus(step(kind, count - 1 - i));
    const end = start.plus(step(kind, 1));
    return { start, end, label: label(kind, start, end) };
  });
}

const toPeriodDTO = (p: { start: DateTime; end: DateTime; label: string }): StatsPeriod => ({
  start: p.start.toISODate()!,
  end: p.end.toISODate()!,
  label: p.label,
});

// --- Calls with their rate ------------------------------------------------------------

interface PricedCall {
  associateId: string;
  profileId: string;
  platformId: string;
  scheduledAt: Date;
  durationMinutes: number;
  actualDurationMinutes: number | null;
  realIncome: number | null;
  rate: number | null;
}

async function pricedCalls(from: Date, to: Date, associateIds?: string[]): Promise<PricedCall[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      associate_id: string;
      profile_id: string;
      platform_id: string;
      scheduled_at: Date;
      duration_minutes: number;
      actual_duration_minutes: number | null;
      real_income: Prisma.Decimal | null;
      rate: Prisma.Decimal | null;
    }>
  >`
    SELECT c.associate_id, c.profile_id, c.platform_id, c.scheduled_at, c.duration_minutes,
           c.actual_duration_minutes, c.real_income, COALESCE(c.rate_override, s.rate) AS rate
    FROM calls c
    LEFT JOIN profile_platform_statuses s ON s.profile_id = c.profile_id AND s.platform_id = c.platform_id
    WHERE c.scheduled_at >= ${from} AND c.scheduled_at < ${to}
      ${associateIds ? Prisma.sql`AND c.associate_id = ANY(${associateIds}::uuid[])` : Prisma.empty}`;
  return rows.map((r) => ({
    associateId: r.associate_id,
    profileId: r.profile_id,
    platformId: r.platform_id,
    scheduledAt: r.scheduled_at,
    durationMinutes: r.duration_minutes,
    actualDurationMinutes: r.actual_duration_minutes,
    realIncome: r.real_income === null ? null : Number(r.real_income),
    rate: r.rate === null ? null : Number(r.rate),
  }));
}

/** Adds money in cents so sums don't drift. */
const addMoney = (a: number, b: number) => Math.round(a * 100 + b * 100) / 100;

const periodIndex = (periods: Array<{ start: DateTime; end: DateTime }>, at: Date) => {
  const t = at.getTime();
  return periods.findIndex((p) => p.start.toMillis() <= t && t < p.end.toMillis());
};

// --- By associate ----------------------------------------------------------------------

const emptyAssociateCell = (): AssociateStatsCell => ({ calls: 0, finishedCalls: 0, potential: 0, unpriced: 0 });

function addToAssociateCell(cell: AssociateStatsCell, c: PricedCall) {
  cell.calls += 1;
  if (c.actualDurationMinutes !== null) cell.finishedCalls += 1;
  const price = expectedPrice(c.rate, c.actualDurationMinutes ?? c.durationMinutes);
  if (price === null) cell.unpriced += 1;
  else cell.potential = addMoney(cell.potential, price);
}

statsRouter.get('/stats/associates', async (req, res) => {
  const actor = actorOf(req);
  if (actor.role === 'expert') throw forbidden();
  const { period, count } = parseQuery(statsQuerySchema, req);
  const periods = statsPeriods(period, count);
  const from = periods[0]!.start.toJSDate();
  const to = periods.at(-1)!.end.toJSDate();

  const scope =
    actor.role === 'founder' ? {} : actor.role === 'manager' ? { managerId: actor.id } : { id: actor.id };
  const associates = await prisma.user.findMany({
    where: { role: 'associate', ...scope },
    select: { ...userRefSelect, isActive: true, manager: { select: userRefSelect } },
    orderBy: { nickname: 'asc' },
  });
  const calls = await pricedCalls(from, to, actor.role === 'founder' ? undefined : associates.map((a) => a.id));

  const byAssociate = new Map(associates.map((a) => [a.id, Array.from({ length: count }, emptyAssociateCell)]));
  const totals = Array.from({ length: count }, emptyAssociateCell);
  for (const c of calls) {
    const cells = byAssociate.get(c.associateId);
    const i = periodIndex(periods, c.scheduledAt);
    if (!cells || i < 0) continue;
    addToAssociateCell(cells[i]!, c);
    addToAssociateCell(totals[i]!, c);
  }
  const sum = (cells: AssociateStatsCell[]) =>
    cells.reduce(
      (t, c) => ({
        calls: t.calls + c.calls,
        finishedCalls: t.finishedCalls + c.finishedCalls,
        potential: addMoney(t.potential, c.potential),
        unpriced: t.unpriced + c.unpriced,
      }),
      emptyAssociateCell(),
    );

  const body: AssociateStats = {
    zone: TEAM_TIME_ZONE,
    periods: periods.map(toPeriodDTO),
    rows: associates
      .map((a) => {
        const cells = byAssociate.get(a.id)!;
        return { associate: { ...toUserRef(a), isActive: a.isActive }, manager: a.manager ? toUserRef(a.manager) : null, periods: cells, total: sum(cells) };
      })
      // Deactivated Associates only while they have calls in the range.
      .filter((r) => r.associate.isActive || r.total.calls > 0),
    totals,
    total: sum(totals),
  };
  res.json(body);
});

// --- By profile (Founder) -------------------------------------------------------------------

statsRouter.get('/stats/profiles', requireRole('founder'), async (_req, res) => {
  const [profiles, sums] = await Promise.all([
    prisma.profile.findMany({
      select: {
        id: true,
        name: true,
        avatarId: true,
        photoId: true,
        status: true,
        isActive: true,
        onboardedAt: true,
        email: true,
        banks: { select: { bankName: true, country: true, currency: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.$queryRaw<
      Array<{ profile_id: string; calls: bigint; paid_calls: bigint; expected: Prisma.Decimal | null; income: Prisma.Decimal | null; last_call_at: Date | null }>
    >`
      SELECT c.profile_id,
             count(*) AS calls,
             count(c.real_income) AS paid_calls,
             sum(round(COALESCE(c.rate_override, s.rate) * c.actual_duration_minutes / 60, 2)) AS expected,
             sum(c.real_income) AS income,
             max(c.scheduled_at) FILTER (WHERE c.scheduled_at <= ${new Date()}) AS last_call_at
      FROM calls c
      LEFT JOIN profile_platform_statuses s ON s.profile_id = c.profile_id AND s.platform_id = c.platform_id
      GROUP BY c.profile_id`,
  ]);
  const rows: ProfileStatsRow[] = profiles.map((p) => {
    const agg = sums.find((s) => s.profile_id === p.id);
    const bank = p.banks[0];
    return {
      profile: { id: p.id, name: p.name, avatarId: p.avatarId, photoId: p.photoId },
      status: p.status,
      isActive: p.isActive,
      onboardedAt: p.onboardedAt ? p.onboardedAt.toISOString().slice(0, 10) : null,
      email: p.email,
      bank: bank ? { ...bank, count: p.banks.length } : null,
      calls: Number(agg?.calls ?? 0),
      paidCalls: Number(agg?.paid_calls ?? 0),
      expectedIncome: Number(agg?.expected ?? 0),
      totalIncome: Number(agg?.income ?? 0),
      lastCallAt: isoOrNull(agg?.last_call_at ?? null),
    };
  });
  res.json(rows);
});

// --- Finance (Founder) ----------------------------------------------------------------------

const emptyFinanceCell = (): FinanceCell => ({
  calls: 0,
  finishedCalls: 0,
  paidCalls: 0,
  expected: 0,
  paidExpected: 0,
  real: 0,
  gap: 0,
  unpriced: 0,
});

function addToFinanceCell(cell: FinanceCell, c: PricedCall) {
  cell.calls += 1;
  if (c.actualDurationMinutes === null) return;
  cell.finishedCalls += 1;
  const price = expectedPrice(c.rate, c.actualDurationMinutes);
  if (price === null) cell.unpriced += 1;
  else cell.expected = addMoney(cell.expected, price);
  if (c.realIncome !== null) {
    cell.paidCalls += 1;
    cell.real = addMoney(cell.real, c.realIncome);
    if (price !== null) cell.paidExpected = addMoney(cell.paidExpected, price);
    cell.gap = addMoney(cell.paidExpected, -cell.real);
  }
}

statsRouter.get('/stats/finance', requireRole('founder'), async (req, res) => {
  const { period, count } = parseQuery(statsQuerySchema, req);
  const periods = statsPeriods(period, count);
  const calls = await pricedCalls(periods[0]!.start.toJSDate(), periods.at(-1)!.end.toJSDate());

  const byPeriod = Array.from({ length: count }, emptyFinanceCell);
  const total = emptyFinanceCell();
  const byPlatform = new Map<string, FinanceCell>();
  const byProfile = new Map<string, FinanceCell>();
  const cellIn = (map: Map<string, FinanceCell>, key: string) => {
    let cell = map.get(key);
    if (!cell) map.set(key, (cell = emptyFinanceCell()));
    return cell;
  };
  for (const c of calls) {
    const i = periodIndex(periods, c.scheduledAt);
    if (i < 0) continue;
    addToFinanceCell(byPeriod[i]!, c);
    addToFinanceCell(total, c);
    addToFinanceCell(cellIn(byPlatform, c.platformId), c);
    addToFinanceCell(cellIn(byProfile, c.profileId), c);
  }

  const [platforms, profiles] = await Promise.all([
    prisma.platform.findMany({ where: { id: { in: [...byPlatform.keys()] } }, select: { id: true, name: true } }),
    prisma.profile.findMany({ where: { id: { in: [...byProfile.keys()] } }, select: { id: true, name: true, isActive: true } }),
  ]);
  const largestFirst = (a: { cell: FinanceCell }, b: { cell: FinanceCell }) => b.cell.real - a.cell.real || b.cell.expected - a.cell.expected;

  const body: FinanceStats = {
    zone: TEAM_TIME_ZONE,
    periods: periods.map(toPeriodDTO),
    byPeriod,
    total,
    byPlatform: platforms.map((platform) => ({ platform, cell: byPlatform.get(platform.id)! })).sort(largestFirst),
    byProfile: profiles.map((profile) => ({ profile, cell: byProfile.get(profile.id)! })).sort(largestFirst),
  };
  res.json(body);
});
