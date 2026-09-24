import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { deviceOf } from '../auth/device';
import { deviceIdFor } from '../auth/devices';
import { prisma } from '../db';
import { logger } from '../logger';

export interface AuditEntry {
  action: string;
  summary: string;
  entityType?: string;
  entityId?: string | null;
  meta?: Prisma.InputJsonValue;
  /** For sign-in attempts, where there is no signed-in user yet. */
  userId?: string | null;
}

/**
 * The trail is written after the response, never inside the request's
 * transaction: an audit failure must not undo the user's work.
 */
export function record(req: Request, res: Response, entry: AuditEntry): void {
  const device = deviceOf(req);
  const actor = req.actor;
  const userId = entry.userId !== undefined ? entry.userId : (actor?.id ?? null);
  const statusCode = res.statusCode;
  const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
  const userAgent = req.get('user-agent')?.slice(0, 400) ?? null;
  const method = req.method;
  // The browser it came from, if it named itself; looking it up must not hold
  // up the response, so the row waits for it.
  void deviceIdFor(req)
    .then((deviceId) =>
      prisma.auditLog.create({
        data: {
          userId,
          actorRole: actor?.role ?? null,
          actorName: actor?.nickname ?? null,
          action: entry.action,
          summary: entry.summary,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          method,
          path,
          statusCode,
          ip: device.ip,
          country: device.country,
          deviceType: device.deviceType,
          deviceId,
          userAgent,
          sessionId: actor?.sessionId ?? null,
          meta: entry.meta,
        },
      }),
    )
    .catch((err) => logger.warn({ err, action: entry.action }, 'audit write failed'));
}

/** `/api/v1/calls/123/transition` → `calls/:id/transition`, so actions group. */
function shape(path: string): string {
  return path
    .replace(/^\/api\/v1\//, '')
    .split('?')[0]!
    .split('/')
    .map((part) => (/^[0-9a-f-]{36}$/i.test(part) ? ':id' : part))
    .join('/');
}

/**
 * Reads worth recording: money, personal data and anything that dumps data out.
 * Reading the trail itself is not one of them — it only filled the trail with itself.
 */
const SENSITIVE_READS = [/^users\/:id\/sign-in$/, /^stats\/profiles$/, /^profiles\/:id\/banks$/, /^db-dumps/, /^users\/:id\/sessions$/];

const MUTATIONS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Noisy housekeeping the trail would drown in: token renewals and
 * marking things read. Sign-ins and sign-outs are recorded by their routes.
 */
const SKIP = [/^auth\/refresh$/, /^notifications\/read$/, /^chat\/conversations\/:id\/read$/, /^presence/];

/**
 * What each route is called in the trail. `exact` names already say what
 * happened; the others take the verb from the method.
 */
const NAMES: Array<[RegExp, string, boolean?]> = [
  [/^calls\/:id\/transition$/, 'call.transition', true],
  [/^finance\/payouts$/, 'payout.mark', true],
  [/^calls\/:id\/messages/, 'call.message', true],
  [/^calls/, 'call'],
  [/^profiles\/:id\/platforms\/:id$/, 'profile.platform', true],
  [/^profiles\/:id\/(approve|reject)$/, 'profile.review', true],
  [/^profiles\/:id\/active$/, 'profile.active', true],
  [/^profiles\/:id\/associate$/, 'profile.associate', true],
  [/^profiles\/:id\/banks/, 'bank'],
  [/^profiles\/:id\/photo$/, 'profile.photo'],
  [/^profiles/, 'profile'],
  [/^banks\/:id$/, 'bank'],
  [/^users\/:id\/sessions$/, 'session'],
  [/^users\/:id\/sign-in$/, 'user.sign_in'],
  [/^users\/:id\/google$/, 'user.google'],
  [/^users/, 'user'],
  [/^platforms/, 'platform'],
  [/^chat\/messages\/:id\/todo$/, 'todo'],
  [/^chat\/conversations\/:id\/history$/, 'chat.history', true],
  [/^chat\/messages\/:id\/reactions$/, 'chat.reaction', true],
  [/^chat\/messages\/:id$/, 'chat.message'],
  [/^todos\/:id\/done$/, 'todo.done', true],
  [/^todos\/:id\/confirm$/, 'todo.confirm', true],
  [/^todos\/:id\/reopen$/, 'todo.reopen', true],
  [/^todos\/:id\/move$/, 'todo.move', true],
  [/^todos/, 'todo'],
  [/^chat/, 'chat'],
  [/^db-dumps/, 'dump'],
  [/^me\/sessions/, 'session'],
  [/^me\/password$/, 'password.change', true],
  [/^me/, 'me'],
  [/^auth\/login$/, 'auth.login', true],
  [/^auth\/google$/, 'auth.google', true],
  [/^auth\/logout$/, 'auth.logout', true],
  [/^audit/, 'audit'],
  [/^schedule-blocks|^experts\/:id\/schedule-blocks/, 'schedule'],
  [/^push/, 'push'],
  [/^stats\/profiles$/, 'stats.profiles', true],
];

const VERBS: Record<string, { key: string; word: string }> = {
  POST: { key: 'create', word: 'created' },
  PATCH: { key: 'update', word: 'changed' },
  PUT: { key: 'set', word: 'set' },
  DELETE: { key: 'delete', word: 'removed' },
  GET: { key: 'read', word: 'read' },
};

/** Plain wording for the actions that deserve it; the rest read "changed calls/:id". */
const SUMMARIES: Record<string, string> = {
  'auth.login': 'signed in',
  'auth.google': 'signed in with Google',
  'auth.logout': 'signed out',
  'password.change': 'changed their password',
  'call.transition': 'moved a call to its next status',
  'call.create': 'created a call',
  'call.update': 'changed a call',
  'call.delete': 'deleted a call',
  'payout.mark': 'marked someone’s pay for calls as paid or unpaid',
  'profile.associate': 'handed a profile to another Associate',
  'profile.platform': 'set a profile’s status or rate on a platform',
  'profile.review': 'approved or rejected a profile',
  'profile.active': 'activated or deactivated a profile',
  'profile.create': 'added a profile',
  'profile.update': 'changed a profile',
  'profile.delete': 'deleted a profile',
  'bank.read': 'looked at bank details',
  'bank.create': 'added bank details',
  'bank.update': 'changed bank details',
  'bank.delete': 'removed bank details',
  'dump.read': 'looked at the database backups',
  'dump.create': 'took a database backup',
  'session.delete': 'signed a device out',
  'session.read': 'looked at signed-in devices',
  'user.create': 'created a user',
  'user.update': 'changed a user',
  'user.delete': 'deleted a user account',
  'user.sign_in.read': 'looked at someone’s sign-in email and Google account',
  'user.sign_in.update': 'changed someone’s sign-in email',
  'user.google.delete': 'unlinked someone’s Google account',
  'todo.create': 'gave a task',
  'chat.message.delete': 'deleted a chat message',
  'chat.reaction': 'reacted to a chat message',
  'chat.history': 'erased a chat history',
  'todo.delete': 'removed a task',
  'todo.done': 'marked a task done',
  'todo.confirm': 'confirmed a task complete',
  'todo.reopen': 'reopened a task',
  'todo.move': 'handed a task to someone else',
  // No longer recorded; kept so entries written before still read well.
  'audit.read': 'read the audit trail',
  'stats.profiles': 'looked at profile statistics (emails and banks)',
};

function describe(method: string, shaped: string): { action: string; summary: string } {
  const match = NAMES.find(([re]) => re.test(shaped));
  const name = match?.[1] ?? shaped.split('/')[0] ?? 'request';
  const verb = VERBS[method] ?? { key: method.toLowerCase(), word: method.toLowerCase() };
  const action = match?.[2] ? name : `${name}.${verb.key}`;
  return { action, summary: SUMMARIES[action] ?? `${verb.word} ${shaped}` };
}

/**
 * Records every change and every sensitive read, once the response is known,
 * so failed attempts (403, 409) are in the trail too.
 */
export const auditRequests: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const shaped = shape(req.originalUrl);
  const interesting =
    !SKIP.some((re) => re.test(shaped)) &&
    (MUTATIONS.has(req.method) || (req.method === 'GET' && SENSITIVE_READS.some((re) => re.test(shaped))));
  if (!interesting) return next();

  res.on('finish', () => {
    // A failed sign-in has no actor: keep the attempted address, and only then.
    const failed = res.statusCode >= 400;
    const signIn = shaped === 'auth/login' || shaped === 'auth/google';
    const email = !failed
      ? undefined
      : shaped === 'auth/login'
        ? (req.body as { email?: string } | undefined)?.email
        : shaped === 'auth/google'
          ? (res.locals.signInEmail as string | undefined)
          : undefined;
    const { action, summary } = describe(req.method, shaped);
    const id = (req.params?.id ?? null) as string | null;
    record(req, res, {
      action: failed ? `${action}.failed` : action,
      summary: failed ? `${summary} — refused (${res.statusCode})` : summary,
      entityId: id && /^[0-9a-f-]{36}$/i.test(id) ? id : null,
      meta: email ? { email } : undefined,
      ...(failed && signIn ? { userId: null } : {}),
    });
  });
  next();
};
