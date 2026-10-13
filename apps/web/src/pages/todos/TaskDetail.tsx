import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import NotesRounded from '@mui/icons-material/NotesRounded';
import {
  Alert,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  Link,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  canDeleteTaskNote,
  canEditTask,
  canEditTaskNote,
  canNoteTask,
  canRemoveTask,
  isSelfTask,
  type TodoDTO,
  type TodoNoteDTO,
} from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { ConfirmDialog } from '@/components/common';
import { UserAvatar, UserChip } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { inZone, relativeTime } from '@/lib/time';
import { StatusControl, UrgencyScore, formatWhen, urgencyOf } from './taskShared';
import { TodoPill, todoText, useRefreshTodos } from './todoShared';

/**
 * Everything about one task, beside the table rather than over it: what it
 * asks, its dates, where it stands, and the notes the people on it keep as the
 * work goes. Changing the task itself is a separate step (Edit), for those who
 * may; writing a note is open to everyone who can see the task.
 */
export function TaskDetailDrawer({ todo, onClose, onEdit }: { todo: TodoDTO | null; onClose: () => void; onEdit: (t: TodoDTO) => void }) {
  return (
    <Drawer
      anchor="right"
      open={Boolean(todo)}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 520 }, maxWidth: '100%' } } }}
    >
      {todo && <TaskDetail key={todo.id} todo={todo} onClose={onClose} onEdit={onEdit} />}
    </Drawer>
  );
}

function TaskDetail({ todo: t, onClose, onEdit }: { todo: TodoDTO; onClose: () => void; onEdit: (t: TodoDTO) => void }) {
  const me = useMe();
  const { zone } = useAuth();
  const refresh = useRefreshTodos();
  const toast = useToast();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const mayEdit = canEditTask(me, t);
  const mayRemove = canRemoveTask(me, t);
  // The giver and the owner can remove it later; say when, rather than hide the button.
  const removableLater = !mayRemove && (t.assignee.id === me.id || t.createdBy.id === me.id);
  const text = todoText(t);
  const overdue = t.completeByAt !== null && t.status !== 'completed' && t.status !== 'done' && new Date(t.completeByAt).getTime() < Date.now();
  const inChat = t.conversationId && (t.assignee.id === me.id || t.createdBy.id === me.id);

  const remove = useMutation({
    mutationFn: () => api.todos.remove(t.id),
    onSuccess: () => {
      refresh(t);
      toast.success('Task removed');
      onClose();
    },
  });

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* The heading stays put while the notes scroll under it. */}
      <Box sx={{ px: 2.5, pt: 2, pb: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <StatusControl todo={t} />
          <Box sx={{ flex: 1 }} />
          {mayEdit && (
            <Button size="small" startIcon={<EditRounded />} onClick={() => onEdit(t)}>
              Edit
            </Button>
          )}
          {(mayRemove || removableLater) && (
            <Tooltip title={mayRemove ? 'Remove this task' : 'You can remove it once it is completed'}>
              <span>
                <IconButton size="small" aria-label="Remove task" disabled={!mayRemove} onClick={() => setConfirmRemove(true)} color="error">
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          <IconButton size="small" aria-label="Close" onClick={onClose}>
            <CloseRounded fontSize="small" />
          </IconButton>
        </Stack>
        <Typography
          variant="h6"
          sx={{
            mt: 1.25,
            fontSize: '1.1rem',
            lineHeight: 1.35,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            textDecoration: t.status === 'completed' ? 'line-through' : 'none',
          }}
        >
          {text}
        </Typography>
        <Stack direction="row" spacing={2.5} sx={{ mt: 1.25 }} flexWrap="wrap" useFlexGap>
          <Labelled label="Owner">
            <UserChip user={t.assignee} size={22} />
          </Labelled>
          {!isSelfTask(t) && (
            <Labelled label="Given by">
              <UserChip user={t.createdBy} size={22} />
            </Labelled>
          )}
        </Stack>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 2.5, py: 2 }}>
        <Stack spacing={2.25}>
          {t.status === 'blocked' && t.blockedReason && (
            <Alert severity="error" variant="outlined">
              <strong>Blocked:</strong> {t.blockedReason}
            </Alert>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1.5 }}>
            <Labelled label="Start">
              <Typography variant="body2" color={t.startByAt ? 'text.primary' : 'text.disabled'}>
                {t.startByAt ? formatWhen(t.startByAt, t.startByHasTime, zone) : '—'}
              </Typography>
            </Labelled>
            <Labelled label="End date">
              <Typography variant="body2" sx={{ color: overdue ? 'error.main' : t.completeByAt ? 'text.primary' : 'text.disabled', fontWeight: overdue ? 700 : 400 }}>
                {t.completeByAt ? formatWhen(t.completeByAt, t.completeByHasTime, zone) : '—'}
              </Typography>
            </Labelled>
            <Labelled label="Urgency">
              <UrgencyScore score={urgencyOf(t, zone)} />
            </Labelled>
          </Box>

          <Prose label="Description" text={t.details} />
          <Prose label="Expected deliverable" text={t.expectedDeliverable} />
          <Prose label="Definition of done" text={t.definitionOfDone} />
          {!t.details && !t.expectedDeliverable && !t.definitionOfDone && mayEdit && (
            <Typography variant="body2" color="text.secondary">
              No description yet.{' '}
              <Link component="button" variant="body2" onClick={() => onEdit(t)} sx={{ verticalAlign: 'baseline' }}>
                Add one
              </Link>
            </Typography>
          )}

          {t.dependsOn.length > 0 && (
            <Labelled label="Waits for">
              <Stack spacing={0.75} sx={{ mt: 0.25 }}>
                {t.dependsOn.map((d) => (
                  <Stack key={d.id} direction="row" spacing={1} alignItems="center">
                    <TodoPill todo={d} compact />
                    <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                      {d.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {d.assignee.nickname}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </Labelled>
          )}

          {t.doneNote && (t.status === 'done' || t.status === 'completed') && <Prose label="Note when finished" text={t.doneNote} />}

          {inChat && (
            <Link component={RouterLink} to={`/chat/${t.conversationId}`} variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, alignSelf: 'flex-start' }}>
              <ChatBubbleOutlineRounded sx={{ fontSize: 16 }} />
              Given in a chat — open it
            </Link>
          )}

          <Divider />
          <Notes todo={t} />
        </Stack>
      </Box>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove this task?"
        destructive
        confirmLabel="Remove"
        description={
          <>
            “{text.length > 120 ? `${text.slice(0, 120)}…` : text}”
            {t.noteCount > 0 ? ` and its ${t.noteCount === 1 ? 'note' : `${t.noteCount} notes`}` : ''} will be removed for everyone. This cannot be undone.
          </>
        }
        onConfirm={() => remove.mutateAsync()}
        onClose={() => setConfirmRemove(false)}
      />
    </Box>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600, mb: 0.25 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function Prose({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <Labelled label={label}>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text}
      </Typography>
    </Labelled>
  );
}

// --- Notes ---------------------------------------------------------------------

function Notes({ todo }: { todo: TodoDTO }) {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const key = qk.todos.notes(todo.id);
  const notes = useQuery({ queryKey: key, queryFn: () => api.todos.notes(todo.id) });
  const mayWrite = canNoteTask(me, todo);

  const afterChange = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    // The note count on the row.
    void queryClient.invalidateQueries({ queryKey: qk.todos.all });
  };
  const add = useMutation({
    mutationFn: () => api.todos.addNote(todo.id, draft),
    onSuccess: (note) => {
      queryClient.setQueryData<TodoNoteDTO[]>(key, (old) => (old ? [...old, note] : [note]));
      setDraft('');
      afterChange();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const submit = () => {
    if (draft.trim() && !add.isPending) add.mutate();
  };

  const list = notes.data ?? [];
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
        <NotesRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
        <Typography variant="subtitle2">Notes</Typography>
        {list.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            {list.length}
          </Typography>
        )}
      </Stack>

      {notes.isLoading ? (
        <Stack spacing={1}>
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
        </Stack>
      ) : notes.isError ? (
        <Alert severity="error" action={<Button onClick={() => void notes.refetch()}>Retry</Button>}>
          {errorMessage(notes.error)}
        </Alert>
      ) : list.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          No notes yet. Keep progress, findings and links here, as long as they need to be.
        </Typography>
      ) : (
        <Stack spacing={1.75} sx={{ mb: 2 }}>
          {list.map((n) => (
            <NoteItem key={n.id} note={n} onChanged={afterChange} />
          ))}
        </Stack>
      )}

      {mayWrite && (
        <Box>
          <TextField
            fullWidth
            multiline
            minRows={3}
            maxRows={16}
            placeholder="Add a note…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
            slotProps={{ htmlInput: { 'aria-label': 'New note' } }}
          />
          <Stack direction="row" alignItems="center" sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Ctrl + Enter to add
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" size="small" disabled={!draft.trim() || add.isPending} onClick={submit}>
              Add note
            </Button>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

/** Longer than this, a note opens folded, so one long note does not bury the rest. */
const FOLD_CHARS = 900;
const FOLD_LINES = 12;

function NoteItem({ note, onChanged }: { note: TodoNoteDTO; onChanged: () => void }) {
  const me = useMe();
  const { zone } = useAuth();
  const toast = useToast();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const long = note.body.length > FOLD_CHARS || note.body.split('\n').length > FOLD_LINES;
  const [open, setOpen] = useState(!long);

  const mayEdit = canEditTaskNote(me, note);
  const mayDelete = canDeleteTaskNote(me, note);
  const edited = new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 1000;

  const save = useMutation({
    mutationFn: () => api.todos.editNote(note.todoId, note.id, draft),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.todos.removeNote(note.todoId, note.id),
    onSuccess: () => {
      toast.success('Note deleted');
      onChanged();
    },
  });

  return (
    <Stack direction="row" spacing={1.25} alignItems="flex-start">
      <UserAvatar avatarId={note.author.avatarId} photoId={note.author.photoId} size={28} label={note.author.nickname} userId={note.author.id} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="baseline">
          <Typography variant="body2" fontWeight={600} noWrap>
            {note.author.id === me.id ? 'You' : note.author.nickname}
          </Typography>
          <Tooltip title={inZone(note.createdAt, zone).toFormat('ccc, LLL d yyyy, h:mm a')}>
            <Typography variant="caption" color="text.secondary" noWrap>
              {Date.now() - new Date(note.createdAt).getTime() < 60_000 ? 'just now' : relativeTime(note.createdAt)}
              {edited ? ' · edited' : ''}
            </Typography>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          {(mayEdit || mayDelete) && !editing && (
            <IconButton size="small" aria-label="Note actions" onClick={(e) => setMenu(e.currentTarget)} sx={{ p: 0.25, mt: -0.5 }}>
              <MoreHorizRounded fontSize="small" />
            </IconButton>
          )}
        </Stack>

        {editing ? (
          <Box sx={{ mt: 0.5 }}>
            <TextField
              fullWidth
              multiline
              minRows={3}
              maxRows={20}
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim()) {
                  e.preventDefault();
                  save.mutate();
                }
                if (e.key === 'Escape') setEditing(false);
              }}
              slotProps={{ htmlInput: { 'aria-label': 'Edit note' } }}
            />
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1 }}>
              <Button size="small" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="small" variant="contained" disabled={!draft.trim() || save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </Stack>
          </Box>
        ) : (
          <Box sx={{ mt: 0.25, p: 1.25, borderRadius: 2, bgcolor: 'background.subtle' }}>
            <Typography
              variant="body2"
              sx={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                ...(open ? {} : { display: '-webkit-box', WebkitLineClamp: 8, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
              }}
            >
              {note.body}
            </Typography>
            {long && (
              <Link component="button" variant="caption" onClick={() => setOpen((o) => !o)} sx={{ mt: 0.5 }}>
                {open ? 'Show less' : 'Show all'}
              </Link>
            )}
          </Box>
        )}
      </Box>

      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {mayEdit && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              setDraft(note.body);
              setEditing(true);
            }}
          >
            <EditRounded fontSize="small" sx={{ mr: 1.25 }} />
            Edit
          </MenuItem>
        )}
        {mayDelete && (
          <MenuItem
            onClick={() => {
              setMenu(null);
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
        title="Delete this note?"
        destructive
        confirmLabel="Delete"
        description="It is removed for everyone who can see the task."
        onConfirm={() => remove.mutateAsync()}
        onClose={() => setConfirmDelete(false)}
      />
    </Stack>
  );
}
