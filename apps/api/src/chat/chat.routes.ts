import {
  ACTIVE_TODO_STATUSES,
  addGroupMembersSchema,
  canChat,
  canJoinGroups,
  canRemoveFromGroup,
  createGroupSchema,
  GROUP_MAX_MEMBERS,
  groupMemberRoleSchema,
  PHOTO_MAX_BYTES,
  photoUploadSchema,
  updateGroupSchema,
  type GroupDTO,
  runsGroup,
  mentionedIn,
  chatModeOf,
  displayZoneFor,
  isActiveTodo,
  renderSchedulingMessage,
  SCHEDULING_TEMPLATES,
  schedulingSideOf,
  CHAT_IMAGE_MAX_BYTES,
  RING_SECONDS,
  endRingSchema,
  COMPLETED_TASK_DAYS,
  canGiveTask,
  chatMessageSchema,
  chatReactionSchema,
  createTodoSchema,
  chatMessagesQuerySchema,
  DEFAULT_TODO_IMPORTANCE,
  DEFAULT_TODO_URGENCY,
  listTodosQuerySchema,
  moveTodoSchema,
  reorderTodosSchema,
  sameQuadrant,
  startConversationSchema,
  todoBoardQuerySchema,
  TODO_POSITION_STEP,
  todoDoneSchema,
  todoStatusSchema,
  updateTodoSchema,
  type ChatMessageDTO,
  type ChatMessagePage,
  type ChatRingDTO,
  type ChatRingEndReason,
  type ConversationDTO,
  type GroupRole,
  type GroupSummary,
  type ObservedChatDTO,
  type Role,
  type SchedulingMessage,
  type ServerToClientEvents,
  type TodoDTO,
  type TodoImportance,
  type TodoStatus,
  type TodoUrgency,
  type TodoPanel,
  type TodoRemovedEvent,
  type TodoSummary,
  type UserRef,
} from '@god/shared';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { prisma, type Db } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { idParam, iso, isoOrNull, parseBody, parseQuery } from '../http';
import { notify } from '../notifications/notify';
import { sendWebPush } from '../notifications/webPush';
import { decodeImageDataUrl } from '../images';
import { emitToUser } from '../realtime/hub';
import { toUserRef, userRefSelect } from '../serializers';

export const chatRouter = Router();
chatRouter.use(['/chat', '/todos'], requireAuth);

// --- Loading & serializing -----------------------------------------------------

const participantSelect = { ...userRefSelect, isActive: true, managerId: true, timeZone: true } satisfies Prisma.UserSelect;

const conversationInclude = {
  userA: { select: participantSelect },
  userB: { select: participantSelect },
  createdBy: { select: userRefSelect },
  // Only groups have member rows.
  members: { select: { userId: true, role: true, lastReadAt: true, joinedAt: true, user: { select: participantSelect } }, orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }, { userId: 'asc' }] },
} satisfies Prisma.ConversationInclude;
type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;
type Participant = NonNullable<ConversationRow['userA']>;
/** A one-to-one chat, whose two people are always there. */
type DirectRow = ConversationRow & { kind: 'direct'; userAId: string; userBId: string; userA: Participant; userB: Participant };
const isDirect = (c: ConversationRow): c is DirectRow => c.kind === 'direct';

const todoSummaryInclude = {
  // The owner's zone is the one a task's times are read in unless it says otherwise.
  assignee: { select: { ...userRefSelect, timeZone: true } },
  createdBy: { select: userRefSelect },
} satisfies Prisma.TodoInclude;

const messageInclude = {
  sender: { select: userRefSelect },
  replyTo: { select: { id: true, body: true, imageId: true, deletedAt: true, sender: { select: userRefSelect } } },
  todo: { include: todoSummaryInclude },
  image: { select: { id: true, width: true, height: true } },
  reactions: { select: { emoji: true, userId: true }, orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }] },
} satisfies Prisma.ChatMessageInclude;
type MessageRow = Prisma.ChatMessageGetPayload<{ include: typeof messageInclude }>;

const todoInclude = {
  ...todoSummaryInclude,
  message: { select: { id: true, body: true, createdAt: true, sender: { select: userRefSelect } } },
  dependsOn: {
    select: { dependsOn: { select: { id: true, title: true, status: true, message: { select: { body: true } }, assignee: { select: userRefSelect } } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.TodoInclude;
type TodoRow = Prisma.TodoGetPayload<{ include: typeof todoInclude }>;

const toTodoSummary = (t: Prisma.TodoGetPayload<{ include: typeof todoSummaryInclude }>): TodoSummary => ({
  id: t.id,
  status: t.status,
  urgency: t.urgency,
  importance: t.importance,
  assignee: toUserRef(t.assignee),
  createdBy: toUserRef(t.createdBy),
  doneAt: isoOrNull(t.doneAt),
  confirmedAt: isoOrNull(t.confirmedAt),
});

const toMessageDTO = (m: MessageRow): ChatMessageDTO => ({
  id: m.id,
  conversationId: m.conversationId,
  sender: toUserRef(m.sender),
  body: m.body,
  kind: m.kind,
  replyTo: m.replyTo
    ? {
        id: m.replyTo.id,
        body: m.replyTo.body,
        sender: toUserRef(m.replyTo.sender),
        deleted: m.replyTo.deletedAt !== null,
        hasImage: m.replyTo.imageId !== null,
      }
    : null,
  todo: m.todo ? toTodoSummary(m.todo) : null,
  image: m.image,
  deleted: m.deletedAt !== null,
  reactions: groupReactions(m.reactions),
  scheduling: m.scheduling as SchedulingMessage | null,
  mentionIds: m.mentionIds,
  createdAt: iso(m.createdAt),
});

function groupReactions(rows: Array<{ emoji: string; userId: string }>): ChatMessageDTO['reactions'] {
  const groups = new Map<string, string[]>();
  for (const r of rows) groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r.userId]);
  return [...groups].map(([emoji, userIds]) => ({ emoji, userIds }));
}

const toTodoDTO = (t: TodoRow): TodoDTO => ({
  ...toTodoSummary(t),
  conversationId: t.conversationId,
  message: t.message
    ? { id: t.message.id, body: t.message.body, sender: toUserRef(t.message.sender), createdAt: iso(t.message.createdAt) }
    : null,
  title: t.title,
  details: t.details,
  doneNote: t.doneNote,
  blockedReason: t.blockedReason,
  startByAt: isoOrNull(t.startByAt),
  startByHasTime: t.startByHasTime,
  completeByAt: isoOrNull(t.completeByAt),
  completeByHasTime: t.completeByHasTime,
  // A task with no zone of its own is read in the owner's.
  timeZone: t.timeZone ?? t.assignee.timeZone,
  expectedDeliverable: t.expectedDeliverable,
  definitionOfDone: t.definitionOfDone,
  dependsOn: t.dependsOn.map((d) => ({
    id: d.dependsOn.id,
    title: todoText(d.dependsOn),
    status: d.dependsOn.status,
    assignee: toUserRef(d.dependsOn.assignee),
  })),
  createdAt: iso(t.createdAt),
  updatedAt: iso(t.updatedAt),
});

/** Everything still to do, in progress or stuck, then the two finished states. */
function countsFor(rows: Array<{ assigneeId: string; status: TodoStatus; _count: { _all: number } }>, personId: string): TodoPanel['counts'] {
  const of = (status: TodoStatus) => rows.find((c) => c.assigneeId === personId && c.status === status)?._count._all ?? 0;
  return {
    open: of('open') + of('in_progress') + of('blocked'),
    inProgress: of('in_progress'),
    blocked: of('blocked'),
    done: of('done'),
    completed: of('completed'),
  };
}

/** Who is in a chat: its two people, or a group's members. */
type MembersShape = { kind: string; userAId: string | null; userBId: string | null; members?: Array<{ userId: string }> };
const memberIdsOf = (c: MembersShape): string[] =>
  c.kind === 'group' ? (c.members ?? []).map((m) => m.userId) : [c.userAId, c.userBId].filter((id): id is string => id !== null);
const isParticipant = (c: MembersShape, userId: string) => memberIdsOf(c).includes(userId);
/** The caller's place in a group; null outside one, or in a one-to-one chat. */
const roleIn = (c: ConversationRow, userId: string): GroupRole | null => c.members.find((m) => m.userId === userId)?.role ?? null;
const otherOf = (c: DirectRow, userId: string) => (c.userAId === userId ? c.userB : c.userA);
const myLastReadAt = (c: ConversationRow, userId: string) =>
  isDirect(c) ? (c.userAId === userId ? c.userALastReadAt : c.userBLastReadAt) : (c.members.find((m) => m.userId === userId)?.lastReadAt ?? null);
const otherLastReadAt = (c: DirectRow, userId: string) => (c.userAId === userId ? c.userBLastReadAt : c.userALastReadAt);
/** Moves the caller's read marker in the chat to `at` (sending counts as reading). */
const readMarker = (c: ConversationRow, userId: string, at: Date) =>
  isDirect(c)
    ? prisma.conversation.update({ where: { id: c.id }, data: c.userAId === userId ? { userALastReadAt: at } : { userBLastReadAt: at } })
    : prisma.conversationMember.update({ where: { conversationId_userId: { conversationId: c.id, userId } }, data: { lastReadAt: at } });

/**
 * One-to-one: both people are active and their roles still allow a chat. A
 * group: the caller is an active member (anyone who left can no longer write).
 */
const canSendIn = (c: ConversationRow, userId: string) =>
  isDirect(c)
    ? c.userA.isActive && c.userB.isActive && canChat({ id: c.userA.id, role: c.userA.role as Role }, { id: c.userB.id, role: c.userB.role as Role })
    : c.members.some((m) => m.userId === userId && m.user.isActive);

/** An Expert and the team only schedule calls; every other chat, groups included, is free. */
const modeOf = (c: ConversationRow) =>
  isDirect(c) ? (chatModeOf({ id: c.userA.id, role: c.userA.role as Role }, { id: c.userB.id, role: c.userB.role as Role }) ?? 'free') : 'free';

async function loadConversation(actor: Actor, id: string | null): Promise<ConversationRow> {
  if (!id) throw notFound('Conversation');
  const c = await prisma.conversation.findUnique({ where: { id }, include: conversationInclude });
  if (!c || !isParticipant(c, actor.id)) throw notFound('Conversation');
  return c;
}

/** A one-to-one chat of the caller's, for what only makes sense between two people (rings, tasks). */
async function loadDirect(actor: Actor, id: string | null, what: string): Promise<DirectRow> {
  const c = await loadConversation(actor, id);
  if (!isDirect(c)) throw badRequest(`${what} is for one-to-one chats`);
  return c;
}

const meIn = (c: DirectRow, userId: string) => {
  const me = c.userAId === userId ? c.userA : c.userB;
  return { id: me.id, role: me.role as Role };
};
const asTaker = (u: { id: string; role: string }) => ({ id: u.id, role: u.role as Role });

const groupSummary = (c: ConversationRow, userId: string): GroupSummary => ({
  title: c.title ?? '',
  photoId: c.photoId,
  memberCount: c.members.length,
  myRole: roleIn(c, userId) ?? 'member',
});

/** Builds the list entries for the given conversations, as `userId` sees them. */
async function toConversationDTOs(db: Db, rows: ConversationRow[], userId: string): Promise<ConversationDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [lastMessages, unread, openTodos] = await Promise.all([
    db.$queryRaw<
      Array<{ id: string; conversation_id: string; sender_id: string; sender_nickname: string; body: string; kind: ChatMessageDTO['kind']; image_id: string | null; deleted_at: Date | null; created_at: Date }>
    >`
      SELECT DISTINCT ON (m.conversation_id) m.id, m.conversation_id, m.sender_id, u.nickname AS sender_nickname, m.body, m.kind, m.image_id, m.deleted_at, m.created_at
      FROM chat_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ANY(${ids}::uuid[])
      ORDER BY m.conversation_id, m.created_at DESC, m.id DESC`,
    // Unread: from someone else, after the caller's read marker (a group keeps one per member).
    // What a group did ("added Pixel") is shown but never counts as unread.
    db.$queryRaw<Array<{ id: string; count: bigint; mentions: bigint }>>`
      SELECT c.id, count(m.id) AS count, count(m.id) FILTER (WHERE ${userId}::uuid = ANY(m.mention_ids)) AS mentions
      FROM conversations c
      LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = ${userId}::uuid
      JOIN chat_messages m ON m.conversation_id = c.id
        AND m.sender_id <> ${userId}::uuid
        AND m.kind::text <> 'system'
        AND m.created_at > COALESCE(
          CASE
            WHEN c.kind::text = 'group' THEN cm.last_read_at
            WHEN c.user_a_id = ${userId}::uuid THEN c.user_a_last_read_at
            ELSE c.user_b_last_read_at
          END,
          '-infinity'::timestamptz)
      WHERE c.id = ANY(${ids}::uuid[])
      GROUP BY c.id`,
    db.todo.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: ids }, status: { in: [...ACTIVE_TODO_STATUSES] } },
      _count: { _all: true },
    }),
  ]);
  return rows.map((c) => {
    const last = lastMessages.find((m) => m.conversation_id === c.id);
    const counts = unread.find((u) => u.id === c.id);
    const other = isDirect(c) ? otherOf(c, userId) : null;
    const open = canSendIn(c, userId);
    return {
      id: c.id,
      kind: c.kind,
      other: other ? { ...toUserRef(other), isActive: other.isActive } : null,
      group: isDirect(c) ? null : groupSummary(c, userId),
      lastMessage: last
        ? {
            id: last.id,
            body: last.body,
            kind: last.kind,
            senderId: last.sender_id,
            senderNickname: last.sender_nickname,
            hasImage: last.image_id !== null,
            deleted: last.deleted_at !== null,
            createdAt: iso(last.created_at),
          }
        : null,
      unreadCount: Number(counts?.count ?? 0),
      unreadMentions: Number(counts?.mentions ?? 0),
      openTodoCount: openTodos.find((t) => t.conversationId === c.id)?._count._all ?? 0,
      otherLastReadAt: isDirect(c) ? isoOrNull(otherLastReadAt(c, userId)) : null,
      canSend: open,
      mode: modeOf(c),
      canGiveTask: isDirect(c) && open && canGiveTask(meIn(c, userId), asTaker(other!)),
      canRing: isDirect(c) && open,
      createdAt: iso(c.createdAt),
    };
  });
}

function emitToBoth<E extends keyof ServerToClientEvents>(
  c: { userAId: string; userBId: string },
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  emitToUser(c.userAId, event, ...args);
  emitToUser(c.userBId, event, ...args);
}

/** Tells everyone in the chat: its two people, or every member of a group. */
function emitToMembers<E extends keyof ServerToClientEvents>(c: MembersShape, event: E, ...args: Parameters<ServerToClientEvents[E]>) {
  for (const id of memberIdsOf(c)) emitToUser(id, event, ...args);
}

// --- Contacts & conversations ----------------------------------------------------

/** Everyone the caller may start a chat with. */
chatRouter.get('/chat/contacts', async (req, res) => {
  const actor = actorOf(req);
  const users = await prisma.user.findMany({
    where: { isActive: true, id: { not: actor.id } },
    select: userRefSelect,
    orderBy: [{ role: 'asc' }, { nickname: 'asc' }],
  });
  res.json(users.filter((u) => canChat(actor, { id: u.id, role: u.role as Role })).map(toUserRef));
});

/** The caller's chats that have at least one message, most recent first. */
chatRouter.get('/chat/conversations', async (req, res) => {
  const actor = actorOf(req);
  const rows = await prisma.conversation.findMany({
    where: { OR: [{ userAId: actor.id }, { userBId: actor.id }, { members: { some: { userId: actor.id } } }], lastMessageAt: { not: null } },
    include: conversationInclude,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
  });
  res.json(await toConversationDTOs(prisma, rows, actor.id));
});

/** Opens (or creates) the one-to-one chat with a user the caller is allowed to talk to. */
chatRouter.post('/chat/conversations', async (req, res) => {
  const actor = actorOf(req);
  const { userId } = parseBody(startConversationSchema, req);
  const other = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
  if (!other || !other.isActive || other.id === actor.id) {
    throw badRequest('Choose someone to chat with', { issues: [{ path: 'userId', message: 'Not an active user' }] });
  }
  if (!canChat(actor, { id: other.id, role: other.role as Role })) {
    throw forbidden('You cannot start a chat with this person');
  }
  const [userAId, userBId] = [actor.id, other.id].sort() as [string, string];
  const row = await prisma.conversation.upsert({
    where: { userAId_userBId: { userAId, userBId } },
    create: { userAId, userBId },
    update: {},
    include: conversationInclude,
  });
  res.status(201).json((await toConversationDTOs(prisma, [row], actor.id))[0]);
});

chatRouter.get('/chat/conversations/:id', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadConversation(actor, idParam(req));
  res.json((await toConversationDTOs(prisma, [c], actor.id))[0]);
});

// --- Groups ----------------------------------------------------------------------------
//
// A group is a conversation with a title, a picture and members (§6.11c). Everyone but
// Experts may start one and be in one. Its creator owns it; owners and admins run it.

/** "Pixel", "Pixel and Sprout", "Pixel, Sprout and Mango". */
const namesOf = (people: Array<{ nickname: string }>) => {
  const names = people.map((p) => p.nickname);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
};

/** Records in the group what someone did there ("added Pixel"), as a line between the messages. */
async function postSystem(tx: Db, conversationId: string, actorId: string, body: string, at = new Date()) {
  const m = await tx.chatMessage.create({ data: { conversationId, senderId: actorId, body, kind: 'system', createdAt: at }, include: messageInclude });
  await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: at } });
  return m;
}

/** The caller's group; anything else, or a group they are not in, is a 404. */
async function loadGroup(actor: Actor, id: string | null): Promise<ConversationRow> {
  const c = await loadConversation(actor, id);
  if (isDirect(c)) throw notFound('Group');
  return c;
}

/** Only owners and admins run a group. */
function assertRuns(c: ConversationRow, actor: Actor) {
  if (!runsGroup(roleIn(c, actor.id))) throw forbidden('Only the group’s owner and admins can do that');
}

/** The people to put in a group: each must be an active Founder, Manager or Associate. */
async function groupPeople(ids: string[]) {
  const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { ...userRefSelect, isActive: true } });
  const wrong = ids.filter((id) => {
    const u = people.find((p) => p.id === id);
    return !u || !u.isActive || !canJoinGroups(u.role as Role);
  });
  if (wrong.length) {
    throw badRequest('Groups are for active Founders, Managers and Associates', { issues: wrong.map(() => ({ path: 'memberIds', message: 'Cannot be in a group' })) });
  }
  // In the order they were picked.
  return ids.map((id) => people.find((p) => p.id === id)!);
}

const toGroupDTO = (c: ConversationRow, userId: string): GroupDTO => ({
  id: c.id,
  ...groupSummary(c, userId),
  createdBy: c.createdBy ? toUserRef(c.createdBy) : null,
  members: c.members.map((m) => ({ user: { ...toUserRef(m.user), isActive: m.user.isActive }, role: m.role, joinedAt: iso(m.joinedAt) })),
  createdAt: iso(c.createdAt),
});

/**
 * After a change: everyone in the group (and anyone just taken out of it) hears
 * the group changed, the line saying what happened shows in the chat, and the
 * caller gets the group as it is now.
 */
async function groupChanged(res: import('express').Response, actor: Actor, id: string, system: MessageRow | null, removed: string[] = []) {
  const c = await prisma.conversation.findUnique({ where: { id }, include: conversationInclude });
  if (system && c) emitToMembers(c, 'chat:message', toMessageDTO(system));
  for (const userId of new Set([...(c ? memberIdsOf(c) : []), ...removed])) {
    emitToUser(userId, 'chat:group-updated', { conversationId: id, removedUserIds: removed });
  }
  if (!c || !isParticipant(c, actor.id)) return res.status(204).end();
  return res.json(toGroupDTO(c, actor.id));
}

/** Everyone the caller may put in a group. */
chatRouter.get('/chat/group-candidates', async (req, res) => {
  const actor = actorOf(req);
  if (!canJoinGroups(actor.role)) throw forbidden('Experts are not in groups');
  const users = await prisma.user.findMany({
    where: { isActive: true, id: { not: actor.id }, role: { not: 'expert' } },
    select: userRefSelect,
    orderBy: [{ role: 'asc' }, { nickname: 'asc' }],
  });
  res.json(users.map(toUserRef));
});

/** Starts a group: the caller owns it, with the people they picked as members. */
chatRouter.post('/chat/groups', async (req, res) => {
  const actor = actorOf(req);
  if (!canJoinGroups(actor.role)) throw forbidden('Experts are not in groups');
  const { title, memberIds } = parseBody(createGroupSchema, req);
  const people = await groupPeople(memberIds.filter((id) => id !== actor.id));
  if (!people.length) throw badRequest('Add at least one person', { issues: [{ path: 'memberIds', message: 'Add at least one person' }] });
  const now = new Date();
  const { id, system } = await prisma.$transaction(async (tx) => {
    const group = await tx.conversation.create({
      data: {
        kind: 'group',
        title,
        createdById: actor.id,
        lastMessageAt: now,
        members: { create: [{ userId: actor.id, role: 'owner', lastReadAt: now }, ...people.map((p) => ({ userId: p.id, joinedAt: now }))] },
      },
      select: { id: true },
    });
    return { id: group.id, system: await postSystem(tx, group.id, actor.id, `created the group “${title}”`, now) };
  });
  const c = await prisma.conversation.findUniqueOrThrow({ where: { id }, include: conversationInclude });
  emitToMembers(c, 'chat:message', toMessageDTO(system));
  emitToMembers(c, 'chat:group-updated', { conversationId: id, removedUserIds: [] });
  void sendWebPush(people.filter((p) => p.isActive).map((p) => p.id), {
    title,
    body: `${actor.nickname} added you to the group`,
    url: `/chat/${id}`,
    tag: `chat:${id}`,
    kind: 'chat',
  });
  res.status(201).json((await toConversationDTOs(prisma, [c], actor.id))[0]);
});

chatRouter.get('/chat/groups/:id', async (req, res) => {
  const actor = actorOf(req);
  res.json(toGroupDTO(await loadGroup(actor, idParam(req)), actor.id));
});

/** Renames the group (owners and admins). */
chatRouter.patch('/chat/groups/:id', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadGroup(actor, idParam(req));
  assertRuns(c, actor);
  const { title } = parseBody(updateGroupSchema, req);
  if (title === c.title) return void (await groupChanged(res, actor, c.id, null));
  const system = await prisma.$transaction(async (tx) => {
    await tx.conversation.update({ where: { id: c.id }, data: { title } });
    return postSystem(tx, c.id, actor.id, `renamed the group to “${title}”`);
  });
  await groupChanged(res, actor, c.id, system);
});

/** Sets or clears the group's picture (owners and admins). */
async function setGroupPhoto(actor: Actor, c: ConversationRow, upload: { contentType: string; data: Buffer } | null) {
  return prisma.$transaction(async (tx) => {
    const photo = upload
      ? await tx.photo.create({
          data: { contentType: upload.contentType, data: new Uint8Array(upload.data), byteSize: upload.data.length, createdById: actor.id },
          select: { id: true },
        })
      : null;
    await tx.conversation.update({ where: { id: c.id }, data: { photoId: photo?.id ?? null } });
    // The picture it replaces goes, so old ones never pile up.
    if (c.photoId) await tx.photo.deleteMany({ where: { id: c.photoId } });
    return postSystem(tx, c.id, actor.id, upload ? 'changed the group photo' : 'removed the group photo');
  });
}

chatRouter.put('/chat/groups/:id/photo', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadGroup(actor, idParam(req));
  assertRuns(c, actor);
  const upload = decodeImageDataUrl(parseBody(photoUploadSchema, req).dataUrl, PHOTO_MAX_BYTES);
  await groupChanged(res, actor, c.id, await setGroupPhoto(actor, c, upload));
});

chatRouter.delete('/chat/groups/:id/photo', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadGroup(actor, idParam(req));
  assertRuns(c, actor);
  if (!c.photoId) return void (await groupChanged(res, actor, c.id, null));
  await groupChanged(res, actor, c.id, await setGroupPhoto(actor, c, null));
});

/** Adds people to the group (owners and admins); anyone already in it is skipped. */
chatRouter.post('/chat/groups/:id/members', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadGroup(actor, idParam(req));
  assertRuns(c, actor);
  const { userIds } = parseBody(addGroupMembersSchema, req);
  const fresh = await groupPeople(userIds.filter((id) => !isParticipant(c, id)));
  if (!fresh.length) return void (await groupChanged(res, actor, c.id, null));
  if (c.members.length + fresh.length > GROUP_MAX_MEMBERS) throw conflict(`A group holds at most ${GROUP_MAX_MEMBERS} people`);
  const now = new Date();
  const system = await prisma.$transaction(async (tx) => {
    await tx.conversationMember.createMany({ data: fresh.map((p) => ({ conversationId: c.id, userId: p.id, joinedAt: now })), skipDuplicates: true });
    return postSystem(tx, c.id, actor.id, `added ${namesOf(fresh)}`, now);
  });
  void sendWebPush(fresh.filter((p) => p.isActive).map((p) => p.id), {
    title: c.title ?? 'Group',
    body: `${actor.nickname} added you to the group`,
    url: `/chat/${c.id}`,
    tag: `chat:${c.id}`,
    kind: 'chat',
  });
  await groupChanged(res, actor, c.id, system);
});

/**
 * Takes someone out of the group: owners anyone, admins plain members. Taking
 * yourself out is leaving; an owner who leaves hands the group to the longest-
 * standing admin, or member, and the last one out deletes it.
 */
chatRouter.delete('/chat/groups/:id/members/:userId', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadGroup(actor, idParam(req));
  const userId = idParam(req, 'userId');
  const target = c.members.find((m) => m.userId === userId);
  if (!target) throw notFound('Member');
  const mine = roleIn(c, actor.id)!;
  const leaving = target.userId === actor.id;
  if (!leaving && !canRemoveFromGroup(mine, target.role)) {
    throw forbidden(mine === 'admin' ? 'Admins take out members only; the owner takes out admins' : 'Only the group’s owner and admins take people out');
  }
  const rest = c.members.filter((m) => m.userId !== target.userId);
  if (!rest.length) {
    await deleteGroup(c);
    return void (await groupChanged(res, actor, c.id, null, [target.userId]));
  }
  const system = await prisma.$transaction(async (tx) => {
    await tx.conversationMember.delete({ where: { conversationId_userId: { conversationId: c.id, userId: target.userId } } });
    if (target.role === 'owner') {
      // Members come owner first, then admins, then the rest, each by when they joined.
      const heir = rest.find((m) => m.role === 'admin') ?? rest[0]!;
      await tx.conversationMember.update({ where: { conversationId_userId: { conversationId: c.id, userId: heir.userId } }, data: { role: 'owner' } });
      return postSystem(tx, c.id, actor.id, `left the group; ${heir.user.nickname} owns it now`);
    }
    return postSystem(tx, c.id, actor.id, leaving ? 'left the group' : `removed ${target.user.nickname}`);
  });
  await groupChanged(res, actor, c.id, system, [target.userId]);
});

/** The owner makes a member an admin, or an admin a plain member again. */
chatRouter.put('/chat/groups/:id/members/:userId/role', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadGroup(actor, idParam(req));
  if (roleIn(c, actor.id) !== 'owner') throw forbidden('Only the group’s owner chooses its admins');
  const target = c.members.find((m) => m.userId === idParam(req, 'userId'));
  if (!target) throw notFound('Member');
  if (target.role === 'owner') throw conflict('The owner is the owner');
  const { role } = parseBody(groupMemberRoleSchema, req);
  if (role === target.role) return void (await groupChanged(res, actor, c.id, null));
  const system = await prisma.$transaction(async (tx) => {
    await tx.conversationMember.update({ where: { conversationId_userId: { conversationId: c.id, userId: target.userId } }, data: { role } });
    return postSystem(tx, c.id, actor.id, role === 'admin' ? `made ${target.user.nickname} an admin` : `removed ${target.user.nickname} as an admin`);
  });
  await groupChanged(res, actor, c.id, system);
});

/** Deletes a group with everything in it. */
async function deleteGroup(c: ConversationRow) {
  await prisma.$transaction(async (tx) => {
    await tx.conversation.delete({ where: { id: c.id } });
    if (c.photoId) await tx.photo.deleteMany({ where: { id: c.photoId } });
  });
}

/** The owner deletes the group, for everyone. */
chatRouter.delete('/chat/groups/:id', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadGroup(actor, idParam(req));
  if (roleIn(c, actor.id) !== 'owner') throw forbidden('Only the group’s owner deletes it');
  await deleteGroup(c);
  await groupChanged(res, actor, c.id, null, memberIdsOf(c));
});

// --- Messages ------------------------------------------------------------------------

function encodeCursor(m: { createdAt: Date; id: string }) {
  return Buffer.from(`${m.createdAt.toISOString()}|${m.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [ts, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(ts ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) throw badRequest('Invalid cursor');
  return { createdAt, id };
}

/**
 * A page of messages, oldest → newest. Without cursors: the latest ones.
 * `cursor`: the ones just before it (scrolling up). `after`: the ones just after it
 * (scrolling back down once the client has let go of the newest pages).
 */
chatRouter.get('/chat/conversations/:id/messages', async (req, res) => {
  const c = await loadConversation(actorOf(req), idParam(req));
  const { cursor, after, limit } = parseQuery(chatMessagesQuerySchema, req);
  const body: ChatMessagePage = after ? await messagesAfter(c.id, decodeCursor(after), limit) : await messagesBefore(c.id, cursor ? decodeCursor(cursor) : null, limit);
  res.json(body);
});

async function messagesBefore(conversationId: string, before: { createdAt: Date; id: string } | null, limit: number): Promise<ChatMessagePage> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      conversationId,
      ...(before ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] } : {}),
    },
    include: messageInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit).reverse();
  return {
    items: page.map(toMessageDTO),
    nextCursor: rows.length > limit ? encodeCursor(page[0]!) : null,
    newerCursor: page.length ? encodeCursor(page.at(-1)!) : null,
    // Anything before a cursor has at least the cursor's message after it.
    hasNewer: before !== null,
  };
}

async function messagesAfter(conversationId: string, after: { createdAt: Date; id: string }, limit: number): Promise<ChatMessagePage> {
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId, OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] },
    include: messageInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  return {
    items: page.map(toMessageDTO),
    // The `after` message itself is older than this page.
    nextCursor: page.length ? encodeCursor(page[0]!) : encodeCursor(after),
    newerCursor: page.length ? encodeCursor(page.at(-1)!) : null,
    hasNewer: rows.length > limit,
  };
}

// --- Everyone's chats, for the owner ------------------------------------------

/**
 * A Founder (§6.11a) reads every chat, and only reads: they are not in these
 * conversations, so there is nothing to send, no task to give and no read
 * receipt to leave. Opening one leaves no "Seen" behind, which is the point —
 * looking on must not look like taking part. Each read is recorded in the
 * audit trail.
 */
chatRouter.get('/chat/observed', requireRole('founder'), async (_req, res) => {
  const rows = await prisma.conversation.findMany({
    where: { lastMessageAt: { not: null } },
    include: conversationInclude,
    orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
    take: 500,
  });
  res.json(await toObservedChatDTOs(rows));
});

chatRouter.get('/chat/observed/:id/messages', requireRole('founder'), async (req, res) => {
  const id = idParam(req);
  const exists = id ? await prisma.conversation.findUnique({ where: { id }, select: { id: true } }) : null;
  if (!exists) throw notFound('Conversation');
  const { cursor, after, limit } = parseQuery(chatMessagesQuerySchema, req);
  const body: ChatMessagePage =
    after ? await messagesAfter(exists.id, decodeCursor(after), limit)
    : await messagesBefore(exists.id, cursor ? decodeCursor(cursor) : null, limit);
  res.json(body);
});

/** The chats as an onlooker sees them: two people, the last thing said, how much there is. */
async function toObservedChatDTOs(rows: ConversationRow[]): Promise<ObservedChatDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [lastMessages, counts] = await Promise.all([
    prisma.$queryRaw<
      Array<{ id: string; conversation_id: string; sender_id: string; sender_nickname: string; body: string; kind: ChatMessageDTO['kind']; image_id: string | null; deleted_at: Date | null; created_at: Date }>
    >`
      SELECT DISTINCT ON (m.conversation_id) m.id, m.conversation_id, m.sender_id, u.nickname AS sender_nickname, m.body, m.kind, m.image_id, m.deleted_at, m.created_at
      FROM chat_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = ANY(${ids}::uuid[])
      ORDER BY m.conversation_id, m.created_at DESC, m.id DESC`,
    prisma.chatMessage.groupBy({ by: ['conversationId'], where: { conversationId: { in: ids } }, _count: { _all: true } }),
  ]);
  return rows.map((c) => {
    const last = lastMessages.find((m) => m.conversation_id === c.id);
    return {
      id: c.id,
      title: isDirect(c) ? null : c.title,
      people: isDirect(c) ? [toUserRef(c.userA), toUserRef(c.userB)] : c.members.map((m) => toUserRef(m.user)),
      lastMessage: last
        ? {
            id: last.id,
            body: last.body,
            kind: last.kind,
            senderId: last.sender_id,
            senderNickname: last.sender_nickname,
            hasImage: last.image_id !== null,
            deleted: last.deleted_at !== null,
            createdAt: iso(last.created_at),
          }
        : null,
      messageCount: counts.find((m) => m.conversationId === c.id)?._count._all ?? 0,
      createdAt: iso(c.createdAt),
    };
  });
}

chatRouter.post('/chat/conversations/:id/messages', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadConversation(actor, idParam(req));
  if (!canSendIn(c, actor.id)) {
    throw forbidden(isDirect(c) ? 'This chat is closed: the other person is no longer available' : 'You can no longer write in this group');
  }
  const { body: text, image, scheduling, replyToId } = parseBody(chatMessageSchema, req);
  if (modeOf(c) === 'scheduling') {
    if (!scheduling) throw forbidden('Between an Expert and the team, only the scheduling messages can be sent');
    const from = SCHEDULING_TEMPLATES[scheduling.key].from;
    if (from !== 'both' && from !== schedulingSideOf(actor.role)) throw forbidden('That message is for the other side to send');
  } else if (scheduling) {
    throw badRequest('Scheduling messages are only for chats between an Expert and the team');
  }
  if (replyToId) {
    const quoted = await prisma.chatMessage.findUnique({ where: { id: replyToId }, select: { conversationId: true, kind: true } });
    if (!quoted || quoted.conversationId !== c.id || quoted.kind === 'system') {
      throw badRequest('Reply to a message in this chat', { issues: [{ path: 'replyToId', message: 'Not a message in this chat' }] });
    }
  }
  // A scheduling message is kept as the sender reads it; each reader sees it in their own zone.
  const body = scheduling ? renderSchedulingMessage(scheduling, displayZoneFor(actor))! : text;
  // In a group, "@pixel" calls Pixel in particular.
  const mentionIds = isDirect(c) ? [] : mentionedIn(body, c.members.filter((m) => m.userId !== actor.id).map((m) => m.user));
  const upload = image ? decodeImageDataUrl(image.dataUrl, CHAT_IMAGE_MAX_BYTES) : null;
  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const stored =
      upload && image
        ? await tx.chatImage.create({
            data: {
              conversationId: c.id,
              uploaderId: actor.id,
              contentType: upload.contentType,
              data: new Uint8Array(upload.data),
              byteSize: upload.data.length,
              width: image.width,
              height: image.height,
            },
            select: { id: true },
          })
        : null;
    const m = await tx.chatMessage.create({
      data: {
        conversationId: c.id,
        senderId: actor.id,
        body,
        imageId: stored?.id ?? null,
        replyToId: replyToId ?? null,
        mentionIds,
        ...(scheduling ? { scheduling: { key: scheduling.key, params: scheduling.params } as Prisma.InputJsonObject } : {}),
        createdAt: now,
      },
      include: messageInclude,
    });
    await tx.conversation.update({ where: { id: c.id }, data: { lastMessageAt: now } });
    return m;
  });
  // Sending counts as reading everything before it.
  await readMarker(c, actor.id, now);
  const dto = toMessageDTO(message);
  emitToMembers(c, 'chat:message', dto);

  const clipTo = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  const said = (t: string) => (image ? `📷 Photo${t ? `: ${clipTo(t, 160)}` : ''}` : clipTo(t, 180));
  if (isDirect(c)) {
    // The notification reads in the recipient's zone.
    const other = otherOf(c, actor.id);
    const shown = scheduling ? (renderSchedulingMessage(scheduling, displayZoneFor({ role: other.role as Role, timeZone: other.timeZone })) ?? body) : body;
    void sendWebPush([other.id], {
      title: actor.nickname,
      body: said(shown),
      url: `/chat/${c.id}`,
      // One notification per chat: a newer message replaces the older one.
      tag: `chat:${c.id}`,
      kind: 'chat',
    });
  } else {
    const others = c.members.filter((m) => m.userId !== actor.id && m.user.isActive).map((m) => m.userId);
    const rest = others.filter((id) => !mentionIds.includes(id));
    const push = { url: `/chat/${c.id}`, tag: `chat:${c.id}`, kind: 'chat' as const };
    if (rest.length) void sendWebPush(rest, { ...push, title: c.title ?? 'Group', body: `${actor.nickname}: ${said(body)}` });
    const called = others.filter((id) => mentionIds.includes(id));
    if (called.length) void sendWebPush(called, { ...push, title: `${actor.nickname} mentioned you in ${c.title ?? 'a group'}`, body: said(body) });
  }
  res.status(201).json(dto);
});

// --- Ringing ------------------------------------------------------------------------

/**
 * A ring sounds on the other person's screen until they close it or open the chat,
 * the ringer stops it, or RING_SECONDS pass. It lives only in this process while it
 * sounds (a restart ends it, and each screen stops on its own at `endsAt`); the
 * chat keeps a `ring` message saying it happened.
 */
interface Ring extends ChatRingDTO {
  userAId: string;
  userBId: string;
  timer: NodeJS.Timeout;
}
const rings = new Map<string, Ring>();
/** What a ring message says wherever only its words are shown. */
const RING_BODY = 'Rang';
/** Chats where a ring is being set up, so two at once cannot both start. */
const startingRings = new Set<string>();

const ringDTO = ({ timer: _timer, userAId: _a, userBId: _b, ...dto }: Ring): ChatRingDTO => dto;
const ringIn = (conversationId: string) => [...rings.values()].find((r) => r.conversationId === conversationId);
const inRing = (r: Ring, userId: string) => r.userAId === userId || r.userBId === userId;

function endRing(ring: Ring, reason: ChatRingEndReason) {
  if (!rings.delete(ring.id)) return;
  clearTimeout(ring.timer);
  emitToBoth(ring, 'chat:ring-ended', { id: ring.id, conversationId: ring.conversationId, reason });
}

/** Stops every ring at once (tests, shutting down). */
export function stopAllRings() {
  for (const ring of rings.values()) clearTimeout(ring.timer);
  rings.clear();
}

/** Rings the other person; anyone who may write in the chat may ring, one ring at a time. */
chatRouter.post('/chat/conversations/:id/ring', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadDirect(actor, idParam(req), 'Ringing');
  if (!canSendIn(c, actor.id)) throw forbidden('This chat is closed: the other person is no longer available');
  if (ringIn(c.id) || startingRings.has(c.id)) throw conflict('This chat is already ringing');
  startingRings.add(c.id);
  try {
    const other = otherOf(c, actor.id);
    const now = new Date();
    const message = await prisma.$transaction(async (tx) => {
      const m = await tx.chatMessage.create({
        data: { conversationId: c.id, senderId: actor.id, body: RING_BODY, kind: 'ring', createdAt: now },
        include: messageInclude,
      });
      await tx.conversation.update({
        where: { id: c.id },
        data: { lastMessageAt: now, ...(c.userAId === actor.id ? { userALastReadAt: now } : { userBLastReadAt: now }) },
      });
      return m;
    });
    const dto = toMessageDTO(message);
    const ring: Ring = {
      id: message.id,
      conversationId: c.id,
      from: dto.sender,
      to: toUserRef(other),
      startedAt: iso(now),
      endsAt: iso(new Date(now.getTime() + RING_SECONDS * 1000)),
      userAId: c.userAId,
      userBId: c.userBId,
      timer: setTimeout(() => endRing(ring, 'missed'), RING_SECONDS * 1000),
    };
    ring.timer.unref?.();
    rings.set(ring.id, ring);
    emitToBoth(c, 'chat:message', dto);
    emitToBoth(c, 'chat:ring', ringDTO(ring));
    void sendWebPush([other.id], {
      title: `📞 ${actor.nickname} is ringing you`,
      body: 'Open the chat to answer.',
      url: `/chat/${c.id}`,
      tag: `ring:${c.id}`,
      kind: 'ring',
    });
    res.status(201).json({ ring: ringDTO(ring), message: dto });
  } finally {
    startingRings.delete(c.id);
  }
});

/** The rings sounding now that the caller is in, either side. */
chatRouter.get('/chat/rings', (req, res) => {
  const actor = actorOf(req);
  res.json([...rings.values()].filter((r) => inRing(r, actor.id)).map(ringDTO));
});

/**
 * Stops a ring: the one rung closes it (or opens the chat, `opened: true`), the
 * ringer cancels it. A ring that has already stopped is fine.
 */
chatRouter.post('/chat/rings/:id/end', (req, res) => {
  const actor = actorOf(req);
  const { opened } = parseBody(endRingSchema, req);
  const ring = rings.get(idParam(req) ?? '');
  if (ring) {
    if (!inRing(ring, actor.id)) throw notFound('Ring');
    endRing(ring, ring.to.id === actor.id ? (opened ? 'opened' : 'closed') : 'cancelled');
  }
  res.status(204).end();
});

chatRouter.post('/chat/conversations/:id/read', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadConversation(actor, idParam(req));
  const readAt = new Date();
  // Never move the marker backwards (e.g. a slow request after a newer one).
  const current = myLastReadAt(c, actor.id);
  if (!current || current < readAt) await readMarker(c, actor.id, readAt);
  // "Seen" is for one-to-one chats; in a group only the reader's other screens need to know.
  const event = { conversationId: c.id, userId: actor.id, readAt: iso(readAt) };
  if (isDirect(c)) emitToBoth(c, 'chat:read', event);
  else emitToUser(actor.id, 'chat:read', event);
  res.status(204).end();
});

/**
 * Erases the whole history with someone, for both of them: every message, picture and
 * reaction. Tasks that came from this chat are kept, each with the message's words as its title.
 * In a group only its owner clears it, for everyone.
 */
chatRouter.delete('/chat/conversations/:id/history', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadConversation(actor, idParam(req));
  if (!isDirect(c) && roleIn(c, actor.id) !== 'owner') throw forbidden('Only the group’s owner clears its history');
  await prisma.$transaction(async (tx) => {
    const todos = await tx.todo.findMany({
      where: { conversationId: c.id },
      select: { id: true, title: true, message: { select: { body: true } } },
    });
    for (const todo of todos) {
      await tx.todo.update({
        where: { id: todo.id },
        data: {
          title: todo.title ?? clip(todo.message?.body.trim() || 'Task', 200),
          messageId: null,
          conversationId: null,
          doneMessageId: null,
        },
      });
    }
    await tx.chatMessage.deleteMany({ where: { conversationId: c.id } });
    await tx.chatImage.deleteMany({ where: { conversationId: c.id } });
    // A group stays in its members' lists, even with nothing in it.
    await tx.conversation.update({
      where: { id: c.id },
      data: { lastMessageAt: isDirect(c) ? null : new Date(), userALastReadAt: null, userBLastReadAt: null },
    });
    if (!isDirect(c)) await tx.conversationMember.updateMany({ where: { conversationId: c.id }, data: { lastReadAt: null } });
  });
  emitToMembers(c, 'chat:cleared', { conversationId: c.id });
  res.status(204).end();
});

/** A chat picture, for the two people in the chat only. */
chatRouter.get('/chat/images/:id', async (req, res) => {
  const actor = actorOf(req);
  const id = idParam(req);
  const image = id
    ? await prisma.chatImage.findUnique({
        where: { id },
        select: { contentType: true, data: true, conversation: { select: { kind: true, userAId: true, userBId: true, members: { select: { userId: true } } } } },
      })
    : null;
  if (!image || !isParticipant(image.conversation, actor.id)) throw notFound('Picture');
  res
    .type(image.contentType)
    // Never changes once sent; private so shared caches keep no copy.
    .set('Cache-Control', 'private, max-age=31536000, immutable')
    .send(Buffer.from(image.data));
});

async function loadMessageForReaction(actor: Actor, id: string | null) {
  if (!id) throw notFound('Message');
  const m = await prisma.chatMessage.findUnique({
    where: { id },
    include: { conversation: { include: conversationInclude }, todo: { select: { id: true } } },
  });
  if (!m || !isParticipant(m.conversation, actor.id)) throw notFound('Message');
  return m;
}

/**
 * The sender deletes their message for both people. Its text and picture are erased,
 * its reactions removed, and a "deleted" placeholder stays in the chat.
 */
chatRouter.delete('/chat/messages/:id', async (req, res) => {
  const actor = actorOf(req);
  const m = await loadMessageForReaction(actor, idParam(req));
  // A group's owner and admins also take down anyone's message.
  const moderates = !isDirect(m.conversation) && runsGroup(roleIn(m.conversation, actor.id));
  if (m.senderId !== actor.id && !moderates) throw forbidden('You can only delete your own messages');
  if (m.deletedAt) throw conflict('This message is already deleted');
  if (m.kind === 'ring') throw conflict('A ring stays in the chat');
  if (m.kind === 'system') throw conflict('What happened in a group stays in it');
  if (m.kind !== 'text') throw conflict('A task’s done reply cannot be deleted');
  if (m.todo) throw conflict('This message is a task. Remove the task first.');
  const updated = await prisma.$transaction(async (tx) => {
    await tx.chatReaction.deleteMany({ where: { messageId: m.id } });
    const message = await tx.chatMessage.update({
      where: { id: m.id },
      data: { body: '', imageId: null, scheduling: Prisma.DbNull, deletedAt: new Date() },
      include: messageInclude,
    });
    // The picture goes too, right away.
    if (m.imageId) await tx.chatImage.delete({ where: { id: m.imageId } });
    return message;
  });
  const dto = toMessageDTO(updated);
  emitToMembers(m.conversation, 'chat:message-updated', dto);
  res.json(dto);
});

/** Adds the caller's emoji reaction, or takes it back if they had already reacted with it. */
chatRouter.post('/chat/messages/:id/reactions', async (req, res) => {
  const actor = actorOf(req);
  const m = await loadMessageForReaction(actor, idParam(req));
  const { emoji } = parseBody(chatReactionSchema, req);
  if (m.deletedAt) throw conflict('This message was deleted');
  if (m.kind === 'system') throw conflict('What happened in a group takes no reactions');
  if (!canSendIn(m.conversation, actor.id)) throw forbidden('This chat is closed: the other person is no longer available');
  const key = { messageId_userId_emoji: { messageId: m.id, userId: actor.id, emoji } };
  const existing = await prisma.chatReaction.findUnique({ where: key });
  if (existing) {
    await prisma.chatReaction.delete({ where: key });
  } else {
    const mine = await prisma.chatReaction.count({ where: { messageId: m.id, userId: actor.id } });
    if (mine >= 10) throw conflict('That’s enough reactions on one message');
    await prisma.chatReaction.create({ data: { messageId: m.id, userId: actor.id, emoji } }).catch((err: unknown) => {
      // A double click racing itself: the reaction is there either way.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    });
  }
  const dto = toMessageDTO(await prisma.chatMessage.findUniqueOrThrow({ where: { id: m.id }, include: messageInclude }));
  emitToMembers(m.conversation, 'chat:message-updated', dto);
  res.json(dto);
});

// --- Tasks -----------------------------------------------------------------------------
//
// The Founder gives tasks to anyone, a Manager to the Associates on their team (canGiveTask).
// A task comes from a chat message or stands alone with a title. The taker marks it done,
// then the giver confirms it (completed) or reopens it.

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const todoText = (t: { title: string | null; message: { body: string } | null }) => t.message?.body ?? t.title ?? '';

/**
 * The board is four quadrants — need action or can wait, strategic or not — and
 * a task lives in one of them. A task nobody placed starts where work starts:
 * needing action, and strategic.
 */
type Quadrant = { urgency: TodoUrgency; importance: TodoImportance };
const quadrantOf = (input: Partial<Quadrant>): Quadrant => ({
  urgency: input.urgency ?? DEFAULT_TODO_URGENCY,
  importance: input.importance ?? DEFAULT_TODO_IMPORTANCE,
});

/** A new task goes to the top of its quadrant, above everything already there. */
async function topPosition(tx: Db, assigneeId: string, quadrant: Quadrant): Promise<number> {
  const top = await tx.todo.aggregate({ where: { assigneeId, ...quadrant }, _min: { position: true } });
  return (top._min.position ?? 0) - TODO_POSITION_STEP;
}

/** Tells the giver and the taker (and so every open chat or task list of theirs) about a change. */
function emitTodo(t: { assigneeId: string; createdById: string }, payload: TodoDTO | TodoRemovedEvent) {
  emitToUser(t.assigneeId, 'chat:todo', payload);
  emitToUser(t.createdById, 'chat:todo', payload);
}

async function loadMessageInMyChat(actor: Actor, id: string | null) {
  if (!id) throw notFound('Message');
  const m = await prisma.chatMessage.findUnique({
    where: { id },
    include: { conversation: { include: conversationInclude }, todo: true },
  });
  if (!m || !isParticipant(m.conversation, actor.id)) throw notFound('Message');
  return m;
}

/** A task the caller gave or was given; anyone else gets a 404. */
async function loadTodo(actor: Actor, id: string | null) {
  const t = id ? await prisma.todo.findUnique({ where: { id }, include: { conversation: true } }) : null;
  if (!t || (t.assigneeId !== actor.id && t.createdById !== actor.id)) throw notFound('Task');
  return t;
}

/** Turns a message in the caller's chat into a task for the other person. */
chatRouter.post('/chat/messages/:id/todo', async (req, res) => {
  const actor = actorOf(req);
  const m = await loadMessageInMyChat(actor, idParam(req));
  if (!isDirect(m.conversation)) throw badRequest('Tasks come from one-to-one chats');
  const assignee = otherOf(m.conversation, actor.id);
  if (!canGiveTask(actor, asTaker(assignee))) throw forbidden('You cannot give tasks to this person');
  if (m.kind !== 'text') throw conflict('Only regular messages can become tasks');
  if (m.todo) throw conflict('This message is already a task');
  if (!assignee.isActive) throw conflict('The other person is no longer active');

  const { todo, deliver } = await prisma.$transaction(async (tx) => {
    const todo = await tx.todo.create({
      data: {
        messageId: m.id,
        conversationId: m.conversationId,
        assigneeId: assignee.id,
        createdById: actor.id,
        // A task handed over in chat lands where a new task lands.
        position: await topPosition(tx, assignee.id, quadrantOf({})),
      },
      include: todoInclude,
    });
    const deliver = await notify(tx, [assignee.id], 'todo.assigned', {
      todoId: todo.id,
      conversationId: m.conversationId,
      actor: { nickname: actor.nickname, role: actor.role },
      summary: clip(m.body, 120),
    });
    return { todo, deliver };
  });
  deliver();
  const dto = toTodoDTO(todo);
  emitTodo(todo, dto);
  res.status(201).json(dto);
});

/** The giver removes a task: an open one, or a completed one they no longer need. */
async function removeTodo(actor: Actor, t: { id: string; status: string; createdById: string; assigneeId: string; conversationId: string | null; messageId: string | null }) {
  if (t.createdById !== actor.id) throw forbidden('Only the person who gave the task can remove it');
  // Before it starts, or once both sides have ticked it off; not while it waits for confirmation.
  if (t.status === 'done') throw conflict('Confirm or reopen this task before removing it');
  await prisma.todo.delete({ where: { id: t.id } });
  emitTodo(t, { id: t.id, conversationId: t.conversationId, messageId: t.messageId, removed: true });
}

chatRouter.delete('/chat/messages/:id/todo', async (req, res) => {
  const actor = actorOf(req);
  const m = await loadMessageInMyChat(actor, idParam(req));
  if (!m.todo) throw notFound('Task');
  await removeTodo(actor, m.todo);
  res.status(204).end();
});

/** People the caller may give a task to — themselves first, then anyone below them. */
chatRouter.get('/todos/assignees', async (req, res) => {
  const actor = actorOf(req);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: userRefSelect });
  const others =
    actor.role === 'founder' || actor.role === 'manager'
      ? await prisma.user.findMany({
          where: {
            isActive: true,
            id: { not: actor.id },
            ...(actor.role === 'manager' ? { role: 'associate' as const } : {}),
          },
          select: userRefSelect,
          orderBy: [{ role: 'asc' }, { nickname: 'asc' }],
        })
      : [];
  res.json([me, ...others].map(toUserRef));
});

/** A task that doesn't come from a chat message. */
chatRouter.post('/todos', async (req, res) => {
  const actor = actorOf(req);
  const input = parseBody(createTodoSchema, req);
  const assignee = await prisma.user.findUnique({
    where: { id: input.assigneeId },
    select: { id: true, role: true, managerId: true, isActive: true },
  });
  if (!assignee || !assignee.isActive) {
    throw badRequest('Choose who the task is for', { issues: [{ path: 'assigneeId', message: 'Not an active user' }] });
  }
  if (!canGiveTask(actor, asTaker(assignee))) throw forbidden('You cannot give tasks to this person');

  const { todo, deliver } = await prisma.$transaction(async (tx) => {
    const quadrant = quadrantOf(input);
    const todo = await tx.todo.create({
      data: {
        title: input.title,
        assigneeId: assignee.id,
        createdById: actor.id,
        ...quadrant,
        ...taskFields(input),
        position: await topPosition(tx, assignee.id, quadrant),
      },
      include: todoInclude,
    });
    // The row is read back once its dependencies are in place, so the answer
    // carries them.
    if (input.dependsOn?.length) await setDependencies(tx, todo.id, input.dependsOn);
    const withDeps = input.dependsOn?.length ? await tx.todo.findUniqueOrThrow({ where: { id: todo.id }, include: todoInclude }) : todo;
    // A task you put on your own list tells you nothing you don't know.
    const deliver = await notify(tx, assignee.id === actor.id ? [] : [assignee.id], 'todo.assigned', {
      todoId: todo.id,
      actor: { nickname: actor.nickname, role: actor.role },
      summary: clip(input.title, 120),
    });
    return { todo: withDeps, deliver };
  });
  deliver();
  const dto = toTodoDTO(todo);
  emitTodo(todo, dto);
  res.status(201).json(dto);
});

chatRouter.delete('/todos/:id', async (req, res) => {
  const actor = actorOf(req);
  await removeTodo(actor, await loadTodo(actor, idParam(req)));
  res.status(204).end();
});

/**
 * When work should begin and when it must be finished, what it should produce,
 * and how anyone can tell it is done. Only the fields that were sent change.
 */
function taskFields(input: TaskFieldInput): TaskFields {
  const data: TaskFields = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.details !== undefined) data.details = input.details ?? null;
  if (input.expectedDeliverable !== undefined) data.expectedDeliverable = input.expectedDeliverable ?? null;
  if (input.definitionOfDone !== undefined) data.definitionOfDone = input.definitionOfDone ?? null;
  if (input.timeZone !== undefined) data.timeZone = input.timeZone;
  // A date cleared takes its "and a time was given" with it.
  if (input.startByAt !== undefined) {
    data.startByAt = input.startByAt ? new Date(input.startByAt) : null;
    data.startByHasTime = input.startByAt ? (input.startByHasTime ?? false) : false;
  }
  if (input.completeByAt !== undefined) {
    data.completeByAt = input.completeByAt ? new Date(input.completeByAt) : null;
    data.completeByHasTime = input.completeByAt ? (input.completeByHasTime ?? false) : false;
  }
  return data;
}

/** The stored shape of those fields, usable in a create and in an update alike. */
type TaskFields = Partial<{
  title: string;
  details: string | null;
  expectedDeliverable: string | null;
  definitionOfDone: string | null;
  timeZone: string;
  startByAt: Date | null;
  startByHasTime: boolean;
  completeByAt: Date | null;
  completeByHasTime: boolean;
}>;

type TaskFieldInput = Partial<{
  title: string;
  details: string | null;
  expectedDeliverable: string | null;
  definitionOfDone: string | null;
  timeZone: string;
  startByAt: string | null;
  startByHasTime: boolean;
  completeByAt: string | null;
  completeByHasTime: boolean;
}>;

/**
 * What a task waits for. A task cannot wait for itself, nor for anything that
 * already waits on it — a circle of tasks is a plan nobody can ever start.
 */
async function setDependencies(tx: Db, todoId: string, ids: string[]) {
  const unique = [...new Set(ids)].filter((id) => id !== todoId);
  const found = await tx.todo.findMany({ where: { id: { in: unique } }, select: { id: true } });
  if (found.length !== unique.length) {
    throw badRequest('One of those tasks no longer exists', { issues: [{ path: 'dependsOn', message: 'Task not found' }] });
  }
  for (const id of unique) {
    if (await waitsOn(tx, id, todoId)) {
      throw conflict('That task already waits for this one, and two tasks cannot wait for each other');
    }
  }
  await tx.todoDependency.deleteMany({ where: { todoId } });
  if (unique.length) await tx.todoDependency.createMany({ data: unique.map((dependsOnId) => ({ todoId, dependsOnId })) });
}

/** Does `from` wait, directly or through others, for `target`? */
async function waitsOn(tx: Db, from: string, target: string): Promise<boolean> {
  const seen = new Set<string>();
  let frontier = [from];
  // The chain is short in practice; the cap stops a malformed graph spinning.
  for (let depth = 0; depth < 20 && frontier.length; depth += 1) {
    const rows = await tx.todoDependency.findMany({ where: { todoId: { in: frontier } }, select: { dependsOnId: true } });
    const next = rows.map((r) => r.dependsOnId).filter((id) => !seen.has(id));
    if (next.includes(target)) return true;
    next.forEach((id) => seen.add(id));
    frontier = next;
  }
  return false;
}

/**
 * Who may change a task: the person who gave it, and anyone above the owner who
 * could have given it to them. Not the owner — a deadline you can move yourself
 * is not a commitment to anyone. A task you gave yourself is yours either way,
 * because you are also the giver.
 */
function mayEditTask(actor: Actor, todo: { createdById: string; assignee: { id: string; role: string } }): boolean {
  if (todo.createdById === actor.id) return true;
  return todo.assignee.id !== actor.id && canGiveTask(actor, asTaker(todo.assignee));
}

/** Changing a task after it was given: its wording, its dates, what it should produce. */
chatRouter.patch('/todos/:id', async (req, res) => {
  const actor = actorOf(req);
  const existing = await loadTodoForEdit(actor, idParam(req));
  const input = parseBody(updateTodoSchema, req);
  if (!mayEditTask(actor, existing)) throw forbidden('You cannot change this task');
  if (input.title !== undefined && existing.messageId) {
    throw conflict('This task came from a chat message, so its words are the message');
  }
  const quadrant =
    input.urgency || input.importance ?
      { urgency: input.urgency ?? existing.urgency, importance: input.importance ?? existing.importance }
    : null;

  const todo = await prisma.$transaction(async (tx) => {
    if (input.dependsOn !== undefined) await setDependencies(tx, existing.id, input.dependsOn);
    return tx.todo.update({
      where: { id: existing.id },
      data: {
        ...taskFields(input),
        ...(quadrant ?? {}),
        // Moved to another quadrant, it goes to the top of it, as a drop would.
        ...(quadrant && !sameQuadrant(quadrant, existing) ? { position: await topPosition(tx, existing.assigneeId, quadrant) } : {}),
      },
      include: todoInclude,
    });
  });
  const dto = toTodoDTO(todo);
  emitTodo(todo, dto);
  for (const userId of await boardWatchers()) emitToUser(userId, 'chat:todos-reordered', { assigneeId: todo.assigneeId });
  res.json(dto);
});

/**
 * The owner says where the work stands: not started, in progress, or blocked
 * with a reason. Finishing is a different move (`done`), because it asks the
 * giver for something.
 */
chatRouter.post('/todos/:id/status', async (req, res) => {
  const actor = actorOf(req);
  const existing = await loadTodoForEdit(actor, idParam(req));
  const { status, blockedReason } = parseBody(todoStatusSchema, req);
  if (existing.assigneeId !== actor.id && !mayEditTask(actor, existing)) throw forbidden('You cannot change this task');
  if (!isActiveTodo(existing.status)) throw conflict('This task is already finished; reopen it first');

  const todo = await prisma.todo.update({
    where: { id: existing.id },
    data: { status, blockedReason: status === 'blocked' ? (blockedReason ?? null) : null },
    include: todoInclude,
  });
  const dto = toTodoDTO(todo);
  emitTodo(todo, dto);
  // A task nobody can get on with is the giver's problem too.
  if (status === 'blocked' && existing.createdById !== actor.id) {
    const deliver = await notify(prisma, [existing.createdById], 'todo.blocked', {
      todoId: todo.id,
      actor: { nickname: actor.nickname, role: actor.role },
      summary: `Blocked: ${clip(todoText(todo), 100)}${blockedReason ? ` — ${clip(blockedReason, 120)}` : ''}`,
    });
    deliver();
  }
  res.json(dto);
});

/** A task the caller gave or was given, with enough of it to decide who may change it. */
async function loadTodoForEdit(actor: Actor, id: string | null) {
  const t = id ? await prisma.todo.findUnique({ where: { id }, include: { assignee: { select: { id: true, role: true } } } }) : null;
  if (!t) throw notFound('Task');
  if (t.assigneeId !== actor.id && t.createdById !== actor.id && !canGiveTask(actor, asTaker(t.assignee))) throw notFound('Task');
  return t;
}

/**
 * Drag and drop onto someone else's panel: the giver hands an open task to another
 * person they may give tasks to. Tasks made from a chat message belong to that chat,
 * so they stay with the person in it.
 */
chatRouter.post('/todos/:id/move', async (req, res) => {
  const actor = actorOf(req);
  const existing = await loadTodo(actor, idParam(req));
  const { assigneeId, ...where } = parseBody(moveTodoSchema, req);
  // Dropped on a quadrant, the task goes there. On the person's own board it
  // otherwise stays put; handed to someone else it lands where a new task lands,
  // so a task given to you always turns up in the same corner.
  const quadrant: Quadrant =
    existing.assigneeId === assigneeId ?
      { urgency: where.urgency ?? existing.urgency, importance: where.importance ?? existing.importance }
    : quadrantOf(where);
  // Staying with the same person: a drop on another quadrant of their own board.
  if (existing.assigneeId === assigneeId) {
    const moved =
      existing.urgency === quadrant.urgency && existing.importance === quadrant.importance ?
        await prisma.todo.findUniqueOrThrow({ where: { id: existing.id }, include: todoInclude })
      : await prisma.$transaction(async (tx) =>
          tx.todo.update({
            where: { id: existing.id },
            data: { ...quadrant, position: await topPosition(tx, assigneeId, quadrant) },
            include: todoInclude,
          }),
        );
    const dto = toTodoDTO(moved);
    emitTodo(moved, dto);
    for (const userId of await boardWatchers()) emitToUser(userId, 'chat:todos-reordered', { assigneeId });
    res.json(dto);
    return;
  }
  if (existing.createdById !== actor.id) throw forbidden('Only the person who gave the task can hand it to someone else');
  if (existing.conversationId) throw conflict('This task came from a chat, so it stays with the person in that chat');
  if (!isActiveTodo(existing.status)) throw conflict('Only tasks still to do can be handed on');
  const assignee = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { id: true, role: true, managerId: true, isActive: true },
  });
  if (!assignee || !assignee.isActive) {
    throw badRequest('Choose who the task is for', { issues: [{ path: 'assigneeId', message: 'Not an active user' }] });
  }
  if (!canGiveTask(actor, asTaker(assignee))) throw forbidden('You cannot give tasks to this person');

  const { todo, deliver } = await prisma.$transaction(async (tx) => {
    const todo = await tx.todo.update({
      where: { id: existing.id },
      data: { assigneeId: assignee.id, ...quadrant, position: await topPosition(tx, assignee.id, quadrant) },
      include: todoInclude,
    });
    const deliver = await notify(tx, assignee.id === actor.id ? [] : [assignee.id], 'todo.assigned', {
      todoId: todo.id,
      actor: { nickname: actor.nickname, role: actor.role },
      summary: clip(todoText(todo), 120),
    });
    return { todo, deliver };
  });
  deliver();
  const dto = toTodoDTO(todo);
  // The previous taker's lists drop it; the new taker and the giver get it.
  if (existing.assigneeId !== actor.id) {
    emitToUser(existing.assigneeId, 'chat:todo', { id: todo.id, conversationId: null, messageId: null, removed: true });
  }
  emitTodo(todo, dto);
  for (const userId of await boardWatchers()) emitToUser(userId, 'chat:todos-reordered', { assigneeId: existing.assigneeId });
  res.json(dto);
});

/**
 * Drag and drop: the new order of one person's panel. Their own panel is theirs
 * to arrange, and so is the panel of anyone they may give tasks to. Everyone
 * looking at the board sees the same order.
 */
chatRouter.post('/todos/reorder', async (req, res) => {
  const actor = actorOf(req);
  const { assigneeId, ids, ...into } = parseBody(reorderTodosSchema, req);
  // The quadrant these tasks now belong to; left out, each keeps the one it has.
  const quadrant = into.urgency && into.importance ? { urgency: into.urgency, importance: into.importance } : null;
  const assignee = await prisma.user.findUnique({ where: { id: assigneeId }, select: { id: true, role: true } });
  if (!assignee) throw notFound('Person');
  if (assigneeId !== actor.id && !canGiveTask(actor, asTaker(assignee))) {
    throw forbidden('You cannot arrange this person\u2019s tasks');
  }
  const unique = [...new Set(ids)];
  const rows = await prisma.todo.findMany({ where: { id: { in: unique }, assigneeId }, select: { id: true } });
  if (rows.length !== unique.length) throw conflict('These tasks just changed; refresh and try again');

  await prisma.$transaction(async (tx) => {
    // Tasks dragged in from another quadrant arrive first, so the ordering below
    // sees the quadrant as it will be.
    if (quadrant) await tx.todo.updateMany({ where: { id: { in: unique } }, data: quadrant });
    // The caller sends the order they can see; anything the filter hides keeps its
    // own order below it, so the numbers stay sound whatever was on screen.
    const all = await tx.todo.findMany({
      where: { assigneeId, ...(quadrant ?? {}) },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      select: { id: true },
    });
    const ordered = [...unique, ...all.map((t) => t.id).filter((id) => !unique.includes(id))];
    await Promise.all(
      ordered.map((id, i) => tx.todo.update({ where: { id }, data: { position: (i + 1) * TODO_POSITION_STEP } })),
    );
  });
  for (const userId of new Set([assigneeId, actor.id, ...(await boardWatchers())])) {
    emitToUser(userId, 'chat:todos-reordered', { assigneeId });
  }
  res.status(204).end();
});

/** Everyone whose board can hold someone else's panel. */
async function boardWatchers(): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { isActive: true, role: { in: ['founder', 'manager'] } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** `assigned`: tasks given to me. `created`: tasks I gave. Open first, then done, then completed; newest first. */
/** `active` keeps a task until a week after it was confirmed, so finished work stays in sight. */
function todoStatusWhere(status: 'active' | 'all' | TodoStatus): Prisma.TodoWhereInput {
  if (status === 'all') return {};
  if (status !== 'active') return { status };
  const since = new Date(Date.now() - COMPLETED_TASK_DAYS * 24 * 60 * 60 * 1000);
  return { OR: [{ status: { in: [...ACTIVE_TODO_STATUSES, 'done'] } }, { status: 'completed', confirmedAt: { gte: since } }] };
}

chatRouter.get('/todos', async (req, res) => {
  const actor = actorOf(req);
  const { scope, status } = parseQuery(listTodosQuerySchema, req);
  const rows = await prisma.todo.findMany({
    where: {
      ...(scope === 'assigned' ? { assigneeId: actor.id } : { createdById: actor.id }),
      ...todoStatusWhere(status),
    },
    include: todoInclude,
    orderBy: [{ status: 'asc' }, { position: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  res.json(rows.map(toTodoDTO));
});

/**
 * The task board: the caller's own tasks first, then a panel for each person below them
 * (a Manager's Associates, everyone for the Founder). Each panel holds that person's tasks,
 * whoever gave them.
 */
chatRouter.get('/todos/board', async (req, res) => {
  const actor = actorOf(req);
  const { status } = parseQuery(todoBoardQuerySchema, req);
  const below =
    actor.role === 'founder'
      ? await prisma.user.findMany({
          where: { deletedAt: null, id: { not: actor.id } },
          select: { ...userRefSelect, isActive: true, managerId: true },
          orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { nickname: 'asc' }],
        })
      : actor.role === 'manager'
        ? await prisma.user.findMany({
            where: { deletedAt: null, role: 'associate' },
            select: { ...userRefSelect, isActive: true, managerId: true },
            orderBy: [{ isActive: 'desc' }, { nickname: 'asc' }],
          })
        : [];
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { ...userRefSelect, isActive: true, managerId: true } });
  const people = [me, ...below];

  const rows = await prisma.todo.findMany({
    where: {
      assigneeId: { in: people.map((p) => p.id) },
      ...todoStatusWhere(status),
    },
    include: todoInclude,
    // The panel's own order, set by dragging; new tasks arrive at the top.
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
    take: 1000,
  });
  const counts = await prisma.todo.groupBy({
    by: ['assigneeId', 'status'],
    where: { assigneeId: { in: people.map((p) => p.id) } },
    _count: { _all: true },
  });

  const body: TodoPanel[] = people.map((person) => ({
    person: { ...toUserRef(person), isActive: person.isActive },
    isMe: person.id === actor.id,
    canGive: canGiveTask(actor, asTaker(person)),
    tasks: rows.filter((t) => t.assigneeId === person.id).map(toTodoDTO),
    counts: countsFor(counts, person.id),
  }));
  // Only people with tasks, plus everyone the caller may give tasks to.
  res.json(body.filter((p) => p.isMe || p.canGive || p.tasks.length > 0));
});

/**
 * The taker marks a task done. For a chat task this posts a reply to the task message.
 * A task someone gave themselves has nobody to confirm it, so ticking it finishes it.
 */
chatRouter.post('/todos/:id/done', async (req, res) => {
  const actor = actorOf(req);
  const existing = await loadTodo(actor, idParam(req));
  const { note } = parseBody(todoDoneSchema, req);
  if (existing.assigneeId !== actor.id) throw forbidden('Only the person the task is for can mark it done');
  if (!isActiveTodo(existing.status)) throw conflict('This task is already done');
  const mine = existing.createdById === actor.id;

  const now = new Date();
  const { todo, message, deliver } = await prisma.$transaction(async (tx) => {
    // Guard against a double click racing past the check above.
    const claimed = await tx.todo.updateMany({
      where: { id: existing.id, status: { in: [...ACTIVE_TODO_STATUSES] } },
      // Finishing a blocked task unblocks it: the reason no longer applies.
      data: { status: mine ? 'completed' : 'done', doneAt: now, doneNote: note ?? null, blockedReason: null, ...(mine ? { confirmedAt: now } : {}) },
    });
    if (!claimed.count) throw conflict('This task is already done');
    let message: MessageRow | null = null;
    if (existing.conversation) {
      message = await tx.chatMessage.create({
        data: {
          conversationId: existing.conversation.id,
          senderId: actor.id,
          body: note ?? 'Done',
          kind: 'todo_done',
          replyToId: existing.messageId,
          createdAt: now,
        },
        include: messageInclude,
      });
      await tx.conversation.update({
        where: { id: existing.conversation.id },
        data: {
          lastMessageAt: now,
          ...(existing.conversation.userAId === actor.id ? { userALastReadAt: now } : { userBLastReadAt: now }),
        },
      });
    }
    const todo = await tx.todo.update({ where: { id: existing.id }, data: { doneMessageId: message?.id ?? null }, include: todoInclude });
    // Nobody is told about a task you gave yourself and ticked off.
    const deliver = await notify(tx, mine ? [] : [existing.createdById], 'todo.done', {
      todoId: existing.id,
      ...(existing.conversationId ? { conversationId: existing.conversationId } : {}),
      actor: { nickname: actor.nickname, role: actor.role },
      summary: `Done: ${clip(todoText(todo), 100)}`,
    });
    return { todo, message, deliver };
  });
  deliver();
  if (message && existing.conversation) emitToMembers(existing.conversation, 'chat:message', toMessageDTO(message));
  const dto = toTodoDTO(todo);
  emitTodo(todo, dto);
  res.json(dto);
});

/** The giver moves a task on: `confirm` completes a done task, `reopen` sends it back to the taker. */
async function reviewTodo(actor: Actor, id: string | null, action: 'confirm' | 'reopen', note: string | null) {
  const existing = await loadTodo(actor, id);
  if (existing.createdById !== actor.id) throw forbidden('Only the person who gave the task can do this');
  const from = action === 'confirm' ? (['done'] as const) : (['done', 'completed'] as const);
  if (!(from as readonly string[]).includes(existing.status)) {
    throw conflict(action === 'confirm' ? 'Only a task marked done can be confirmed' : 'This task is still open');
  }
  const { todo, deliver } = await prisma.$transaction(async (tx) => {
    const claimed = await tx.todo.updateMany({
      where: { id: existing.id, status: { in: [...from] } },
      data:
        action === 'confirm'
          ? { status: 'completed', confirmedAt: new Date() }
          : { status: 'open', doneAt: null, doneNote: null, doneMessageId: null, confirmedAt: null, blockedReason: null },
    });
    if (!claimed.count) throw conflict('This task just changed; refresh and try again');
    const todo = await tx.todo.findUniqueOrThrow({ where: { id: existing.id }, include: todoInclude });
    const text = clip(todoText(todo), 100);
    const deliver = await notify(tx, [existing.assigneeId], action === 'confirm' ? 'todo.completed' : 'todo.reopened', {
      todoId: existing.id,
      ...(existing.conversationId ? { conversationId: existing.conversationId } : {}),
      actor: { nickname: actor.nickname, role: actor.role },
      summary: note ? `${text} — ${clip(note, 120)}` : text,
    });
    return { todo, deliver };
  });
  deliver();
  const dto = toTodoDTO(todo);
  emitTodo(todo, dto);
  return dto;
}

chatRouter.post('/todos/:id/confirm', async (req, res) => {
  res.json(await reviewTodo(actorOf(req), idParam(req), 'confirm', null));
});

chatRouter.post('/todos/:id/reopen', async (req, res) => {
  const { note } = parseBody(todoDoneSchema, req);
  res.json(await reviewTodo(actorOf(req), idParam(req), 'reopen', note ?? null));
});
