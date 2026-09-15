import {
  canChat,
  chatMessageSchema,
  chatMessagesQuerySchema,
  listTodosQuerySchema,
  startConversationSchema,
  todoDoneSchema,
  type ChatMessageDTO,
  type ConversationDTO,
  type CursorPage,
  type Role,
  type ServerToClientEvents,
  type TodoDTO,
  type TodoSummary,
} from '@god/shared';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { prisma, type Db } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { idParam, iso, isoOrNull, parseBody, parseQuery } from '../http';
import { notify } from '../notifications/notify';
import { emitToUser } from '../realtime/hub';
import { toUserRef, userRefSelect } from '../serializers';

export const chatRouter = Router();
chatRouter.use(['/chat', '/todos'], requireAuth);

// --- Loading & serializing -----------------------------------------------------

const participantSelect = { ...userRefSelect, isActive: true } satisfies Prisma.UserSelect;

const conversationInclude = {
  userA: { select: participantSelect },
  userB: { select: participantSelect },
} satisfies Prisma.ConversationInclude;
type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof conversationInclude }>;

const todoSummaryInclude = {
  assignee: { select: userRefSelect },
  createdBy: { select: userRefSelect },
} satisfies Prisma.TodoInclude;

const messageInclude = {
  sender: { select: userRefSelect },
  replyTo: { select: { id: true, body: true, sender: { select: userRefSelect } } },
  todo: { include: todoSummaryInclude },
} satisfies Prisma.ChatMessageInclude;
type MessageRow = Prisma.ChatMessageGetPayload<{ include: typeof messageInclude }>;

const todoInclude = {
  ...todoSummaryInclude,
  message: { select: { id: true, body: true, createdAt: true, sender: { select: userRefSelect } } },
} satisfies Prisma.TodoInclude;
type TodoRow = Prisma.TodoGetPayload<{ include: typeof todoInclude }>;

const toTodoSummary = (t: Prisma.TodoGetPayload<{ include: typeof todoSummaryInclude }>): TodoSummary => ({
  id: t.id,
  status: t.status,
  assignee: toUserRef(t.assignee),
  createdBy: toUserRef(t.createdBy),
  doneAt: isoOrNull(t.doneAt),
});

const toMessageDTO = (m: MessageRow): ChatMessageDTO => ({
  id: m.id,
  conversationId: m.conversationId,
  sender: toUserRef(m.sender),
  body: m.body,
  kind: m.kind,
  replyTo: m.replyTo ? { id: m.replyTo.id, body: m.replyTo.body, sender: toUserRef(m.replyTo.sender) } : null,
  todo: m.todo ? toTodoSummary(m.todo) : null,
  createdAt: iso(m.createdAt),
});

const toTodoDTO = (t: TodoRow): TodoDTO => ({
  ...toTodoSummary(t),
  conversationId: t.conversationId,
  message: { id: t.message.id, body: t.message.body, sender: toUserRef(t.message.sender), createdAt: iso(t.message.createdAt) },
  doneNote: t.doneNote,
  createdAt: iso(t.createdAt),
});

const isParticipant = (c: { userAId: string; userBId: string }, userId: string) => c.userAId === userId || c.userBId === userId;
const otherOf = (c: ConversationRow, userId: string) => (c.userAId === userId ? c.userB : c.userA);
const myLastReadAt = (c: ConversationRow, userId: string) => (c.userAId === userId ? c.userALastReadAt : c.userBLastReadAt);
const otherLastReadAt = (c: ConversationRow, userId: string) => (c.userAId === userId ? c.userBLastReadAt : c.userALastReadAt);

/** Both people are active and their roles still allow a chat. */
const canSendIn = (c: ConversationRow) =>
  c.userA.isActive && c.userB.isActive && canChat({ id: c.userA.id, role: c.userA.role as Role }, { id: c.userB.id, role: c.userB.role as Role });

async function loadConversation(actor: Actor, id: string | null): Promise<ConversationRow> {
  if (!id) throw notFound('Conversation');
  const c = await prisma.conversation.findUnique({ where: { id }, include: conversationInclude });
  if (!c || !isParticipant(c, actor.id)) throw notFound('Conversation');
  return c;
}

/** Builds the list entries for the given conversations, as `userId` sees them. */
async function toConversationDTOs(db: Db, rows: ConversationRow[], userId: string): Promise<ConversationDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [lastMessages, unread, openTodos] = await Promise.all([
    db.$queryRaw<Array<{ id: string; conversation_id: string; sender_id: string; body: string; kind: ChatMessageDTO['kind']; created_at: Date }>>`
      SELECT DISTINCT ON (conversation_id) id, conversation_id, sender_id, body, kind, created_at
      FROM chat_messages WHERE conversation_id = ANY(${ids}::uuid[])
      ORDER BY conversation_id, created_at DESC, id DESC`,
    db.$queryRaw<Array<{ id: string; count: bigint }>>`
      SELECT c.id, count(m.id) AS count
      FROM conversations c
      JOIN chat_messages m ON m.conversation_id = c.id
        AND m.sender_id <> ${userId}::uuid
        AND m.created_at > COALESCE(
          CASE WHEN c.user_a_id = ${userId}::uuid THEN c.user_a_last_read_at ELSE c.user_b_last_read_at END,
          '-infinity'::timestamptz)
      WHERE c.id = ANY(${ids}::uuid[])
      GROUP BY c.id`,
    db.todo.groupBy({ by: ['conversationId'], where: { conversationId: { in: ids }, status: 'open' }, _count: { _all: true } }),
  ]);
  return rows.map((c) => {
    const last = lastMessages.find((m) => m.conversation_id === c.id);
    const other = otherOf(c, userId);
    return {
      id: c.id,
      other: { ...toUserRef(other), isActive: other.isActive },
      lastMessage: last
        ? { id: last.id, body: last.body, kind: last.kind, senderId: last.sender_id, createdAt: iso(last.created_at) }
        : null,
      unreadCount: Number(unread.find((u) => u.id === c.id)?.count ?? 0),
      openTodoCount: openTodos.find((t) => t.conversationId === c.id)?._count._all ?? 0,
      otherLastReadAt: isoOrNull(otherLastReadAt(c, userId)),
      canSend: canSendIn(c),
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
    where: { OR: [{ userAId: actor.id }, { userBId: actor.id }], lastMessageAt: { not: null } },
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

/** Newest page first; items inside a page are oldest → newest for display. */
chatRouter.get('/chat/conversations/:id/messages', async (req, res) => {
  const c = await loadConversation(actorOf(req), idParam(req));
  const { cursor, limit } = parseQuery(chatMessagesQuerySchema, req);
  const before = cursor ? decodeCursor(cursor) : null;
  const rows = await prisma.chatMessage.findMany({
    where: {
      conversationId: c.id,
      ...(before
        ? { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] }
        : {}),
    },
    include: messageInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const body: CursorPage<ChatMessageDTO> = {
    items: page.reverse().map(toMessageDTO),
    nextCursor: hasMore ? encodeCursor(page[0]!) : null,
  };
  res.json(body);
});

chatRouter.post('/chat/conversations/:id/messages', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadConversation(actor, idParam(req));
  if (!canSendIn(c)) throw forbidden('This chat is closed: the other person is no longer available');
  const { body } = parseBody(chatMessageSchema, req);
  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const m = await tx.chatMessage.create({
      data: { conversationId: c.id, senderId: actor.id, body, createdAt: now },
      include: messageInclude,
    });
    // Sending counts as reading everything before it.
    await tx.conversation.update({
      where: { id: c.id },
      data: { lastMessageAt: now, ...(c.userAId === actor.id ? { userALastReadAt: now } : { userBLastReadAt: now }) },
    });
    return m;
  });
  const dto = toMessageDTO(message);
  emitToBoth(c, 'chat:message', dto);
  res.status(201).json(dto);
});

chatRouter.post('/chat/conversations/:id/read', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadConversation(actor, idParam(req));
  const readAt = new Date();
  // Never move the marker backwards (e.g. a slow request after a newer one).
  const current = myLastReadAt(c, actor.id);
  if (!current || current < readAt) {
    await prisma.conversation.update({
      where: { id: c.id },
      data: c.userAId === actor.id ? { userALastReadAt: readAt } : { userBLastReadAt: readAt },
    });
  }
  emitToBoth(c, 'chat:read', { conversationId: c.id, userId: actor.id, readAt: iso(readAt) });
  res.status(204).end();
});

// --- To-dos ----------------------------------------------------------------------------

async function loadMessageForFounder(actor: Actor, id: string | null) {
  if (!id) throw notFound('Message');
  const m = await prisma.chatMessage.findUnique({
    where: { id },
    include: { conversation: { include: conversationInclude }, todo: true },
  });
  if (!m || !isParticipant(m.conversation, actor.id)) throw notFound('Message');
  return m;
}

/** A Founder turns any message in their chat into a to-do for the other person. */
chatRouter.post('/chat/messages/:id/todo', requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const m = await loadMessageForFounder(actor, idParam(req));
  if (m.kind !== 'text') throw conflict('Only regular messages can become to-dos');
  if (m.todo) throw conflict('This message is already a to-do');
  const assignee = otherOf(m.conversation, actor.id);
  if (!assignee.isActive) throw conflict('The other person is no longer active');

  const { todo, deliver } = await prisma.$transaction(async (tx) => {
    const todo = await tx.todo.create({
      data: { messageId: m.id, conversationId: m.conversationId, assigneeId: assignee.id, createdById: actor.id },
      include: todoInclude,
    });
    const deliver = await notify(tx, [assignee.id], 'todo.assigned', {
      todoId: todo.id,
      conversationId: m.conversationId,
      actor: { nickname: actor.nickname, role: actor.role },
      summary: m.body.length > 120 ? `${m.body.slice(0, 117)}…` : m.body,
    });
    return { todo, deliver };
  });
  deliver();
  const dto = toTodoDTO(todo);
  emitToBoth(m.conversation, 'chat:todo', dto);
  res.status(201).json(dto);
});

/** A Founder takes back a to-do that is still open. */
chatRouter.delete('/chat/messages/:id/todo', requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const m = await loadMessageForFounder(actor, idParam(req));
  if (!m.todo) throw notFound('To-do');
  if (m.todo.status !== 'open') throw conflict('A done to-do cannot be removed');
  await prisma.todo.delete({ where: { id: m.todo.id } });
  emitToBoth(m.conversation, 'chat:todo', { id: m.todo.id, conversationId: m.conversationId, messageId: m.id, removed: true });
  res.status(204).end();
});

/** `assigned`: my to-dos. `created`: to-dos I gave out (Founders). Open first, newest first. */
chatRouter.get('/todos', async (req, res) => {
  const actor = actorOf(req);
  const { scope, status } = parseQuery(listTodosQuerySchema, req);
  if (scope === 'created' && actor.role !== 'founder') throw forbidden('Only Founders create to-dos');
  const rows = await prisma.todo.findMany({
    where: { ...(scope === 'assigned' ? { assigneeId: actor.id } : { createdById: actor.id }), ...(status ? { status } : {}) },
    include: todoInclude,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  res.json(rows.map(toTodoDTO));
});

/** The assignee marks a to-do done; this posts a reply to the to-do message in the chat. */
chatRouter.post('/todos/:id/done', async (req, res) => {
  const actor = actorOf(req);
  const id = idParam(req);
  const { note } = parseBody(todoDoneSchema, req);
  const existing = id ? await prisma.todo.findUnique({ where: { id }, include: { conversation: true } }) : null;
  if (!existing || !isParticipant(existing.conversation, actor.id)) throw notFound('To-do');
  if (existing.assigneeId !== actor.id) throw forbidden('Only the person the to-do is for can mark it done');
  if (existing.status === 'done') throw conflict('This to-do is already done');

  const now = new Date();
  const { todo, message, deliver } = await prisma.$transaction(async (tx) => {
    // Guard against a double click racing past the check above.
    const claimed = await tx.todo.updateMany({ where: { id: existing.id, status: 'open' }, data: { status: 'done', doneAt: now, doneNote: note ?? null } });
    if (!claimed.count) throw conflict('This to-do is already done');
    const message = await tx.chatMessage.create({
      data: {
        conversationId: existing.conversationId,
        senderId: actor.id,
        body: note ?? 'Done',
        kind: 'todo_done',
        replyToId: existing.messageId,
        createdAt: now,
      },
      include: messageInclude,
    });
    const todo = await tx.todo.update({ where: { id: existing.id }, data: { doneMessageId: message.id }, include: todoInclude });
    await tx.conversation.update({
      where: { id: existing.conversationId },
      data: {
        lastMessageAt: now,
        ...(existing.conversation.userAId === actor.id ? { userALastReadAt: now } : { userBLastReadAt: now }),
      },
    });
    const deliver = await notify(tx, [existing.createdById], 'todo.done', {
      todoId: existing.id,
      conversationId: existing.conversationId,
      actor: { nickname: actor.nickname, role: actor.role },
      summary: `Done: ${todo.message.body.length > 100 ? `${todo.message.body.slice(0, 97)}…` : todo.message.body}`,
    });
    return { todo, message, deliver };
  });
  deliver();
  emitToBoth(existing.conversation, 'chat:message', toMessageDTO(message));
  const dto = toTodoDTO(todo);
  emitToBoth(existing.conversation, 'chat:todo', dto);
  res.json(dto);
});
