import {
  FEATURES,
  createCallSchema,
  listCallsQuerySchema,
  messageSchema,
  messagesQuerySchema,
  transitionSchema,
  updateCallSchema,
  type CursorPage,
  type MessageDTO,
} from '@god/shared';
import { Router } from 'express';
import { actorOf, requireAuth } from '../auth/middleware';
import { prisma } from '../db';
import { badRequest, notFound } from '../errors';
import { idParam, parseBody, parseQuery } from '../http';
import { notify } from '../notifications/notify';
import { emitToCall } from '../realtime/hub';
import { historyInclude, messageInclude, toHistoryDTO, toMessageDTO } from '../serializers';
import {
  createCall,
  getCallDetail,
  getCallForActor,
  listCalls,
  participantIds,
  transitionCall,
  updateCall,
} from './calls.service';

export const callsRouter = Router();
callsRouter.use('/calls', requireAuth);

callsRouter.get('/calls', async (req, res) => {
  res.json(await listCalls(actorOf(req), parseQuery(listCallsQuerySchema, req)));
});

callsRouter.post('/calls', async (req, res) => {
  res.status(201).json(await createCall(actorOf(req), parseBody(createCallSchema, req)));
});

callsRouter.get('/calls/:id', async (req, res) => {
  res.json(await getCallDetail(actorOf(req), idParam(req)));
});

callsRouter.patch('/calls/:id', async (req, res) => {
  res.json(await updateCall(actorOf(req), idParam(req), parseBody(updateCallSchema, req)));
});

callsRouter.post('/calls/:id/transition', async (req, res) => {
  res.json(await transitionCall(actorOf(req), idParam(req), parseBody(transitionSchema, req)));
});

callsRouter.get('/calls/:id/history', async (req, res) => {
  const call = await getCallForActor(actorOf(req), idParam(req));
  const history = await prisma.callStatusHistory.findMany({
    where: { callId: call.id },
    include: historyInclude,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  res.json(history.map(toHistoryDTO));
});

// --- Messages ---------------------------------------------------------------

// Messaging is switched off for now (FEATURES.messages): the routes do not exist.
callsRouter.use('/calls/:id/messages', (_req, _res, next) => {
  if (!FEATURES.messages) throw notFound('Route');
  next();
});

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
callsRouter.get('/calls/:id/messages', async (req, res) => {
  const call = await getCallForActor(actorOf(req), idParam(req));
  const { cursor, limit } = parseQuery(messagesQuerySchema, req);
  const before = cursor ? decodeCursor(cursor) : null;
  const rows = await prisma.message.findMany({
    where: {
      callId: call.id,
      ...(before
        ? {
            OR: [
              { createdAt: { lt: before.createdAt } },
              { createdAt: before.createdAt, id: { lt: before.id } },
            ],
          }
        : {}),
    },
    include: messageInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const body: CursorPage<MessageDTO> = {
    items: page.reverse().map(toMessageDTO),
    nextCursor: hasMore ? encodeCursor(page[0]!) : null,
  };
  res.json(body);
});

callsRouter.post('/calls/:id/messages', async (req, res) => {
  const actor = actorOf(req);
  const call = await getCallForActor(actor, idParam(req));
  const { body } = parseBody(messageSchema, req);

  const { message, deliver } = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: { callId: call.id, senderId: actor.id, body },
      include: messageInclude,
    });
    const recipients = (await participantIds(tx, call)).filter((id) => id !== actor.id);
    const deliver = await notify(tx, recipients, 'call.message', {
      callId: call.id,
      actor: { nickname: actor.nickname, role: actor.role },
      summary: body.length > 120 ? `${body.slice(0, 117)}…` : body,
    });
    return { message, deliver };
  });

  const dto = toMessageDTO(message);
  emitToCall(call.id, 'call:message', dto);
  deliver();
  res.status(201).json(dto);
});
