import { createApiClient, createSocket, cookieTokenStore } from '@god/api-client';
import { deviceId } from './deviceId';

/** Empty base URL = same origin (Vite proxies /api and /socket.io in dev). */
export const API_BASE_URL: string = import.meta.env.VITE_API_URL ?? '';

let sessionExpiredHandler: () => void = () => {};
export const onSessionExpired = (fn: () => void) => {
  sessionExpiredHandler = fn;
};

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  tokenStore: cookieTokenStore,
  withCredentials: true,
  onSessionExpired: () => sessionExpiredHandler(),
  deviceId,
});

export const socket = createSocket(API_BASE_URL, api.http);

export const avatarUrl = (id: string) => api.avatars.url(id);
export const photoUrl = (id: string) => api.photos.url(id);
