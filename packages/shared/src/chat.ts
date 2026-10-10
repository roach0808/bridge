import type { Role } from './roles';

/**
 * Who may hold a one-to-one chat with whom:
 * - the Founder with anyone;
 * - Managers with Managers and with any Associate;
 * - Experts with Managers and Associates, but only to schedule calls (see
 *   scheduling.ts): every message is one of the set sentences.
 * Associates don't chat with each other, nor Experts with Experts. The rule is
 * symmetric, and nobody chats with themselves.
 */
export type ChatMode = 'free' | 'scheduling';

/** How two people may chat, or null when they may not. */
export function chatModeOf(a: { id: string; role: Role }, b: { id: string; role: Role }): ChatMode | null {
  if (a.id === b.id) return null;
  if (a.role === 'founder' || b.role === 'founder') return 'free';
  if (a.role === 'expert' && b.role === 'expert') return null;
  if (a.role === 'expert' || b.role === 'expert') return 'scheduling';
  return a.role === 'manager' || b.role === 'manager' ? 'free' : null;
}

export function canChat(a: { id: string; role: Role }, b: { id: string; role: Role }): boolean {
  return chatModeOf(a, b) !== null;
}

/**
 * `todo_done` is the reply posted when the assignee marks a to-do done; `ring`
 * records that one person rang the other (see RING_SECONDS).
 */
export const CHAT_MESSAGE_KINDS = ['text', 'todo_done', 'ring', 'system'] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];

// --- Groups --------------------------------------------------------------------------

/**
 * A chat is one-to-one (`direct`) or a `group`: a title, a picture, and any
 * number of people. Groups are for everyone but Experts, who keep their
 * one-to-one chats. A `system` message records what happened in a group
 * ("created the group", "added Pixel", "left"); nobody sends one.
 */
export const CONVERSATION_KINDS = ['direct', 'group'] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

/**
 * The group's creator is its owner. Admins add and remove members, rename it,
 * change its picture and delete anyone's message; the owner also makes and
 * unmakes admins and deletes the group.
 */
export const GROUP_ROLES = ['owner', 'admin', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export const GROUP_TITLE_MAX = 64;
export const GROUP_MAX_MEMBERS = 200;

/** Who may be in a group, and so start one: everyone but Experts. */
export const canJoinGroups = (role: Role): boolean => role !== 'expert';

/** Owners and admins run the group. */
export const runsGroup = (role: GroupRole | null | undefined): boolean => role === 'owner' || role === 'admin';

/**
 * Who may take someone else out of a group: the owner anyone, an admin plain
 * members only. Leaving is always one's own choice.
 */
export const canRemoveFromGroup = (actor: GroupRole, target: GroupRole): boolean =>
  actor === 'owner' ? target !== 'owner' : actor === 'admin' && target === 'member';

const MENTION_RE = /@([\p{L}\p{N}_.-]+)/gu;

/**
 * The people a message @mentions, among those given: "@pixel" names the person
 * whose nickname is pixel, whatever the case. A dot or dash ending a sentence
 * ("thanks @pixel.") is not part of the name.
 */
export function mentionedIn(body: string, people: ReadonlyArray<{ id: string; nickname: string }>): string[] {
  const byName = new Map(people.map((p) => [p.nickname.toLowerCase(), p.id]));
  const found = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const name = m[1]!.toLowerCase();
    const id = byName.get(name) ?? byName.get(name.replace(/[.-]+$/, ''));
    if (id) found.add(id);
  }
  return [...found];
}

/**
 * Ringing is no call: it plays a tune on the other person's screen until they
 * close it, open the chat, or this many seconds pass, so a chat waiting for them
 * is hard to miss. Anyone who may write in a chat may ring in it, one ring at a time.
 */
export const RING_SECONDS = 45;

/**
 * Not Started → In Progress → Ready for Review (the taker ticks it) → Completed
 * (the giver confirms it), with Blocked to one side. The stored names are older
 * than the words on screen: `open` is Not Started and `done` is Ready for
 * Review (see TODO_STATUS_LABELS in tasks.ts).
 */
export const TODO_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'completed'] as const;
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
