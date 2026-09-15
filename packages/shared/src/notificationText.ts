import { STATUS_LABELS } from './callStatus';
import type { NotificationDTO } from './types';

/** Title and body of a notification, for the bell, the notifications page and push. */
export function notificationText(n: NotificationDTO): { title: string; body: string } {
  const who = n.payload.actor ? n.payload.actor.nickname : 'Someone';
  switch (n.type) {
    case 'call.status_changed':
      return {
        title: `${who} moved a call to ${n.payload.to ? STATUS_LABELS[n.payload.to] : 'a new status'}`,
        body: n.payload.summary ?? '',
      };
    case 'call.message':
      return { title: `${who} posted a message`, body: n.payload.summary ?? '' };
    case 'call.assigned':
      return { title: `${who} assigned you a call`, body: n.payload.summary ?? '' };
    case 'call.created':
      return { title: `${who} created a call`, body: n.payload.summary ?? '' };
    case 'call.updated':
      return { title: `${who} updated a call`, body: n.payload.summary ?? '' };
    case 'todo.assigned':
      return { title: `${who} gave you a to-do`, body: n.payload.summary ?? '' };
    case 'todo.done':
      return { title: `${who} finished a to-do`, body: n.payload.summary ?? '' };
    case 'profile.submitted':
      return { title: `${who} submitted a profile for review`, body: n.payload.summary ?? '' };
    case 'profile.approved':
      return { title: 'Profile approved', body: n.payload.summary ?? '' };
    case 'profile.rejected':
      return { title: 'Profile rejected', body: n.payload.summary ?? '' };
    default:
      return { title: 'Notification', body: n.payload.summary ?? '' };
  }
}

/** Where a notification leads in the web app, or null. */
export function notificationLink(n: NotificationDTO): string | null {
  if (n.payload.callId) return `/calls/${n.payload.callId}`;
  if (n.type === 'todo.assigned') return '/todos';
  if (n.payload.conversationId) return `/chat/${n.payload.conversationId}`;
  if (n.payload.profileId) return '/profiles';
  return null;
}
