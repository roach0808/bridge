import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import { Box, MenuItem, Select, Stack, Tooltip, Typography } from '@mui/material';
import {
  TODO_PRIORITY_LABELS,
  TODO_PRIORITY_SHORT,
  TODO_RISK_LABELS,
  TODO_STATUS_LABELS,
  needsStartDate,
  priorityOf,
  taskRisk,
  type TodoDTO,
  type TodoPriority,
  type TodoRisk,
  type TodoStatus,
} from '@god/shared';
import { DateTime } from 'luxon';
import { useAuth } from '@/auth/AuthProvider';
import { inZone, zoneAbbr } from '@/lib/time';

/**
 * Start By and Complete By, never folded into one "due date". Start By is when
 * to begin; Complete By is the moment the work must already be finished. The
 * whole point of the task board is that a reader can tell them apart at a
 * glance, so they are shown with their own words and their own colours.
 */

/** Whole days between now and a moment, counted in the reader's own days. */
export function daysUntil(iso: string, zone: string): number {
  const due = inZone(iso, zone).startOf('day');
  return Math.round(due.diff(DateTime.now().setZone(zone).startOf('day'), 'days').days);
}

/** "Thu, Mar 4" for a day, "Fri 6:00 PM IST" when a time of day was given. */
export function formatWhen(iso: string, hasTime: boolean, zone: string): string {
  const dt = inZone(iso, zone);
  return hasTime ? `${dt.toFormat('ccc, LLL d, h:mm a')} ${zoneAbbr(zone, dt)}` : dt.toFormat('ccc, LLL d');
}

export function riskOf(todo: TodoDTO, zone: string): TodoRisk | null {
  return taskRisk({
    status: todo.status,
    completeByAt: todo.completeByAt,
    daysUntilDue: todo.completeByAt ? daysUntil(todo.completeByAt, zone) : null,
  });
}

const RISK_COLOR: Record<TodoRisk, string> = {
  overdue: 'error.main',
  high_risk: 'error.main',
  at_risk: 'warning.main',
  on_track: 'success.main',
};

/** Only a deadline in trouble says anything; work in hand stays quiet. */
export function RiskChip({ risk, always }: { risk: TodoRisk | null; always?: boolean }) {
  if (!risk || (risk === 'on_track' && !always)) return null;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.4,
        px: 0.75,
        height: 19,
        borderRadius: 999,
        fontSize: '0.68rem',
        fontWeight: 700,
        color: RISK_COLOR[risk],
        border: 1,
        borderColor: RISK_COLOR[risk],
        whiteSpace: 'nowrap',
      }}
    >
      {risk !== 'on_track' && <ErrorOutlineRounded sx={{ fontSize: 13 }} />}
      {TODO_RISK_LABELS[risk]}
    </Box>
  );
}

const PRIORITY_COLOR: Record<TodoPriority, string> = { p1: 'error.main', p2: 'warning.main', p3: 'text.disabled' };

/** P1, P2 or P3 — which follows from the quadrant the task sits in. */
export function PriorityChip({ todo }: { todo: Pick<TodoDTO, 'urgency' | 'importance'> }) {
  const priority = priorityOf(todo);
  return (
    <Tooltip title={`${TODO_PRIORITY_LABELS[priority]} — from “${labelOfQuadrant(todo)}”`}>
      <Box
        component="span"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35, fontSize: '0.72rem', fontWeight: 700, color: PRIORITY_COLOR[priority] }}
      >
        <FlagOutlined sx={{ fontSize: 13 }} />
        {TODO_PRIORITY_SHORT[priority]}
      </Box>
    </Tooltip>
  );
}

const labelOfQuadrant = (t: Pick<TodoDTO, 'urgency' | 'importance'>) =>
  `${t.urgency === 'need_action' ? 'Need action' : 'Can wait'} · ${t.importance === 'strategic' ? 'Strategic' : 'Non strategic'}`;

/**
 * When to begin, and when it must be finished. Shown as two labelled things,
 * because a deadline read as a start date is the mistake this prevents.
 */
export function TaskWhen({ todo, compact }: { todo: TodoDTO; compact?: boolean }) {
  const { zone } = useAuth();
  const own = todo.timeZone;
  const risk = riskOf(todo, zone);
  if (!todo.startByAt && !todo.completeByAt) {
    return compact ? null : (
      <Typography variant="caption" color="text.disabled">
        No dates
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" useFlexGap flexWrap="wrap">
      {todo.startByAt && (
        <Tooltip title={`Start By — begin work no later than this${own === zone ? '' : ` (${formatWhen(todo.startByAt, todo.startByHasTime, own)} for them)`}`}>
          <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <PlayArrowRounded sx={{ fontSize: 12, verticalAlign: '-1px' }} /> {formatWhen(todo.startByAt, todo.startByHasTime, zone)}
          </Typography>
        </Tooltip>
      )}
      {todo.completeByAt && (
        <Tooltip title={`Complete By — finished by this moment${own === zone ? '' : ` (${formatWhen(todo.completeByAt, todo.completeByHasTime, own)} for them)`}`}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Due {formatWhen(todo.completeByAt, todo.completeByHasTime, zone)}
          </Typography>
        </Tooltip>
      )}
      <RiskChip risk={risk} />
      {needsStartDate(todo) && (
        <Tooltip title="No start date assigned. Team member may not know when to begin this task.">
          <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 600, whiteSpace: 'nowrap' }}>
            No start date
          </Typography>
        </Tooltip>
      )}
    </Stack>
  );
}

const STATUS_COLOR: Record<TodoStatus, string> = {
  open: 'text.secondary',
  in_progress: 'info.main',
  blocked: 'error.main',
  done: 'warning.main',
  completed: 'success.main',
};

export function StatusPill({ status }: { status: TodoStatus }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        px: 0.9,
        height: 20,
        borderRadius: 999,
        bgcolor: 'action.selected',
        color: STATUS_COLOR[status],
        fontSize: '0.7rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {TODO_STATUS_LABELS[status]}
    </Box>
  );
}

/**
 * The owner says where the work stands. Finishing is not here: that asks the
 * giver to verify, and belongs with the tick.
 */
export function ProgressSelect({
  status,
  disabled,
  onChange,
}: {
  status: TodoStatus;
  disabled?: boolean;
  onChange: (status: 'open' | 'in_progress' | 'blocked') => void;
}) {
  const finished = status === 'done' || status === 'completed';
  if (finished) return <StatusPill status={status} />;
  return (
    <Select
      size="small"
      variant="standard"
      disableUnderline
      value={status}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as 'open' | 'in_progress' | 'blocked')}
      renderValue={(v) => <StatusPill status={v as TodoStatus} />}
      inputProps={{ 'aria-label': 'Where the work stands' }}
      sx={{ '& .MuiSelect-select': { py: 0.25, display: 'flex', alignItems: 'center' } }}
    >
      {(['open', 'in_progress', 'blocked'] as const).map((s) => (
        <MenuItem key={s} value={s}>
          <StatusPill status={s} />
        </MenuItem>
      ))}
    </Select>
  );
}
