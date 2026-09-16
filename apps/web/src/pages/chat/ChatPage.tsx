import AddCommentRounded from '@mui/icons-material/AddCommentRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import {
  Badge,
  Box,
  Button,
  Card,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CHAT_MESSAGE_MAX,
  ROLE_LABELS,
  ROLES,
  type ChatMessageDTO,
  type ConversationDTO,
  type ChatMessagePage,
  type UserRef,
} from '@god/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { BrowserNotificationsPrompt } from '@/components/BrowserNotifications';
import { EmptyState, ErrorState } from '@/components/common';
import { RoleBadge, UserAvatar } from '@/components/identity';
import { PresenceBadge, presenceLabel } from '@/components/PresenceDot';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { inZone } from '@/lib/time';
import { usePresence } from '@/realtime/PresenceProvider';
import { appendChatMessage } from '@/realtime/RealtimeProvider';
import { ROLE_COLORS } from '@/theme/theme';
import { SearchField, useIsPhone } from '../admin/adminShared';
import { TODO_COLORS, TodoDoneDialog, TodoPill, useRefreshTodos } from '../todos/todoShared';

type PageParam = { cursor: string } | { after: string } | null;
type Pages = { pages: ChatMessagePage[]; pageParams: PageParam[] };

/** Messages per request, and how many requests' worth a thread keeps in memory. */
const PAGE_SIZE = 40;
const WINDOW_PAGES = 5;
/** How close to either end of the loaded messages scrolling starts loading more. */
const EDGE_PX = 400;

const PANEL_HEIGHT = { xs: 'calc(100dvh - 150px)', md: 'calc(100vh - 170px)' };

function previewOf(c: ConversationDTO, meId: string): string {
  const m = c.lastMessage;
  if (!m) return 'No messages yet';
  const prefix = m.senderId === meId ? 'You: ' : '';
  return m.kind === 'todo_done' ? `${prefix}✓ Marked a task done` : `${prefix}${m.body}`;
}

function shortTime(iso: string, zone: string): string {
  const dt = inZone(iso, zone);
  const now = DateTime.now().setZone(zone);
  if (dt.hasSame(now, 'day')) return dt.toFormat('h:mm a');
  if (now.diff(dt, 'days').days < 7) return dt.toFormat('ccc');
  return dt.toFormat('LLL d');
}

// ---------------------------------------------------------------------------

function NewChatDialog({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (u: UserRef) => void }) {
  const [search, setSearch] = useState('');
  const contacts = useQuery({ queryKey: qk.chat.contacts, queryFn: api.chat.contacts, enabled: open });
  useEffect(() => {
    if (open) setSearch('');
  }, [open]);
  const term = search.trim().toLowerCase();
  const filtered = (contacts.data ?? []).filter((u) => !term || u.nickname.toLowerCase().includes(term));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth scroll="paper">
      <DialogTitle>New chat</DialogTitle>
      <Box sx={{ px: 3, pb: 1.5 }}>
        <SearchField value={search} onChange={setSearch} placeholder="Search people" sx={{ maxWidth: 'none' }} />
      </Box>
      <DialogContent dividers sx={{ p: 0, minHeight: 240 }}>
        {contacts.isLoading ? (
          <Stack alignItems="center" sx={{ py: 5 }}>
            <CircularProgress size={22} />
          </Stack>
        ) : contacts.isError ? (
          <Box sx={{ p: 2 }}>
            <ErrorState error={contacts.error} onRetry={() => void contacts.refetch()} />
          </Box>
        ) : filtered.length === 0 ? (
          <EmptyState title="Nobody found" description="Everyone can chat with the Founder. Managers chat with Managers and Associates; Associates with Managers." />
        ) : (
          <List dense disablePadding>
            {ROLES.map((role) => {
              const people = filtered.filter((u) => u.role === role);
              if (!people.length) return null;
              return (
                <li key={role}>
                  <ul style={{ padding: 0 }}>
                    <ListSubheader sx={{ lineHeight: '32px', bgcolor: 'background.paper' }}>{ROLE_LABELS[role]}s</ListSubheader>
                    {people.map((u) => (
                      <ListItemButton key={u.id} onClick={() => onPick(u)} sx={{ py: 1 }}>
                        <PresenceBadge userId={u.id} size={9}>
                          <UserAvatar avatarId={u.avatarId} photoId={u.photoId} label={u.nickname} size={32} />
                        </PresenceBadge>
                        <Typography variant="body2" fontWeight={500} sx={{ ml: 1.5 }}>
                          {u.nickname}
                        </Typography>
                      </ListItemButton>
                    ))}
                  </ul>
                </li>
              );
            })}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "Online", "Away" or "Last seen …" beside the name in the chat header. */
function PresenceText({ userId }: { userId: string }) {
  const presence = usePresence(userId);
  return (
    <Typography variant="caption" color={presence.status === 'online' ? 'success.main' : 'text.secondary'}>
      {presenceLabel(presence)}
    </Typography>
  );
}

function ConversationList({ activeId, onOpen }: { activeId: string | null; onOpen: (id: string) => void }) {
  const me = useMe();
  const { zone } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const conversations = useQuery({ queryKey: qk.chat.conversations, queryFn: api.chat.conversations });

  const start = useMutation({
    mutationFn: (userId: string) => api.chat.start(userId),
    onSuccess: (c) => {
      queryClient.setQueryData(qk.chat.conversation(c.id), c);
      setPicking(false);
      onOpen(c.id);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const term = search.trim().toLowerCase();
  const rows = (conversations.data ?? []).filter((c) => !term || c.other.nickname.toLowerCase().includes(term));

  return (
    <Card sx={{ height: PANEL_HEIGHT, display: 'flex', flexDirection: 'column', minHeight: 420 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, pt: 1.75, pb: 1 }}>
        <Typography variant="subtitle1" component="h2">
          Chats
        </Typography>
        <Tooltip title="New chat">
          <IconButton color="primary" onClick={() => setPicking(true)} aria-label="New chat">
            <AddCommentRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box sx={{ px: 2, pb: 1.25 }}>
        <SearchField value={search} onChange={setSearch} placeholder="Search chats" sx={{ maxWidth: 'none' }} />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', borderTop: 1, borderColor: 'divider' }}>
        {conversations.isLoading ? (
          <Stack alignItems="center" sx={{ py: 5 }}>
            <CircularProgress size={22} />
          </Stack>
        ) : conversations.isError ? (
          <Box sx={{ p: 2 }}>
            <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
          </Box>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ChatBubbleOutlineRounded />}
            title={term ? 'No chats match' : 'No chats yet'}
            action={
              !term && (
                <Button size="small" variant="contained" startIcon={<AddCommentRounded />} onClick={() => setPicking(true)}>
                  Start a chat
                </Button>
              )
            }
          />
        ) : (
          <List disablePadding>
            {rows.map((c) => (
              <ListItemButton key={c.id} selected={c.id === activeId} onClick={() => onOpen(c.id)} sx={{ py: 1.25, px: 2, gap: 1.5, alignItems: 'flex-start' }}>
                <Badge color="primary" variant="dot" invisible={!c.unreadCount} overlap="circular">
                  <PresenceBadge userId={c.other.id}>
                    <UserAvatar avatarId={c.other.avatarId} photoId={c.other.photoId} label={c.other.nickname} size={40} />
                  </PresenceBadge>
                </Badge>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    <Typography variant="body2" fontWeight={c.unreadCount ? 700 : 600} noWrap sx={{ flex: 1, minWidth: 0 }}>
                      {c.other.nickname}
                    </Typography>
                    {c.lastMessage && (
                      <Typography variant="caption" color={c.unreadCount ? 'primary.main' : 'text.secondary'} sx={{ flexShrink: 0 }}>
                        {shortTime(c.lastMessage.createdAt, zone)}
                      </Typography>
                    )}
                  </Stack>
                  <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.25 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ROLE_COLORS[c.other.role], flexShrink: 0 }} />
                    <Typography variant="caption" color={c.unreadCount ? 'text.primary' : 'text.secondary'} noWrap sx={{ flex: 1, minWidth: 0 }}>
                      {previewOf(c, me.id)}
                    </Typography>
                    {c.openTodoCount > 0 && (
                      <Tooltip title={`${c.openTodoCount} open task${c.openTodoCount === 1 ? '' : 's'}`}>
                        <ChecklistRounded sx={{ fontSize: 15, color: TODO_COLORS.open }} />
                      </Tooltip>
                    )}
                    {c.unreadCount > 0 && (
                      <Box sx={{ minWidth: 18, height: 18, px: 0.5, borderRadius: 99, bgcolor: 'primary.main', color: 'common.white', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center' }}>
                        {c.unreadCount}
                      </Box>
                    )}
                  </Stack>
                </Box>
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
      <NewChatDialog open={picking} onClose={() => setPicking(false)} onPick={(u) => start.mutate(u.id)} />
    </Card>
  );
}

// ---------------------------------------------------------------------------

function MessageMenu({ message, conversation }: { message: ChatMessageDTO; conversation: ConversationDTO }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.chat.messages(conversation.id) });
    void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
    void queryClient.invalidateQueries({ queryKey: qk.todos.all });
  };
  const make = useMutation({
    mutationFn: () => api.chat.makeTodo(message.id),
    onSuccess: () => {
      refresh();
      toast.success(`Task given to ${conversation.other.nickname}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.chat.removeTodo(message.id),
    onSuccess: () => {
      refresh();
      toast.success('Task removed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const me = useMe();
  const canMake = !message.todo && conversation.canGiveTask;
  const canRemove = message.todo?.status === 'open' && message.todo.createdBy.id === me.id;
  if (!canMake && !canRemove) return null;
  return (
    <>
      <IconButton
        size="small"
        className="msg-menu"
        aria-label="Message actions"
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity .15s', alignSelf: 'center' }}
      >
        <MoreVertRounded sx={{ fontSize: 17 }} />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {canMake && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              make.mutate();
            }}
          >
            <ChecklistRounded fontSize="small" sx={{ mr: 1.25, color: TODO_COLORS.open }} />
            Give as task to {conversation.other.nickname}
          </MenuItem>
        )}
        {canRemove && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              remove.mutate();
            }}
          >
            Remove task
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

function ConfirmTaskButton({ todoId, conversationId }: { todoId: string; conversationId: string }) {
  const toast = useToast();
  const refresh = useRefreshTodos();
  const confirm = useMutation({
    mutationFn: () => api.todos.confirm(todoId),
    onSuccess: () => {
      refresh({ conversationId });
      toast.success('Task completed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Button size="small" variant="outlined" color="success" startIcon={<VerifiedRounded />} onClick={() => confirm.mutate()} disabled={confirm.isPending} sx={{ height: 24, fontSize: 12, py: 0 }}>
      Confirm
    </Button>
  );
}

function MessageBubble({
  message: m,
  conversation,
  mine,
  seen,
  zone,
  onDone,
}: {
  message: ChatMessageDTO;
  conversation: ConversationDTO;
  mine: boolean;
  seen: boolean;
  zone: string;
  onDone: (m: ChatMessageDTO) => void;
}) {
  const me = useMe();
  const dt = inZone(m.createdAt, zone);
  const isDone = m.kind === 'todo_done';
  const todo = m.todo;
  const bubbleSx = isDone
    ? { bgcolor: `${TODO_COLORS.done}1a`, border: 1, borderColor: `${TODO_COLORS.done}55`, color: 'text.primary' }
    : mine
      ? { bgcolor: 'primary.main', color: 'primary.contrastText' }
      : { bgcolor: 'action.hover', color: 'text.primary' };

  return (
    <Stack
      direction={mine ? 'row-reverse' : 'row'}
      spacing={0.5}
      alignItems="flex-end"
      sx={{ mb: 1.25, '&:hover .msg-menu': { opacity: 1 } }}
    >
      <Box sx={{ maxWidth: { xs: '85%', md: '72%' }, minWidth: 0 }}>
        <Tooltip title={dt.toFormat('LLL d, h:mm a ZZZZ')} placement={mine ? 'left' : 'right'}>
          <Box
            sx={{
              px: 1.5,
              py: 1,
              borderRadius: 2.5,
              ...(mine ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }),
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              typography: 'body2',
              ...(todo ? { boxShadow: `inset 3px 0 0 ${TODO_COLORS[todo.status]}` } : {}),
              ...bubbleSx,
            }}
          >
            {isDone && (
              <>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: TODO_COLORS.done, fontWeight: 600, mb: 0.5 }}>
                  <TaskAltRounded sx={{ fontSize: 16 }} />
                  <span>Marked the task done</span>
                </Stack>
                {m.replyTo && (
                  <Box sx={{ pl: 1, mb: m.body !== 'Done' ? 0.75 : 0, borderLeft: 2, borderColor: 'divider', color: 'text.secondary', fontSize: '0.8rem' }}>
                    {m.replyTo.body.length > 160 ? `${m.replyTo.body.slice(0, 157)}…` : m.replyTo.body}
                  </Box>
                )}
                {m.body !== 'Done' && m.body}
              </>
            )}
            {!isDone && m.body}
          </Box>
        </Tooltip>
        <Stack direction="row" spacing={0.75} alignItems="center" justifyContent={mine ? 'flex-end' : 'flex-start'} sx={{ mt: 0.4, mx: 0.5, flexWrap: 'wrap' }}>
          {todo && (
            <>
              <TodoPill todo={todo} compact />
              <Typography variant="caption" color="text.secondary">
                {todo.assignee.id === me.id ? 'for you' : `for ${todo.assignee.nickname}`}
              </Typography>
              {todo.status === 'open' && todo.assignee.id === me.id && (
                <Button size="small" variant="contained" color="success" startIcon={<TaskAltRounded />} onClick={() => onDone(m)} sx={{ height: 24, fontSize: 12, py: 0 }}>
                  Mark done
                </Button>
              )}
              {todo.status === 'done' && todo.createdBy.id === me.id && <ConfirmTaskButton todoId={todo.id} conversationId={m.conversationId} />}
            </>
          )}
          <Typography variant="caption" color="text.disabled">
            {dt.toFormat('h:mm a')}
            {mine && seen ? ' · Seen' : ''}
          </Typography>
        </Stack>
      </Box>
      {m.kind === 'text' && <MessageMenu message={m} conversation={conversation} />}
    </Stack>
  );
}

function ChatThread({ conversationId, onBack }: { conversationId: string; onBack?: () => void }) {
  const me = useMe();
  const { zone } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [doneFor, setDoneFor] = useState<ChatMessageDTO | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const conversation = useQuery({ queryKey: qk.chat.conversation(conversationId), queryFn: () => api.chat.conversation(conversationId) });
  const {
    data,
    fetchNextPage,
    fetchPreviousPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
    isLoading,
    error,
  } = useInfiniteQuery({
    queryKey: qk.chat.messages(conversationId),
    queryFn: ({ pageParam }) => api.chat.messages(conversationId, { ...pageParam, limit: PAGE_SIZE }),
    initialPageParam: null as PageParam,
    // "Next" pages are older messages, "previous" pages newer ones.
    getNextPageParam: (last) => (last.nextCursor ? { cursor: last.nextCursor } : undefined),
    getPreviousPageParam: (first) => (first.hasNewer && first.newerCursor ? { after: first.newerCursor } : undefined),
    // Only a window of messages stays in memory; the far end is let go and reloaded on scrolling back.
    maxPages: WINDOW_PAGES,
  });
  // Pages are newest-first; each page's items are oldest → newest.
  const messages = useMemo(() => (data ? [...data.pages].reverse().flatMap((p) => p.items) : []), [data]);
  const fetching = isFetchingNextPage || isFetchingPreviousPage;

  // Back to the latest messages, e.g. after sending from an older window.
  const jumpToLatest = () => {
    stickToBottom.current = true;
    void queryClient.resetQueries({ queryKey: qk.chat.messages(conversationId) });
  };
  useEffect(() => {
    // A window left scrolled up last time: start at the latest messages again.
    if (queryClient.getQueryData<Pages>(qk.chat.messages(conversationId))?.pages[0]?.hasNewer) jumpToLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  /** The first message on screen and its offset, so loading pages above or dropping them doesn't move the view. */
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const captureAnchor = () => {
    const el = scroller.current;
    if (!el) return;
    for (const item of el.querySelectorAll<HTMLElement>('[data-mid]')) {
      if (item.offsetTop + item.offsetHeight > el.scrollTop) {
        anchor.current = { id: item.dataset.mid!, top: item.offsetTop - el.scrollTop };
        return;
      }
    }
  };
  /** Loads more when the view nears either end of the window. */
  const loadNearEdges = () => {
    const el = scroller.current;
    if (!el || fetching || isLoading) return;
    if (el.scrollTop < EDGE_PX && hasNextPage) {
      captureAnchor();
      void fetchNextPage();
    } else if (el.scrollHeight - el.scrollTop - el.clientHeight < EDGE_PX && hasPreviousPage) {
      captureAnchor();
      void fetchPreviousPage();
    }
  };

  // Reading: whenever unread messages are on screen and the tab is visible.
  const markRead = useMutation({
    mutationFn: () => api.chat.markRead(conversationId),
    onSuccess: () => {
      queryClient.setQueryData<ConversationDTO[]>(qk.chat.conversations, (list) =>
        list?.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)),
      );
      queryClient.setQueryData<ConversationDTO>(qk.chat.conversation(conversationId), (c) => (c ? { ...c, unreadCount: 0 } : c));
    },
  });
  const unread = conversation.data?.unreadCount ?? 0;
  useEffect(() => {
    const read = () => {
      if (document.visibilityState === 'visible' && unread > 0 && !markRead.isPending) markRead.mutate();
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, unread]);

  const send = useMutation({
    mutationFn: (body: string) => api.chat.send(conversationId, body),
    onSuccess: (message) => {
      if (hasPreviousPage) jumpToLatest();
      else appendChatMessage(queryClient, message);
      stickToBottom.current = true;
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
    },
    onError: (err, body) => {
      setDraft(body);
      toast.error(errorMessage(err));
    },
  });

  useEffect(() => {
    stickToBottom.current = true;
    setDraft('');
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const a = anchor.current;
    anchor.current = null;
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    else if (a) {
      const item = el.querySelector<HTMLElement>(`[data-mid="${a.id}"]`);
      if (item) el.scrollTop = item.offsetTop - a.top;
    }
    // A short window may not fill the panel yet.
    loadNearEdges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, conversationId]);

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    setDraft('');
    send.mutate(body);
  };

  const c = conversation.data;
  const lastMine = [...messages].reverse().find((m) => m.sender.id === me.id);
  const seenMine = Boolean(lastMine && c?.otherLastReadAt && c.otherLastReadAt >= lastMine.createdAt);
  let lastDay = '';

  if (conversation.error || error) {
    return (
      <Card sx={{ height: PANEL_HEIGHT, p: 3 }}>
        <ErrorState error={conversation.error ?? error} onRetry={() => void conversation.refetch()} />
      </Card>
    );
  }

  return (
    <Card sx={{ height: PANEL_HEIGHT, minHeight: 420, display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', minHeight: 64 }}>
        {onBack && (
          <IconButton onClick={onBack} aria-label="Back to chats" edge="start">
            <ArrowBackRounded />
          </IconButton>
        )}
        {c && (
          <>
            <PresenceBadge userId={c.other.id} size={11}>
              <UserAvatar avatarId={c.other.avatarId} photoId={c.other.photoId} label={c.other.nickname} size={38} />
            </PresenceBadge>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap>
                {c.other.nickname}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <RoleBadge role={c.other.role} />
                <PresenceText userId={c.other.id} />
                {c.openTodoCount > 0 && (
                  <Typography variant="caption" sx={{ color: TODO_COLORS.open, fontWeight: 600 }}>
                    {c.openTodoCount} open task{c.openTodoCount === 1 ? '' : 's'}
                  </Typography>
                )}
              </Stack>
            </Box>
          </>
        )}
      </Stack>

      <Box
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = !hasPreviousPage && el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          loadNearEdges();
        }}
        sx={{ flex: 1, overflowY: 'auto', position: 'relative', px: { xs: 1.5, md: 2.5 }, py: 1.5 }}
      >
        {isFetchingNextPage && (
          <Stack alignItems="center" sx={{ py: 1 }}>
            <CircularProgress size={18} aria-label="Loading earlier messages" />
          </Stack>
        )}
        {!isLoading && !hasNextPage && messages.length > 0 && (
          <Typography variant="caption" color="text.disabled" component="div" sx={{ textAlign: 'center', my: 1 }}>
            Start of your chat with {c?.other.nickname}
          </Typography>
        )}
        {isLoading || !c ? (
          <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
            <CircularProgress size={24} />
          </Stack>
        ) : messages.length === 0 ? (
          <EmptyState
            icon={<ChatBubbleOutlineRounded />}
            title={`Say hello to ${c.other.nickname}`}
            description={me.role === 'founder' || me.role === 'manager' ? 'Tip: open a message’s menu to give it as a task.' : undefined}
          />
        ) : (
          messages.map((m) => {
            const day = inZone(m.createdAt, zone).toISODate()!;
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <Box key={m.id} data-mid={m.id}>
                {showDay && (
                  <Typography variant="caption" color="text.secondary" component="div" sx={{ textAlign: 'center', my: 1.5 }}>
                    {inZone(m.createdAt, zone).hasSame(DateTime.now().setZone(zone), 'day') ? 'Today' : inZone(m.createdAt, zone).toFormat('cccc, LLL d')}
                  </Typography>
                )}
                <MessageBubble
                  message={m}
                  conversation={c}
                  mine={m.sender.id === me.id}
                  seen={m.id === lastMine?.id && seenMine}
                  zone={zone}
                  onDone={setDoneFor}
                />
              </Box>
            );
          })
        )}
        {isFetchingPreviousPage && (
          <Stack alignItems="center" sx={{ py: 1 }}>
            <CircularProgress size={18} aria-label="Loading newer messages" />
          </Stack>
        )}
      </Box>

      {hasPreviousPage && (
        <Box sx={{ position: 'relative', height: 0 }}>
          <Button
            size="small"
            variant="contained"
            startIcon={<ArrowDownwardRounded />}
            onClick={jumpToLatest}
            sx={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', borderRadius: 99, boxShadow: 3, zIndex: 2 }}
          >
            Jump to latest
          </Button>
        </Box>
      )}

      {c && !c.canSend ? (
        <Box sx={{ p: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {c.other.nickname} is no longer active, so this chat is read-only.
          </Typography>
        </Box>
      ) : (
        <Stack direction="row" spacing={1} alignItems="flex-end" sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
          <TextField
            placeholder={c ? `Message ${c.other.nickname}…` : 'Write a message…'}
            multiline
            maxRows={6}
            fullWidth
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            slotProps={{ htmlInput: { 'aria-label': 'Message', maxLength: CHAT_MESSAGE_MAX } }}
          />
          <Tooltip title="Send (Enter)">
            <span>
              <IconButton color="primary" onClick={submit} disabled={!draft.trim() || send.isPending || !c}>
                <SendRounded fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      )}

      <TodoDoneDialog
        todo={doneFor?.todo ? { id: doneFor.todo.id, conversationId, instruction: doneFor.body } : null}
        onClose={() => setDoneFor(null)}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------

export default function ChatPage() {
  const { conversationId = null } = useParams();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const open = (id: string) => navigate(`/chat/${id}`);

  if (phone) {
    return conversationId ? (
      <ChatThread conversationId={conversationId} onBack={() => navigate('/chat')} />
    ) : (
      <>
        <BrowserNotificationsPrompt />
        <ConversationList activeId={null} onOpen={open} />
      </>
    );
  }

  return (
    <>
      <BrowserNotificationsPrompt />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'minmax(280px, 340px) minmax(0, 1fr)' }}>
        <ConversationList activeId={conversationId} onOpen={open} />
        {conversationId ? (
          <ChatThread key={conversationId} conversationId={conversationId} />
        ) : (
          <Card sx={{ height: PANEL_HEIGHT, minHeight: 420, display: 'grid', placeItems: 'center' }}>
            <EmptyState
              icon={<ChatBubbleOutlineRounded />}
              title="Pick a chat"
              description="Choose a conversation on the left, or start a new one."
            />
          </Card>
        )}
      </Box>
    </>
  );
}
