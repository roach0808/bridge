import type { Role } from './roles';

/**
 * Who may hold a one-to-one chat with whom:
 * - the Founder with anyone;
 * - anyone with someone of the same role;
 * - Associates with Managers (any Manager, not only their own).
 * The rule is symmetric, and nobody chats with themselves.
 */
export function canChat(a: { id: string; role: Role }, b: { id: string; role: Role }): boolean {
  if (a.id === b.id) return false;
  if (a.role === 'founder' || b.role === 'founder') return true;
  if (a.role === b.role) return true;
  const pair = new Set([a.role, b.role]);
  return pair.has('associate') && pair.has('manager');
}

export const CHAT_MESSAGE_KINDS = ['text', 'todo_done'] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

export const TODO_STATUSES = ['open', 'done'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const CHAT_MESSAGE_MAX = 5000;
