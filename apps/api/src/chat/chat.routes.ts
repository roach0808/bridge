import {
  canChat,
  CHAT_IMAGE_MAX_BYTES,
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
  startConversationSchema,
  todoBoardQuerySchema,
  TODO_POSITION_STEP,
  todoDoneSchema,
  type ChatMessageDTO,
  type ChatMessagePage,
  type ConversationDTO,
  type Role,
  type ServerToClientEvents,
  type TodoDTO,
  type TodoImportance,
  type TodoStatus,
  type TodoUrgency,
  type TodoPanel,
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
import { decodeImageDataUrl } from '../images';
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
  replyTo: { select: { id: true, body: true, imageId: true, deletedAt: true, sender: { select: userRefSelect } } },
  todo: { include: todoSummaryInclude },
  image: { select: { id: true, width: true, height: true } },
  reactions: { select: { emoji: true, userId: true }, orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }] },
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
const asTaker = (u: { id: string; role: string }) => ({ id: u.id, role: u.role as Role });

/** Builds the list entries for the given conversations, as `userId` sees them. */
async function toConversationDTOs(db: Db, rows: ConversationRow[], userId: string): Promise<ConversationDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [lastMessages, unread, openTodos] = await Promise.all([
    db.$queryRaw<
      Array<{ id: string; conversation_id: string; sender_id: string; body: string; kind: ChatMessageDTO['kind']; image_id: string | null; deleted_at: Date | null; created_at: Date }>
    >`
      SELECT DISTINCT ON (conversation_id) id, conversation_id, sender_id, body, kind, image_id, deleted_at, created_at
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
        ? {
            id: last.id,
            body: last.body,
            kind: last.kind,
            senderId: last.sender_id,
            hasImage: last.image_id !== null,
            deleted: last.deleted_at !== null,
            createdAt: iso(last.created_at),
          }
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

chatRouter.post('/chat/conversations/:id/messages', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadConversation(actor, idParam(req));
  if (!canSendIn(c)) throw forbidden('This chat is closed: the other person is no longer available');
  const { body, image } = parseBody(chatMessageSchema, req);
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
      data: { conversationId: c.id, senderId: actor.id, body, imageId: stored?.id ?? null, createdAt: now },
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
    body: image ? `📷 Photo${body ? `: ${body.length > 160 ? `${body.slice(0, 157)}…` : body}` : ''}` : body.length > 180 ? `${body.slice(0, 177)}…` : body,
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

/**
 * Erases the whole history with someone, for both of them: every message, picture and
 * reaction. Tasks that came from this chat are kept, each with the message's words as its title.
 */
chatRouter.delete('/chat/conversations/:id/history', async (req, res) => {
  const actor = actorOf(req);
  const c = await loadConversation(actor, idParam(req));
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
    await tx.conversation.update({
      where: { id: c.id },
      data: { lastMessageAt: null, userALastReadAt: null, userBLastReadAt: null },
    });
  });
  emitToBoth(c, 'chat:cleared', { conversationId: c.id });
  res.status(204).end();
});

/** A chat picture, for the two people in the chat only. */
chatRouter.get('/chat/images/:id', async (req, res) => {
  const actor = actorOf(req);
  const id = idParam(req);
  const image = id
    ? await prisma.chatImage.findUnique({
        where: { id },
        select: { contentType: true, data: true, conversation: { select: { userAId: true, userBId: true } } },
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
  if (m.senderId !== actor.id) throw forbidden('You can only delete your own messages');
  if (m.deletedAt) throw conflict('This message is already deleted');
  if (m.kind !== 'text') throw conflict('A task’s done reply cannot be deleted');
  if (m.todo) throw conflict('This message is a task. Remove the task first.');
  const updated = await prisma.$transaction(async (tx) => {
    await tx.chatReaction.deleteMany({ where: { messageId: m.id } });
    const message = await tx.chatMessage.update({
      where: { id: m.id },
      data: { body: '', imageId: null, deletedAt: new Date() },
      include: messageInclude,
    });
    // The picture goes too, right away.
    if (m.imageId) await tx.chatImage.delete({ where: { id: m.imageId } });
    return message;
  });
  const dto = toMessageDTO(updated);
  emitToBoth(m.conversation, 'chat:message-updated', dto);
  res.json(dto);
});

/** Adds the caller's emoji reaction, or takes it back if they had already reacted with it. */
chatRouter.post('/chat/messages/:id/reactions', async (req, res) => {
  const actor = actorOf(req);
  const m = await loadMessageForReaction(actor, idParam(req));
  const { emoji } = parseBody(chatReactionSchema, req);
  if (m.deletedAt) throw conflict('This message was deleted');
  if (!canSendIn(m.conversation)) throw forbidden('This chat is closed: the other person is no longer available');
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
  emitToBoth(m.conversation, 'chat:message-updated', dto);
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
        details: input.details ?? null,
        assigneeId: assignee.id,
        createdById: actor.id,
        ...quadrant,
        position: await topPosition(tx, assignee.id, quadrant),
      },
      include: todoInclude,
    });
    // A task you put on your own list tells you nothing you don't know.
    const deliver = await notify(tx, assignee.id === actor.id ? [] : [assignee.id], 'todo.assigned', {
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
  if (existing.status !== 'open') throw conflict('Only open tasks can be handed on');
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
  return { OR: [{ status: { in: ['open', 'done'] } }, { status: 'completed', confirmedAt: { gte: since } }] };
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
    counts: {
      open: counts.find((c) => c.assigneeId === person.id && c.status === 'open')?._count._all ?? 0,
      done: counts.find((c) => c.assigneeId === person.id && c.status === 'done')?._count._all ?? 0,
      completed: counts.find((c) => c.assigneeId === person.id && c.status === 'completed')?._count._all ?? 0,
    },
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
  if (existing.status !== 'open') throw conflict('This task is already done');
  const mine = existing.createdById === actor.id;

  const now = new Date();
  const { todo, message, deliver } = await prisma.$transaction(async (tx) => {
    // Guard against a double click racing past the check above.
    const claimed = await tx.todo.updateMany({
      where: { id: existing.id, status: 'open' },
      data: { status: mine ? 'completed' : 'done', doneAt: now, doneNote: note ?? null, ...(mine ? { confirmedAt: now } : {}) },
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
