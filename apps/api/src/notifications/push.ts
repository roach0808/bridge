import { config } from '../config';
import { prisma } from '../db';
import { logger } from '../logger';
import type { NotificationDTO } from '@god/shared';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function titleFor(n: NotificationDTO): { title: string; body: string } {
  const who = n.payload.actor?.nickname ?? 'Someone';
  switch (n.type) {
    case 'call.status_changed':
      return { title: 'Call status changed', body: `${who} moved a call to ${n.payload.to}` };
    case 'call.message':
      return { title: 'New message', body: `${who} posted in a call thread` };
    case 'call.assigned':
      return { title: 'Call assigned', body: `${who} assigned you a call` };
    default:
      return { title: 'God System', body: n.payload.summary ?? 'You have a new notification' };
  }
}

/**
 * Expo push adapter (Phase 2). A no-op unless PUSH_ENABLED=true, so Phase 1
 * deployments never call out to Expo.
 */
export async function sendPush(userId: string, notification: NotificationDTO): Promise<void> {
  if (!config.PUSH_ENABLED) return;
  // Called fire-and-forget: every failure, including the device lookup, is logged, never thrown.
  try {
    const devices = await prisma.deviceToken.findMany({
      where: { userId, platform: { in: ['ios', 'android'] } },
      select: { token: true },
    });
    if (!devices.length) return;
    const { title, body } = titleFor(notification);
    const messages = devices.map((d) => ({
      to: d.token,
      title,
      body,
      sound: 'default',
      data: { url: notification.payload.callId ? `call/${notification.payload.callId}` : undefined, ...notification.payload },
    }));
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${config.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) logger.warn({ status: res.status }, 'expo push failed');
  } catch (err) {
    logger.warn({ err }, 'expo push error');
  }
}
