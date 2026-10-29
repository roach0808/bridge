import type { Role } from './roles';

/**
 * Someone as the team rules see them. `managerId` is an Associate's Manager;
 * it is null for everyone else.
 */
export interface TeamMember {
  id: string;
  role: Role;
  managerId: string | null;
}

/**
 * The team someone is in, named by its Manager: a Manager's own, an
 * Associate's Manager's. The Founder and Experts are in no team.
 */
export const teamIdOf = (p: TeamMember): string | null =>
  p.role === 'manager' ? p.id : p.role === 'associate' ? p.managerId : null;

/** Two people in the same team. Each team is closed to the others (§2.4). */
export const sameTeam = (a: TeamMember, b: TeamMember): boolean => {
  const team = teamIdOf(a);
  return team !== null && team === teamIdOf(b);
};

/**
 * Who may hold a one-to-one chat with whom:
 * - the Founder with anyone;
 * - Managers with Managers;
 * - everyone in a team with the rest of their own team: a Manager with their
 *   Associates, Associates with each other;
 * - Experts with Managers and Associates, but only to schedule calls (see
 *   scheduling.ts): every message is one of the set sentences.
 * Nobody chats with another team's people, nor Experts with Experts. The rule
 * is symmetric, and nobody chats with themselves.
 */
export type ChatMode = 'free' | 'scheduling';

/** How two people may chat, or null when they may not. */
export function chatModeOf(a: TeamMember, b: TeamMember): ChatMode | null {
  if (a.id === b.id) return null;
  if (a.role === 'founder' || b.role === 'founder') return 'free';
  if (a.role === 'expert' && b.role === 'expert') return null;
  if (a.role === 'expert' || b.role === 'expert') return 'scheduling';
  if (a.role === 'manager' && b.role === 'manager') return 'free';
  return sameTeam(a, b) ? 'free' : null;
}

export function canChat(a: TeamMember, b: TeamMember): boolean {
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

/** Who may start a group: everyone but Experts. */
export const canJoinGroups = (role: Role): boolean => role !== 'expert';

/**
 * Who may put someone in a group: anyone who may start one (so never an
 * Expert) puts Founders, Managers and Associates there; an Expert is put there
 * by a Founder only, and then talks freely in it like everyone else.
 */
export const canPutInGroup = (actor: { role: Role }, person: { role: Role }): boolean =>
  canJoinGroups(actor.role) && (person.role !== 'expert' || actor.role === 'founder');

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
 * own panel), the Founder to anyone else, a Manager to the Associates of their
 * own team.
 */
export function canGiveTask(giver: TeamMember, taker: TeamMember): boolean {
  if (giver.id === taker.id) return true;
  if (giver.role === 'founder') return true;
  return giver.role === 'manager' && taker.role === 'associate' && taker.managerId === giver.id;
}

/** A task someone gave themselves needs nobody's confirmation: ticking it finishes it. */
export function isSelfTask(t: { assignee: { id: string }; createdBy: { id: string } }): boolean {
  return t.assignee.id === t.createdBy.id;
}

/**
 * Who may change a task (its wording, dates and details): whoever gave it, and
 * anyone above the owner who could have given it to them. Not the owner — a
 * deadline you can move yourself is not a commitment to anyone — unless they
 * gave it to themselves.
 */
export function canEditTask(actor: TeamMember, t: { assignee: TeamMember; createdBy: { id: string } }): boolean {
  if (t.createdBy.id === actor.id) return true;
  return t.assignee.id !== actor.id && canGiveTask(actor, t.assignee);
}

/**
 * Who may delete a task. The Founder may delete any task, at any stage. Anyone
 * else must wait until it is completed (the giver has confirmed it), and then
 * only the two people it concerns may: whoever gave it and whoever it is for.
 * Until then a task is a record of work owed, and only the Founder strikes it.
 */
export function canRemoveTask(
  actor: { id: string; role: Role },
  t: { status: TodoStatus; assignee: { id: string }; createdBy: { id: string } },
): boolean {
  if (actor.role === 'founder') return true;
  if (t.status !== 'completed') return false;
  return t.assignee.id === actor.id || t.createdBy.id === actor.id;
}

/**
 * Who may write notes on a task: whoever it is for, whoever gave it, and anyone
 * who could have given it to them — everyone who can see the task.
 */
export function canNoteTask(actor: TeamMember, t: { assignee: TeamMember; createdBy: { id: string } }): boolean {
  return t.assignee.id === actor.id || t.createdBy.id === actor.id || canGiveTask(actor, t.assignee);
}

/** A note is its writer's to change; the Founder may also delete it. */
export const canEditTaskNote = (actor: { id: string }, note: { author: { id: string } }): boolean => note.author.id === actor.id;
export const canDeleteTaskNote = (actor: { id: string; role: Role }, note: { author: { id: string } }): boolean =>
  note.author.id === actor.id || actor.role === 'founder';

/** A Manager runs the work of their own team's Associates, and their own. */
export function supervisesWork(actor: TeamMember, owner: TeamMember): boolean {
  if (actor.role === 'founder') return true;
  if (actor.role !== 'manager') return false;
  return owner.id === actor.id || (owner.role === 'associate' && owner.managerId === actor.id);
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
