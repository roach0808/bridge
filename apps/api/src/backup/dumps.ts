import { gzipSync } from 'node:zlib';
import { TEAM_TIME_ZONE, type DbDumpDTO } from '@god/shared';
import type { DbDumpTrigger, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../db';
import { iso } from '../http';
import { logger } from '../logger';

/** How many dumps to keep; older ones are deleted after each run. */
export const DUMP_RETENTION = 7;
/** A dump larger than this is refused rather than stored. */
const MAX_DUMP_BYTES = 100 * 1024 * 1024;

/**
 * Every table in the dump. `refresh_tokens` is left out on purpose: those are
 * session secrets, and dropping them only signs people out of a restored copy.
 */
const TABLES = {
  avatars: () => prisma.avatar.findMany(),
  users: () => prisma.user.findMany(),
  photos: () => prisma.photo.findMany(),
  platforms: () => prisma.platform.findMany(),
  profiles: () => prisma.profile.findMany(),
  profile_platform_statuses: () => prisma.profilePlatformStatus.findMany(),
  profile_banks: () => prisma.profileBank.findMany(),
  calls: () => prisma.call.findMany(),
  call_status_history: () => prisma.callStatusHistory.findMany(),
  messages: () => prisma.message.findMany(),
  schedule_blocks: () => prisma.scheduleBlock.findMany(),
  conversations: () => prisma.conversation.findMany(),
  chat_messages: () => prisma.chatMessage.findMany(),
  todos: () => prisma.todo.findMany(),
  notifications: () => prisma.notification.findMany(),
  device_tokens: () => prisma.deviceToken.findMany(),
  web_push_subscriptions: () => prisma.webPushSubscription.findMany(),
} as const;

/** Buffers (photos, dumps) become `{ $bytea }` so a dump stays plain JSON. */
const replacer = (_key: string, value: unknown) => {
  const buffer = value as { type?: string; data?: number[] } | null;
  return buffer && typeof buffer === 'object' && buffer.type === 'Buffer' && Array.isArray(buffer.data)
    ? { $bytea: Buffer.from(buffer.data).toString('base64') }
    : value;
};

export const toDbDumpDTO = (d: {
  id: string;
  trigger: DbDumpTrigger;
  succeeded: boolean;
  error: string | null;
  byteSize: number;
  tableCounts: Prisma.JsonValue;
  createdAt: Date;
}): DbDumpDTO => ({
  id: d.id,
  trigger: d.trigger,
  succeeded: d.succeeded,
  error: d.error,
  byteSize: d.byteSize,
  tableCounts: (d.tableCounts ?? {}) as Record<string, number>,
  createdAt: iso(d.createdAt),
});

const dumpSelect = {
  id: true,
  trigger: true,
  succeeded: true,
  error: true,
  byteSize: true,
  tableCounts: true,
  createdAt: true,
} satisfies Prisma.DbDumpSelect;

/** Dumps every table into one gzipped JSON row, then prunes old ones. */
export async function createDump(trigger: DbDumpTrigger): Promise<DbDumpDTO> {
  const startedAt = Date.now();
  try {
    const tables: Record<string, unknown[]> = {};
    for (const [name, read] of Object.entries(TABLES)) tables[name] = await read();
    const counts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
    const body = JSON.stringify({ takenAt: new Date().toISOString(), tables }, replacer);
    const data = gzipSync(Buffer.from(body), { level: 9 });
    if (data.byteLength > MAX_DUMP_BYTES) throw new Error(`Dump too large (${data.byteLength} bytes)`);

    const row = await prisma.dbDump.create({
      data: { trigger, succeeded: true, byteSize: data.byteLength, tableCounts: counts, data },
      select: dumpSelect,
    });
    await prune();
    logger.info({ ms: Date.now() - startedAt, bytes: data.byteLength, trigger }, 'database dump stored');
    return toDbDumpDTO(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, trigger }, 'database dump failed');
    const row = await prisma.dbDump.create({
      data: { trigger, succeeded: false, error: message.slice(0, 500), byteSize: 0, tableCounts: {} },
      select: dumpSelect,
    });
    await prune();
    return toDbDumpDTO(row);
  }
}

async function prune() {
  const keep = await prisma.dbDump.findMany({ orderBy: { createdAt: 'desc' }, take: DUMP_RETENTION, select: { id: true } });
  await prisma.dbDump.deleteMany({ where: { id: { notIn: keep.map((k) => k.id) } } });
}

export async function listDumps(): Promise<DbDumpDTO[]> {
  const rows = await prisma.dbDump.findMany({ orderBy: { createdAt: 'desc' }, take: DUMP_RETENTION, select: dumpSelect });
  return rows.map(toDbDumpDTO);
}

export async function readDump(id: string) {
  return prisma.dbDump.findUnique({ where: { id }, select: { id: true, data: true, createdAt: true, succeeded: true } });
}

/** How long the audit trail is kept. */
const AUDIT_RETENTION_DAYS = 365;

/** Drops audit entries older than a year, with the nightly dump. */
export async function trimAuditTrail(): Promise<number> {
  const cutoff = new Date(Date.now() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (count) logger.info({ count }, 'trimmed audit trail');
  return count;
}

/** The hour (team time) the nightly dump runs at. */
const DUMP_HOUR = 3;

/**
 * Runs the nightly dump: checks every 15 minutes, and also catches up when the
 * process was asleep (the API sleeps on free hosting) and a day was missed.
 */
export function startDumpSchedule(everyMs = 15 * 60_000): NodeJS.Timeout {
  const tick = async () => {
    try {
      const last = await prisma.dbDump.findFirst({
        where: { succeeded: true },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const now = DateTime.now().setZone(TEAM_TIME_ZONE);
      const lastAt = last ? DateTime.fromJSDate(last.createdAt).setZone(TEAM_TIME_ZONE) : null;
      // Today's run is due once it is past the dump hour and nothing ran since.
      const dueToday = now.hour >= DUMP_HOUR && (!lastAt || lastAt < now.startOf('day').plus({ hours: DUMP_HOUR }));
      const missedADay = lastAt !== null && now.diff(lastAt, 'hours').hours >= 24;
      if (!last || dueToday || missedADay) {
        await createDump('scheduled');
        await trimAuditTrail();
      }
    } catch (err) {
      logger.warn({ err }, 'dump schedule tick failed');
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return timer;
}
