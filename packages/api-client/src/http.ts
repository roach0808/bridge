import type { ApiErrorBody, AuthResponse } from '@god/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages from a validation error, keyed by path. */
  get fieldErrors(): Record<string, string> {
    const issues = (this.details as { issues?: Array<{ path: string; message: string }> } | undefined)?.issues;
    return Object.fromEntries((issues ?? []).map((i) => [i.path, i.message]));
  }
}

/**
 * Where the refresh token lives. The web app keeps it in an httpOnly cookie
 * (so this is a no-op); the mobile app uses expo-secure-store.
 */
export interface TokenStore {
  getRefreshToken(): Promise<string | null> | string | null;
  setRefreshToken(token: string | null): Promise<void> | void;
}

export const cookieTokenStore: TokenStore = {
  getRefreshToken: () => null,
  setRefreshToken: () => {},
};

export interface ClientOptions {
  /** e.g. http://localhost:4000 — `/api/v1` is appended. Empty string for same-origin. */
  baseUrl: string;
  tokenStore?: TokenStore;
  /** Send cookies (web). */
  withCredentials?: boolean;
  /** Called when the session can no longer be refreshed. */
  onSessionExpired?: () => void;
  /** Called whenever tokens change (login, refresh). */
  onAuth?: (auth: AuthResponse) => void;
  fetch?: typeof fetch;
}

export type Query = Record<string, string | number | boolean | string[] | null | undefined>;

export function toQueryString(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

export class HttpClient {
  private accessToken: string | null = null;
  private refreshing: Promise<AuthResponse | null> | null = null;
  private readonly fetchImpl: typeof fetch;
  readonly apiBase: string;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.apiBase = `${options.baseUrl.replace(/\/$/, '')}/api/v1`;
  }

  get token(): string | null {
    return this.accessToken;
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  async applyAuth(auth: AuthResponse) {
    this.accessToken = auth.accessToken;
    await this.options.tokenStore?.setRefreshToken(auth.refreshToken);
    this.options.onAuth?.(auth);
  }

  async clearAuth() {
    this.accessToken = null;
    await this.options.tokenStore?.setRefreshToken(null);
  }

  /** Single-flight refresh so parallel 401s trigger one rotation. */
  refresh(): Promise<AuthResponse | null> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          const refreshToken = (await this.options.tokenStore?.getRefreshToken()) ?? undefined;
          const auth = await this.raw<AuthResponse>('POST', '/auth/refresh', {
            body: refreshToken ? { refreshToken } : {},
            auth: false,
          });
          await this.applyAuth(auth);
          return auth;
        } catch {
          await this.clearAuth();
          return null;
        } finally {
          this.refreshing = null;
        }
      })();
    }
    return this.refreshing;
  }

  private async raw<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Query; auth?: boolean; signal?: AbortSignal } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.auth !== false && this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}${path}${toQueryString(opts.query)}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        credentials: this.options.withCredentials ? 'include' : 'same-origin',
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection.');
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const err = (data as ApiErrorBody | undefined)?.error;
      throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? res.statusText, err?.details);
    }
    return data as T;
  }

  /**
   * Downloads a file (the database dump) with the access token attached, since
   * a plain link cannot send one. Refreshes once on an expired token.
   */
  async download(path: string, retry = true): Promise<{ blob: Blob; filename: string | null }> {
    const headers: Record<string, string> = {};
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    const res = await this.fetchImpl(`${this.apiBase}${path}`, {
      method: 'GET',
      headers,
      credentials: this.options.withCredentials ? 'include' : 'same-origin',
    });
    if (res.status === 401 && retry && (await this.refresh())) return this.download(path, false);
    if (!res.ok) throw new ApiError(res.status, 'http_error', 'Could not download the file');
    const disposition = res.headers.get('content-disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
    return { blob: await res.blob(), filename };
  }

  async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Query; signal?: AbortSignal } = {},
  ): Promise<T> {
    try {
      return await this.raw<T>(method, path, opts);
    } catch (err) {
      const retryable =
        err instanceof ApiError && err.status === 401 && ['token_expired', 'unauthenticated'].includes(err.code);
      if (!retryable) throw err;
      const auth = await this.refresh();
      if (!auth) {
        this.options.onSessionExpired?.();
        throw err;
      }
      return this.raw<T>(method, path, opts);
    }
  }
}
