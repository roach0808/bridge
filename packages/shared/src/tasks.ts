import { DEFAULT_TODO_IMPORTANCE, DEFAULT_TODO_URGENCY, type TodoImportance, type TodoStatus, type TodoUrgency } from './chat';

/**
 * Start By controls execution; Complete By controls accountability.
 *
 * Start By is the day work should begin, Complete By the moment it must already
 * be finished. A deadline read as a start date is the mistake this whole model
 * exists to prevent, so the two are separate fields everywhere — stored,
 * sorted, and shown — and never folded into one "due date".
 */

// --- Status --------------------------------------------------------------------

/**
 * The five states a task moves through. The stored names are older than the
 * words on screen: `open` is a task not started, and `done` is the assignee
 * saying it is finished and waiting to be verified.
 */
export const TODO_STATUS_LABELS: Record<TodoStatus, string> = {
  open: 'Not Started',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Ready for Review',
  completed: 'Completed',
};

/** Work that is still someone's to do: everything short of the giver's tick. */
export const ACTIVE_TODO_STATUSES: readonly TodoStatus[] = ['open', 'in_progress', 'blocked'];

/** The states the owner moves between themselves, without troubling the giver. */
export const OWN_PROGRESS_STATUSES: readonly TodoStatus[] = ['open', 'in_progress', 'blocked'];

export const isActiveTodo = (status: TodoStatus) => ACTIVE_TODO_STATUSES.includes(status);

/** A task nobody has picked up yet — what "Not Started" means for the risk rules. */
export const isNotStarted = (status: TodoStatus) => status === 'open';

// --- Priority ------------------------------------------------------------------

/**
 * P1 first. Priority is not a field anyone sets: it follows from the quadrant
 * the task sits in, so a task cannot be P1 on one screen and "can wait" on
 * another. Dragging a task to another quadrant changes its priority with it.
 */
export const TODO_PRIORITIES = ['p1', 'p2', 'p3'] as const;
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

export const TODO_PRIORITY_LABELS: Record<TodoPriority, string> = {
  p1: 'P1 — Critical',
  p2: 'P2 — Important',
  p3: 'P3 — Normal',
};
export const TODO_PRIORITY_SHORT: Record<TodoPriority, string> = { p1: 'P1', p2: 'P2', p3: 'P3' };

export function priorityOf(task: { urgency: TodoUrgency; importance: TodoImportance }): TodoPriority {
  if (task.urgency === 'need_action') return task.importance === 'strategic' ? 'p1' : 'p2';
  return task.importance === 'strategic' ? 'p2' : 'p3';
}

/** What a new task is, before anyone moves it. */
export const DEFAULT_TODO_PRIORITY = priorityOf({ urgency: DEFAULT_TODO_URGENCY, importance: DEFAULT_TODO_IMPORTANCE });

const PRIORITY_RANK: Record<TodoPriority, number> = { p1: 0, p2: 1, p3: 2 };

// --- Sorting -------------------------------------------------------------------

/** What both views need of a task to put it in order. */
export interface SortableTask {
  startByAt: string | null;
  startByHasTime: boolean;
  completeByAt: string | null;
  urgency: TodoUrgency;
  importance: TodoImportance;
  createdAt: string;
}

/**
 * A task with no date is not urgent by accident: it sorts after every dated
 * one, in both views, rather than to the top as an empty string would.
 */
const byInstant = (a: string | null, b: string | null): number =>
  a === b ? 0
  : a === null ? 1
  : b === null ? -1
  : a < b ? -1
  : 1;

/**
 * The execution view: what should be started or worked on now. Start By date,
 * then Start By time, then priority, then Complete By — the order the spec sets
 * out. A day without a time comes before the same day with one, because "begin
 * on Thursday" is the earliest Thursday can mean.
 */
export function byExecution(a: SortableTask, b: SortableTask): number {
  const start = byInstant(a.startByAt, b.startByAt);
  if (start !== 0) return start;
  if (a.startByHasTime !== b.startByHasTime) return a.startByHasTime ? 1 : -1;
  const priority = PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)];
  if (priority !== 0) return priority;
  const complete = byInstant(a.completeByAt, b.completeByAt);
  return complete !== 0 ? complete : a.createdAt.localeCompare(b.createdAt);
}

/** The deadline view: what must be finished soon. Complete By, then priority. */
export function byDeadline(a: SortableTask, b: SortableTask): number {
  const complete = byInstant(a.completeByAt, b.completeByAt);
  if (complete !== 0) return complete;
  const priority = PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)];
  if (priority !== 0) return priority;
  const start = byInstant(a.startByAt, b.startByAt);
  return start !== 0 ? start : a.createdAt.localeCompare(b.createdAt);
}

// --- Risk ----------------------------------------------------------------------

/**
 * How a task's deadline is going. `overdue` is past it; `high_risk` is due
 * today and nobody has started; `at_risk` is due tomorrow and nobody has
 * started; `on_track` is in hand with time left. A finished task, and one with
 * no deadline at all, has nothing to say.
 */
export const TODO_RISKS = ['overdue', 'high_risk', 'at_risk', 'on_track'] as const;
export type TodoRisk = (typeof TODO_RISKS)[number];

export const TODO_RISK_LABELS: Record<TodoRisk, string> = {
  overdue: 'Overdue',
  high_risk: 'High risk',
  at_risk: 'At risk',
  on_track: 'On track',
};

export interface RiskInput {
  status: TodoStatus;
  completeByAt: string | null;
  /** Days from now to the deadline, in the reader's own day, from `daysUntil`. */
  daysUntilDue: number | null;
}

export function taskRisk(task: RiskInput, now: Date = new Date()): TodoRisk | null {
  if (!task.completeByAt || !isActiveTodo(task.status)) return null;
  if (new Date(task.completeByAt).getTime() < now.getTime()) return 'overdue';
  if (task.daysUntilDue === null) return null;
  if (isNotStarted(task.status)) {
    if (task.daysUntilDue <= 0) return 'high_risk';
    if (task.daysUntilDue === 1) return 'at_risk';
  }
  return 'on_track';
}

/**
 * The warning that gives the product its reason to exist: a deadline with no
 * start date leaves the owner to guess when to begin (§14).
 */
export const NO_START_DATE_WARNING = 'No start date assigned. Team member may not know when to begin this task.';

export const needsStartDate = (task: { startByAt: string | null; completeByAt: string | null }) =>
  task.completeByAt !== null && task.startByAt === null;
