import AddTaskRounded from '@mui/icons-material/AddTaskRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DragIndicatorRounded from '@mui/icons-material/DragIndicatorRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import { Box, Button, Card, Checkbox, Collapse, Divider, IconButton, Skeleton, Stack, Tooltip, Typography } from '@mui/material';
import { ROLE_LABELS, isSelfTask, type TodoDTO, type TodoPanel, type UserRef } from '@god/shared';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type CSSProperties, type ReactNode, type Ref } from 'react';
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
import { NewTaskDialog, TODO_COLORS, TodoReopenDialog, todoText, useRefreshTodos } from './todoShared';

/** A ticked box keeps its colour even when it is no longer yours to change. */
const TICK_SX = (color: string) => ({
  p: 0.5,
  // Yours to tick: clearly clickable. Ticked: the status colour, even once it is out of your hands.
  color: 'text.secondary',
  '&:hover': { color },
  '&.Mui-checked, &.Mui-checked.Mui-disabled': { color },
  '&.Mui-disabled:not(.Mui-checked)': { color: 'action.disabled', opacity: 0.5 },
});

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
  const [reopenFor, setReopenFor] = useState<TodoDTO | null>(null);

  const query = useQuery({
    queryKey: qk.todos.board(filter),
    queryFn: () => api.todos.board({ status: filter }),
  });
  const panels = query.data ?? [];
  const gives = panels.some((p) => p.canGive && !p.isMe);

  return (
    <Box>
      <PageHeader
        title="Tasks"
        subtitle={
          gives
            ? 'Your tasks first, then one panel per person. Add your own, drag to reorder, and confirm theirs when they are done.'
            : 'Your own to-dos and the tasks given to you. Add one, drag to reorder, and tick it off when it is finished.'
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
              onReopen={setReopenFor}
            />
          ))}
        </Stack>
      )}

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
  onReopen,
}: {
  panel: TodoPanel;
  filter: Filter;
  onNewTask: () => void;
  onReopen: (t: TodoDTO) => void;
}) {
  const { person, counts, tasks, isMe } = panel;
  // Panels with nothing in them start folded, so a long team stays readable.
  const [open, setOpen] = useState(isMe || tasks.length > 0);
  const waiting = counts.done;
  const queryClient = useQueryClient();
  const toast = useToast();
  // Your own panel is yours to arrange, and so is the panel of anyone you give tasks to.
  const mayArrange = (isMe || panel.canGive) && tasks.length > 1;
  const sensors = useSensors(
    // A few pixels of movement, so a tap on the handle still behaves like a tap.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.todos.reorder({ assigneeId: person.id, ids }),
    onError: (err) => {
      toast.error(errorMessage(err));
      void queryClient.invalidateQueries({ queryKey: qk.todos.all });
    },
  });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = tasks.findIndex((t) => t.id === active.id);
    const to = tasks.findIndex((t) => t.id === over.id);
    if (from < 0 || to < 0) return;
    const next = arrayMove(tasks, from, to);
    // Move it under the hand right away; the order is saved for everyone.
    queryClient.setQueryData<TodoPanel[]>(qk.todos.board(filter), (old) =>
      old?.map((p) => (p.person.id === person.id ? { ...p, tasks: next } : p)),
    );
    reorder.mutate(next.map((t) => t.id));
  };

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
            {isMe ? 'Yours' : ROLE_LABELS[person.role]}
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
        ) : mayArrange ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              <Stack divider={<Divider />}>
                {tasks.map((t) => (
                  <SortableTask key={t.id} todo={t} onReopen={() => onReopen(t)} />
                ))}
              </Stack>
            </SortableContext>
          </DndContext>
        ) : (
          <Stack divider={<Divider />}>
            {tasks.map((t) => (
              <TaskRow key={t.id} todo={t} onReopen={() => onReopen(t)} />
            ))}
          </Stack>
        )}
      </Collapse>
    </Card>
  );
}

/** A task that can be dragged up and down its panel by its handle. */
function SortableTask({ todo, onReopen }: { todo: TodoDTO; onReopen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id });
  return (
    <TaskRow
      todo={todo}
      onReopen={onReopen}
      rootRef={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: 'relative',
        zIndex: isDragging ? 2 : undefined,
        opacity: isDragging ? 0.75 : 1,
      }}
      handle={
        <Tooltip title="Drag to reorder">
          <IconButton
            size="small"
            aria-label={`Reorder \u201c${todoText(todo)}\u201d`}
            {...attributes}
            {...listeners}
            sx={{ cursor: 'grab', touchAction: 'none', color: 'text.disabled', p: 0.25, '&:active': { cursor: 'grabbing' } }}
          >
            <DragIndicatorRounded sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      }
    />
  );
}

/**
 * One task on a single line: the taker's tick, the giver's tick, what it says,
 * who gave it, and (once both ticked, or before it starts) a way to clear it away.
 * A task you gave yourself has nobody to confirm it, so it has one tick only.
 */
function TaskRow({
  todo: t,
  onReopen,
  handle,
  rootRef,
  style,
}: {
  todo: TodoDTO;
  onReopen: () => void;
  handle?: ReactNode;
  rootRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
}) {
  const me = useMe();
  const { zone } = useAuth();
  const toast = useToast();
  const refresh = useRefreshTodos();
  const navigate = useNavigate();
  const iGave = t.createdBy.id === me.id;
  const mine = t.assignee.id === me.id;
  // Given to yourself: ticking it finishes it, there is nobody to confirm.
  const self = isSelfTask(t);
  const [expanded, setExpanded] = useState(false);
  const text = todoText(t);

  const done = useMutation({
    mutationFn: () => api.todos.done(t.id),
    onSuccess: (saved) => {
      refresh(saved);
      toast.success(saved.conversationId ? 'Marked done — your reply was posted in the chat' : self ? 'Done' : 'Marked done');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
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
  const busy = done.isPending || confirm.isPending || remove.isPending;
  const canDelete = iGave && (t.status === 'open' || t.status === 'completed');

  return (
    <Box
      ref={rootRef}
      style={style}
      sx={{
        px: 1,
        py: 0.25,
        // A colour bar makes the state readable at a glance: waiting, ticked, confirmed.
        borderLeft: 3,
        borderLeftColor: TODO_COLORS[t.status],
        // An opaque row: while one is dragged it slides over the others.
        bgcolor: t.status === 'completed' ? 'action.hover' : 'background.paper',
      }}
    >
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minHeight: 40 }}>
        {handle}
        <Tooltip title={t.status === 'open' ? (mine ? 'Tick when you have finished it' : `Waiting for ${t.assignee.nickname}`) : `Done ${t.doneAt ? relativeTime(t.doneAt) : ''}`}>
          <span>
            <Checkbox
              size="small"
              checked={t.status !== 'open'}
              disabled={!mine || t.status !== 'open' || busy}
              onChange={() => done.mutate()}
              icon={<RadioButtonUncheckedRounded fontSize="small" />}
              checkedIcon={<CheckCircleRounded fontSize="small" />}
              inputProps={{ 'aria-label': `Mark “${text}” done` }}
              sx={TICK_SX(TODO_COLORS.done)}
            />
          </span>
        </Tooltip>
        {!self && (
          <Tooltip
            title={
              t.status === 'completed'
                ? `Confirmed ${t.confirmedAt ? relativeTime(t.confirmedAt) : ''}`
                : iGave
                  ? t.status === 'done'
                    ? 'Confirm it is really done'
                    : 'Your tick, once they mark it done'
                  : `${t.createdBy.nickname} confirms it`
            }
          >
            <span>
              <Checkbox
                size="small"
                color="success"
                checked={t.status === 'completed'}
                disabled={!iGave || t.status !== 'done' || busy}
                onChange={() => confirm.mutate()}
                icon={<VerifiedOutlined fontSize="small" />}
                checkedIcon={<VerifiedRounded fontSize="small" />}
                inputProps={{ 'aria-label': `Confirm “${text}”` }}
                sx={TICK_SX(TODO_COLORS.completed)}
              />
            </span>
          </Tooltip>
        )}

        <Box sx={{ minWidth: 0, flex: 1, cursor: t.details || t.doneNote ? 'pointer' : 'default' }} onClick={() => setExpanded((e) => !e)}>
          <Typography
            variant="body2"
            noWrap={!expanded}
            title={text}
            sx={{
              fontWeight: t.title ? 550 : 400,
              textDecoration: t.status === 'completed' ? 'line-through' : 'none',
              color: t.status === 'completed' ? 'text.secondary' : 'text.primary',
              whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
              wordBreak: 'break-word',
            }}
          >
            {text}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {self ? '' : `${iGave ? 'by you' : `by ${t.createdBy.nickname}`} · `}
            <Tooltip title={formatDateTime(t.createdAt, zone)}>
              <span>{relativeTime(t.createdAt)}</span>
            </Tooltip>
            {t.doneNote ? ` · “${t.doneNote}”` : ''}
            {t.details && !expanded ? ' · details' : ''}
          </Typography>
        </Box>

        {t.conversationId && (
          <Tooltip title="Open the chat">
            <IconButton size="small" onClick={() => navigate(`/chat/${t.conversationId}`)} aria-label="Open the chat">
              <ChatBubbleOutlineRounded sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        )}
        {iGave && t.status !== 'open' && (
          <Tooltip title="Reopen: send it back">
            <IconButton size="small" onClick={onReopen} aria-label={`Reopen “${text}”`}>
              <ReplayRounded sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        )}
        {canDelete && (
          <Tooltip title={t.status === 'completed' ? 'Delete this finished task' : 'Delete this task'}>
            <IconButton size="small" onClick={() => remove.mutate()} disabled={busy} aria-label={`Delete “${text}”`}>
              <DeleteOutlineRounded sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      {expanded && t.details && (
        <Typography variant="body2" color="text.secondary" sx={{ pl: 5.5, pb: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {t.details}
        </Typography>
      )}
    </Box>
  );
}
