import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import DeleteForeverOutlined from '@mui/icons-material/DeleteForeverOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PersonAddAlt1Outlined from '@mui/icons-material/PersonAddAlt1Outlined';
import PersonRemoveOutlined from '@mui/icons-material/PersonRemoveOutlined';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItem,
  Menu,
  MenuItem,
  Paper,
  Popper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  GROUP_TITLE_MAX,
  canRemoveFromGroup,
  runsGroup,
  type ChatMessageDTO,
  type ConversationDTO,
  type GroupDTO,
  type GroupRole,
  type UserRef,
} from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useMe } from '@/auth/AuthProvider';
import { ConfirmDialog } from '@/components/common';
import { RoleBadge, UserAvatar } from '@/components/identity';
import { PhotoUpload } from '@/components/PhotoUpload';
import { PresenceBadge } from '@/components/PresenceDot';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { inZone } from '@/lib/time';
import { navigateTo } from '@/realtime/RealtimeProvider';

/**
 * Group chats (§6.11c): a title, a picture and members. The creator owns the
 * group; owners and admins run it. What happened in it ("added Pixel") shows
 * as a line between the messages, and "@pixel" calls someone in particular.
 */

/** What a chat is called: the group's title, or the other person's name. */
export const chatTitle = (c: ConversationDTO) => c.group?.title ?? c.other?.nickname ?? '';

/** A group's picture (its initial without one), or the other person's avatar with their presence. */
export function ChatAvatar({ conversation: c, size = 40 }: { conversation: ConversationDTO; size?: number }) {
  if (c.group) return <UserAvatar avatarId={null} photoId={c.group.photoId} label={c.group.title} size={size} />;
  const other = c.other!;
  return (
    <PresenceBadge userId={other.id} size={size > 38 ? 11 : 9}>
      <UserAvatar avatarId={other.avatarId} photoId={other.photoId} label={other.nickname} size={size} />
    </PresenceBadge>
  );
}

export const ROLE_IN_GROUP: Record<GroupRole, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

/** A steady colour per person, for their name over their messages. */
const NAME_COLORS = ['#c0392b', '#2471a3', '#1e8449', '#b9770e', '#7d3c98', '#117a65', '#a04000', '#2e4053'];
export function nameColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length]!;
}

// --- Lines and text -------------------------------------------------------------------

/** "Atlas added Pixel", centred between the messages. */
export function SystemLine({ message: m, zone }: { message: ChatMessageDTO; zone: string }) {
  const me = useMe();
  return (
    <Stack alignItems="center" sx={{ my: 1.25 }}>
      <Typography
        variant="caption"
        sx={{ px: 1.5, py: 0.4, borderRadius: 99, bgcolor: 'action.hover', color: 'text.secondary', textAlign: 'center', maxWidth: '85%' }}
      >
        {m.sender.id === me.id ? 'You' : m.sender.nickname} {m.body} · {inZone(m.createdAt, zone).toFormat('h:mm a')}
      </Typography>
    </Stack>
  );
}

const MENTION_SPLIT = /(@[\p{L}\p{N}_.-]+)/u;

/**
 * Message text with its @mentions picked out — strongly when they name the
 * reader. Only names of people in the chat count; anything else stays plain.
 */
export function MentionText({ text, people, mine }: { text: string; people: ReadonlyArray<{ id: string; nickname: string }>; mine: boolean }) {
  const me = useMe();
  if (!people.length || !text.includes('@')) return <>{text}</>;
  const byName = new Map(people.map((p) => [p.nickname.toLowerCase(), p.id]));
  return (
    <>
      {text.split(MENTION_SPLIT).map((part, i) => {
        if (!part.startsWith('@')) return part;
        const name = part.slice(1).toLowerCase();
        const id = byName.get(name) ?? byName.get(name.replace(/[.-]+$/, ''));
        if (!id) return part;
        const isMe = id === me.id;
        return (
          <Box
            key={i}
            component="span"
            sx={{
              fontWeight: 650,
              color: mine ? 'inherit' : 'primary.main',
              ...(isMe && !mine ? { bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: 1, px: 0.4 } : {}),
              ...(mine ? { textDecoration: 'underline' } : {}),
            }}
          >
            {part}
          </Box>
        );
      })}
    </>
  );
}

/** The message a reply answers, quoted: who wrote it and how it began. */
export function ReplyQuote({ reply, onClick, mine }: { reply: NonNullable<ChatMessageDTO['replyTo']>; onClick?: () => void; mine?: boolean }) {
  const text = reply.deleted ? 'Deleted message' : reply.body || (reply.hasImage ? '📷 Photo' : '');
  return (
    <Box
      onClick={onClick}
      sx={{
        pl: 1,
        py: 0.25,
        mb: 0.5,
        borderLeft: 3,
        borderColor: mine ? 'currentColor' : nameColor(reply.sender.id),
        cursor: onClick ? 'pointer' : 'default',
        opacity: mine ? 0.9 : 1,
        minWidth: 0,
      }}
    >
      <Typography variant="caption" component="div" sx={{ fontWeight: 650, color: mine ? 'inherit' : nameColor(reply.sender.id), lineHeight: 1.3 }}>
        {reply.sender.nickname}
      </Typography>
      <Typography variant="caption" component="div" noWrap sx={{ color: mine ? 'inherit' : 'text.secondary', fontStyle: reply.deleted ? 'italic' : 'normal' }}>
        {text.length > 120 ? `${text.slice(0, 117)}…` : text}
      </Typography>
    </Box>
  );
}

// --- @mentions while typing -----------------------------------------------------------------

/** The "@na" being typed just before the caret, if any. */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]!.toLowerCase() } : null;
}

/**
 * Suggests people as someone types "@" in a group's composer: the list follows
 * what comes after it, arrows move, Enter or Tab picks, Escape closes.
 */
export function useMentions({
  draft,
  setDraft,
  input,
  people,
}: {
  draft: string;
  setDraft: (text: string) => void;
  input: RefObject<HTMLTextAreaElement | null>;
  people: UserRef[];
}) {
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const at = people.length ? mentionAt(draft, caret) : null;
  const options = useMemo(
    () => (at ? people.filter((p) => p.nickname.toLowerCase().startsWith(at.query) || p.nickname.toLowerCase().includes(at.query)).slice(0, 6) : []),
    [at?.query, at?.start, people], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const open = Boolean(at) && options.length > 0 && dismissed !== at?.start;
  useEffect(() => setActive(0), [at?.query]);

  const pick = (p: UserRef) => {
    if (!at) return;
    const before = draft.slice(0, at.start);
    const after = draft.slice(caret);
    const inserted = `@${p.nickname} `;
    setDraft(before + inserted + after);
    const pos = before.length + inserted.length;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  /** Call from the input's keydown; true when the key was used for the list. */
  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!open) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      pick(options[active]!);
      return true;
    }
    if (e.key === 'Escape') {
      setDismissed(at!.start);
      return true;
    }
    return false;
  };
  const track = () => setCaret(input.current?.selectionStart ?? draft.length);

  const popper: ReactNode = (
    <Popper open={open} anchorEl={input.current} placement="top-start" sx={{ zIndex: 1300 }}>
      <Paper elevation={6} sx={{ mb: 1, minWidth: 220, maxWidth: 320, py: 0.5 }}>
        {options.map((p, i) => (
          <MenuItem
            key={p.id}
            selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(p);
            }}
            sx={{ gap: 1.25, py: 0.75 }}
          >
            <UserAvatar avatarId={p.avatarId} photoId={p.photoId} label={p.nickname} size={24} />
            <Typography variant="body2" sx={{ flex: 1 }}>
              {p.nickname}
            </Typography>
            <RoleBadge role={p.role} />
          </MenuItem>
        ))}
      </Paper>
    </Popper>
  );
  return { open, onKeyDown, track, popper };
}

// --- Starting a group ------------------------------------------------------------------------

/** Picks people from those who may be in a group (everyone but Experts). */
function PeoplePicker({ value, onChange, exclude = [], label = 'People' }: { value: UserRef[]; onChange: (people: UserRef[]) => void; exclude?: string[]; label?: string }) {
  const candidates = useQuery({ queryKey: qk.chat.groupCandidates, queryFn: api.chat.groupCandidates });
  const options = (candidates.data ?? []).filter((u) => !exclude.includes(u.id));
  return (
    <Autocomplete
      multiple
      options={options}
      loading={candidates.isLoading}
      value={value}
      onChange={(_e, v) => onChange(v)}
      getOptionLabel={(o) => o.nickname}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      groupBy={(o) => (o.role === 'founder' ? 'Founders' : o.role === 'manager' ? 'Managers' : 'Associates')}
      filterSelectedOptions
      renderOption={({ key, ...props }, o) => (
        <li key={key} {...props}>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <UserAvatar avatarId={o.avatarId} photoId={o.photoId} label={o.nickname} size={26} />
            <span>{o.nickname}</span>
          </Stack>
        </li>
      )}
      renderValue={(selected, getItemProps) =>
        selected.map((o, index) => {
          const { key, ...item } = getItemProps({ index });
          return <Chip key={key} {...item} size="small" label={o.nickname} avatar={<UserAvatar avatarId={o.avatarId} photoId={o.photoId} label={o.nickname} size={20} />} />;
        })
      }
      renderInput={(params) => <TextField {...params} label={label} placeholder={value.length ? '' : 'Add people'} />}
    />
  );
}

export function NewGroupDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: ConversationDTO) => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [people, setPeople] = useState<UserRef[]>([]);
  useEffect(() => {
    if (open) {
      setTitle('');
      setPeople([]);
    }
  }, [open]);
  const create = useMutation({
    mutationFn: () => api.chat.createGroup(title.trim(), people.map((p) => p.id)),
    onSuccess: (c) => {
      queryClient.setQueryData(qk.chat.conversation(c.id), c);
      void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
      onCreated(c);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const ready = title.trim().length > 0 && people.length > 0;
  return (
    <Dialog open={open} onClose={() => !create.isPending && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle>New group</DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 1 }}>
          <TextField
            label="Group name"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            slotProps={{ htmlInput: { maxLength: GROUP_TITLE_MAX } }}
          />
          <PeoplePicker value={people} onChange={setPeople} />
          <Typography variant="caption" color="text.secondary">
            You own the group. Founders, Managers and Associates can be in groups; Experts keep their one-to-one chats.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={create.isPending}>
          Cancel
        </Button>
        <Button variant="contained" disabled={!ready || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <CircularProgress size={18} color="inherit" /> : 'Create group'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// --- The group's info panel -------------------------------------------------------------------

/** Name, picture and members; owners and admins change them, anyone leaves. */
export function GroupInfoDialog({ conversationId, open, onClose }: { conversationId: string; open: boolean; onClose: () => void }) {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const group = useQuery({ queryKey: qk.chat.group(conversationId), queryFn: () => api.chat.group(conversationId), enabled: open });
  const g = group.data;
  const runs = runsGroup(g?.myRole);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState<UserRef[] | null>(null);
  const [memberMenu, setMemberMenu] = useState<{ anchor: HTMLElement; member: GroupDTO['members'][number] } | null>(null);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);

  const saved = (next: GroupDTO | undefined | void) => {
    if (next) queryClient.setQueryData(qk.chat.group(conversationId), next);
    void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
    void queryClient.invalidateQueries({ queryKey: qk.chat.conversation(conversationId) });
  };
  const run = <T,>(task: () => Promise<T>, done?: string) =>
    task().then(
      (result) => {
        saved(result as GroupDTO | undefined);
        if (done) toast.success(done);
        return result;
      },
      (err: unknown) => {
        toast.error(errorMessage(err));
        throw err;
      },
    );
  const gone = (message: string) => {
    queryClient.removeQueries({ queryKey: qk.chat.group(conversationId) });
    queryClient.removeQueries({ queryKey: qk.chat.messages(conversationId) });
    void queryClient.invalidateQueries({ queryKey: qk.chat.conversations });
    toast.success(message);
    onClose();
    navigateTo('/chat');
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth scroll="paper">
      {!g ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress size={24} />
        </Stack>
      ) : (
        <>
          <DialogTitle sx={{ pb: 1 }}>Group info</DialogTitle>
          <DialogContent dividers>
            <Stack alignItems="center" spacing={1.5} sx={{ pb: 2 }}>
              {runs ? (
                <PhotoUpload
                  avatarId={null}
                  photoId={g.photoId}
                  label={g.title}
                  size={84}
                  hint="Owners and admins change the group's picture."
                  onUpload={(dataUrl) => run(() => api.chat.setGroupPhoto(conversationId, dataUrl))}
                  onRemove={g.photoId ? () => run(() => api.chat.removeGroupPhoto(conversationId)) : undefined}
                />
              ) : (
                <UserAvatar avatarId={null} photoId={g.photoId} label={g.title} size={84} />
              )}
              {renaming !== null ? (
                <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
                  <TextField
                    size="small"
                    fullWidth
                    autoFocus
                    value={renaming}
                    onChange={(e) => setRenaming(e.target.value)}
                    slotProps={{ htmlInput: { maxLength: GROUP_TITLE_MAX, 'aria-label': 'Group name' } }}
                  />
                  <Button
                    variant="contained"
                    disabled={!renaming.trim()}
                    onClick={() => void run(() => api.chat.renameGroup(conversationId, renaming.trim())).then(() => setRenaming(null), () => undefined)}
                  >
                    Save
                  </Button>
                </Stack>
              ) : (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Typography variant="h6" sx={{ textAlign: 'center', wordBreak: 'break-word' }}>
                    {g.title}
                  </Typography>
                  {runs && (
                    <IconButton size="small" aria-label="Rename the group" onClick={() => setRenaming(g.title)}>
                      <EditOutlined sx={{ fontSize: 18 }} />
                    </IconButton>
                  )}
                </Stack>
              )}
              <Typography variant="caption" color="text.secondary">
                {g.memberCount} member{g.memberCount === 1 ? '' : 's'}
                {g.createdBy ? ` · started by ${g.createdBy.id === me.id ? 'you' : g.createdBy.nickname}` : ''}
              </Typography>
            </Stack>
            <Divider />
            <Stack direction="row" alignItems="center" sx={{ pt: 1.5, pb: 0.5 }}>
              <Typography variant="subtitle2" sx={{ flex: 1 }}>
                Members
              </Typography>
              {runs && adding === null && (
                <Button size="small" startIcon={<PersonAddAlt1Outlined />} onClick={() => setAdding([])}>
                  Add
                </Button>
              )}
            </Stack>
            {adding !== null && (
              <Stack spacing={1} sx={{ py: 1 }}>
                <PeoplePicker value={adding} onChange={setAdding} exclude={g.members.map((m) => m.user.id)} label="Add people" />
                <Stack direction="row" spacing={1} justifyContent="flex-end">
                  <Button size="small" color="inherit" onClick={() => setAdding(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={!adding.length}
                    onClick={() =>
                      void run(() => api.chat.addGroupMembers(conversationId, adding.map((p) => p.id)), `Added ${adding.length} ${adding.length === 1 ? 'person' : 'people'}`).then(
                        () => setAdding(null),
                        () => undefined,
                      )
                    }
                  >
                    Add to group
                  </Button>
                </Stack>
              </Stack>
            )}
            <List dense disablePadding>
              {g.members.map((m) => {
                const mayRemove = m.user.id !== me.id && canRemoveFromGroup(g.myRole, m.role);
                const mayPromote = g.myRole === 'owner' && m.role !== 'owner';
                return (
                  <ListItem
                    key={m.user.id}
                    disableGutters
                    secondaryAction={
                      (mayRemove || mayPromote) && (
                        <IconButton edge="end" size="small" aria-label={`Options for ${m.user.nickname}`} onClick={(e) => setMemberMenu({ anchor: e.currentTarget, member: m })}>
                          <MoreVertRounded sx={{ fontSize: 18 }} />
                        </IconButton>
                      )
                    }
                  >
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0, flex: 1, pr: 4, opacity: m.user.isActive ? 1 : 0.55 }}>
                      <PresenceBadge userId={m.user.id} size={9}>
                        <UserAvatar avatarId={m.user.avatarId} photoId={m.user.photoId} label={m.user.nickname} size={32} />
                      </PresenceBadge>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" fontWeight={550} noWrap>
                          {m.user.nickname}
                          {m.user.id === me.id ? ' (you)' : ''}
                        </Typography>
                        <RoleBadge role={m.user.role} />
                      </Box>
                      {m.role !== 'member' && (
                        <Chip size="small" label={ROLE_IN_GROUP[m.role]} color={m.role === 'owner' ? 'primary' : 'default'} variant={m.role === 'owner' ? 'filled' : 'outlined'} />
                      )}
                    </Stack>
                  </ListItem>
                );
              })}
            </List>
          </DialogContent>
          <DialogActions sx={{ px: 2, py: 1.5, justifyContent: 'space-between' }}>
            <Stack direction="row" spacing={1}>
              <Button color="error" startIcon={<LogoutRounded />} onClick={() => setConfirm('leave')}>
                Leave
              </Button>
              {g.myRole === 'owner' && (
                <Button color="error" startIcon={<DeleteForeverOutlined />} onClick={() => setConfirm('delete')}>
                  Delete
                </Button>
              )}
            </Stack>
            <Button onClick={onClose}>Close</Button>
          </DialogActions>

          <Menu anchorEl={memberMenu?.anchor ?? null} open={Boolean(memberMenu)} onClose={() => setMemberMenu(null)}>
            {memberMenu && g.myRole === 'owner' && memberMenu.member.role !== 'owner' && (
              <MenuItem
                onClick={() => {
                  const { member } = memberMenu;
                  setMemberMenu(null);
                  void run(() => api.chat.setGroupMemberRole(conversationId, member.user.id, member.role === 'admin' ? 'member' : 'admin')).catch(() => undefined);
                }}
              >
                <AdminPanelSettingsOutlined fontSize="small" sx={{ mr: 1.25 }} />
                {memberMenu.member.role === 'admin' ? 'Remove as admin' : 'Make admin'}
              </MenuItem>
            )}
            {memberMenu && canRemoveFromGroup(g.myRole, memberMenu.member.role) && (
              <MenuItem
                sx={{ color: 'error.main' }}
                onClick={() => {
                  const { member } = memberMenu;
                  setMemberMenu(null);
                  void run(() => api.chat.removeGroupMember(conversationId, member.user.id), `${member.user.nickname} removed`).catch(() => undefined);
                }}
              >
                <PersonRemoveOutlined fontSize="small" sx={{ mr: 1.25 }} />
                Remove from group
              </MenuItem>
            )}
          </Menu>

          <ConfirmDialog
            open={confirm === 'leave'}
            title={`Leave “${g.title}”?`}
            description={
              g.myRole === 'owner' && g.memberCount > 1
                ? 'You own this group: it goes to the longest-standing admin, or member. You will no longer see its messages.'
                : g.memberCount === 1
                  ? 'You are the last one in it, so the group is deleted.'
                  : 'You will no longer see its messages. An admin can add you back.'
            }
            confirmLabel="Leave group"
            destructive
            onClose={() => setConfirm(null)}
            onConfirm={async () => {
              await api.chat.removeGroupMember(conversationId, me.id);
              gone(`You left “${g.title}”`);
            }}
          />
          <ConfirmDialog
            open={confirm === 'delete'}
            title={`Delete “${g.title}”?`}
            description="Every message and picture in it is erased for everyone, and the group is gone. This cannot be undone."
            confirmLabel="Delete group"
            destructive
            onClose={() => setConfirm(null)}
            onConfirm={async () => {
              await api.chat.deleteGroup(conversationId);
              gone(`“${g.title}” deleted`);
            }}
          />
        </>
      )}
    </Dialog>
  );
}
