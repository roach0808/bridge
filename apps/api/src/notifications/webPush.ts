import { notificationLink, notificationText, type NotificationDTO, type WebPushPayload } from '@god/shared';
import webpush from 'web-push';
import { config } from '../config';
import { prisma } from '../db';
import { logger } from '../logger';

/** Browser push is on only when both VAPID keys are configured. */
export const webPushEnabled = () => Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY);

let vapidSet = false;

/**
 * Sends a push to every browser the users have subscribed. Fire-and-forget:
 * failures are logged, and subscriptions the push service says are gone
 * (404/410) are deleted.
 */
export async function sendWebPush(userIds: Iterable<string>, payload: WebPushPayload): Promise<void> {
  if (!webPushEnabled()) return;
  try {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    if (!vapidSet) {
      webpush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY!, config.VAPID_PRIVATE_KEY!);
      vapidSet = true;
    }
    const subs = await prisma.webPushSubscription.findMany({ where: { userId: { in: ids } } });
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            TTL: 60 * 60 * 24,
            urgency: payload.kind === 'chat' ? 'high' : 'normal',
            topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
          });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await prisma.webPushSubscription.deleteMany({ where: { id: s.id } });
          } else {
            logger.warn({ err, status }, 'web push failed');
          }
        }
      }),
    );
  } catch (err) {
    logger.warn({ err }, 'web push error');
  }
}

/** The push for a stored notification (to-dos, calls, profiles). */
export function notificationPush(n: NotificationDTO): WebPushPayload {
  const { title, body } = notificationText(n);
  return { title, body, url: notificationLink(n) ?? '/notifications', tag: `notification:${n.id}`, kind: 'notification' };
}
