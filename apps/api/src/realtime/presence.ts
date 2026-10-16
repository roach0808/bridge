import { AWAY_AFTER_MS, canChat, type PresenceDTO, type PresenceStatus, type TeamMember } from '@god/shared';
import { prisma } from '../db';
import { logger } from '../logger';
import { emitToUser } from './hub';

interface Connection {
  /** Who they are to the chat rules: presence goes only to people they may chat with. */
  member: TeamMember;
  sockets: Set<string>;
  /** Last sign of life from any of their tabs. */
  lastActiveAt: number;
  /** Every tab reported itself hidden or idle. */
  away: boolean;
}

/** Who is connected right now. Presence is per process: one API instance (§7.6). */
const connections = new Map<string, Connection>();
/** The status each peer was last told about, so we only broadcast changes. */
const broadcasted = new Map<string, PresenceStatus>();

const statusOf = (c: Connection): PresenceStatus =>
  c.away || Date.now() - c.lastActiveAt > AWAY_AFTER_MS ? 'away' : 'online';

export function presenceOf(userId: string): PresenceStatus {
  const c = connections.get(userId);
  return c ? statusOf(c) : 'offline';
}

/** Sends one person's presence to every connected user who may chat with them. */
function broadcast(member: TeamMember, dto: PresenceDTO) {
  for (const [peerId, peer] of connections) {
    if (peerId !== member.id && canChat(peer.member, member)) {
      emitToUser(peerId, 'presence:update', [dto]);
    }
  }
}

function publish(member: TeamMember, status: PresenceStatus, lastSeenAt: Date | null) {
  const userId = member.id;
  if (broadcasted.get(userId) === status) return;
  broadcasted.set(userId, status);
  broadcast(member, { userId, status, lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null });
}

async function touch(userId: string) {
  try {
    await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } });
  } catch (err) {
    logger.warn({ err, userId }, 'could not store last seen');
  }
}

export async function markConnected(member: TeamMember, socketId: string): Promise<void> {
  const userId = member.id;
  const existing = connections.get(userId);
  if (existing) {
    existing.sockets.add(socketId);
    existing.lastActiveAt = Date.now();
    existing.away = false;
  } else {
    connections.set(userId, { member, sockets: new Set([socketId]), lastActiveAt: Date.now(), away: false });
  }
  publish(member, 'online', null);
  await touch(userId);
}

export function markDisconnected(userId: string, socketId: string): void {
  const c = connections.get(userId);
  if (!c) return;
  c.sockets.delete(socketId);
  if (c.sockets.size) return;
  connections.delete(userId);
  broadcasted.delete(userId);
  const at = new Date();
  broadcast(c.member, { userId, status: 'offline', lastSeenAt: at.toISOString() });
  void touch(userId);
}

/** A tab reported activity (`away: false`) or that it went idle / hidden. */
export function markActivity(userId: string, away: boolean): void {
  const c = connections.get(userId);
  if (!c) return;
  c.away = away;
  if (!away) c.lastActiveAt = Date.now();
  publish(c.member, statusOf(c), null);
}

/** Presence of everyone the caller may chat with, active users only. */
export async function presenceFor(actor: TeamMember): Promise<PresenceDTO[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, id: { not: actor.id } },
    select: { id: true, role: true, managerId: true, lastSeenAt: true },
  });
  return users
    .filter((u) => canChat(actor, u))
    .map((u) => {
      const status = presenceOf(u.id);
      return { userId: u.id, status, lastSeenAt: status === 'offline' ? u.lastSeenAt.toISOString() : null };
    });
}

/** Flips idle connections to `away` and keeps `last_seen_at` fresh for open tabs. */
export function startPresenceSweeper(everyMs = 60_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    for (const [userId, c] of connections) {
      publish(c.member, statusOf(c), null);
      if (statusOf(c) === 'online') void touch(userId);
    }
  }, everyMs);
  timer.unref();
  return timer;
}
