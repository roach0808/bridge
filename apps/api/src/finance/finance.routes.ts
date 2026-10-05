import {
  FINANCE_STATUSES,
  PAYEE_LABELS,
  TEAM_TIME_ZONE,
  financeCallsQuerySchema,
  markPayoutsSchema,
  paymentStatsQuerySchema,
  type CallDTO,
  type FinanceCallsPage,
  type FinanceSummary,
  type PayLine,
  type Payee,
  type PaymentFigures,
  type PaymentStatsDTO,
} from '@god/shared';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { actorOf, requireAuth, type Actor } from '../auth/middleware';
import { broadcastCall } from '../calls/calls.service';
import { callInclude, toCallDTO } from '../calls/calls.serialize';
import { canViewCall } from '../calls/calls.access';
import { prisma } from '../db';
import { conflict, forbidden, notFound } from '../errors';
import { iso, parseBody, parseQuery } from '../http';
import { deliverAll, notify, type Deliver } from '../notifications/notify';

/**
 * The money side of the Calls page (§6.5a): every call that took place, with
 * who is paid what for it, as one person's own financial dashboard. The Founder
 * pays the Expert and the Manager and marks it here; the Manager does the same
 * for the Associate's part. The Payment records tab adds up what was paid, week
 * by week, month by month or year by year.
 */
export const financeRouter = Router();
financeRouter.use('/finance', requireAuth);

const BEFORE_BANK = FINANCE_STATUSES.filter((s) => s !== 'process_to_bank');

/** The calls in someone's money: those that pay them, or that they pay out of. */
function scopeWhere(actor: Pick<Actor, 'id' | 'role'>): Prisma.CallWhereInput {
  const took: Prisma.CallWhereInput = { status: { in: [...FINANCE_STATUSES] } };
  switch (actor.role) {
    case 'founder':
      return took;
    case 'manager':
      // Paid to them, or on its way to them: the calls they run and their team runs.
      return {
        ...took,
        OR: [
          { payeeManagerId: actor.id },
          { status: { in: BEFORE_BANK }, OR: [{ associateId: actor.id }, { associate: { managerId: actor.id } }] },
        ],
      };
    case 'associate':
      return { ...took, associateId: actor.id };
    case 'expert':
      return { ...took, expertId: actor.id };
  }
}

/** Something the viewer pays or is paid is still open on the call, now or once the bank pays. */
function unpaidWhere(actor: Pick<Actor, 'id' | 'role'>): Prisma.CallWhereInput {
  const notBanked: Prisma.CallWhereInput = { status: { not: 'process_to_bank' } };
  switch (actor.role) {
    case 'founder':
      return { OR: [{ expertPaidAt: null }, notBanked, { managerPaidAt: null, payeeManagerId: { not: null } }] };
    case 'manager':
      return {
        OR: [
          notBanked,
          { payeeManagerId: actor.id, managerPaidAt: null },
          { payeeManagerId: actor.id, associateSharePercent: { gt: 0 }, associatePaidAt: null },
        ],
      };
    case 'associate':
      return { OR: [notBanked, { associateSharePercent: { gt: 0 }, associatePaidAt: null }] };
    case 'expert':
      return { expertPaidAt: null };
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Adds up what the viewer can see on each call. */
function summarize(actor: Pick<Actor, 'id' | 'role'>, calls: CallDTO[]): FinanceSummary {
  const role = actor.role;
  // Associates never see what a call brings in, only their Manager's share and their part of it.
  const income = role === 'founder' || role === 'manager' ? { expected: 0, real: 0, unpriced: 0 } : null;
  const expert = role === 'founder' || role === 'expert' ? { paid: 0, unpaid: 0, unpriced: 0, minutes: 0 } : null;
  const manager = role === 'expert' ? null : { paid: 0, unpaid: 0, expected: 0 };
  const associate = role === 'expert' ? null : { paid: 0, unpaid: 0, expected: 0 };
  let keeps = role === 'manager' ? 0 : null;

  const add = (
    bucket: { paid: number; unpaid: number; expected?: number } | null,
    line: { amount: number | null; expected: number | null; paidAt: string | null } | null,
  ) => {
    if (!bucket || !line) return;
    if (line.amount === null) {
      // A share the bank has not paid yet: what it should come to.
      if (bucket.expected !== undefined && line.expected !== null) bucket.expected += line.expected;
      return;
    }
    if (line.paidAt) bucket.paid += line.amount;
    else bucket.unpaid += line.amount;
  };

  for (const c of calls) {
    if (income) {
      if (c.realIncome !== null) income.real += c.realIncome;
      else if (c.expectedPrice !== null) income.expected += c.expectedPrice;
      else income.unpriced++;
    }
    const e = c.payouts.expert;
    if (expert && e) {
      if (e.amount === null) expert.unpriced++;
      add(expert, e);
      expert.minutes += e.minutes ?? 0;
    }
    // A Manager's share with nobody to receive it is not owed to anyone.
    if (c.payouts.manager?.user) add(manager, c.payouts.manager);
    add(associate, c.payouts.associate);
    // What stays with the Manager, once the bank has paid: expected shares are not money yet.
    if (keeps !== null && c.payouts.manager?.settled && c.payouts.manager.keeps != null) keeps += c.payouts.manager.keeps;
  }

  const tidy = <T extends Record<string, number>>(o: T | null): T | null =>
    o ? (Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)])) as T) : null;
  return {
    calls: calls.length,
    income: tidy(income),
    expert: tidy(expert),
    manager: tidy(manager),
    associate: tidy(associate),
    keeps: keeps === null ? null : round(keeps),
  };
}

financeRouter.get('/finance/calls', async (req, res) => {
  const actor = actorOf(req);
  const query = parseQuery(financeCallsQuerySchema, req);
  const filters: Prisma.CallWhereInput[] = [
    scopeWhere(actor),
    query.from ? { scheduledAt: { gte: new Date(query.from) } } : {},
    query.to ? { scheduledAt: { lt: new Date(query.to) } } : {},
    query.q
      ? {
          OR: [
            { profile: { name: { contains: query.q, mode: 'insensitive' } } },
            { platform: { name: { contains: query.q, mode: 'insensitive' } } },
            { associate: { nickname: { contains: query.q, mode: 'insensitive' } } },
            { expert: { nickname: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {},
  ];
  const paidFilter =
    query.paid === 'unpaid' ? unpaidWhere(actor) : query.paid === 'paid' ? { NOT: unpaidWhere(actor) } : {};

  // The totals cover every matching call, whichever of them the paid filter shows.
  const all = await prisma.call.findMany({ where: { AND: filters }, include: callInclude, orderBy: [{ scheduledAt: 'desc' }, { id: 'asc' }] });
  const [total, rows] = await prisma.$transaction([
    prisma.call.count({ where: { AND: [...filters, paidFilter] } }),
    prisma.call.findMany({
      where: { AND: [...filters, paidFilter] },
      include: callInclude,
      orderBy: [{ scheduledAt: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const body: FinanceCallsPage = {
    items: rows.map((c) => toCallDTO(c, actor)),
    page: query.page,
    pageSize: query.pageSize,
    total,
    summary: summarize(actor, all.map((c) => toCallDTO(c, actor))),
  };
  res.json(body);
});

const PAID_FIELD: Record<Payee, 'expertPaidAt' | 'managerPaidAt' | 'associatePaidAt'> = {
  expert: 'expertPaidAt',
  manager: 'managerPaidAt',
  associate: 'associatePaidAt',
};

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Marks one person's pay as paid (or not paid after all) on several calls. All
 * or nothing: a call where there is nothing for the caller to mark refuses the batch.
 */
financeRouter.post('/finance/payouts', async (req, res) => {
  const actor = actorOf(req);
  const { payee, callIds, paid } = parseBody(markPayoutsSchema, req);
  if (actor.role !== 'founder' && !(actor.role === 'manager' && payee === 'associate')) {
    throw forbidden(`You cannot mark the ${PAYEE_LABELS[payee]}’s pay`);
  }
  const ids = [...new Set(callIds)];
  const field = PAID_FIELD[payee];

  const { changed, delivers } = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM calls WHERE id = ANY(${ids}::uuid[]) FOR UPDATE`;
    const calls = await tx.call.findMany({ where: { id: { in: ids } }, include: callInclude });
    if (calls.length !== ids.length || calls.some((c) => !canViewCall(actor, c))) throw notFound('Call');

    const lines = calls.map((c) => ({ call: c, dto: toCallDTO(c, actor) }));
    const blocked = lines.find(({ dto }) => !dto.payouts.canMark.includes(payee));
    if (blocked) {
      const reason =
        payee === 'expert'
          ? 'it has not finished, or the Expert has no rate for it yet'
          : payee === 'manager'
            ? 'it has not been paid to bank yet, or has no Manager to pay'
            : 'it has not been paid to bank yet, or the Associate has no share of it';
      throw conflict(`Nothing to mark for the ${PAYEE_LABELS[payee]} on the call with ${blocked.call.profile.name}: ${reason}`, 'payout_unavailable', {
        callId: blocked.call.id,
      });
    }

    // Only the calls whose state really changes; a second click changes nothing.
    const changed = lines.filter(({ call }) => (call[field] !== null) !== paid);
    if (changed.length) {
      await tx.call.updateMany({
        where: { id: { in: changed.map(({ call }) => call.id) } },
        data: { [field]: paid ? new Date() : null },
      });
    }

    // Tell each person they were paid, once per batch.
    const delivers: Deliver[] = [];
    if (paid) {
      const byPerson = new Map<string, Array<{ id: string; amount: number; name: string }>>();
      for (const { call, dto } of changed) {
        const line = dto.payouts[payee];
        const person = payee === 'expert' ? call.expertId : payee === 'manager' ? call.payeeManagerId : call.associateId;
        if (!person || person === actor.id || !line || line.amount === null) continue;
        byPerson.set(person, [...(byPerson.get(person) ?? []), { id: call.id, amount: line.amount, name: call.profile.name }]);
      }
      for (const [person, items] of byPerson) {
        const sum = items.reduce((t, i) => t + i.amount, 0);
        delivers.push(
          await notify(tx, [person], 'call.paid', {
            ...(items.length === 1 ? { callId: items[0]!.id } : {}),
            actor: { nickname: actor.nickname, role: actor.role },
            summary:
              items.length === 1
                ? `${usd(sum)} for the call with ${items[0]!.name}`
                : `${usd(sum)} for ${items.length} calls`,
          }),
        );
      }
    }
    return { changed: changed.map(({ call }) => call.id), delivers };
  });

  deliverAll(delivers);
  for (const id of changed) void broadcastCall(id);
  // Everyone who sees these calls gets them fresh over the socket; the caller gets the count.
  res.json({ updated: changed.length });
});

// --- Payment records ---------------------------------------------------------------------

type Viewer = Pick<Actor, 'id' | 'role'>;

/** Adds a payment to one person's line. */
function addLine(lines: Map<string, PayLine>, user: PayLine['user'], kind: Payee, amount: number) {
  const key = `${kind}:${user.id}`;
  const line = lines.get(key) ?? { user, kind, amount: 0, calls: 0 };
  line.amount = round(line.amount + amount);
  line.calls += 1;
  lines.set(key, line);
}

const byAmount = (a: PayLine, b: PayLine) => b.amount - a.amount || a.user.nickname.localeCompare(b.user.nickname);

/** One period's money, filled call by call. */
class Bucket {
  income = 0;
  paid = { experts: 0, managers: 0, associates: 0 };
  lines = new Map<string, PayLine>();

  figures(viewer: Viewer): PaymentFigures {
    const founder = viewer.role === 'founder';
    const people = [...this.lines.values()].filter((l) => founder || l.user.id === viewer.id).sort(byAmount);
    // Anyone but the Founder sees only what they were paid themselves.
    const own = (kind: Payee) => round(people.filter((l) => l.kind === kind).reduce((t, l) => t + l.amount, 0));
    return {
      income: founder ? round(this.income) : null,
      paidExperts: founder ? round(this.paid.experts) : own('expert'),
      paidManagers: founder ? round(this.paid.managers) : own('manager'),
      paidAssociates: founder ? round(this.paid.associates) : own('associate'),
      // The Founder pays Experts and Managers; Associates are paid out of the Managers' shares.
      balance: founder ? round(this.income - this.paid.experts - this.paid.managers) : null,
      people,
    };
  }
}

/**
 * What came in (income that reached the bank) and went out (every payment made),
 * in each of the last `count` weeks, months or years in team time. Each payment
 * counts in the period it was made, whatever the call's date.
 */
financeRouter.get('/finance/records', async (req, res) => {
  const actor = actorOf(req);
  const { period, count } = parseQuery(paymentStatsQuerySchema, req);
  const now = DateTime.now().setZone(TEAM_TIME_ZONE);
  const first = now.startOf(period).minus({ [`${period}s`]: count - 1 });
  const bounds = Array.from({ length: count + 1 }, (_, i) => first.plus({ [`${period}s`]: i }).toJSDate());
  const since = bounds[0]!;
  const until = bounds[count]!;

  const range = { gte: since, lt: until };
  const calls = await prisma.call.findMany({
    where: {
      OR: [{ bankedAt: range }, { expertPaidAt: range }, { managerPaidAt: range }, { associatePaidAt: range }],
    },
    include: callInclude,
  });

  const buckets = Array.from({ length: count }, () => new Bucket());
  const total = new Bucket();
  const bucketOf = (d: Date | null) => {
    if (!d || d < since || d >= until) return null;
    // Few periods: a linear scan is plenty.
    const i = bounds.findIndex((b, k) => k < count && d >= b && d < bounds[k + 1]!);
    return i < 0 ? null : buckets[i]!;
  };
  // Amounts are worked out as the Founder sees them; each viewer then gets their own share of the picture.
  const founder: Viewer = { id: actor.id, role: 'founder' };
  for (const call of calls) {
    const { payouts } = toCallDTO(call, founder);
    const pay = (at: Date | null, kind: Payee, line: { user: PayLine['user'] | null; amount: number | null } | null) => {
      const bucket = bucketOf(at);
      if (!bucket || !line?.user || line.amount === null) return;
      for (const b of [bucket, total]) {
        b.paid[`${kind}s` as const] += line.amount;
        addLine(b.lines, line.user, kind, line.amount);
      }
    };
    const banked = bucketOf(call.bankedAt);
    if (banked && call.realIncome !== null) {
      banked.income += Number(call.realIncome);
      total.income += Number(call.realIncome);
    }
    pay(call.expertPaidAt, 'expert', payouts.expert);
    pay(call.managerPaidAt, 'manager', payouts.manager);
    pay(call.associatePaidAt, 'associate', payouts.associate);
  }

  const body: PaymentStatsDTO = {
    period,
    periods: buckets.map((b, i) => ({ start: iso(bounds[i]!), end: iso(bounds[i + 1]!), ...b.figures(actor) })),
    total: total.figures(actor),
  };
  res.json(body);
});
