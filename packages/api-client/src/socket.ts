import type { ClientToServerEvents, ServerToClientEvents } from '@god/shared';
import { io, type Socket } from 'socket.io-client';
import type { HttpClient } from './http';

export type GodSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Connects with the current access token and re-sends a fresh one on every
 * reconnect (§7.1). An auth failure triggers a token refresh and one retry.
 */
export function createSocket(baseUrl: string, http: HttpClient): GodSocket {
  const socket: GodSocket = io(baseUrl || undefined, {
    path: '/socket.io',
    autoConnect: false,
    transports: ['websocket', 'polling'],
    auth: (cb) => cb({ token: http.token }),
  });

  let retrying = false;
  socket.on('connect_error', async (err) => {
    if (err.message !== 'unauthenticated' || retrying) return;
    retrying = true;
    const auth = await http.refresh();
    retrying = false;
    if (auth) socket.connect();
  });

  return socket;
}

/** Joins a call room; returns a function that leaves it. Re-joins after reconnects. */
export function joinCallRoom(socket: GodSocket, callId: string): () => void {
  const join = () => socket.emit('call:join', { callId });
  if (socket.connected) join();
  socket.on('connect', join);
  return () => {
    socket.off('connect', join);
    if (socket.connected) socket.emit('call:leave', { callId });
  };
}
