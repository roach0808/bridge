import { FINANCE_STATUSES, expectedPrice, type PublicStats } from '@god/shared';
import { Router } from 'express';
import { prisma } from '../db';

/**
 * What anyone may see without signing in: a few rounded totals for the landing
 * page (§6.18), and nothing about any one call or person. Associates and Experts
 * never see a call's income, and this page is open to them too, so the income is
 * rounded down: watching the total must not tell anyone what a call earned.
 */
export const publicRouter = Router();

const INCOME_STEP = 1000;
/** Live, but counted at most this often however many people open the page. */
const CACHE_MS = 60_000;

let cached: { at: number; stats: PublicStats } | null = null;

/** For tests: the next request counts again. */
export const forgetPublicStats = () => {
  cached = null;
};

async function countStats(): Promise<PublicStats> {
  const took = { status: { in: [...FINANCE_STATUSES] } };
  const calls = await prisma.call.findMany({
    where: took,
    select: {
      platformId: true,
      durationMinutes: true,
      actualDurationMinutes: true,
      rateOverride: true,
      profile: { select: { platformStatuses: { select: { platformId: true, rate: true } } } },
    },
  });
  // A call nobody reported the length of counts for what was booked.
  const minutes = calls.reduce((t, c) => t + (c.actualDurationMinutes ?? c.durationMinutes), 0);
  // The invoice amount, as on the Finance table: the call's rate for how long it really ran.
  const invoiced = calls.reduce((t, c) => {
    const rate = c.rateOverride ?? c.profile.platformStatuses.find((s) => s.platformId === c.platformId)?.rate ?? null;
    return t + (expectedPrice(rate === null ? null : Number(rate), c.actualDurationMinutes) ?? 0);
  }, 0);
  return {
    deliveredCalls: calls.length,
    hoursDelivered: Math.floor(minutes / 60),
    incomeAtLeast: Math.floor(invoiced / INCOME_STEP) * INCOME_STEP,
  };
}

publicRouter.get('/public/stats', async (_req, res) => {
  if (!cached || Date.now() - cached.at > CACHE_MS) cached = { at: Date.now(), stats: await countStats() };
  res.set('Cache-Control', `public, max-age=${CACHE_MS / 1000}`);
  res.json(cached.stats);
});
