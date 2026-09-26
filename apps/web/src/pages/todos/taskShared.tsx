import { Box, MenuItem, Select, Tooltip, Typography } from '@mui/material';
import { TODO_STATUS_LABELS, isActiveTodo, isSelfTask, urgencyFromDays, type TodoDTO, type TodoStatus } from '@god/shared';
import { DateTime } from 'luxon';
import { useMe } from '@/auth/AuthProvider';
import { inZone, zoneAbbr } from '@/lib/time';
import { useTaskActions } from './todoShared';

/**
 * The two pieces of a task the table draws itself from: when its dates fall,
 * and where the work stands. Start and end date are separate fields, and the
 * table keeps them in separate columns, because a deadline is not a start date.
 */

/** Whole days between two moments, counted in the reader's own days. */
export function daysBetween(fromIso: string, toIso: string, zone: string): number {
  const from = inZone(fromIso, zone).startOf('day');
  return Math.round(inZone(toIso, zone).startOf('day').diff(from, 'days').days);
}

/** Whole days from today to a moment, in the reader's own days. */
export const daysUntil = (iso: string, zone: string) => daysBetween(DateTime.now().setZone(zone).toISO()!, iso, zone);

/**
 * How pressing a task is, 0–100 (`urgencyFromDays`). Measured over the time the
 * task was given: from its start date to its end date, or, when nobody set a
 * start, from the day it was written down.
 *
 * The period counts both ends — a task that starts and ends on the same day was
 * given one day, not none — so no task is ever measured against a period of
 * zero. A task with no end date, and a task already completed, is not pressing
 * at all.
 */
export function urgencyOf(todo: TodoDTO, zone: string): number | null {
  if (!todo.completeByAt || todo.status === 'completed') return null;
  const total = daysBetween(todo.startByAt ?? todo.createdAt, todo.completeByAt, zone) + 1;
  return urgencyFromDays(daysUntil(todo.completeByAt, zone), total);
}

/** The number itself, loud when the deadline is close and quiet when it is not. */
export function UrgencyScore({ score }: { score: number | null }) {
  if (score === null) {
    return (
      <Typography variant="body2" color="text.disabled">
        —
      </Typography>
    );
  }
  const color = score >= 90 ? 'error.main' : score >= 60 ? 'warning.main' : score >= 30 ? 'text.primary' : 'text.secondary';
  return (
    <Tooltip title={`${score} of 100 — how much of this task's time has gone`}>
      <Typography variant="body2" sx={{ color, fontWeight: score >= 60 ? 700 : 500, fontVariantNumeric: 'tabular-nums' }}>
        {score}
      </Typography>
    </Tooltip>
  );
}

/** "Thu, Mar 4" for a day, "Fri 6:00 PM IST" when a time of day was given. */
export function formatWhen(iso: string, hasTime: boolean, zone: string): string {
  const dt = inZone(iso, zone);
  return hasTime ? `${dt.toFormat('ccc, LLL d, h:mm a')} ${zoneAbbr(zone, dt)}` : dt.toFormat('ccc, LLL d');
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
 * Where the work stands, as one control. The owner moves it along — not
 * started, in progress, blocked, or finished and ready to be checked — and
 * whoever gave the task confirms it or sends it back. Blocked asks why first.
 * Everyone else reads the pill.
 */
export function StatusControl({ todo }: { todo: TodoDTO }) {
  const me = useMe();
  const { setStatus, done, confirm, reopen, busy, blockDialog } = useTaskActions(todo);
  const mine = todo.assignee.id === me.id;
  const iGave = todo.createdBy.id === me.id;
  // A task you gave yourself has nobody to review it: ticking it finishes it,
  // so the choice has to say Completed rather than Ready for Review.
  const self = isSelfTask(todo);

  // What this person can turn this task into, from where it is now.
  const options: TodoStatus[] = [];
  if (mine && isActiveTodo(todo.status)) options.push('open', 'in_progress', 'blocked', self ? 'completed' : 'done');
  if (iGave && todo.status === 'done') options.push('done', 'completed', 'open');
  if (iGave && todo.status === 'completed') options.push('completed', 'open');
  const choices = [...new Set(options)];
  if (choices.length < 2) return <StatusPill status={todo.status} />;

  const go = (next: TodoStatus) => {
    if (next === todo.status) return;
    if (next === 'done') return void done.mutate(undefined);
    // Finishing your own task is the same tick; only a giver confirms someone else's.
    if (next === 'completed') return void (isActiveTodo(todo.status) ? done.mutate(undefined) : confirm.mutate());
    if (todo.status === 'done' || todo.status === 'completed') return void reopen.mutate();
    setStatus(next as 'open' | 'in_progress' | 'blocked');
  };

  return (
    <>
      <Select
        size="small"
        variant="standard"
        disableUnderline
        value={todo.status}
        disabled={busy}
        onChange={(e) => go(e.target.value as TodoStatus)}
        renderValue={(v) => <StatusPill status={v as TodoStatus} />}
        inputProps={{ 'aria-label': 'Status' }}
        sx={{ '& .MuiSelect-select': { py: 0.25, display: 'flex', alignItems: 'center' } }}
      >
        {choices.map((s) => (
          <MenuItem key={s} value={s}>
            <StatusPill status={s} />
          </MenuItem>
        ))}
      </Select>
      {blockDialog}
    </>
  );
}
