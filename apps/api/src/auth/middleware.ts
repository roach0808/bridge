import type { Role } from '@god/shared';
import { ERROR_CODES } from '@god/shared';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { forbidden, unauthenticated } from '../errors';
import { verifyAccessToken } from './tokens';

export interface Actor {
  id: string;
  role: Role;
  nickname: string;
  managerId: string | null;
  timeZone: string;
  avatarId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

export async function loadActiveActor(userId: string): Promise<Actor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, nickname: true, managerId: true, timeZone: true, avatarId: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  const { isActive: _active, ...actor } = user;
  return actor;
}

/**
 * Verifies the bearer token and loads the user fresh from the database, so a
 * deactivation or role change takes effect on the very next request.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthenticated();
  let userId: string;
  try {
    userId = verifyAccessToken(header.slice(7)).sub;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw unauthenticated('Your session expired', ERROR_CODES.tokenExpired);
    }
    throw unauthenticated('Invalid access token');
  }
  const actor = await loadActiveActor(userId);
  if (!actor) throw unauthenticated('This account is not active', ERROR_CODES.inactive);
  req.actor = actor;
  next();
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.actor) throw unauthenticated();
    if (!roles.includes(req.actor.role)) throw forbidden();
    next();
  };

export function actorOf(req: Express.Request): Actor {
  if (!req.actor) throw unauthenticated();
  return req.actor;
}
