import type { Role } from './roles';

/**
 * Who may hold a one-to-one chat with whom:
 * - the Founder with anyone;
 * - Managers with Managers;
 * - Associates with Managers (any Manager, not only their own).
 * Associates don't chat with each other, and Experts only with the Founder.
 * The rule is symmetric, and nobody chats with themselves.
 */
export function canChat(a: { id: string; role: Role }, b: { id: string; role: Role }): boolean {
  if (a.id === b.id) return false;
  if (a.role === 'founder' || b.role === 'founder') return true;
  if (a.role === 'manager') return b.role === 'manager' || b.role === 'associate';
  if (b.role === 'manager') return a.role === 'associate';
  return false;
}

export const CHAT_MESSAGE_KINDS = ['text', 'todo_done'] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

/** open → done (the taker ticks it) → completed (the giver confirms it). */
export const TODO_STATUSES = ['open', 'done', 'completed'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

/**
 * Who may give a task to whom: the Founder to anyone else,
 * a Manager to the Associates on their own team.
 */
export function canGiveTask(
  giver: { id: string; role: Role },
  taker: { id: string; role: Role; managerId?: string | null },
): boolean {
  if (giver.id === taker.id) return false;
  if (giver.role === 'founder') return true;
  return giver.role === 'manager' && taker.role === 'associate' && taker.managerId === giver.id;
}

export const CHAT_MESSAGE_MAX = 5000;

/** A chat picture after the browser has shrunk it. */
export const CHAT_IMAGE_MAX_BYTES = 1024 * 1024;
/** Longest side of a chat picture, in pixels. */
export const CHAT_IMAGE_MAX_SIDE = 1600;
export const CHAT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Offered on hover; the picker allows any other emoji. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
