import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { Alert, Box, Button, Card, Divider, List, ListItemButton, Stack, Typography } from '@mui/material';
import type { ChatMessageDTO, ChatMessagePage, ObservedChatDTO } from '@god/shared';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { UserAvatar } from '@/components/identity';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { inZone, relativeTime } from '@/lib/time';
import { ChatImage } from './chatExtras';

const PAGE_SIZE = 40;
const PANEL_HEIGHT = { xs: 'calc(100dvh - 200px)', md: 'calc(100vh - 220px)' };

/**
 * Every chat in the system, for a Founder (§6.11a) — and only to read. There is
 * no message box, no reaction and no read receipt: looking on must not look
 * like taking part, and the other two are never told. Each chat opened is
 * written to the audit trail.
 */
export default function AllChatsPage() {
  const me = useMe();
  const navigate = useNavigate();
  const { conversationId = null } = useParams();
  const founder = me.role === 'founder';
  const query = useQuery({ queryKey: qk.chat.observed, queryFn: api.chat.observed, enabled: founder });

  if (!founder) {
    return (
      <Card>
        <EmptyState title="Not your page" description="Only a Founder can read everyone’s chats." />
      </Card>
    );
  }

  const chats = query.data ?? [];
  const open = chats.find((c) => c.id === conversationId) ?? null;

  return (
    <Box>
      <PageHeader
        title="Everyone’s chats"
        subtitle="Every conversation in the system, to read. Nobody is told, and nothing you open is marked as seen."
        actions={
          <Button onClick={() => navigate('/chat')} size="small">
            Back to your chats
          </Button>
        }
      />
      <Alert severity="info" icon={<VisibilityOutlined />} variant="outlined" sx={{ mb: 2 }}>
        These are other people’s private messages. Every chat you open is recorded in the audit trail under your name.
      </Alert>

      {query.isLoading ? (
        <LoadingRows rows={6} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : chats.length === 0 ? (
        <Card>
          <EmptyState icon={<ChatBubbleOutlineRounded />} title="No chats yet" description="Conversations appear here once someone writes a message." />
        </Card>
      ) : (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 360px) minmax(0, 1fr)' } }}>
          <ChatList chats={chats} activeId={conversationId} onOpen={(id) => navigate(`/chat/all/${id}`)} />
          {open ? (
            <Transcript key={open.id} chat={open} />
          ) : (
            <Card sx={{ height: PANEL_HEIGHT, minHeight: 360, display: { xs: 'none', md: 'grid' }, placeItems: 'center' }}>
              <EmptyState icon={<ChatBubbleOutlineRounded />} title="Pick a chat" description="Choose a conversation on the left to read it." />
            </Card>
          )}
        </Box>
      )}
    </Box>
  );
}

function ChatList({ chats, activeId, onOpen }: { chats: ObservedChatDTO[]; activeId: string | null; onOpen: (id: string) => void }) {
  return (
    <Card sx={{ height: PANEL_HEIGHT, minHeight: 360, overflow: 'auto' }}>
      <List disablePadding>
        {chats.map((c) => {
          const [a, b] = c.people;
          const last = c.lastMessage;
          return (
            <ListItemButton key={c.id} selected={c.id === activeId} onClick={() => onOpen(c.id)} sx={{ alignItems: 'flex-start', py: 1.25 }}>
              <Stack direction="row" spacing={-0.75} sx={{ mr: 1.5, pt: 0.25 }}>
                <UserAvatar avatarId={a.avatarId} photoId={a.photoId} label={a.nickname} size={28} />
                <UserAvatar avatarId={b.avatarId} photoId={b.photoId} label={b.nickname} size={28} />
              </Stack>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Typography variant="body2" fontWeight={550} noWrap>
                    {a.nickname} &amp; {b.nickname}
                  </Typography>
                  {last && (
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {relativeTime(last.createdAt)}
                    </Typography>
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {last ? preview(last) : 'No messages'}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                  {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                </Typography>
              </Box>
            </ListItemButton>
          );
        })}
      </List>
    </Card>
  );
}

const preview = (m: NonNullable<ObservedChatDTO['lastMessage']>) =>
  m.deleted ? 'Message deleted' : m.body || (m.hasImage ? 'Picture' : '');

/** One chat, oldest at the top, with "Load older" above it. Read only. */
function Transcript({ chat }: { chat: ObservedChatDTO }) {
  const { zone } = useAuth();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error, refetch } = useInfiniteQuery({
    queryKey: qk.chat.observedMessages(chat.id),
    queryFn: ({ pageParam }) => api.chat.observedMessages(chat.id, { cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ChatMessagePage) => last.nextCursor ?? undefined,
  });
  // Pages come newest-first; each page runs oldest → newest inside itself.
  const messages = useMemo(() => (data ? [...data.pages].reverse().flatMap((p) => p.items) : []), [data]);

  return (
    <Card sx={{ height: PANEL_HEIGHT, minHeight: 360, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 1.75 }}>
        <Typography variant="subtitle1">
          {chat.people[0].nickname} &amp; {chat.people[1].nickname}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {chat.messageCount} message{chat.messageCount === 1 ? '' : 's'} · started {relativeTime(chat.createdAt)}
        </Typography>
      </Box>
      <Divider />
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
        {isLoading ? (
          <LoadingRows rows={5} height={48} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : (
          <>
            {hasNextPage && (
              <Box sx={{ display: 'grid', placeItems: 'center', mb: 1.5 }}>
                <Button size="small" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? 'Loading…' : 'Load older messages'}
                </Button>
              </Box>
            )}
            {messages.map((m) => (
              <Line key={m.id} message={m} zone={zone} />
            ))}
          </>
        )}
      </Box>
    </Card>
  );
}

/** A transcript line: who said it, when, and what. Both sides read the same way. */
function Line({ message: m, zone }: { message: ChatMessageDTO; zone: string }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ mb: 1.5 }} alignItems="flex-start">
      <UserAvatar avatarId={m.sender.avatarId} photoId={m.sender.photoId} label={m.sender.nickname} size={26} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="baseline">
          <Typography variant="body2" fontWeight={600}>
            {m.sender.nickname}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {inZone(m.createdAt, zone).toFormat('LLL d, h:mm a')}
          </Typography>
        </Stack>
        {m.deleted ? (
          <Typography variant="body2" color="text.secondary" fontStyle="italic">
            Message deleted
          </Typography>
        ) : (
          <>
            {m.body && (
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.body}
              </Typography>
            )}
            {m.image && (
              <Box sx={{ mt: 0.5, maxWidth: 320 }}>
                <ChatImage image={m.image} />
              </Box>
            )}
          </>
        )}
      </Box>
    </Stack>
  );
}
