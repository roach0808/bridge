import { deviceSchema, listNotificationsQuerySchema, markReadSchema, type NotificationList } from '@god/shared';
import { Router } from 'express';
import { actorOf, requireAuth } from '../auth/middleware';
import { prisma } from '../db';
import { param, parseBody, parseQuery } from '../http';
import { toNotificationDTO } from './notify';

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
