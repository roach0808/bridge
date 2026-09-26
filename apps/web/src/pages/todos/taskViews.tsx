import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import DragIndicatorRounded from '@mui/icons-material/DragIndicatorRounded';
import {
  Box,
  Card,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  COMPLETED_TASK_DAYS,
  TODO_STATUSES,
  TODO_STATUS_LABELS,
  isActiveTodo,
  type TodoDTO,
  type TodoPanel,
  type TodoStatus,
  type UserRef,
} from '@god/shared';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { EmptyState } from '@/components/common';
import { UserChip } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { TableSurface } from '../admin/adminShared';
import { StatusControl, UrgencyScore, formatWhen, urgencyOf } from './taskShared';
import { todoText } from './todoShared';

/**
 * One table of every task: who owns it, when to start, when it is due, what it
 * says, and where it stands — with a filter under each heading and a sort on
 * each heading. Nothing else. A task's full detail lives in the dialog a row
 * opens, out of the way until it is wanted.
 */

export const allTasks = (panels: TodoPanel[]): TodoDTO[] => panels.flatMap((p) => p.tasks);

/**
 * The columns worth sorting by, plus `order` — the order people have dragged
 * their tasks into, which is where the table starts. Sorting the words of a
 * task alphabetically tells nobody anything, so Description is not one of them.
 */
type Column = 'order' | 'owner' | 'start' | 'complete' | 'urgency' | 'status';

interface Filters {
  owner: string;
  /** A day: tasks starting on or after it. */
  start: string;
  /** A day: tasks due on or before it. */
  complete: string;
  text: string;
  /**
   * A status, `all`, or `active` — everything still going on. A task marked
   * Ready for Review is not finished: it waits for the person who gave it, and
   * has to stay in sight for them to act on. A task just completed stays for a
   * week too, so that finishing one never makes it vanish under your hand.
   */
  status: string;
}

export const NO_FILTERS: Filters = { owner: 'all', start: '', complete: '', text: '', status: 'active' };

export function TaskTable({ panels, onOpen }: { panels: TodoPanel[]; onOpen: (t: TodoDTO) => void }) {
  const me = useMe();
  const { zone } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  // Most pressing first: the question the table is usually asked.
  const [sort, setSort] = useState<{ by: Column; desc: boolean }>({ by: 'urgency', desc: true });
  const [dragging, setDragging] = useState<TodoDTO | null>(null);
  const tasks = useMemo(() => allTasks(panels), [panels]);
  const owners = useMemo(() => panels.map((p) => p.person), [panels]);

  const set = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const filtered = useMemo(() => tasks.filter((t) => matches(t, filters, zone)), [tasks, filters, zone]);
  // In `order` the rows keep the order they were dragged into — one group per
  // person, as the server sends them. A column sort is a different question.
  const rows = useMemo(
    () => (sort.by === 'order' ? filtered : [...filtered].sort(compare(sort.by, sort.desc, zone))),
    [filtered, sort, zone],
  );
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const draggable = sort.by === 'order';

  const sensors = useSensors(
    // A few pixels of movement, so a tap on the handle still behaves like a tap.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const setTasks = (update: (old: TodoPanel[]) => TodoPanel[]) =>
    queryClient.setQueryData<TodoPanel[]>(qk.todos.board('all'), (old) => (old ? update(old) : old));
  const onFailed = (err: unknown) => {
    toast.error(errorMessage(err));
    void queryClient.invalidateQueries({ queryKey: qk.todos.all });
  };
  const reorder = useMutation({ mutationFn: (v: { assigneeId: string; ids: string[] }) => api.todos.reorder(v), onError: onFailed });
  const handOver = useMutation({
    mutationFn: (v: { todo: TodoDTO; to: UserRef }) => api.todos.move(v.todo.id, v.to.id),
    onSuccess: (saved, v) => {
      toast.success(v.to.id === me.id ? 'Moved to your tasks' : `Handed to ${saved.assignee.nickname}`);
      void queryClient.invalidateQueries({ queryKey: qk.todos.all });
    },
    onError: onFailed,
  });

  const panelOf = (taskId: string) => panels.find((p) => p.tasks.some((t) => t.id === taskId));

  /**
   * Dropped on a row of your own, the task takes that place in your order.
   * Dropped on someone else's row, it is handed to them — the same two things
   * dragging always did.
   */
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over || active.id === over.id) return;
    const from = panelOf(String(active.id));
    const to = panelOf(String(over.id));
    const task = from?.tasks.find((t) => t.id === active.id);
    if (!from || !to || !task) return;

    if (to.person.id === from.person.id) {
      if (!from.isMe && !from.canGive) return;
      const list = from.tasks;
      const next = arrayMove(
        list,
        list.findIndex((t) => t.id === active.id),
        list.findIndex((t) => t.id === over.id),
      );
      setTasks((old) => old.map((p) => (p.person.id === from.person.id ? { ...p, tasks: next } : p)));
      reorder.mutate({ assigneeId: from.person.id, ids: next.map((t) => t.id) });
      return;
    }
    if (!canHandOn(task, me.id) || !to.canGive) {
      toast.info(
        task.conversationId ? 'A task from a chat stays with the person in that chat'
        : task.createdBy.id !== me.id ? 'Only the person who gave a task can hand it to someone else'
        : !isActiveTodo(task.status) ? 'Only unfinished tasks can be handed on'
        : `You cannot give tasks to ${to.person.nickname}`,
      );
      return;
    }
    setTasks((old) =>
      old.map((p) =>
        p.person.id === from.person.id ? { ...p, tasks: p.tasks.filter((t) => t.id !== task.id) }
        : p.person.id === to.person.id ? { ...p, tasks: [{ ...task, assignee: to.person }, ...p.tasks] }
        : p,
      ),
    );
    handOver.mutate({ todo: task, to: to.person });
  };

  const heading = (key: Column, label: string, width?: number) => (
    <TableCell key={key} sx={{ minWidth: width }}>
      <TableSortLabel
        active={sort.by === key}
        direction={sort.by === key && sort.desc ? 'desc' : 'asc'}
        IconComponent={ArrowDownwardRounded}
        onClick={() => setSort((s) => ({ by: key, desc: s.by === key ? !s.desc : false }))}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={({ active }) => setDragging(tasks.find((t) => t.id === active.id) ?? null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      {/* What follows the pointer, so a row can travel to another person. */}
      <DragOverlay>
        {dragging ? (
          <Card sx={{ px: 1.5, py: 1, boxShadow: 6, cursor: 'grabbing' }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <DragIndicatorRounded sx={{ fontSize: 17, color: 'text.disabled' }} />
              <Typography variant="body2" noWrap>
                {todoText(dragging)}
              </Typography>
            </Stack>
          </Card>
        ) : null}
      </DragOverlay>
      <TableSurface minWidth={1020}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell width={36} sx={{ px: 0.5 }}>
              <Tooltip title={draggable ? 'Rows are in the order they were dragged into' : 'Show the dragged order, so rows can be dragged again'}>
                <TableSortLabel
                  active={draggable}
                  hideSortIcon
                  onClick={() => setSort({ by: 'order', desc: false })}
                  sx={{ '& .MuiTableSortLabel-icon': { display: 'none' } }}
                >
                  <DragIndicatorRounded sx={{ fontSize: 17, color: draggable ? 'text.secondary' : 'text.disabled' }} />
                </TableSortLabel>
              </Tooltip>
            </TableCell>
            {heading('owner', 'Owner', 150)}
            {heading('start', 'Start', 130)}
            {heading('complete', 'End date', 140)}
            {heading('urgency', 'Urgency', 84)}
            <TableCell sx={{ minWidth: 280 }}>Description</TableCell>
            {heading('status', 'Status', 150)}
          </TableRow>
          <TableRow>
            <TableCell sx={{ py: 0.5 }} />
            <TableCell sx={{ py: 0.5 }}>
              <Filter value={filters.owner} onChange={(v) => set('owner', v)} select>
                <MenuItem value="all">Anyone</MenuItem>
                {owners.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.nickname}
                  </MenuItem>
                ))}
              </Filter>
            </TableCell>
            <TableCell sx={{ py: 0.5 }}>
              <Filter type="date" value={filters.start} onChange={(v) => set('start', v)} title="Starting on or after" />
            </TableCell>
            <TableCell sx={{ py: 0.5 }}>
              <Filter type="date" value={filters.complete} onChange={(v) => set('complete', v)} title="Due on or before" />
            </TableCell>
            <TableCell sx={{ py: 0.5 }} />
            <TableCell sx={{ py: 0.5 }}>
              <Filter value={filters.text} onChange={(v) => set('text', v)} placeholder="Search" />
            </TableCell>
            <TableCell sx={{ py: 0.5 }}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Filter value={filters.status} onChange={(v) => set('status', v)} select>
                  <MenuItem value="active">Active</MenuItem>
                  <MenuItem value="all">Any status</MenuItem>
                  {TODO_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>
                      {TODO_STATUS_LABELS[s]}
                    </MenuItem>
                  ))}
                </Filter>
                {filtering && (
                  <Tooltip title="Clear every filter">
                    <Typography
                      variant="caption"
                      onClick={() => setFilters(NO_FILTERS)}
                      sx={{ cursor: 'pointer', color: 'primary.main', whiteSpace: 'nowrap' }}
                      role="button"
                    >
                      Clear
                    </Typography>
                  </Tooltip>
                )}
              </Stack>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} sx={{ border: 0 }}>
                <Card variant="outlined">
                  <EmptyState
                    icon={<ChecklistRounded />}
                    title={filtering ? 'No tasks match' : 'No tasks yet'}
                    description={filtering ? 'Change or clear the filters above.' : undefined}
                  />
                </Card>
              </TableCell>
            </TableRow>
          ) : (
            <SortableContext items={rows.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {rows.map((t) => (
                <TaskRow key={t.id} todo={t} draggable={draggable} onOpen={() => onOpen(t)} />
              ))}
            </SortableContext>
          )}
        </TableBody>
      </Table>
      </TableSurface>
    </DndContext>
  );
}

/** One small control under a heading; they all look and behave the same. */
function Filter({
  value,
  onChange,
  select,
  type,
  placeholder,
  title,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  select?: boolean;
  type?: string;
  placeholder?: string;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <Tooltip title={title ?? ''}>
      <TextField
        select={select}
        type={type}
        size="small"
        variant="standard"
        fullWidth
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        slotProps={{ input: { disableUnderline: false }, htmlInput: { 'aria-label': title ?? placeholder } }}
        sx={{ '& .MuiInputBase-input': { fontSize: '0.78rem', py: 0.25 } }}
      >
        {children}
      </TextField>
    </Tooltip>
  );
}

function TaskRow({ todo: t, draggable, onOpen }: { todo: TodoDTO; draggable: boolean; onOpen: () => void }) {
  const { zone } = useAuth();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, disabled: !draggable });
  const overdue = t.completeByAt !== null && isActiveTodo(t.status) && new Date(t.completeByAt).getTime() < Date.now();
  const text = todoText(t);
  return (
    <TableRow
      hover
      ref={setNodeRef}
      sx={{ cursor: 'pointer', position: 'relative', zIndex: isDragging ? 2 : undefined, opacity: isDragging ? 0.35 : 1 }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onOpen}
    >
      <TableCell onClick={(e) => e.stopPropagation()} sx={{ px: 0.5 }}>
        {draggable ? (
          <Tooltip title="Drag to reorder, or onto someone else’s row to hand it to them">
            <IconButton
              size="small"
              aria-label={`Move “${text}”`}
              {...attributes}
              {...listeners}
              sx={{ cursor: 'grab', touchAction: 'none', color: 'text.disabled', p: 0.25, '&:active': { cursor: 'grabbing' } }}
            >
              <DragIndicatorRounded sx={{ fontSize: 17 }} />
            </IconButton>
          </Tooltip>
        ) : null}
      </TableCell>
      <TableCell>
        <UserChip user={t.assignee} size={22} showRole={false} />
      </TableCell>
      <TableCell>
        <Typography variant="body2" color={t.startByAt ? 'text.primary' : 'text.disabled'} noWrap>
          {t.startByAt ? formatWhen(t.startByAt, t.startByHasTime, zone) : '—'}
        </Typography>
      </TableCell>
      <TableCell>
        <Tooltip title={overdue ? 'Past its end date' : ''}>
          <Typography
            variant="body2"
            noWrap
            sx={{ color: overdue ? 'error.main' : t.completeByAt ? 'text.primary' : 'text.disabled', fontWeight: overdue ? 700 : 400 }}
          >
            {t.completeByAt ? formatWhen(t.completeByAt, t.completeByHasTime, zone) : '—'}
          </Typography>
        </Tooltip>
      </TableCell>
      <TableCell>
        <UrgencyScore score={urgencyOf(t, zone)} />
      </TableCell>
      <TableCell>
        <Typography
          variant="body2"
          noWrap
          title={t.details ? `${text}\n\n${t.details}` : text}
          sx={{
            textDecoration: t.status === 'completed' ? 'line-through' : 'none',
            color: t.status === 'completed' ? 'text.secondary' : 'text.primary',
          }}
        >
          {text}
        </Typography>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <StatusControl todo={t} />
      </TableCell>
    </TableRow>
  );
}

/** Finished, but recently enough that it is still worth seeing. */
const justCompleted = (t: TodoDTO) =>
  t.confirmedAt !== null && Date.now() - new Date(t.confirmedAt).getTime() < COMPLETED_TASK_DAYS * 24 * 60 * 60 * 1000;

/** The giver hands an unfinished task on; one from a chat stays with that chat. */
const canHandOn = (t: TodoDTO, meId: string) => t.createdBy.id === meId && isActiveTodo(t.status) && !t.conversationId;

/** A day the reader typed, as the first moment of that day in their own zone. */
const dayStart = (day: string, zone: string) => new Date(`${day}T00:00:00`).getTime() && startOfDayMs(day, zone);
const startOfDayMs = (day: string, zone: string) => {
  const [y, m, d] = day.split('-').map(Number);
  // Compared against instants, so the reader's own day is what counts.
  return new Date(new Date(Date.UTC(y!, m! - 1, d!)).toLocaleString('en-US', { timeZone: zone })).getTime();
};

function matches(t: TodoDTO, f: Filters, zone: string): boolean {
  if (f.owner !== 'all' && t.assignee.id !== f.owner) return false;
  if (f.status === 'active') {
    if (t.status === 'completed' && !justCompleted(t)) return false;
  } else if (f.status !== 'all' && t.status !== f.status) return false;
  if (f.start) {
    if (!t.startByAt) return false;
    if (new Date(t.startByAt).getTime() < dayStart(f.start, zone)) return false;
  }
  if (f.complete) {
    if (!t.completeByAt) return false;
    // "on or before" that day, so the whole of it counts.
    if (new Date(t.completeByAt).getTime() >= dayStart(f.complete, zone) + 86_400_000) return false;
  }
  if (f.text) {
    const haystack = `${todoText(t)} ${t.details ?? ''} ${t.assignee.nickname} ${t.expectedDeliverable ?? ''}`.toLowerCase();
    if (!haystack.includes(f.text.toLowerCase())) return false;
  }
  return true;
}

const STATUS_ORDER: Record<TodoStatus, number> = { open: 0, in_progress: 1, blocked: 2, done: 3, completed: 4 };

/** A column's order. A task with no date sorts last, whichever way the column runs. */
function compare(by: Column, desc: boolean, zone: string) {
  const dates = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
  return (x: TodoDTO, y: TodoDTO) => {
    const flip = desc ? -1 : 1;
    const undated = by === 'start' ? dates(x.startByAt, y.startByAt) : by === 'complete' ? dates(x.completeByAt, y.completeByAt) : 0;
    switch (by) {
      case 'urgency': {
        const ux = urgencyOf(x, zone);
        const uy = urgencyOf(y, zone);
        // Nothing pressing sorts last either way, not to the top of an ascending list.
        if ((ux === null) !== (uy === null)) return ux === null ? 1 : -1;
        return ux === null || uy === null ? x.createdAt.localeCompare(y.createdAt) : flip * (ux - uy) || x.createdAt.localeCompare(y.createdAt);
      }
      case 'owner':
        return flip * x.assignee.nickname.localeCompare(y.assignee.nickname);
      case 'status':
        return flip * (STATUS_ORDER[x.status] - STATUS_ORDER[y.status]);
      default:
        // A dateless task stays at the bottom either way: it is not the oldest.
        return (x.startByAt === null) !== (y.startByAt === null) || (x.completeByAt === null) !== (y.completeByAt === null)
          ? undated
          : flip * undated || x.createdAt.localeCompare(y.createdAt);
    }
  };
}

export type { Filters };
