import {
  deviceSchema,
  listNotificationsQuerySchema,
  markReadSchema,
  webPushSubscriptionSchema,
  webPushUnsubscribeSchema,
  type NotificationList,
} from '@god/shared';
import { Router } from 'express';
import { actorOf, requireAuth } from '../auth/middleware';
import { prisma } from '../db';
import { param, parseBody, parseQuery } from '../http';
import { config } from '../config';
import { toNotificationDTO } from './notify';
import { conflict } from '../errors';
import { sendWebPush, webPushEnabled } from './webPush';

export const notificationsRouter = Router();

notificationsRouter.get('/notifications', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const { unread, limit } = parseQuery(listNotificationsQuerySchema, req);
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: actor.id, ...(unread === 'true' ? { readAt: null } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    }),
    prisma.notification.count({ where: { userId: actor.id, readAt: null } }),
  ]);
  res.set('X-Unread-Count', String(unreadCount));
  const body: NotificationList = { items: items.map(toNotificationDTO), unreadCount };
  res.json(body);
});

notificationsRouter.post('/notifications/read', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const input = parseBody(markReadSchema, req);
  const { count } = await prisma.notification.updateMany({
    where: { userId: actor.id, readAt: null, ...('ids' in input ? { id: { in: input.ids } } : {}) },
    data: { readAt: new Date() },
  });
  const unreadCount = await prisma.notification.count({ where: { userId: actor.id, readAt: null } });
  res.set('X-Unread-Count', String(unreadCount));
  res.json({ updated: count, unreadCount });
});

// --- Browser push ------------------------------------------------------------------

/** The VAPID public key browsers subscribe with; null when push is not configured. */
notificationsRouter.get('/push/config', requireAuth, (_req, res) => {
  res.json({ publicKey: webPushEnabled() ? config.VAPID_PUBLIC_KEY : null });
});

/** Saves this browser's subscription for the signed-in user (it moves if someone else signed in before). */
notificationsRouter.post('/push/subscriptions', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const { endpoint, keys } = parseBody(webPushSubscriptionSchema, req);
  const userAgent = req.get('user-agent')?.slice(0, 300) ?? null;
  await prisma.webPushSubscription.upsert({
    where: { endpoint },
    create: { userId: actor.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    update: { userId: actor.id, p256dh: keys.p256dh, auth: keys.auth, userAgent, lastSeenAt: new Date() },
  });
  res.status(204).end();
});

/** Sends a test notification to all of the caller's subscribed browsers. */
notificationsRouter.post('/push/test', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  if (!webPushEnabled()) throw conflict('Browser notifications are not configured on the server');
  const count = await prisma.webPushSubscription.count({ where: { userId: actor.id } });
  if (!count) throw conflict('Turn on notifications in this browser first');
  await sendWebPush([actor.id], {
    title: 'Notifications are working',
    body: 'You will be notified about new chat messages, to-dos and call updates.',
    url: '/settings',
    tag: 'test',
    kind: 'test',
  });
  res.json({ browsers: count });
});

/** Called on sign-out or when the user turns notifications off in this browser. */
notificationsRouter.delete('/push/subscriptions', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const { endpoint } = parseQuery(webPushUnsubscribeSchema, req);
  await prisma.webPushSubscription.deleteMany({ where: { endpoint, userId: actor.id } });
  res.status(204).end();
});

// --- Devices (Phase 2 endpoints shipped in Phase 1, §6.7) --------------------

notificationsRouter.post('/devices', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  const { platform, token } = parseBody(deviceSchema, req);
  const device = await prisma.deviceToken.upsert({
    where: { token },
    create: { userId: actor.id, platform, token },
    update: { userId: actor.id, platform, lastSeenAt: new Date() },
  });
  res.status(201).json({ id: device.id, platform: device.platform, token: device.token });
});

notificationsRouter.delete('/devices/:token', requireAuth, async (req, res) => {
  const actor = actorOf(req);
  await prisma.deviceToken.deleteMany({ where: { token: param(req, 'token'), userId: actor.id } });
  res.status(204).end();
});
