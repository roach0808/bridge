import type { Role } from './roles';

/**
 * Who may hold a one-to-one chat with whom:
 * - the Founder with anyone;
 * - Managers with Managers, with any Associate and with any Expert.
 * Associates and Experts talk to Managers and the Founder, not to each other.
 * The rule is symmetric, and nobody chats with themselves.
 */
export function canChat(a: { id: string; role: Role }, b: { id: string; role: Role }): boolean {
  if (a.id === b.id) return false;
  if (a.role === 'founder' || b.role === 'founder') return true;
  return a.role === 'manager' || b.role === 'manager';
}

export const CHAT_MESSAGE_KINDS = ['text', 'todo_done'] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

/** open → done (the taker ticks it) → completed (the giver confirms it). */
export const TODO_STATUSES = ['open', 'done', 'completed'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

/**
 * Who may give a task to whom: anyone to themselves (a personal to-do on their
 * own panel), the Founder to anyone else, a Manager to any Associate.
 */
export function canGiveTask(giver: { id: string; role: Role }, taker: { id: string; role: Role }): boolean {
  if (giver.id === taker.id) return true;
  if (giver.role === 'founder') return true;
  return giver.role === 'manager' && taker.role === 'associate';
}

/** A task someone gave themselves needs nobody's confirmation: ticking it finishes it. */
export function isSelfTask(t: { assignee: { id: string }; createdBy: { id: string } }): boolean {
  return t.assignee.id === t.createdBy.id;
}

/** A Manager runs the work of every Associate, and of themselves. */
export function supervisesWork(actor: { id: string; role: Role }, owner: { id: string; role: Role }): boolean {
  if (actor.role === 'founder') return true;
  if (actor.role !== 'manager') return false;
  return owner.role === 'associate' || owner.id === actor.id;
}

/**
 * The task board's four quadrants: a column (needs action now, or can wait) and
 * a row (strategic work, or not). Every task sits in one; a new task starts
 * where the work starts, needing action and strategic.
 */
export const TODO_URGENCIES = ['need_action', 'can_wait'] as const;
export type TodoUrgency = (typeof TODO_URGENCIES)[number];
export const TODO_IMPORTANCES = ['strategic', 'non_strategic'] as const;
export type TodoImportance = (typeof TODO_IMPORTANCES)[number];

export const TODO_URGENCY_LABELS: Record<TodoUrgency, string> = {
  need_action: 'Need action',
  can_wait: 'Can wait',
};
export const TODO_IMPORTANCE_LABELS: Record<TodoImportance, string> = {
  strategic: 'Strategic',
  non_strategic: 'Non strategic',
};

export const DEFAULT_TODO_URGENCY: TodoUrgency = 'need_action';
export const DEFAULT_TODO_IMPORTANCE: TodoImportance = 'strategic';

/** One quadrant of the board. */
export interface TodoQuadrant {
  urgency: TodoUrgency;
  importance: TodoImportance;
}

/** The four quadrants, in reading order: the most pressing first. */
export const TODO_QUADRANTS: readonly TodoQuadrant[] = TODO_IMPORTANCES.flatMap((importance) =>
  TODO_URGENCIES.map((urgency) => ({ urgency, importance })),
);

export const sameQuadrant = (a: TodoQuadrant, b: TodoQuadrant) => a.urgency === b.urgency && a.importance === b.importance;

/** Tasks are ordered by hand inside each quadrant; the gap leaves room to drop one between two others. */
export const TODO_POSITION_STEP = 100;

/** A completed task stays on the board this long before it drops out of the default view. */
export const COMPLETED_TASK_DAYS = 7;

export const CHAT_MESSAGE_MAX = 5000;

/** A chat picture after the browser has shrunk it. */
export const CHAT_IMAGE_MAX_BYTES = 1024 * 1024;
/** Longest side of a chat picture, in pixels. */
export const CHAT_IMAGE_MAX_SIDE = 1600;
export const CHAT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Offered on hover; the picker allows any other emoji. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
