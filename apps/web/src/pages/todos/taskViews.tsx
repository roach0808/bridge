import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import {
  Box,
  Card,
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
import { TODO_STATUSES, TODO_STATUS_LABELS, isActiveTodo, type TodoDTO, type TodoPanel, type TodoStatus } from '@god/shared';
import { useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState } from '@/components/common';
import { UserChip } from '@/components/identity';
import { TableSurface } from '../admin/adminShared';
import { StatusControl, formatWhen } from './taskShared';
import { todoText } from './todoShared';

/**
 * One table of every task: who owns it, when to start, when it is due, what it
 * says, and where it stands — with a filter under each heading and a sort on
 * each heading. Nothing else. A task's full detail lives in the dialog a row
 * opens, out of the way until it is wanted.
 */

export const allTasks = (panels: TodoPanel[]): TodoDTO[] => panels.flatMap((p) => p.tasks);

/** The columns worth sorting by. Sorting the words of a task alphabetically
 * tells nobody anything, so Description is not one of them. */
type Column = 'owner' | 'start' | 'complete' | 'status';

interface Filters {
  owner: string;
  /** A day: tasks starting on or after it. */
  start: string;
  /** A day: tasks due on or before it. */
  complete: string;
  text: string;
  /** A status, `active` for everything unfinished, or `all`. */
  status: string;
}

export const NO_FILTERS: Filters = { owner: 'all', start: '', complete: '', text: '', status: 'active' };

export function TaskTable({ panels, onOpen }: { panels: TodoPanel[]; onOpen: (t: TodoDTO) => void }) {
  const { zone } = useAuth();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ by: Column; desc: boolean }>({ by: 'start', desc: false });
  const tasks = useMemo(() => allTasks(panels), [panels]);
  const owners = useMemo(() => panels.map((p) => p.person), [panels]);

  const set = (key: keyof Filters, value: string) => setFilters((f) => ({ ...f, [key]: value }));
  const filtered = useMemo(() => tasks.filter((t) => matches(t, filters, zone)), [tasks, filters, zone]);
  const rows = useMemo(() => [...filtered].sort(compare(sort.by, sort.desc, zone)), [filtered, sort, zone]);
  const filtering = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);

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
    <TableSurface minWidth={900}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            {heading('owner', 'Owner', 150)}
            {heading('start', 'Start', 130)}
            {heading('complete', 'End date', 140)}
            <TableCell sx={{ minWidth: 280 }}>Description</TableCell>
            {heading('status', 'Status', 150)}
          </TableRow>
          <TableRow>
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
            <TableCell sx={{ py: 0.5 }}>
              <Filter value={filters.text} onChange={(v) => set('text', v)} placeholder="Search" />
            </TableCell>
            <TableCell sx={{ py: 0.5 }}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Filter value={filters.status} onChange={(v) => set('status', v)} select>
                  <MenuItem value="active">Unfinished</MenuItem>
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
              <TableCell colSpan={5} sx={{ border: 0 }}>
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
            rows.map((t) => <TaskRow key={t.id} todo={t} onOpen={() => onOpen(t)} />)
          )}
        </TableBody>
      </Table>
    </TableSurface>
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

function TaskRow({ todo: t, onOpen }: { todo: TodoDTO; onOpen: () => void }) {
  const { zone } = useAuth();
  const overdue = t.completeByAt !== null && isActiveTodo(t.status) && new Date(t.completeByAt).getTime() < Date.now();
  const text = todoText(t);
  return (
    <TableRow hover sx={{ cursor: 'pointer' }} onClick={onOpen}>
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
        <Typography variant="body2" noWrap title={t.details ? `${text}\n\n${t.details}` : text}>
          {text}
        </Typography>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <StatusControl todo={t} />
      </TableCell>
    </TableRow>
  );
}

/** A day the reader typed, as the first moment of that day in their own zone. */
const dayStart = (day: string, zone: string) => new Date(`${day}T00:00:00`).getTime() && startOfDayMs(day, zone);
const startOfDayMs = (day: string, zone: string) => {
  const [y, m, d] = day.split('-').map(Number);
  // Compared against instants, so the reader's own day is what counts.
  return new Date(new Date(Date.UTC(y!, m! - 1, d!)).toLocaleString('en-US', { timeZone: zone })).getTime();
};

function matches(t: TodoDTO, f: Filters, zone: string): boolean {
  if (f.owner !== 'all' && t.assignee.id !== f.owner) return false;
  if (f.status === 'active' ? !isActiveTodo(t.status) : f.status !== 'all' && t.status !== f.status) return false;
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
function compare(by: Column, desc: boolean, _zone: string) {
  const dates = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);
  return (x: TodoDTO, y: TodoDTO) => {
    const flip = desc ? -1 : 1;
    const undated = by === 'start' ? dates(x.startByAt, y.startByAt) : by === 'complete' ? dates(x.completeByAt, y.completeByAt) : 0;
    switch (by) {
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
