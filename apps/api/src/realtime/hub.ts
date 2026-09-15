import type { ClientToServerEvents, ServerToClientEvents } from '@god/shared';
import type { Server } from 'socket.io';

export interface SocketData {
  userId: string;
}

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

let io: IoServer | null = null;

export function setIo(server: IoServer | null) {
  io = server;
}

export function getIo(): IoServer | null {
  return io;
}

export const userRoom = (userId: string) => `user:${userId}`;
export const callRoom = (callId: string) => `call:${callId}`;

export function emitToUser<E extends keyof ServerToClientEvents>(
  userId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  io?.to(userRoom(userId)).emit(event, ...args);
}

export function emitToCall<E extends keyof ServerToClientEvents>(
  callId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  io?.to(callRoom(callId)).emit(event, ...args);
}

/** Drops every live socket of a user (deactivation, §8). */
export function disconnectUser(userId: string) {
  if (!io) return;
  io.to(userRoom(userId)).emit('session:revoked');
  io.in(userRoom(userId)).disconnectSockets(true);
}
