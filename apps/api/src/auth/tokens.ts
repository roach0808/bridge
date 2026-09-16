import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@god/shared';
import { config, durationToMs } from '../config';
import type { Db } from '../db';
import type { DeviceInfo } from './device';

export interface AccessClaims {
  sub: string;
  role: Role;
  /** The session (refresh-token family) this token belongs to. */
  sid?: string;
}

export function signAccessToken(userId: string, role: Role, sessionId?: string): string {
  return jwt.sign({ role, sid: sessionId }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: Math.floor(durationToMs(config.ACCESS_TOKEN_TTL) / 1000),
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || !payload.sub) throw new Error('Malformed token');
  return { sub: payload.sub, role: payload.role as Role, sid: payload.sid as string | undefined };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Sessions that never expire still need a date in the column. */
const NEVER = new Date('9999-12-31T00:00:00.000Z');
/** Ten years: the longest a browser will keep the refresh cookie. */
const COOKIE_MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const sessionExpiry = () =>
  config.REFRESH_TOKEN_TTL === 'never' ? NEVER : new Date(Date.now() + durationToMs(config.REFRESH_TOKEN_TTL));

/** Issues a random 256-bit refresh token, stored hashed, carrying the session's device. */
export async function issueRefreshToken(
  db: Db,
  userId: string,
  familyId: string = randomUUID(),
  device?: Partial<DeviceInfo>,
): Promise<{ token: string; id: string; familyId: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = sessionExpiry();
  const row = await db.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: hashToken(token),
      expiresAt,
      deviceType: device?.deviceType ?? null,
      browser: device?.browser ?? null,
      os: device?.os ?? null,
      ip: device?.ip ?? null,
      country: device?.country ?? null,
      lastUsedAt: new Date(),
    },
  });
  return { token, id: row.id, familyId, expiresAt };
}

export const refreshTokenTtlMs = () =>
  config.REFRESH_TOKEN_TTL === 'never' ? COOKIE_MAX_AGE_MS : durationToMs(config.REFRESH_TOKEN_TTL);
