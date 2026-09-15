import type { NotificationDTO, NotificationPayload, NotificationType } from '@god/shared';
import type { Prisma } from '@prisma/client';
import type { Db } from '../db';
import { iso, isoOrNull } from '../http';
import { emitToUser } from '../realtime/hub';
import { sendPush } from './push';

export const toNotificationDTO = (n: Prisma.NotificationGetPayload<object>): NotificationDTO => ({
  id: n.id,
  type: n.type as NotificationType,
  payload: n.payload as NotificationPayload,
  readAt: isoOrNull(n.readAt),
  createdAt: iso(n.createdAt),
});

export type Deliver = () => void;

/**
 * The single entry point for outgoing notifications (§5.3). Writes the rows
 * inside the caller's transaction and returns a `deliver` callback to run
 * after commit, which emits socket events and (Phase 2) push messages.
 */
export async function notify(
  db: Db,
  recipientIds: Iterable<string>,
  type: NotificationType,
  payload: NotificationPayload,
): Promise<Deliver> {
  const ids = [...new Set(recipientIds)];
  if (!ids.length) return () => {};
  const rows = await db.notification.createManyAndReturn({
    data: ids.map((userId) => ({ userId, type, payload: payload as Prisma.InputJsonValue })),
  });
  return () => {
    for (const row of rows) {
      const dto = toNotificationDTO(row);
      emitToUser(row.userId, 'notification:new', dto);
      void sendPush(row.userId, dto);
    }
  };
}

export function deliverAll(delivers: Deliver[]) {
  for (const d of delivers) d();
}
