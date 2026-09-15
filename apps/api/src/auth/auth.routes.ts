import {
  ERROR_CODES,
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
import { parseBody } from '../http';
import { meSelect, toMeDTO } from '../serializers';
import { actorOf, requireAuth } from './middleware';
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
  const refresh = await issueRefreshToken(prisma, user.id);
  setRefreshCookie(res, refresh.token);
  res.json({
    accessToken: signAccessToken(user.id, user.role),
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
      return { error: 'Refresh token was already used' } as const;
    }
    if (row.expiresAt <= new Date()) return { error: 'Refresh token expired' } as const;
    const user = await tx.user.findUnique({ where: { id: row.userId }, select: meSelect });
    if (!user?.isActive) {
      await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      return { error: 'This account has been deactivated', code: ERROR_CODES.inactive } as const;
    }
    const next = await issueRefreshToken(tx, row.userId, row.familyId);
    await tx.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedBy: next.id } });
    return { user, next } as const;
  });

  if ('error' in result) {
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    throw unauthenticated(result.error, 'code' in result ? result.code : ERROR_CODES.unauthenticated);
  }
  setRefreshCookie(res, result.next.token);
  res.json({
    accessToken: signAccessToken(result.user.id, result.user.role),
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
