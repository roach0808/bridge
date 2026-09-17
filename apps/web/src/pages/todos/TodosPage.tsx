import AddTaskRounded from '@mui/icons-material/AddTaskRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import { Box, Button, Card, Collapse, Divider, IconButton, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { ROLE_LABELS, type TodoDTO, type TodoPanel, type UserRef } from '@god/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { BrowserNotificationsPrompt } from '@/components/BrowserNotifications';
import { useToast } from '@/components/ToastProvider';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { UserAvatar } from '@/components/identity';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { formatDateTime, relativeTime } from '@/lib/time';
import { FilterChips } from '../admin/adminShared';
import { NewTaskDialog, TODO_COLORS, TodoDoneDialog, TodoPill, TodoReopenDialog, todoText, useRefreshTodos } from './todoShared';

/** `active` = not completed yet, the default view. */
type Filter = 'active' | 'open' | 'done' | 'completed' | 'all';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Waiting for confirmation' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

export default function TodosPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const filter = (FILTERS.find((f) => f.value === params.get('filter'))?.value ?? 'active') as Filter;
  const [newTaskFor, setNewTaskFor] = useState<UserRef | null>(null);
  const [doneFor, setDoneFor] = useState<TodoDTO | null>(null);
  const [reopenFor, setReopenFor] = useState<TodoDTO | null>(null);

  const query = useQuery({
    queryKey: qk.todos.board(filter),
    queryFn: () => api.todos.board({ status: filter }),
  });
  const panels = query.data ?? [];
  const gives = panels.some((p) => p.canGive);

  return (
    <Box>
      <PageHeader
        title="Tasks"
        subtitle={
          gives
            ? 'Your tasks first, then one panel per person. Mark your own done; confirm theirs when they are.'
            : 'Tasks given to you. Mark one done when it is finished, and the person who gave it confirms.'
        }
      />

      <BrowserNotificationsPrompt />

      <Box sx={{ mb: 2 }}>
        <FilterChips
          ariaLabel="Filter by status"
          value={filter}
          onChange={(v) => setParams((p) => ({ ...Object.fromEntries(p), filter: v }), { replace: true })}
          options={FILTERS}
        />
      </Box>

      {query.isLoading ? (
        <Stack spacing={2}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={140} />
          ))}
        </Stack>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Stack spacing={2}>
          {panels.map((panel) => (
            <PersonPanel
              key={panel.person.id}
              panel={panel}
              filter={filter}
              onNewTask={() => setNewTaskFor(panel.person)}
              onDone={setDoneFor}
              onReopen={setReopenFor}
            />
          ))}
        </Stack>
      )}

      <TodoDoneDialog
        todo={doneFor ? { id: doneFor.id, conversationId: doneFor.conversationId, instruction: todoText(doneFor) } : null}
        onClose={() => setDoneFor(null)}
      />
      <TodoReopenDialog todo={reopenFor} onClose={() => setReopenFor(null)} />
      <NewTaskDialog open={Boolean(newTaskFor)} assignee={newTaskFor ?? undefined} onClose={() => setNewTaskFor(null)} />
      {me.role !== 'expert' && panels.length === 0 && !query.isLoading && !query.isError && (
        <Card>
          <EmptyState icon={<ChecklistRounded />} title="Nothing here yet" />
        </Card>
      )}
    </Box>
  );
}

/** One person's tasks. The caller's own panel opens first and is always expanded. */
function PersonPanel({
  panel,
  filter,
  onNewTask,
  onDone,
  onReopen,
}: {
  panel: TodoPanel;
  filter: Filter;
  onNewTask: () => void;
  onDone: (t: TodoDTO) => void;
  onReopen: (t: TodoDTO) => void;
}) {
  const { person, counts, tasks, isMe } = panel;
  // Panels with nothing in them start folded, so a long team stays readable.
  const [open, setOpen] = useState(isMe || tasks.length > 0);
  const waiting = counts.done;

  return (
    <Card>
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ p: 1.75, cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-expanded={open}
      >
        <UserAvatar avatarId={person.avatarId} photoId={person.photoId} label={person.nickname} size={36} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" noWrap>
            {isMe ? 'Your tasks' : person.nickname}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {isMe ? 'Given to you' : ROLE_LABELS[person.role]}
            {!person.isActive && ' · deactivated'}
            {counts.open > 0 && ` · ${counts.open} open`}
            {waiting > 0 && ` · ${waiting} waiting for confirmation`}
            {counts.open === 0 && waiting === 0 && ' · nothing to do'}
          </Typography>
        </Box>
        {panel.canGive && (
          <Button
            size="small"
            startIcon={<AddTaskRounded />}
            onClick={(e) => {
              e.stopPropagation();
              onNewTask();
            }}
          >
            New task
          </Button>
        )}
        <IconButton size="small" aria-label={open ? 'Collapse' : 'Expand'} sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
          <ExpandMoreRounded />
        </IconButton>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Divider />
        {tasks.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {filter === 'active' ? 'No tasks right now.' : 'No tasks match this filter.'}
          </Typography>
        ) : (
          <Stack divider={<Divider />}>
            {tasks.map((t) => (
              <TaskRow key={t.id} todo={t} onDone={() => onDone(t)} onReopen={() => onReopen(t)} />
            ))}
          </Stack>
        )}
      </Collapse>
    </Card>
  );
}

function TaskRow({ todo: t, onDone, onReopen }: { todo: TodoDTO; onDone: () => void; onReopen: () => void }) {
  const me = useMe();
  const { zone } = useAuth();
  const toast = useToast();
  const refresh = useRefreshTodos();
  const navigate = useNavigate();
  const iGave = t.createdBy.id === me.id;
  const mine = t.assignee.id === me.id;
  const finished = t.status !== 'open';

  const confirm = useMutation({
    mutationFn: () => api.todos.confirm(t.id),
    onSuccess: (saved) => {
      refresh(saved);
      toast.success('Completed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.todos.remove(t.id),
    onSuccess: () => {
      refresh(t);
      toast.success('Task removed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1.5}
      justifyContent="space-between"
      alignItems={{ sm: 'flex-start' }}
      sx={{ p: 2, borderLeft: 3, borderLeftColor: TODO_COLORS[t.status], opacity: t.status === 'completed' ? 0.75 : 1 }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
          <TodoPill todo={t} />
          <Tooltip title={formatDateTime(t.createdAt, zone)}>
            <Typography variant="caption" color="text.secondary">
              {relativeTime(t.createdAt)}
            </Typography>
          </Tooltip>
        </Stack>
        <Typography
          variant="body1"
          sx={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontWeight: t.title ? 600 : 400,
            textDecoration: t.status === 'completed' ? 'line-through' : 'none',
            color: finished ? 'text.secondary' : 'text.primary',
          }}
        >
          {todoText(t)}
        </Typography>
        {t.details && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {t.details}
          </Typography>
        )}
        {finished && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Done {t.doneAt ? relativeTime(t.doneAt) : ''}
            {t.doneNote ? ` — “${t.doneNote}”` : ''}
            {t.confirmedAt ? ` · confirmed ${relativeTime(t.confirmedAt)}` : ''}
          </Typography>
        )}
        <Box sx={{ mt: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            {!iGave && <UserAvatar avatarId={t.createdBy.avatarId} photoId={t.createdBy.photoId} label={t.createdBy.nickname} size={20} />}
            <Typography variant="caption" color="text.secondary">
              Given by {iGave ? 'you' : t.createdBy.nickname}
            </Typography>
          </Stack>
        </Box>
      </Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ flexShrink: 0 }}>
        {t.status === 'open' && mine && (
          <Button variant="contained" color="success" size="small" startIcon={<TaskAltRounded />} onClick={onDone}>
            Mark done
          </Button>
        )}
        {t.status === 'done' && iGave && (
          <Button variant="contained" color="success" size="small" startIcon={<VerifiedRounded />} onClick={() => confirm.mutate()} disabled={confirm.isPending}>
            Confirm
          </Button>
        )}
        {finished && iGave && (
          <Button size="small" color="inherit" startIcon={<ReplayRounded />} onClick={onReopen} sx={{ color: 'text.secondary' }}>
            Reopen
          </Button>
        )}
        {t.status === 'open' && iGave && (
          <Button size="small" color="inherit" startIcon={<DeleteOutlineRounded />} onClick={() => remove.mutate()} disabled={remove.isPending} sx={{ color: 'text.secondary' }}>
            Remove
          </Button>
        )}
        {t.conversationId && (
          <Tooltip title="Open the chat">
            <IconButton size="small" onClick={() => navigate(`/chat/${t.conversationId}`)} aria-label="Open the chat">
              <ChatBubbleOutlineRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}
