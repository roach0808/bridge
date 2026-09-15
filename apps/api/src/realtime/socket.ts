import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { loadActiveActor } from '../auth/middleware';
import { verifyAccessToken } from '../auth/tokens';
import { canViewCall } from '../calls/calls.access';
import { config } from '../config';
import { prisma } from '../db';
import { logger } from '../logger';
import { callRoom, setIo, userRoom, type IoServer } from './hub';

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function createSocketServer(httpServer: HttpServer): IoServer {
  const io: IoServer = new Server(httpServer, {
    cors: { origin: config.CORS_ORIGINS, credentials: true },
    path: '/socket.io',
  });

  // §7.1: verify the JWT on connect; clients re-send a fresh token on reconnect.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('unauthenticated'));
      const { sub } = verifyAccessToken(token);
      const actor = await loadActiveActor(sub);
      if (!actor) return next(new Error('unauthenticated'));
      socket.data.userId = actor.id;
      next();
    } catch {
      next(new Error('unauthenticated'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    void socket.join(userRoom(userId));

    socket.on('call:join', async ({ callId } = { callId: '' }, ack) => {
      try {
        if (typeof callId !== 'string' || !UUID_RE.test(callId)) return ack?.({ ok: false, error: 'not_found' });
        const [actor, call] = await Promise.all([
          loadActiveActor(userId),
          prisma.call.findUnique({
            where: { id: callId },
            select: { status: true, associateId: true, expertId: true, associate: { select: { managerId: true } } },
          }),
        ]);
        if (!actor) {
          socket.disconnect(true);
          return;
        }
        if (!call || !canViewCall(actor, call)) return ack?.({ ok: false, error: 'not_found' });
        await socket.join(callRoom(callId));
        ack?.({ ok: true });
      } catch (err) {
        logger.warn({ err }, 'call:join failed');
        ack?.({ ok: false, error: 'internal_error' });
      }
    });

    socket.on('call:leave', ({ callId } = { callId: '' }) => {
      if (typeof callId === 'string') void socket.leave(callRoom(callId));
    });

    socket.on('user:typing', async ({ callId } = { callId: '' }) => {
      if (typeof callId !== 'string' || !socket.rooms.has(callRoom(callId))) return;
      try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { nickname: true } });
        if (user) socket.to(callRoom(callId)).emit('user:typing', { callId, userId, nickname: user.nickname });
      } catch (err) {
        logger.warn({ err }, 'user:typing failed');
      }
    });
  });

  setIo(io);
  return io;
}
