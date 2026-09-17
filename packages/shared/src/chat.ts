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
 * Who may give a task to whom: the Founder to anyone else,
 * a Manager to any Associate (not only their own team).
 */
export function canGiveTask(giver: { id: string; role: Role }, taker: { id: string; role: Role }): boolean {
  if (giver.id === taker.id) return false;
  if (giver.role === 'founder') return true;
  return giver.role === 'manager' && taker.role === 'associate';
}

/** A Manager runs the work of every Associate, and of themselves. */
export function supervisesWork(actor: { id: string; role: Role }, owner: { id: string; role: Role }): boolean {
  if (actor.role === 'founder') return true;
  if (actor.role !== 'manager') return false;
  return owner.role === 'associate' || owner.id === actor.id;
}

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
