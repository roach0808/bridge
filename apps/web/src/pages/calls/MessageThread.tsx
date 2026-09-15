import SendRounded from '@mui/icons-material/SendRounded';
import { Box, Button, Card, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import type { CursorPage, MessageDTO } from '@god/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMe } from '@/auth/AuthProvider';
import { EmptyState } from '@/components/common';
import { UserAvatar } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api, socket } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { inZone } from '@/lib/time';
import { ROLE_COLORS } from '@/theme/theme';

type Pages = { pages: CursorPage<MessageDTO>[]; pageParams: (string | null)[] };

export function MessageThread({ callId, zone }: { callId: string; zone: string }) {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState<{ nickname: string; at: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const lastTypingSent = useRef(0);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: qk.calls.messages(callId),
    queryFn: ({ pageParam }) => api.calls.messages(callId, pageParam, 50),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  // Pages are newest-first; each page's items are oldest → newest.
  const messages = useMemo(() => (data ? [...data.pages].reverse().flatMap((p) => p.items) : []), [data]);

  const send = useMutation({
    mutationFn: (body: string) => api.calls.postMessage(callId, body),
    onSuccess: (message) => {
      queryClient.setQueryData<Pages>(qk.calls.messages(callId), (d) => {
        if (!d?.pages.length || d.pages.some((p) => p.items.some((m) => m.id === message.id))) return d;
        const [first, ...rest] = d.pages;
        return { ...d, pages: [{ ...first!, items: [...first!.items, message] }, ...rest] };
      });
      stickToBottom.current = true;
    },
    onError: (err, body) => {
      setDraft(body);
      toast.error(errorMessage(err));
    },
  });

  useEffect(() => {
    const onTyping = (p: { callId: string; nickname: string }) => {
      if (p.callId === callId) setTyping({ nickname: p.nickname, at: Date.now() });
    };
    socket.on('user:typing', onTyping);
    const t = setInterval(() => setTyping((cur) => (cur && Date.now() - cur.at > 3500 ? null : cur)), 1000);
    return () => {
      socket.off('user:typing', onTyping);
      clearInterval(t);
    };
  }, [callId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft('');
    send.mutate(body);
  };

  const onChange = (value: string) => {
    setDraft(value);
    if (Date.now() - lastTypingSent.current > 2000) {
      lastTypingSent.current = Date.now();
      socket.emit('user:typing', { callId });
    }
  };

  let lastDay = '';
  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', height: { xs: 520, lg: 'calc(100vh - 220px)' }, minHeight: 420 }}>
      <Box sx={{ px: 2.5, pt: 2, pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle1" component="h2">
          Thread
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Visible to everyone on this call
        </Typography>
      </Box>
      <Box
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.5 }}
      >
        {hasNextPage && (
          <Box sx={{ textAlign: 'center', mb: 1 }}>
            <Button
              size="small"
              color="inherit"
              onClick={() => {
                stickToBottom.current = false;
                void fetchNextPage();
              }}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load earlier messages'}
            </Button>
          </Box>
        )}
        {isLoading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
            <CircularProgress size={24} />
          </Box>
        ) : messages.length === 0 ? (
          <EmptyState title="No messages yet" description="Share logistics, dial-in details or follow-ups here." />
        ) : (
          messages.map((m) => {
            const mine = m.sender.id === me.id;
            const dt = inZone(m.createdAt, zone);
            const day = dt.toISODate()!;
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <Box key={m.id}>
                {showDay && (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ textAlign: 'center', my: 1.5 }}>
                    {dt.hasSame(DateTime.now().setZone(zone), 'day') ? 'Today' : dt.toFormat('cccc, LLL d')}
                  </Typography>
                )}
                <Stack direction={mine ? 'row-reverse' : 'row'} spacing={1} alignItems="flex-end" sx={{ mb: 1.25 }}>
                  {!mine && <UserAvatar avatarId={m.sender.avatarId} photoId={m.sender.photoId} label={m.sender.nickname} size={30} />}
                  <Box sx={{ maxWidth: '78%' }}>
                    {!mine && (
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.25, ml: 0.5 }}>
                        <Typography variant="caption" fontWeight={500}>
                          {m.sender.nickname}
                        </Typography>
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ROLE_COLORS[m.sender.role] }} />
                      </Stack>
                    )}
                    <Tooltip title={dt.toFormat('LLL d, h:mm a ZZZZ')} placement={mine ? 'left' : 'right'}>
                      <Box
                        sx={(t) => ({
                          px: 1.5,
                          py: 1,
                          borderRadius: 2.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          typography: 'body2',
                          ...(mine
                            ? { bgcolor: 'primary.main', color: 'primary.contrastText', borderBottomRightRadius: 6 }
                            : { bgcolor: `rgba(${t.vars!.palette.text.primaryChannel} / 0.07)`, borderBottomLeftRadius: 6 }),
                        })}
                      >
                        {m.body}
                      </Box>
                    </Tooltip>
                    <Typography variant="caption" color="text.disabled" component="div" sx={{ mt: 0.25, textAlign: mine ? 'right' : 'left', mx: 0.5 }}>
                      {dt.toFormat('h:mm a')}
                    </Typography>
                  </Box>
                </Stack>
              </Box>
            );
          })
        )}
      </Box>
      <Box sx={{ px: 2, minHeight: 20 }}>
        {typing && (
          <Typography variant="caption" color="text.secondary">
            {typing.nickname} is typing…
          </Typography>
        )}
      </Box>
      <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ p: 1.5, pt: 0.5, borderTop: 1, borderColor: 'divider' }}>
        <TextField
          placeholder="Write a message…"
          multiline
          maxRows={5}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          slotProps={{ htmlInput: { 'aria-label': 'Message', maxLength: 5000 } }}
        />
        <Tooltip title="Send (Enter)">
          <span>
            <IconButton color="primary" onClick={submit} disabled={!draft.trim() || send.isPending}>
              <SendRounded fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Card>
  );
}
