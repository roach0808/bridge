import type {
  CallDetailDTO,
  CallDTO,
  ChatMessageDTO,
  ChatMessagePage,
  ChatReadEvent,
  CursorPage,
  MessageDTO,
  NotificationDTO,
  NotificationList,
  Paginated,
  TodoDTO,
  TodoRemovedEvent,
} from '@god/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { notificationLink, notificationText } from '@god/shared';
import { useAuth } from '@/auth/AuthProvider';
import { showInTabNotification } from '@/lib/push';
import { socket } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

type ChatPages = { pages: ChatMessagePage[]; pageParams: unknown[] };

/**
 * Adds a chat message to the loaded thread, ignoring duplicates. When the thread
 * holds an older window (the newest pages were let go), it arrives on scrolling down.
 */
export function appendChatMessage(queryClient: QueryClient, message: ChatMessageDTO) {
  queryClient.setQueryData<ChatPages>(qk.chat.messages(message.conversationId), (data) => {
    if (!data?.pages.length || data.pages[0]!.hasNewer) return data;
    if (data.pages.some((p) => p.items.some((m) => m.id === message.id))) return data;
    const [first, ...rest] = data.pages;
    return { ...data, pages: [{ ...first!, items: [...first!.items, message] }, ...rest] };
  });
}

/** Patches every cached copy of a Call with the server's latest version (§9.3). */
export function patchCallInCache(queryClient: QueryClient, call: CallDTO) {
  queryClient.setQueriesData<Paginated<CallDTO>>({ queryKey: ['calls', 'list'] }, (data) =>
    data ? { ...data, items: data.items.map((c) => (c.id === call.id ? call : c)) } : data,
  );
  queryClient.setQueryData<CallDetailDTO>(qk.calls.detail(call.id), (data) => (data ? { ...data, ...call } : data));
}

/** Asks the app (inside the router) to open a path; used by notification clicks. */
export const navigateTo = (url: string) => window.dispatchEvent(new CustomEvent<string>('god:navigate', { detail: url }));

interface RealtimeState {
  connected: boolean;
}

const RealtimeContext = createContext<RealtimeState>({ connected: false });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { status, user } = useAuth();
  const meId = user?.id;
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const onConnect = () => {
      setConnected(true);
      // Anything could have changed while we were away.
      void queryClient.invalidateQueries({ queryKey: qk.calls.all });
      void queryClient.invalidateQueries({ queryKey: qk.notifications });
      void queryClient.invalidateQueries({ queryKey: qk.chat.all });
      void queryClient.invalidateQueries({ queryKey: qk.todos.all });
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

    const onChatMessage = (message: ChatMessageDTO) => {
      appendChatMessage(queryClient, message);
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversation(message.conversationId) });
      window.dispatchEvent(new CustomEvent<ChatMessageDTO>('god:chat-message', { detail: message }));
      if (message.sender.id !== meId && message.kind === 'text') {
        showInTabNotification(
          message.sender.nickname,
          { body: message.body, tag: `chat:${message.conversationId}`, url: `/chat/${message.conversationId}` },
          navigateTo,
        );
      }
    };

    const onChatTodo = (todo: TodoDTO | TodoRemovedEvent) => {
      // A chat task shows on its message and in the chat list counts; every task is on the task lists.
      if (todo.conversationId) {
        void queryClient.invalidateQueries({ queryKey: qk.chat.messages(todo.conversationId) });
        void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
        void queryClient.invalidateQueries({ queryKey: qk.chat.conversation(todo.conversationId) });
      }
      void queryClient.invalidateQueries({ queryKey: qk.todos.all });
    };

    const onChatRead = (event: ChatReadEvent) => {
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversation(event.conversationId) });
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
    };

    const onNotification = (n: NotificationDTO) => {
      queryClient.setQueryData<NotificationList>(qk.notifications, (data) =>
        data ? { items: [n, ...data.items], unreadCount: data.unreadCount + 1 } : data,
      );
      void queryClient.invalidateQueries({ queryKey: qk.notifications, refetchType: 'none' });
      window.dispatchEvent(new CustomEvent<NotificationDTO>('god:notification', { detail: n }));
      const text = notificationText(n);
      showInTabNotification(text.title, { body: text.body, tag: `notification:${n.id}`, url: notificationLink(n) ?? '/notifications' }, navigateTo);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('call:updated', onCallUpdated);
    socket.on('call:message', onMessage);
    socket.on('notification:new', onNotification);
    socket.on('chat:message', onChatMessage);
    socket.on('chat:todo', onChatTodo);
    socket.on('chat:read', onChatRead);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('call:updated', onCallUpdated);
      socket.off('call:message', onMessage);
      socket.off('notification:new', onNotification);
      socket.off('chat:message', onChatMessage);
      socket.off('chat:todo', onChatTodo);
      socket.off('chat:read', onChatRead);
    };
  }, [queryClient, status, meId]);

  return <RealtimeContext.Provider value={{ connected }}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
