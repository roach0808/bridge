import AddCommentRounded from '@mui/icons-material/AddCommentRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined';
import AddReactionOutlined from '@mui/icons-material/AddReactionOutlined';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import DeleteSweepOutlined from '@mui/icons-material/DeleteSweepOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EmojiEmotionsOutlined from '@mui/icons-material/EmojiEmotionsOutlined';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import {
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
  isActiveTodo,
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
import { ConfirmDialog, EmptyState, ErrorState } from '@/components/common';
import { RoleBadge, UserAvatar } from '@/components/identity';
import { PresenceBadge, presenceLabel } from '@/components/PresenceDot';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { shrinkChatImage } from '@/lib/image';
import { inZone } from '@/lib/time';
import { usePresence } from '@/realtime/PresenceProvider';
import { appendChatMessage, replaceChatMessage } from '@/realtime/RealtimeProvider';
import { ChatImage, EmojiPickerPopover, QuickReactionBar, ReactionChips, useReact } from './chatExtras';
import { SearchField, useIsPhone } from '../admin/adminShared';
import { TODO_COLORS, TodoDoneDialog, TodoPill, useRefreshTodos } from '../todos/todoShared';

type PageParam = { cursor: string } | { after: string } | null;
type Pages = { pages: ChatMessagePage[]; pageParams: PageParam[] };
type Attachment = { dataUrl: string; width: number; height: number };

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
  if (m.deleted) return `${prefix}Message deleted`;
  if (m.kind === 'todo_done') return `${prefix}✓ Marked a task done`;
  return m.hasImage ? `${prefix}📷 ${m.body || 'Photo'}` : `${prefix}${m.body}`;
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
  const navigate = useNavigate();
  const { zone } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const [menu, setMenu] = useState<{ conversation: ConversationDTO; anchor: HTMLElement } | null>(null);
  const [clearing, setClearing] = useState<ConversationDTO | null>(null);
  const conversations = useQuery({ queryKey: qk.chat.conversations, queryFn: api.chat.conversations });

  const clearHistory = useMutation({
    mutationFn: (id: string) => api.chat.clearHistory(id),
    onSuccess: (_result, id) => {
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
      void queryClient.resetQueries({ queryKey: qk.chat.messages(id) });
      void queryClient.invalidateQueries({ queryKey: qk.todos.all });
      setClearing(null);
      toast.success('Chat history cleared');
    },
  });

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
        <Stack direction="row" spacing={0.5} alignItems="center">
          {/* A Founder can read everyone's chats (§6.11a). */}
          {me.role === 'founder' && (
            <Tooltip title="Read everyone’s chats">
              <IconButton onClick={() => navigate('/chat/all')} aria-label="Everyone’s chats">
                <VisibilityOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="New chat">
            <IconButton color="primary" onClick={() => setPicking(true)} aria-label="New chat">
              <AddCommentRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
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
              <ListItemButton
                key={c.id}
                selected={c.id === activeId}
                onClick={() => onOpen(c.id)}
                sx={{ py: 1.25, px: 2, gap: 1.5, alignItems: 'flex-start', '&:hover .chat-menu': { opacity: 1 } }}
              >
                <Box>
                  <PresenceBadge userId={c.other.id}>
                    <UserAvatar avatarId={c.other.avatarId} photoId={c.other.photoId} label={c.other.nickname} size={40} />
                  </PresenceBadge>
                </Box>
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
                <IconButton
                  className="chat-menu"
                  size="small"
                  aria-label={`Options for the chat with ${c.other.nickname}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenu({ conversation: c, anchor: e.currentTarget });
                  }}
                  sx={{ alignSelf: 'center', opacity: { xs: 1, md: 0 }, transition: 'opacity .15s' }}
                >
                  <MoreVertRounded sx={{ fontSize: 18 }} />
                </IconButton>
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
      <Menu anchorEl={menu?.anchor ?? null} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            setClearing(menu?.conversation ?? null);
            setMenu(null);
          }}
          sx={{ color: 'error.main' }}
        >
          <DeleteSweepOutlined fontSize="small" sx={{ mr: 1.25 }} />
          Clear chat history
        </MenuItem>
      </Menu>
      <ConfirmDialog
        open={Boolean(clearing)}
        title={`Clear the chat with ${clearing?.other.nickname ?? ''}?`}
        description={`Every message and picture in this chat is erased for you and ${clearing?.other.nickname ?? 'them'}. Tasks that came from it are kept. This cannot be undone.`}
        confirmLabel="Clear history"
        destructive
        onClose={() => setClearing(null)}
        onConfirm={async () => {
          if (clearing) await clearHistory.mutateAsync(clearing.id);
        }}
      />
      <NewChatDialog open={picking} onClose={() => setPicking(false)} onPick={(u) => start.mutate(u.id)} />
    </Card>
  );
}

// ---------------------------------------------------------------------------

function MessageMenu({
  message,
  conversation,
  onReact,
}: {
  message: ChatMessageDTO;
  conversation: ConversationDTO;
  onReact: (anchor: HTMLElement) => void;
}) {
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

  const deleteMessage = useMutation({
    mutationFn: () => api.chat.deleteMessage(message.id),
    onSuccess: (saved) => {
      replaceChatMessage(queryClient, saved);
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
      toast.success('Message deleted');
    },
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const me = useMe();
  const canMake = !message.todo && conversation.canGiveTask && !message.image && !message.deleted;
  const canRemove = message.todo !== null && isActiveTodo(message.todo.status) && message.todo.createdBy.id === me.id;
  const canDelete = message.sender.id === me.id && !message.todo && !message.deleted;
  const canReact = conversation.canSend && !message.deleted;
  const menuButton = useRef<HTMLButtonElement>(null);
  if (!canMake && !canRemove && !canDelete && !canReact) return null;
  return (
    <>
      <IconButton
        ref={menuButton}
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
        {canReact && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              if (menuButton.current) onReact(menuButton.current);
            }}
          >
            <AddReactionOutlined fontSize="small" sx={{ mr: 1.25 }} />
            React
          </MenuItem>
        )}
        {canDelete && (
          <MenuItem
            onClick={() => {
              setAnchor(null);
              setConfirmDelete(true);
            }}
            sx={{ color: 'error.main' }}
          >
            <DeleteOutlineRounded fontSize="small" sx={{ mr: 1.25 }} />
            Delete
          </MenuItem>
        )}
      </Menu>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this message?"
        description={`It will be deleted for you and ${conversation.other.nickname}${message.image ? ', including the picture' : ''}. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => deleteMessage.mutateAsync()}
      />
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
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const react = useReact(m);
  const bubbleSx = m.deleted
    ? { bgcolor: 'transparent', border: 1, borderColor: 'divider', color: 'text.secondary', fontStyle: 'italic' }
    : isDone
      ? { bgcolor: `${TODO_COLORS.done}1a`, border: 1, borderColor: `${TODO_COLORS.done}55`, color: 'text.primary' }
      : mine
        ? { bgcolor: 'primary.main', color: 'primary.contrastText' }
        : { bgcolor: 'action.hover', color: 'text.primary' };
  const canReact = conversation.canSend && !m.deleted;

  return (
    <Stack
      direction={mine ? 'row-reverse' : 'row'}
      spacing={0.5}
      alignItems="flex-end"
      sx={{ mb: 1.25, '&:hover .msg-menu': { opacity: 1 }, '&:hover .msg-actions': { opacity: 1, pointerEvents: 'auto' } }}
    >
      <Box sx={{ maxWidth: { xs: '85%', md: '72%' }, minWidth: 0 }}>
        <Tooltip title={dt.toFormat('LLL d, h:mm a ZZZZ')} placement={mine ? 'left' : 'right'} disableHoverListener={Boolean(m.image)}>
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
              ...(m.image ? { p: 0.5 } : {}),
              ...bubbleSx,
            }}
          >
            {m.deleted && 'This message was deleted'}
            {isDone && (
              <>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: TODO_COLORS.done, fontWeight: 600, mb: 0.5 }}>
                  <TaskAltRounded sx={{ fontSize: 16 }} />
                  <span>Marked the task done</span>
                </Stack>
                {m.replyTo && (
                  <Box sx={{ pl: 1, mb: m.body !== 'Done' ? 0.75 : 0, borderLeft: 2, borderColor: 'divider', color: 'text.secondary', fontSize: '0.8rem' }}>
                    {m.replyTo.deleted
                      ? 'Deleted message'
                      : m.replyTo.body.length > 160
                        ? `${m.replyTo.body.slice(0, 157)}…`
                        : m.replyTo.body || (m.replyTo.hasImage ? '📷 Photo' : '')}
                  </Box>
                )}
                {m.body !== 'Done' && m.body}
              </>
            )}
            {!isDone && !m.deleted && (
              <>
                {m.image && <ChatImage image={m.image} />}
                {m.body && <Box sx={m.image ? { px: 1, pt: 0.75, pb: 0.25 } : undefined}>{m.body}</Box>}
              </>
            )}
          </Box>
        </Tooltip>
        <ReactionChips message={m} conversation={conversation} align={mine ? 'right' : 'left'} />
        <Stack direction="row" spacing={0.75} alignItems="center" justifyContent={mine ? 'flex-end' : 'flex-start'} sx={{ mt: 0.4, mx: 0.5, flexWrap: 'wrap' }}>
          {todo && (
            <>
              <TodoPill todo={todo} compact />
              <Typography variant="caption" color="text.secondary">
                {todo.assignee.id === me.id ? 'for you' : `for ${todo.assignee.nickname}`}
              </Typography>
              {isActiveTodo(todo.status) && todo.assignee.id === me.id && (
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
      {m.kind === 'text' && !m.deleted && <MessageMenu message={m} conversation={conversation} onReact={setPickerAnchor} />}
      {canReact && <QuickReactionBar message={m} onMore={setPickerAnchor} />}
      <EmojiPickerPopover
        anchor={pickerAnchor}
        onClose={() => setPickerAnchor(null)}
        onPick={(emoji) => {
          setPickerAnchor(null);
          react.mutate(emoji);
        }}
      />
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
    mutationFn: ({ body, image }: { body: string; image: Attachment | null }) =>
      api.chat.send(conversationId, body, image ? { dataUrl: image.dataUrl, width: image.width, height: image.height } : undefined),
    onSuccess: (message) => {
      if (hasPreviousPage) jumpToLatest();
      else appendChatMessage(queryClient, message);
      stickToBottom.current = true;
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
    },
    onError: (err, { body, image }) => {
      setDraft(body);
      setAttachment(image);
      toast.error(errorMessage(err));
    },
  });

  // A picture waiting to be sent: pasted, dropped, or chosen with the attach button.
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null);
  const attach = async (file: Blob | null | undefined) => {
    if (!file) return;
    setPreparing(true);
    try {
      setAttachment(await shrinkChatImage(file));
      input.current?.focus();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPreparing(false);
    }
  };
  const insertEmoji = (emoji: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

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
    if ((!body && !attachment) || send.isPending || preparing) return;
    setDraft('');
    setAttachment(null);
    send.mutate({ body, image: attachment });
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
    <Card
      sx={{ height: PANEL_HEIGHT, minHeight: 420, display: 'flex', flexDirection: 'column', position: 'relative' }}
      onDragOver={(e) => {
        if (c?.canSend && [...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!c?.canSend) return;
        e.preventDefault();
        setDragging(false);
        void attach([...e.dataTransfer.files].find((f) => f.type.startsWith('image/')));
      }}
    >
      {dragging && (
        <Stack
          alignItems="center"
          justifyContent="center"
          sx={{ position: 'absolute', inset: 8, zIndex: 3, border: 2, borderStyle: 'dashed', borderColor: 'primary.main', borderRadius: 2, bgcolor: 'background.paper', opacity: 0.94, pointerEvents: 'none' }}
        >
          <AddPhotoAlternateOutlined color="primary" />
          <Typography variant="body2" sx={{ mt: 1 }}>
            Drop the picture to send it
          </Typography>
        </Stack>
      )}
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
        <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
          {(attachment || preparing) && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Box sx={{ position: 'relative', width: 72, height: 72, borderRadius: 1.5, overflow: 'hidden', bgcolor: 'action.hover', flexShrink: 0 }}>
                {attachment ? (
                  <Box component="img" src={attachment.dataUrl} alt="Picture to send" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <Stack alignItems="center" justifyContent="center" sx={{ height: '100%' }}>
                    <CircularProgress size={18} />
                  </Stack>
                )}
                {attachment && (
                  <IconButton
                    size="small"
                    onClick={() => setAttachment(null)}
                    aria-label="Remove picture"
                    sx={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, bgcolor: 'rgba(0,0,0,.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,.8)' } }}
                  >
                    <CloseRounded sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {attachment ? 'Add a caption if you like, then send.' : 'Preparing the picture…'}
              </Typography>
            </Stack>
          )}
          <Stack direction="row" spacing={0.5} alignItems="flex-end">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void attach(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Tooltip title="Attach a picture (or paste one)">
              <span>
                <IconButton onClick={() => fileInput.current?.click()} disabled={!c || preparing} aria-label="Attach a picture" sx={{ mb: 0.25 }}>
                  <AddPhotoAlternateOutlined fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Emoji">
              <span>
                <IconButton onClick={(e) => setEmojiAnchor(e.currentTarget)} disabled={!c} aria-label="Insert emoji" sx={{ mb: 0.25 }}>
                  <EmojiEmotionsOutlined fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <TextField
              placeholder={c ? `Message ${c.other.nickname}…` : 'Write a message…'}
              multiline
              maxRows={6}
              fullWidth
              value={draft}
              inputRef={input}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              onPaste={(e) => {
                const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'));
                if (file) {
                  e.preventDefault();
                  void attach(file);
                }
              }}
              slotProps={{ htmlInput: { 'aria-label': 'Message', maxLength: CHAT_MESSAGE_MAX } }}
            />
            <Tooltip title="Send (Enter)">
              <span>
                <IconButton color="primary" onClick={submit} disabled={(!draft.trim() && !attachment) || send.isPending || preparing || !c} aria-label="Send" sx={{ mb: 0.25 }}>
                  <SendRounded fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
          <EmojiPickerPopover anchor={emojiAnchor} onClose={() => setEmojiAnchor(null)} onPick={insertEmoji} />
        </Box>
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
