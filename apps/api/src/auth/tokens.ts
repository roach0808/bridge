import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Role } from '@god/shared';
import { config, durationToMs } from '../config';
import type { Db } from '../db';

export interface AccessClaims {
  sub: string;
  role: Role;
}

export function signAccessToken(userId: string, role: Role): string {
  return jwt.sign({ role }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    expiresIn: Math.floor(durationToMs(config.ACCESS_TOKEN_TTL) / 1000),
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
  if (typeof payload === 'string' || !payload.sub) throw new Error('Malformed token');
  return { sub: payload.sub, role: payload.role as Role };
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Issues a random 256-bit refresh token, stored hashed. */
export async function issueRefreshToken(
  db: Db,
  userId: string,
  familyId: string = randomUUID(),
): Promise<{ token: string; id: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + durationToMs(config.REFRESH_TOKEN_TTL));
  const row = await db.refreshToken.create({
    data: { userId, familyId, tokenHash: hashToken(token), expiresAt },
  });
  return { token, id: row.id, expiresAt };
}

export const refreshTokenTtlMs = () => durationToMs(config.REFRESH_TOKEN_TTL);
