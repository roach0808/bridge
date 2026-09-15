import type { CallDetailDTO, CallDTO, CursorPage, MessageDTO, NotificationDTO, NotificationList, Paginated } from '@god/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { socket } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/** Patches every cached copy of a Call with the server's latest version (§9.3). */
export function patchCallInCache(queryClient: QueryClient, call: CallDTO) {
  queryClient.setQueriesData<Paginated<CallDTO>>({ queryKey: ['calls', 'list'] }, (data) =>
    data ? { ...data, items: data.items.map((c) => (c.id === call.id ? call : c)) } : data,
  );
  queryClient.setQueryData<CallDetailDTO>(qk.calls.detail(call.id), (data) => (data ? { ...data, ...call } : data));
}

interface RealtimeState {
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeState>({ connected: false });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { status } = useAuth();
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const onConnect = () => {
      setConnected(true);
      // Anything could have changed while we were away.
      void queryClient.invalidateQueries({ queryKey: qk.calls.all });
      void queryClient.invalidateQueries({ queryKey: qk.notifications });
    };
    const onDisconnect = () => setConnected(false);

    const onCallUpdated = (call: CallDTO) => {
      const knownInList = queryClient
        .getQueriesData<Paginated<CallDTO>>({ queryKey: ['calls', 'list'] })
        .some(([, d]) => d?.items.some((c) => c.id === call.id));
      patchCallInCache(queryClient, call);
      // History lives only on the detail payload; refresh it in the background.
      void queryClient.invalidateQueries({ queryKey: qk.calls.detail(call.id), refetchType: 'active' });
      if (!knownInList) void queryClient.invalidateQueries({ queryKey: ['calls', 'list'] });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.calendar.all });
    };

    const onMessage = (message: MessageDTO) => {
      queryClient.setQueryData<CallDetailDTO>(qk.calls.detail(message.callId), (data) =>
        data && !data.messages.some((m) => m.id === message.id)
          ? { ...data, messages: [...data.messages, message] }
          : data,
      );
      queryClient.setQueryData<{ pages: CursorPage<MessageDTO>[]; pageParams: unknown[] }>(
        qk.calls.messages(message.callId),
        (data) => {
          if (!data?.pages.length) return data;
          if (data.pages.some((p) => p.items.some((m) => m.id === message.id))) return data;
          const [first, ...rest] = data.pages;
          return { ...data, pages: [{ ...first!, items: [...first!.items, message] }, ...rest] };
        },
      );
    };

    const onNotification = (n: NotificationDTO) => {
      queryClient.setQueryData<NotificationList>(qk.notifications, (data) =>
        data ? { items: [n, ...data.items], unreadCount: data.unreadCount + 1 } : data,
      );
      void queryClient.invalidateQueries({ queryKey: qk.notifications, refetchType: 'none' });
      window.dispatchEvent(new CustomEvent<NotificationDTO>('god:notification', { detail: n }));
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('call:updated', onCallUpdated);
    socket.on('call:message', onMessage);
    socket.on('notification:new', onNotification);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('call:updated', onCallUpdated);
      socket.off('call:message', onMessage);
      socket.off('notification:new', onNotification);
    };
  }, [queryClient, status]);

  return <RealtimeContext.Provider value={{ connected }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
