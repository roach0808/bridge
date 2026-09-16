import {
  ERROR_CODES,
  type SessionDTO,
  avatarSchema,
  changePasswordSchema,
  isAvatarForAudience,
  loginSchema,
  refreshSchema,
  timeZoneSchema,
} from '@god/shared';
import argon2 from 'argon2';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config, cookieSecure } from '../config';
import { prisma } from '../db';
import { HttpError, badRequest, forbidden, unauthenticated } from '../errors';
import { iso, param, parseBody } from '../http';
import { meSelect, toMeDTO } from '../serializers';
import { record } from '../audit/audit';
import { deviceOf } from './device';
import { actorOf, requireAuth, requireRole } from './middleware';
import { hashToken, issueRefreshToken, refreshTokenTtlMs, signAccessToken } from './tokens';

export const REFRESH_COOKIE = 'god_rt';
const COOKIE_PATH = '/api/v1/auth';

// A dummy hash so unknown emails cost as much as wrong passwords.
const DUMMY_HASH = argon2.hash('not-a-real-password-just-timing', { type: argon2.argon2id });

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: refreshTokenTtlMs(),
  });
}

function readRefreshToken(req: Request): string | undefined {
  const { refreshToken } = parseBody(refreshSchema, req);
  return refreshToken ?? (req.cookies?.[REFRESH_COOKIE] as string | undefined);
}

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.LOGIN_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Count failures only: throttles guessing without locking out an office behind one IP.
  skipSuccessfulRequests: true,
  handler: (_req, res) => {
    res.status(429).json({
      error: { code: ERROR_CODES.rateLimited, message: 'Too many sign-in attempts. Try again in a minute.' },
    });
  },
});

authRouter.post('/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = parseBody(loginSchema, req);
  const user = await prisma.user.findUnique({ where: { email }, select: { ...meSelect, passwordHash: true } });
  const ok = user
    ? await argon2.verify(user.passwordHash, password)
    : (await argon2.verify(await DUMMY_HASH, password), false);
  if (!user || !ok) {
    throw new HttpError(401, ERROR_CODES.invalidCredentials, 'Email or password is incorrect');
  }
  if (!user.isActive) throw new HttpError(401, ERROR_CODES.inactive, 'This account has been deactivated');

  const { passwordHash: _hash, ...me } = user;
  const refresh = await issueRefreshToken(prisma, user.id, undefined, deviceOf(req));
  // So the audit trail attributes this sign-in to them (no requireAuth here).
  req.actor = { id: user.id, role: user.role, nickname: user.nickname, managerId: user.managerId, timeZone: user.timeZone, avatarId: user.avatarId, sessionId: refresh.familyId };
  setRefreshCookie(res, refresh.token);
  res.json({
    accessToken: signAccessToken(user.id, user.role, refresh.familyId),
    refreshToken: refresh.token,
    user: toMeDTO(me),
  });
});

authRouter.post('/auth/refresh', async (req, res) => {
  const token = readRefreshToken(req);
  if (!token) throw unauthenticated('Missing refresh token');

  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row) return { error: 'Invalid refresh token' } as const;
    if (row.revokedAt) {
      // Reuse of a rotated token: assume theft and revoke the whole family.
      await tx.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { error: 'Refresh token was already used', reuse: row.userId } as const;
    }
    if (row.expiresAt <= new Date()) return { error: 'Refresh token expired' } as const;
    const user = await tx.user.findUnique({ where: { id: row.userId }, select: meSelect });
    if (!user?.isActive) {
      await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      return { error: 'This account has been deactivated', code: ERROR_CODES.inactive } as const;
    }
    // The session keeps the device it signed in on; the address can change.
    const device = deviceOf(req);
    const next = await issueRefreshToken(tx, row.userId, row.familyId, {
      deviceType: row.deviceType ?? device.deviceType,
      browser: row.browser ?? device.browser,
      os: row.os ?? device.os,
      ip: device.ip,
      country: device.country ?? row.country,
    });
    await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedBy: next.id } });
    return { user, next } as const;
  });

  if ('error' in result) {
    if ('reuse' in result) {
      record(req, res, {
        action: 'auth.token_reuse',
        summary: 'A used refresh token was presented again; every session of that account was ended',
        userId: result.reuse,
      });
    }
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    throw unauthenticated(result.error, 'code' in result ? result.code : ERROR_CODES.unauthenticated);
  }
  setRefreshCookie(res, result.next.token);
  res.json({
    accessToken: signAccessToken(result.user.id, result.user.role, result.next.familyId),
    refreshToken: result.next.token,
    user: toMeDTO(result.user),
  });
});

authRouter.post('/auth/logout', async (req, res) => {
  const token = readRefreshToken(req);
  if (token) {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (row) {
      await prisma.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }
  res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  res.status(204).end();
});

/** One row per signed-in session (a refresh-token family), newest first. */
async function sessionsOf(userId: string, currentSessionId?: string): Promise<SessionDTO[]> {
  const rows = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: { lastUsedAt: 'desc' },
  });
  // A family rotates through many rows; the live one is what the user sees.
  const byFamily = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!byFamily.has(row.familyId)) byFamily.set(row.familyId, row);
  return [...byFamily.values()].map((row) => ({
    id: row.familyId,
    deviceType: row.deviceType ?? 'unknown',
    browser: row.browser,
    os: row.os,
    country: row.country,
    ip: row.ip,
    current: row.familyId === currentSessionId,
    signedInAt: iso(row.createdAt),
    lastUsedAt: iso(row.lastUsedAt),
  }));
}

authRouter.get('/me/sessions', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  res.json(await sessionsOf(actor.id, actor.sessionId));
});

/** Signs out one session; `all` leaves only the one making the request. */
authRouter.delete('/me/sessions/:id', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const id = param(req, 'id');
  const where =
    id === 'all'
      ? { userId: actor.id, revokedAt: null, ...(actor.sessionId ? { familyId: { not: actor.sessionId } } : {}) }
      : { userId: actor.id, revokedAt: null, familyId: id };
  // Count sessions, not the rotated tokens inside them.
  const families = await prisma.refreshToken.findMany({ where, select: { familyId: true }, distinct: ['familyId'] });
  await prisma.refreshToken.updateMany({ where, data: { revokedAt: new Date() } });
  res.json({ signedOut: families.length });
});

/** Founders can see and end anyone's sessions. */
authRouter.get('/users/:id/sessions', requireAuth, requireRole('founder'), async (req, res) => {
  res.json(await sessionsOf(param(req, 'id')));
});

authRouter.delete('/users/:id/sessions', requireAuth, requireRole('founder'), async (req, res) => {
  const where = { userId: param(req, 'id'), revokedAt: null };
  const families = await prisma.refreshToken.findMany({ where, select: { familyId: true }, distinct: ['familyId'] });
  await prisma.refreshToken.updateMany({ where, data: { revokedAt: new Date() } });
  res.json({ signedOut: families.length });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actorOf(req).id }, select: meSelect });
  res.json(toMeDTO(me));
});

authRouter.patch('/me/password', requireAuth, async (req, res) => {
  const { current, next } = parseBody(changePasswordSchema, req);
  const actor = actorOf(req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { passwordHash: true } });
  if (!(await argon2.verify(user.passwordHash, current))) {
    throw badRequest('Current password is incorrect', { issues: [{ path: 'current', message: 'Incorrect password' }] });
  }
  if (current === next) throw badRequest('Choose a password you have not used just now');
  await prisma.user.update({ where: { id: actor.id }, data: { passwordHash: await hashPassword(next) } });
  res.status(204).end();
});

authRouter.patch('/me/avatar', requireAuth, async (req, res) => {
  const { avatarId } = parseBody(avatarSchema, req);
  const actor = actorOf(req);
  if (!isAvatarForAudience(avatarId, actor.role)) {
    throw badRequest('Choose an avatar from your role’s set');
  }
  const me = await prisma.user.update({ where: { id: actor.id }, data: { avatarId }, select: meSelect });
  res.json(toMeDTO(me));
});

authRouter.patch('/me/time-zone', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  if (actor.role !== 'expert') throw forbidden('Only Experts set their own time zone; everyone else works on team time');
  const { timeZone } = parseBody(timeZoneSchema, req);
  const me = await prisma.user.update({ where: { id: actor.id }, data: { timeZone }, select: meSelect });
  res.json(toMeDTO(me));
});
