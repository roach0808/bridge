import {
  canChat,
  canGiveTask,
  chatMessageSchema,
  createTodoSchema,
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
  type TodoRemovedEvent,
  type TodoSummary,
} from '@god/shared';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { actorOf, requireAuth, type Actor } from '../auth/middleware';
import { prisma, type Db } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { idParam, iso, isoOrNull, parseBody, parseQuery } from '../http';
import { notify } from '../notifications/notify';
import { sendWebPush } from '../notifications/webPush';
import { emitToUser } from '../realtime/hub';
import { toUserRef, userRefSelect } from '../serializers';

export const chatRouter = Router();
chatRouter.use(['/chat', '/todos'], requireAuth);

// --- Loading & serializing -----------------------------------------------------

const participantSelect = { ...userRefSelect, isActive: true, managerId: true } satisfies Prisma.UserSelect;

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
  confirmedAt: isoOrNull(t.confirmedAt),
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
  message: t.message
    ? { id: t.message.id, body: t.message.body, sender: toUserRef(t.message.sender), createdAt: iso(t.message.createdAt) }
    : null,
  title: t.title,
  details: t.details,
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

const meIn = (c: ConversationRow, userId: string) => {
  const me = c.userAId === userId ? c.userA : c.userB;
  return { id: me.id, role: me.role as Role };
};
const asTaker = (u: { id: string; role: string; managerId: string | null }) => ({ id: u.id, role: u.role as Role, managerId: u.managerId });

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
      canGiveTask: canSendIn(c) && canGiveTask(meIn(c, userId), asTaker(other)),
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
  void sendWebPush([otherOf(c, actor.id).id], {
    title: actor.nickname,
    body: body.length > 180 ? `${body.slice(0, 177)}…` : body,
    url: `/chat/${c.id}`,
    // One notification per chat: a newer message replaces the older one.
    tag: `chat:${c.id}`,
    kind: 'chat',
  });
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

// --- Tasks -----------------------------------------------------------------------------
//
// The Founder gives tasks to anyone, a Manager to the Associates on their team (canGiveTask).
// A task comes from a chat message or stands alone with a title. The taker marks it done,
// then the giver confirms it (completed) or reopens it.

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const todoText = (t: { title: string | null; message: { body: string } | null }) => t.message?.body ?? t.title ?? '';

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
  const assignee = otherOf(m.conversation, actor.id);
  if (!canGiveTask(actor, asTaker(assignee))) throw forbidden('You cannot give tasks to this person');
  if (m.kind !== 'text') throw conflict('Only regular messages can become tasks');
  if (m.todo) throw conflict('This message is already a task');
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
      summary: clip(m.body, 120),
    });
    return { todo, deliver };
  });
  deliver();
  const dto = toTodoDTO(todo);
  emitTodo(todo, dto);
  res.status(201).json(dto);
});

/** The giver takes back a task that is still open. */
async function removeTodo(actor: Actor, t: { id: string; status: string; createdById: string; assigneeId: string; conversationId: string | null; messageId: string | null }) {
  if (t.createdById !== actor.id) throw forbidden('Only the person who gave the task can remove it');
  if (t.status !== 'open') throw conflict('Only an open task can be removed');
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

/** People the caller may give a task to. */
chatRouter.get('/todos/assignees', async (req, res) => {
  const actor = actorOf(req);
  if (actor.role !== 'founder' && actor.role !== 'manager') return void res.json([]);
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      id: { not: actor.id },
      ...(actor.role === 'manager' ? { role: 'associate', managerId: actor.id } : {}),
    },
    select: userRefSelect,
    orderBy: [{ role: 'asc' }, { nickname: 'asc' }],
  });
  res.json(users.map(toUserRef));
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
    const todo = await tx.todo.create({
      data: { title: input.title, details: input.details ?? null, assigneeId: assignee.id, createdById: actor.id },
      include: todoInclude,
    });
    const deliver = await notify(tx, [assignee.id], 'todo.assigned', {
      todoId: todo.id,
      actor: { nickname: actor.nickname, role: actor.role },
      summary: clip(input.title, 120),
    });
    return { todo, deliver };
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

/** `assigned`: tasks given to me. `created`: tasks I gave. Open first, then done, then completed; newest first. */
chatRouter.get('/todos', async (req, res) => {
  const actor = actorOf(req);
  const { scope, status } = parseQuery(listTodosQuerySchema, req);
  if (scope === 'created' && actor.role !== 'founder' && actor.role !== 'manager') {
    throw forbidden('Only Founders and Managers give tasks');
  }
  const rows = await prisma.todo.findMany({
    where: {
      ...(scope === 'assigned' ? { assigneeId: actor.id } : { createdById: actor.id }),
      ...(status === 'all' ? {} : status === 'active' ? { status: { in: ['open', 'done'] } } : { status }),
    },
    include: todoInclude,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  res.json(rows.map(toTodoDTO));
});

/** The taker marks a task done. For a chat task this posts a reply to the task message. */
chatRouter.post('/todos/:id/done', async (req, res) => {
  const actor = actorOf(req);
  const existing = await loadTodo(actor, idParam(req));
  const { note } = parseBody(todoDoneSchema, req);
  if (existing.assigneeId !== actor.id) throw forbidden('Only the person the task is for can mark it done');
  if (existing.status !== 'open') throw conflict('This task is already done');

  const now = new Date();
  const { todo, message, deliver } = await prisma.$transaction(async (tx) => {
    // Guard against a double click racing past the check above.
    const claimed = await tx.todo.updateMany({ where: { id: existing.id, status: 'open' }, data: { status: 'done', doneAt: now, doneNote: note ?? null } });
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
    const deliver = await notify(tx, [existing.createdById], 'todo.done', {
      todoId: existing.id,
      ...(existing.conversationId ? { conversationId: existing.conversationId } : {}),
      actor: { nickname: actor.nickname, role: actor.role },
      summary: `Done: ${clip(todoText(todo), 100)}`,
    });
    return { todo, message, deliver };
  });
  deliver();
  if (message && existing.conversation) emitToBoth(existing.conversation, 'chat:message', toMessageDTO(message));
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
          : { status: 'open', doneAt: null, doneNote: null, doneMessageId: null, confirmedAt: null },
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
