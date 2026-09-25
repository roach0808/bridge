import BlockRounded from '@mui/icons-material/BlockRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import RadioButtonUncheckedRounded from '@mui/icons-material/RadioButtonUncheckedRounded';
import {
  Box,
  Card,
  Checkbox,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  byDeadline,
  byExecution,
  isActiveTodo,
  type TodoDTO,
  type TodoPanel,
} from '@god/shared';
import { useMemo } from 'react';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { EmptyState } from '@/components/common';
import { UserChip } from '@/components/identity';
import { TableSurface } from '../admin/adminShared';
import { PriorityChip, ProgressSelect, RiskChip, TaskWhen, daysUntil, formatWhen, riskOf } from './taskShared';
import { todoText, useTaskActions } from './todoShared';

/**
 * The two lists the whole system turns on (§4, §5).
 *
 * The execution view answers "what should we be working on now?" and is sorted
 * by Start By. The deadline view answers "what must be finished soon?" and is
 * sorted by Complete By. They are deliberately different orders of the same
 * tasks: a deadline is not a start date.
 */

export type TaskView = 'execution' | 'deadline' | 'today' | 'board';

/** Every task on the board, flattened — the two views are orderings of this. */
export const allTasks = (panels: TodoPanel[]): TodoDTO[] => panels.flatMap((p) => p.tasks);

export function TaskList({ panels, view, onOpen }: { panels: TodoPanel[]; view: 'execution' | 'deadline'; onOpen: (t: TodoDTO) => void }) {
  const me = useMe();
  const tasks = useMemo(() => [...allTasks(panels)].sort(view === 'execution' ? byExecution : byDeadline), [panels, view]);
  const several = panels.length > 1;

  if (tasks.length === 0) {
    return (
      <Card>
        <EmptyState icon={<ChecklistRounded />} title="Nothing here" description="No tasks match this filter." />
      </Card>
    );
  }
  return (
    <TableSurface minWidth={880}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell width={44} />
            <TableCell sx={{ minWidth: 240 }}>Task</TableCell>
            {several && <TableCell sx={{ minWidth: 130 }}>Owner</TableCell>}
            <TableCell sx={{ minWidth: 150 }}>Start By</TableCell>
            <TableCell sx={{ minWidth: 170 }}>Complete By</TableCell>
            <TableCell width={64}>Priority</TableCell>
            <TableCell sx={{ minWidth: 130 }}>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {tasks.map((t) => (
            <TaskLine key={t.id} todo={t} showOwner={several} meId={me.id} onOpen={() => onOpen(t)} />
          ))}
        </TableBody>
      </Table>
    </TableSurface>
  );
}

function TaskLine({ todo: t, showOwner, meId, onOpen }: { todo: TodoDTO; showOwner: boolean; meId: string; onOpen: () => void }) {
  const { zone } = useAuth();
  const { done, setStatus, busy, blockDialog } = useTaskActions(t);
  const mine = t.assignee.id === meId;
  const risk = riskOf(t, zone);
  const text = todoText(t);

  return (
    <TableRow hover sx={{ cursor: 'pointer' }} onClick={onOpen}>
      <TableCell onClick={(e) => e.stopPropagation()} sx={{ pr: 0 }}>
        <Tooltip title={mine && isActiveTodo(t.status) ? 'Tick when you have finished it' : ''}>
          <span>
            <Checkbox
              size="small"
              checked={!isActiveTodo(t.status)}
              disabled={!mine || !isActiveTodo(t.status) || busy}
              onChange={() => done.mutate(undefined)}
              icon={<RadioButtonUncheckedRounded fontSize="small" />}
              checkedIcon={<CheckCircleRounded fontSize="small" />}
              inputProps={{ 'aria-label': `Mark “${text}” done` }}
              sx={{ p: 0.5 }}
            />
          </span>
        </Tooltip>
      </TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 550, textDecoration: t.status === 'completed' ? 'line-through' : 'none' }} noWrap title={text}>
          {text}
        </Typography>
        {t.blockedReason && (
          <Typography variant="caption" sx={{ color: 'error.main', display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
            <BlockRounded sx={{ fontSize: 13 }} />
            {t.blockedReason}
          </Typography>
        )}
        {t.dependsOn.length > 0 && (
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            Waits for {t.dependsOn.map((d) => d.title).join(', ')}
          </Typography>
        )}
      </TableCell>
      {showOwner && (
        <TableCell>
          <UserChip user={t.assignee} size={20} showRole={false} />
        </TableCell>
      )}
      <TableCell>
        <StartCell todo={t} />
      </TableCell>
      <TableCell>
        <DueCell todo={t} />
      </TableCell>
      <TableCell>
        <PriorityChip todo={t} />
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <ProgressSelect status={t.status} disabled={!mine || busy} onChange={setStatus} />
          <RiskChip risk={risk} />
          {blockDialog}
        </Stack>
      </TableCell>
    </TableRow>
  );
}

function StartCell({ todo }: { todo: TodoDTO }) {
  const { zone } = useAuth();
  if (!todo.startByAt) {
    return (
      <Tooltip title="No start date assigned. Team member may not know when to begin this task.">
        <Typography variant="caption" sx={{ color: todo.completeByAt ? 'warning.main' : 'text.disabled', fontWeight: todo.completeByAt ? 600 : 400 }}>
          {todo.completeByAt ? 'Not set' : '—'}
        </Typography>
      </Tooltip>
    );
  }
  const days = daysUntil(todo.startByAt, zone);
  return (
    <Box>
      <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 600 }} noWrap>
        {formatWhen(todo.startByAt, todo.startByHasTime, zone)}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {days < 0 ? 'started' : days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}
      </Typography>
    </Box>
  );
}

function DueCell({ todo }: { todo: TodoDTO }) {
  const { zone } = useAuth();
  if (!todo.completeByAt) {
    return (
      <Typography variant="caption" color="text.disabled">
        —
      </Typography>
    );
  }
  return (
    <Box>
      <Typography variant="body2" fontWeight={600} noWrap>
        {formatWhen(todo.completeByAt, todo.completeByHasTime, zone)}
      </Typography>
      {todo.timeZone !== zone && todo.completeByHasTime && (
        <Typography variant="caption" color="text.secondary" noWrap>
          {formatWhen(todo.completeByAt, true, todo.timeZone)} for {todo.assignee.nickname}
        </Typography>
      )}
    </Box>
  );
}

/**
 * "What should everyone work on today?" (§21): each person's tasks that have
 * started and are not finished, most pressing first, with the counts a manager
 * needs to step in (§11).
 */
export function TodayView({ panels, onOpen }: { panels: TodoPanel[]; onOpen: (t: TodoDTO) => void }) {
  const { zone } = useAuth();
  const me = useMe();
  const started = (t: TodoDTO) => isActiveTodo(t.status) && (!t.startByAt || daysUntil(t.startByAt, zone) <= 0);
  const withWork = panels
    .map((p) => ({ panel: p, tasks: p.tasks.filter(started).sort(byExecution) }))
    .filter((p) => p.tasks.length > 0);
  const everything = allTasks(panels);
  const manager = panels.length > 1;

  return (
    <Stack spacing={2}>
      {manager && <TeamWorkload panels={panels} />}
      {withWork.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ChecklistRounded />}
            title="Nothing has started yet"
            description={
              everything.some((t) => isActiveTodo(t.status))
                ? 'Every task still to do starts on a later day.'
                : 'No tasks are waiting to be worked on.'
            }
          />
        </Card>
      ) : (
        withWork.map(({ panel, tasks }) => (
          <Card key={panel.person.id} sx={{ p: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <UserChip user={panel.person} size={24} showRole={false} />
              <Typography variant="caption" color="text.secondary">
                {panel.isMe ? 'you' : panel.person.nickname === me.nickname ? '' : ''} {tasks.length} to work on
              </Typography>
            </Stack>
            <Stack spacing={0.75}>
              {tasks.map((t) => (
                <Stack
                  key={t.id}
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  useFlexGap
                  flexWrap="wrap"
                  sx={{ cursor: 'pointer' }}
                  onClick={() => onOpen(t)}
                >
                  <PriorityChip todo={t} />
                  <Typography variant="body2" sx={{ fontWeight: 550 }}>
                    {todoText(t)}
                  </Typography>
                  <TaskWhen todo={t} compact />
                </Stack>
              ))}
            </Stack>
          </Card>
        ))
      )}
    </Stack>
  );
}

/** Who is carrying what, and where a manager needs to step in (§11). */
function TeamWorkload({ panels }: { panels: TodoPanel[] }) {
  const { zone } = useAuth();
  const rows = panels.map((p) => {
    const active = p.tasks.filter((t) => isActiveTodo(t.status));
    return {
      person: p.person,
      active: active.length,
      dueToday: active.filter((t) => t.completeByAt && daysUntil(t.completeByAt, zone) === 0).length,
      overdue: active.filter((t) => riskOf(t, zone) === 'overdue').length,
      blocked: p.tasks.filter((t) => t.status === 'blocked').length,
      review: p.tasks.filter((t) => t.status === 'done').length,
    };
  });
  if (rows.every((r) => r.active === 0 && r.review === 0)) return null;

  return (
    <TableSurface minWidth={520}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Member</TableCell>
            <TableCell align="right">Active</TableCell>
            <TableCell align="right">Due today</TableCell>
            <TableCell align="right">Overdue</TableCell>
            <TableCell align="right">Blocked</TableCell>
            <TableCell align="right">Ready for review</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.person.id} hover>
              <TableCell>
                <UserChip user={r.person} size={22} showRole={false} />
              </TableCell>
              <TableCell align="right">{r.active}</TableCell>
              <TableCell align="right">{r.dueToday || '—'}</TableCell>
              <TableCell align="right" sx={{ color: r.overdue ? 'error.main' : undefined, fontWeight: r.overdue ? 700 : undefined }}>
                {r.overdue || '—'}
              </TableCell>
              <TableCell align="right" sx={{ color: r.blocked ? 'error.main' : undefined, fontWeight: r.blocked ? 700 : undefined }}>
                {r.blocked || '—'}
              </TableCell>
              <TableCell align="right" sx={{ color: r.review ? 'warning.main' : undefined, fontWeight: r.review ? 700 : undefined }}>
                {r.review || '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableSurface>
  );
}

