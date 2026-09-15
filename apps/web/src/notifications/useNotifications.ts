import type { NotificationDTO } from '@god/shared';
import { STATUS_LABELS } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export function useNotifications() {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.notifications.list({ limit: 50 }),
    refetchInterval: 120_000,
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[] | 'all') => (ids === 'all' ? api.notifications.markAllRead() : api.notifications.markRead(ids)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.notifications }),
  });
}

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

export function notificationLink(n: NotificationDTO): string | null {
  if (n.payload.callId) return `/calls/${n.payload.callId}`;
  if (n.payload.profileId) return '/profiles';
  return null;
}
