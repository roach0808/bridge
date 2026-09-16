import { AWAY_AFTER_MS, type PresenceDTO, type PresenceStatus } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { api, socket } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export interface Presence {
  status: PresenceStatus;
  lastSeenAt: string | null;
}

const OFFLINE: Presence = { status: 'offline', lastSeenAt: null };
const PresenceContext = createContext<Map<string, Presence>>(new Map());

/** Tells the server this tab is in use, at most once a minute. */
function useReportActivity(enabled: boolean) {
  const lastSent = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const active = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastSent.current < 60_000) return;
      lastSent.current = Date.now();
      socket.emit('presence:active');
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        lastSent.current = 0;
        active();
      } else {
        socket.emit('presence:away');
      }
    };
    // Idle in a visible tab also counts as away.
    let idle = setTimeout(() => socket.emit('presence:away'), AWAY_AFTER_MS);
    const onInput = () => {
      clearTimeout(idle);
      idle = setTimeout(() => socket.emit('presence:away'), AWAY_AFTER_MS);
      active();
    };

    active();
    document.addEventListener('visibilitychange', onVisibility);
    for (const event of ['pointerdown', 'keydown', 'focus'] as const) window.addEventListener(event, onInput);
    return () => {
      clearTimeout(idle);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const event of ['pointerdown', 'keydown', 'focus'] as const) window.removeEventListener(event, onInput);
    };
  }, [enabled]);
}

/**
 * Who is at their screen right now. The server only ever sends presence for
 * people the viewer may chat with (§7.6).
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { status: authStatus } = useAuth();
  const enabled = authStatus === 'authenticated';
  const [live, setLive] = useState<Map<string, Presence>>(new Map());

  const initial = useQuery({
    queryKey: qk.presence,
    queryFn: api.presence.list,
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  useReportActivity(enabled);

  useEffect(() => {
    if (!enabled) return;
    const apply = (list: PresenceDTO[]) =>
      setLive((current) => {
        const next = new Map(current);
        for (const p of list) next.set(p.userId, { status: p.status, lastSeenAt: p.lastSeenAt });
        return next;
      });
    const onUpdate = (list: PresenceDTO[]) => apply(list);
    socket.on('presence:update', onUpdate);
    return () => {
      socket.off('presence:update', onUpdate);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) setLive(new Map());
  }, [enabled]);

  const value = useMemo(() => {
    const map = new Map<string, Presence>();
    for (const p of initial.data ?? []) map.set(p.userId, { status: p.status, lastSeenAt: p.lastSeenAt });
    for (const [id, p] of live) map.set(id, p);
    return map;
  }, [initial.data, live]);

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

/** Presence of one user; `offline` when unknown (including people we may not chat with). */
export function usePresence(userId: string | null | undefined): Presence {
  const map = useContext(PresenceContext);
  return (userId && map.get(userId)) || OFFLINE;
}
