import {
  FINANCE_STATUSES,
  PAYEE_LABELS,
  TEAM_TIME_ZONE,
  closeCycleSchema,
  financeCallsQuerySchema,
  markPayoutsSchema,
  type CallDTO,
  type CurrentCycleDTO,
  type FinanceCallsPage,
  type FinanceSummary,
  type PayCycleDTO,
  type PayCycleLine,
  type Payee,
} from '@god/shared';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { broadcastCall } from '../calls/calls.service';
import { callInclude, toCallDTO } from '../calls/calls.serialize';
import { canViewCall } from '../calls/calls.access';
import { prisma } from '../db';
import { conflict, forbidden, notFound } from '../errors';
import { iso, isoOrNull, parseBody, parseQuery } from '../http';
import { deliverAll, notify, type Deliver } from '../notifications/notify';
import { toUserRef, userRefSelect } from '../serializers';

/**
 * The money side of the Calls page (§6.5a): every call that took place, with
 * who is paid what for it, as one person's own financial dashboard. The Founder
 * pays the Expert and the Manager and marks it here; the Manager does the same
 * for the Associate's part. Once a month the Founder pays everyone they owe and
 * closes the payment cycle, which is kept on record.
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
    // A payment made in a month that is closed stays in that month's record.
    const last = paid ? null : await lastCycle(tx);
    const locked = last && changed.find(({ call }) => call[field] !== null && call[field]! <= last.closedAt);
    if (locked) {
      throw conflict(`The payment for the call with ${locked.call.profile.name} belongs to a closed payment cycle`, 'payout_closed', {
        callId: locked.call.id,
      });
    }
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

// --- Payment cycles ----------------------------------------------------------------------

type Viewer = Pick<Actor, 'id' | 'role'>;
const FOUNDER_VIEW = (actor: Viewer): Viewer => ({ id: actor.id, role: 'founder' });

async function lastCycle(db: Prisma.TransactionClient | typeof prisma = prisma) {
  return db.payCycle.findFirst({ orderBy: { closedAt: 'desc' }, select: { closedAt: true } });
}

/** "September 2026" early in October; the current month from mid-month on. */
function suggestedLabel(now = DateTime.now().setZone(TEAM_TIME_ZONE)): string {
  return (now.day <= 15 ? now.minus({ months: 1 }) : now).toFormat('LLLL yyyy');
}

/** Adds a payment to one person's line. */
function addLine(lines: Map<string, PayCycleLine>, user: PayCycleLine['user'], kind: Payee, amount: number) {
  const key = `${kind}:${user.id}`;
  const line = lines.get(key) ?? { user, kind, amount: 0, calls: 0 };
  line.amount = round(line.amount + amount);
  line.calls += 1;
  lines.set(key, line);
}

const byAmount = (a: PayCycleLine, b: PayCycleLine) => b.amount - a.amount || a.user.nickname.localeCompare(b.user.nickname);

/** Everyone the Founder owes now: Experts for calls with a known pay, Managers for calls paid to bank. */
async function outstanding(db: Prisma.TransactionClient | typeof prisma, founder: Viewer) {
  const calls = await db.call.findMany({
    where: {
      status: { in: [...FINANCE_STATUSES] },
      OR: [{ expertPaidAt: null }, { status: 'process_to_bank', managerPaidAt: null, payeeManagerId: { not: null } }],
    },
    include: callInclude,
  });
  const lines = new Map<string, PayCycleLine>();
  const expertCalls: string[] = [];
  const managerCalls: string[] = [];
  let unpricedExpertCalls = 0;
  for (const call of calls) {
    const { payouts } = toCallDTO(call, founder);
    const e = payouts.expert;
    if (e && !e.paidAt) {
      if (e.amount === null) unpricedExpertCalls++;
      else {
        addLine(lines, e.user, 'expert', e.amount);
        expertCalls.push(call.id);
      }
    }
    const m = payouts.manager;
    if (m?.settled && m.user && m.amount !== null && !m.paidAt) {
      addLine(lines, m.user, 'manager', m.amount);
      managerCalls.push(call.id);
    }
  }
  return { lines: [...lines.values()].sort(byAmount), expertCalls, managerCalls, unpricedExpertCalls };
}

/** What came in and went out in (since, until]: income that reached the bank, and every payment made. */
async function windowTotals(db: Prisma.TransactionClient | typeof prisma, founder: Viewer, since: Date | null, until: Date) {
  const range = { ...(since ? { gt: since } : {}), lte: until };
  const calls = await db.call.findMany({
    where: {
      OR: [{ bankedAt: range }, { expertPaidAt: range }, { managerPaidAt: range }, { associatePaidAt: range }],
    },
    include: callInclude,
  });
  const inWindow = (d: Date | null) => d !== null && (!since || d > since) && d <= until;
  const lines = new Map<string, PayCycleLine>();
  let income = 0;
  const paid = { experts: 0, managers: 0, associates: 0 };
  for (const call of calls) {
    const { payouts } = toCallDTO(call, founder);
    if (inWindow(call.bankedAt) && call.realIncome !== null) income += Number(call.realIncome);
    if (inWindow(call.expertPaidAt) && payouts.expert?.amount != null) {
      paid.experts += payouts.expert.amount;
      addLine(lines, payouts.expert.user, 'expert', payouts.expert.amount);
    }
    if (inWindow(call.managerPaidAt) && payouts.manager?.user && payouts.manager.amount !== null) {
      paid.managers += payouts.manager.amount;
      addLine(lines, payouts.manager.user, 'manager', payouts.manager.amount);
    }
    if (inWindow(call.associatePaidAt) && payouts.associate?.amount != null) {
      paid.associates += payouts.associate.amount;
      addLine(lines, payouts.associate.user, 'associate', payouts.associate.amount);
    }
  }
  return {
    income: round(income),
    paid: { experts: round(paid.experts), managers: round(paid.managers), associates: round(paid.associates) },
    // The Founder pays Experts and Managers; Associates are paid out of the Managers' shares.
    balance: round(income - paid.experts - paid.managers),
    lines: [...lines.values()].sort(byAmount),
  };
}

/** Founder: the cycle still open — this month's income, what went out, and what closing it would pay. */
financeRouter.get('/finance/cycle', requireRole('founder'), async (req, res) => {
  const founder = FOUNDER_VIEW(actorOf(req));
  const last = await lastCycle();
  const [totals, owed, pipeline] = await Promise.all([
    windowTotals(prisma, founder, last?.closedAt ?? null, new Date()),
    outstanding(prisma, founder),
    prisma.call.findMany({ where: { status: { in: ['finished', 'invoice_submit', 'invoice_approve'] } }, include: callInclude }),
  ]);
  const body: CurrentCycleDTO = {
    startedAt: isoOrNull(last?.closedAt ?? null),
    income: totals.income,
    paid: totals.paid,
    balance: totals.balance,
    expectedPipeline: round(pipeline.reduce((t, c) => t + (toCallDTO(c, founder).expectedPrice ?? 0), 0)),
    toPay: owed.lines,
    unpricedExpertCalls: owed.unpricedExpertCalls,
    suggestedLabel: suggestedLabel(),
  };
  res.json(body);
});

/** Stored lines point at users by id; the reader gets them as people. */
interface StoredLine {
  userId: string;
  kind: Payee;
  amount: number;
  calls: number;
}

/**
 * Founder: pays everyone the Founder owes (Experts, and Managers for calls paid to
 * bank) and closes the month. What came in and went out is kept on record; the next
 * cycle starts from zero. Associates are still paid by their Managers.
 */
financeRouter.post('/finance/cycles', requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const founder = FOUNDER_VIEW(actor);
  const { label } = parseBody(closeCycleSchema, req);

  const { cycle, changed, delivers } = await prisma.$transaction(async (tx) => {
    // One close at a time.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('pay_cycles'))`;
    const last = await lastCycle(tx);
    const closedAt = new Date();
    if (last && closedAt.getTime() - last.closedAt.getTime() < 10 * 60_000) {
      throw conflict('A payment cycle was closed a few minutes ago');
    }
    const owed = await outstanding(tx, founder);
    if (owed.expertCalls.length) {
      await tx.call.updateMany({ where: { id: { in: owed.expertCalls }, expertPaidAt: null }, data: { expertPaidAt: closedAt } });
    }
    if (owed.managerCalls.length) {
      await tx.call.updateMany({ where: { id: { in: owed.managerCalls }, managerPaidAt: null }, data: { managerPaidAt: closedAt } });
    }
    const totals = await windowTotals(tx, founder, last?.closedAt ?? null, closedAt);
    const stored: StoredLine[] = totals.lines.map((l) => ({ userId: l.user.id, kind: l.kind, amount: l.amount, calls: l.calls }));
    const cycle = await tx.payCycle.create({
      data: {
        label,
        startedAt: last?.closedAt ?? null,
        closedAt,
        closedById: actor.id,
        income: totals.income,
        paidExperts: totals.paid.experts,
        paidManagers: totals.paid.managers,
        paidAssociates: totals.paid.associates,
        lines: stored as unknown as Prisma.InputJsonValue,
      },
    });
    // Everyone paid now hears about it once, with the month's name.
    const delivers: Deliver[] = [];
    for (const line of owed.lines) {
      if (line.user.id === actor.id) continue;
      delivers.push(
        await notify(tx, [line.user.id], 'call.paid', {
          actor: { nickname: actor.nickname, role: actor.role },
          summary: `${usd(line.amount)} for ${line.calls} call${line.calls === 1 ? '' : 's'} — ${label}`,
        }),
      );
    }
    return { cycle, changed: [...new Set([...owed.expertCalls, ...owed.managerCalls])], delivers };
  });

  deliverAll(delivers);
  for (const id of changed) void broadcastCall(id);
  res.status(201).json((await cyclesFor(actor, cycle.id))[0]);
});

/** Closed cycles, newest first: the Founder sees everything; anyone else only what they were paid. */
async function cyclesFor(actor: Viewer, only?: string): Promise<PayCycleDTO[]> {
  const rows = await prisma.payCycle.findMany({
    where: only ? { id: only } : {},
    include: { closedBy: { select: userRefSelect } },
    orderBy: { closedAt: 'desc' },
  });
  const founder = actor.role === 'founder';
  const ids = [...new Set(rows.flatMap((r) => (r.lines as unknown as StoredLine[]).map((l) => l.userId)))];
  const users = new Map(
    (await prisma.user.findMany({ where: { id: { in: ids } }, select: userRefSelect })).map((u) => [u.id, toUserRef(u)]),
  );
  return rows
    .map((r) => {
      const lines = (r.lines as unknown as StoredLine[])
        .filter((l) => founder || l.userId === actor.id)
        .flatMap((l) => {
          const user = users.get(l.userId);
          return user ? [{ user, kind: l.kind, amount: l.amount, calls: l.calls }] : [];
        });
      const income = Number(r.income);
      const paidExperts = Number(r.paidExperts);
      const paidManagers = Number(r.paidManagers);
      return {
        id: r.id,
        label: r.label,
        startedAt: isoOrNull(r.startedAt),
        closedAt: iso(r.closedAt),
        closedBy: toUserRef(r.closedBy),
        totals: founder
          ? {
              income,
              paidExperts,
              paidManagers,
              paidAssociates: Number(r.paidAssociates),
              balance: round(income - paidExperts - paidManagers),
            }
          : null,
        lines,
      };
    })
    .filter((c) => founder || c.lines.length > 0);
}

financeRouter.get('/finance/cycles', async (req, res) => {
  res.json(await cyclesFor(actorOf(req)));
});
