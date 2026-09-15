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

// Wording and links are shared with the server, which uses them for push notifications.
export { notificationLink, notificationText } from '@god/shared';
