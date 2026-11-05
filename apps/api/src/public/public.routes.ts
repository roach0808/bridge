import { FINANCE_STATUSES, type PublicStats } from '@god/shared';
import { Router } from 'express';
import { prisma } from '../db';

/**
 * What anyone may see without signing in: a few rounded totals for the landing
 * page (§6.18), and nothing about any one call or person. Associates and Experts
 * never see a call's income, and this page is open to them too, so the income is
 * rounded down and the figures change only every so often: watching the total
 * must not tell anyone what a call earned.
 */
export const publicRouter = Router();

const INCOME_STEP = 1000;
const CACHE_MS = 10 * 60_000;

let cached: { at: number; stats: PublicStats } | null = null;

/** For tests: the next request counts again. */
export const forgetPublicStats = () => {
  cached = null;
};

async function countStats(): Promise<PublicStats> {
  const took = { status: { in: [...FINANCE_STATUSES] } };
  const [calls, reported, unreported, banked] = await Promise.all([
    prisma.call.count({ where: took }),
    prisma.call.aggregate({ where: took, _sum: { actualDurationMinutes: true } }),
    // A call nobody reported the length of counts for what was booked.
    prisma.call.aggregate({ where: { ...took, actualDurationMinutes: null }, _sum: { durationMinutes: true } }),
    prisma.call.aggregate({ where: { realIncome: { not: null } }, _sum: { realIncome: true } }),
  ]);
  const minutes = (reported._sum.actualDurationMinutes ?? 0) + (unreported._sum.durationMinutes ?? 0);
  return {
    deliveredCalls: calls,
    hoursDelivered: Math.floor(minutes / 60),
    incomeAtLeast: Math.floor(Number(banked._sum.realIncome ?? 0) / INCOME_STEP) * INCOME_STEP,
  };
}

publicRouter.get('/public/stats', async (_req, res) => {
  if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), stats: await countStats() };
  res.set('Cache-Control', `public, max-age=${CACHE_MS / 1000}`);
  res.json(cached.stats);
});
