import CloseRounded from '@mui/icons-material/CloseRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import NotificationsActiveRounded from '@mui/icons-material/NotificationsActiveRounded';
import { Box, Button, Dialog, Link, Stack, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import type { ChatRingDTO, ChatRingEndedEvent } from '@god/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { UserAvatar } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api, socket } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { closeRingNotification, enableNotifications, notificationsSupported, showRingNotification } from '@/lib/push';
import { primeRingtone, startRingback, startRingtone } from '@/lib/ringtone';
import { appendChatMessage, navigateTo } from './RealtimeProvider';

/**
 * Ringing someone in a chat (RING_SECONDS in @god/shared). It is no call: the
 * person rung sees who is ringing and hears a tune until they close it or open
 * the chat; the ringer hears it ringing out meanwhile, and then how it ended.
 * While the app is not the window in front, the system shows the ring too: a
 * website cannot bring its own window forward, but a click on that can.
 */

interface RingApi {
  /** The ring sounding in a chat now, either way, or null. */
  ringIn: (conversationId: string) => ChatRingDTO | null;
  ring: (conversationId: string) => Promise<void>;
  /** Stops a ring: cancels your own, or closes (or opens) one that rings you. */
  stop: (ring: ChatRingDTO, opened?: boolean) => void;
}

const RingContext = createContext<RingApi>({ ringIn: () => null, ring: async () => undefined, stop: () => undefined });
export const useRings = () => useContext(RingContext);

primeRingtone();

export function RingProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const meId = user?.id;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rings, setRings] = useState<ChatRingDTO[]>([]);
  const ringsNow = useRef(rings);
  ringsNow.current = rings;
  // Rings this screen stopped itself, so it doesn't report back on them.
  const stoppedHere = useRef(new Set<string>());
  // Rings started from this screen: only it plays the ringing-out sound.
  const [startedHere, setStartedHere] = useState<string | null>(null);

  const add = useCallback((ring: ChatRingDTO) => setRings((list) => (list.some((r) => r.id === ring.id) ? list : [...list, ring])), []);
  const drop = useCallback((id: string) => setRings((list) => list.filter((r) => r.id !== id)), []);

  useEffect(() => {
    if (status !== 'authenticated') {
      setRings([]);
      return;
    }
    const load = () => void api.chat.rings().then(setRings, () => undefined);
    const onRing = (ring: ChatRingDTO) => add(ring);
    const onEnded = (event: ChatRingEndedEvent) => {
      const ring = ringsNow.current.find((r) => r.id === event.id);
      if (ring && ring.from.id === meId && !stoppedHere.current.has(ring.id)) {
        const name = ring.to.nickname;
        if (event.reason === 'opened') toast.success(`${name} opened the chat`);
        else if (event.reason === 'closed') toast.info(`${name} saw your ring`);
        else if (event.reason === 'missed') toast.info(`No answer from ${name}`);
      }
      drop(event.id);
    };
    load();
    socket.on('connect', load);
    socket.on('chat:ring', onRing);
    socket.on('chat:ring-ended', onEnded);
    return () => {
      socket.off('connect', load);
      socket.off('chat:ring', onRing);
      socket.off('chat:ring-ended', onEnded);
    };
  }, [status, meId, toast, add, drop]);

  // Every screen stops a ring on its own once its time is up, even if the word from the server is lost.
  useEffect(() => {
    if (!rings.length) return;
    const soonest = Math.min(...rings.map((r) => Date.parse(r.endsAt)));
    const timer = window.setTimeout(() => setRings((list) => list.filter((r) => Date.parse(r.endsAt) > Date.now())), Math.max(0, soonest - Date.now()) + 500);
    return () => window.clearTimeout(timer);
  }, [rings]);

  const value = useMemo<RingApi>(
    () => ({
      ringIn: (conversationId) => rings.find((r) => r.conversationId === conversationId) ?? null,
      ring: async (conversationId) => {
        try {
          const { ring, message } = await api.chat.ring(conversationId);
          setStartedHere(ring.id);
          add(ring);
          appendChatMessage(queryClient, message);
          void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
        } catch (err) {
          toast.error(errorMessage(err));
        }
      },
      stop: (ring, opened = false) => {
        stoppedHere.current.add(ring.id);
        drop(ring.id);
        void api.chat.endRing(ring.id, opened).catch(() => undefined);
      },
    }),
    [rings, add, drop, queryClient, toast],
  );

  // The first ring for me that is still sounding.
  const incoming = rings.find((r) => r.to.id === meId) ?? null;
  const ringingOut = rings.some((r) => r.id === startedHere);

  // The ringer hears it ringing out, until it is answered, stopped or missed.
  useEffect(() => (ringingOut ? startRingback() : undefined), [ringingOut]);

  return (
    <RingContext.Provider value={value}>
      {children}
      {incoming && (
        <IncomingRing
          key={incoming.id}
          ring={incoming}
          onClose={() => value.stop(incoming)}
          onOpen={() => {
            value.stop(incoming, true);
            navigateTo(`/chat/${incoming.conversationId}`);
          }}
        />
      )}
    </RingContext.Provider>
  );
}

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.55); }
  70% { box-shadow: 0 0 0 22px rgba(46, 125, 50, 0); }
  100% { box-shadow: 0 0 0 0 rgba(46, 125, 50, 0); }
`;
const shake = keyframes`
  0%, 60%, 100% { transform: rotate(0); }
  10%, 30%, 50% { transform: rotate(-14deg); }
  20%, 40% { transform: rotate(14deg); }
`;

/** Who is ringing, with the tune playing, until it is closed or the chat opened. */
function IncomingRing({ ring, onClose, onOpen }: { ring: ChatRingDTO; onClose: () => void; onOpen: () => void }) {
  const [canNotify, setCanNotify] = useState(() => !notificationsSupported() || Notification.permission === 'granted');

  // While the app isn't the window in front, the system shows the ring as well, and
  // clicking it brings the window forward. Shown again whenever the window drops back.
  useEffect(() => {
    const tag = `ring:${ring.conversationId}`;
    const show = () =>
      void showRingNotification(`🔔 ${ring.from.nickname} is ringing you`, { body: 'Click to open the chat.', tag, url: `/chat/${ring.conversationId}` }, navigateTo);
    show();
    window.focus();
    window.addEventListener('blur', show);
    document.addEventListener('visibilitychange', show);
    return () => {
      window.removeEventListener('blur', show);
      document.removeEventListener('visibilitychange', show);
      void closeRingNotification(tag);
    };
  }, [ring.conversationId, ring.from.nickname]);

  useEffect(() => {
    const stop = startRingtone();
    navigator.vibrate?.([400, 200, 400, 200, 400]);
    // The tab's title blinks too, for someone looking at another tab.
    const title = document.title;
    let flip = false;
    const blink = window.setInterval(() => {
      flip = !flip;
      document.title = flip ? `📞 ${ring.from.nickname} is ringing…` : title;
    }, 1000);
    return () => {
      stop();
      navigator.vibrate?.(0);
      window.clearInterval(blink);
      document.title = title;
    };
  }, [ring.from.nickname]);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth aria-labelledby="ring-title">
      <Stack alignItems="center" spacing={2} sx={{ px: 3, pt: 4, pb: 3, textAlign: 'center' }}>
        <Box sx={{ borderRadius: '50%', animation: `${pulse} 1.6s infinite` }}>
          <UserAvatar avatarId={ring.from.avatarId} photoId={ring.from.photoId} label={ring.from.nickname} size={84} />
        </Box>
        <Box>
          <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center">
            <NotificationsActiveRounded color="success" sx={{ animation: `${shake} 1.2s infinite` }} />
            <Typography id="ring-title" variant="h6">
              {ring.from.nickname} is ringing you
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            They’re waiting for you in the chat.
          </Typography>
        </Box>
        {!canNotify && (
          <Typography variant="caption" color="text.secondary">
            So rings reach you while this window is behind others,{' '}
            <Link component="button" variant="caption" onClick={() => void enableNotifications().then((s) => setCanNotify(s === 'on' || s === 'tab-only'))}>
              turn on notifications
            </Link>
            .
          </Typography>
        )}
        <Stack direction="row" spacing={1.5} sx={{ pt: 1, width: '100%' }}>
          <Button fullWidth variant="outlined" color="inherit" startIcon={<CloseRounded />} onClick={onClose}>
            Close
          </Button>
          <Button fullWidth variant="contained" color="success" startIcon={<ForumRounded />} onClick={onOpen} autoFocus>
            Open chat
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}
