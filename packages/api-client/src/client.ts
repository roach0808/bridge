import type {
  AuditEntryDTO,
  AuthResponse,
  ChatMessageDTO,
  ChatMessagePage,
  ConversationDTO,
  DbDumpDTO,
  TodoDTO,
  TodoStatus,
  BankDTO,
  BankInput,
  AvatarAudience,
  AvatarDTO,
  BlockBodyInput,
  BlockPatchInput,
  CalendarResponse,
  CallDetailDTO,
  CallDTO,
  CallStatus,
  CreateCallInput,
  CursorPage,
  DashboardSummary,
  EditScope,
  ExpertsCalendarResponse,
  MeDTO,
  MessageDTO,
  NotificationList,
  Paginated,
  PlatformDTO,
  PlatformInput,
  PlatformRegistration,
  PresenceDTO,
  ProfileDTO,
  ProfileInput,
  ProfileStatus,
  Role,
  ScheduleBlockDTO,
  SessionDTO,
  StatusHistoryDTO,
  TransitionInput,
  UpdateCallInput,
  UserDTO,
  UserRef,
  AuthConfigDTO,
  GoogleLinkDTO,
  SignInDetailsDTO,
  AssociateStats,
  FinanceStats,
  ProfileStatsRow,
  StatsPeriodKind,
} from '@god/shared';
import { HttpClient, type ClientOptions, type Query } from './http';

export interface ListCallsParams extends Query {
  status?: CallStatus | CallStatus[];
  associateId?: string;
  expertId?: string;
  platformId?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateUserBody {
  nickname: string;
  role: Role;
  email: string;
  password: string;
  managerId?: string | null;
  avatarId?: string;
  timeZone?: string;
}

export interface UpdateUserBody {
  nickname?: string;
  managerId?: string | null;
  isActive?: boolean;
  timeZone?: string;
}

export interface BlockMutationResult {
  updated: ScheduleBlockDTO | null;
  deleted: string[];
  created: ScheduleBlockDTO[];
}

export function createApiClient(options: ClientOptions) {
  const http = new HttpClient(options);
  const get = <T>(path: string, query?: Query) => http.request<T>('GET', path, { query });
  const post = <T>(path: string, body?: unknown) => http.request<T>('POST', path, { body: body ?? {} });
  const patch = <T>(path: string, body: unknown) => http.request<T>('PATCH', path, { body });
  const del = <T>(path: string, query?: Query) => http.request<T>('DELETE', path, { query });
  const enc = encodeURIComponent;

  return {
    http,

    auth: {
      async login(email: string, password: string): Promise<AuthResponse> {
        const auth = await http.request<AuthResponse>('POST', '/auth/login', { body: { email, password } });
        await http.applyAuth(auth);
        return auth;
      },
      /** Public settings for the login page, such as the Google client ID. */
      config: () => get<AuthConfigDTO>('/auth/config'),
      /** Signs in with the ID token the "Sign in with Google" button returned. */
      async google(credential: string): Promise<AuthResponse> {
        const auth = await http.request<AuthResponse>('POST', '/auth/google', { body: { credential } });
        await http.applyAuth(auth);
        return auth;
      },
      /** Restores a session from the stored refresh token (or cookie). */
      restore: () => http.refresh(),
      async logout(): Promise<void> {
        try {
          await http.request<void>('POST', '/auth/logout', { body: {} });
        } finally {
          await http.clearAuth();
        }
      },
      me: () => get<MeDTO>('/me'),
      /** The Google account linked to the caller, or null. */
      googleLink: () => get<GoogleLinkDTO | null>('/me/google'),
      changePassword: (current: string, next: string) => patch<void>('/me/password', { current, next }),
      setAvatar: (avatarId: string) => patch<MeDTO>('/me/avatar', { avatarId }),
      setTimeZone: (timeZone: string) => patch<MeDTO>('/me/time-zone', { timeZone }),
      /** `dataUrl` is a client-resized image (see `resizeImageFile` in the web app). */
      setPhoto: (dataUrl: string) => http.request<MeDTO>('PUT', '/me/photo', { body: { dataUrl } }),
      removePhoto: () => del<MeDTO>('/me/photo'),
      /** Signed-in sessions of the caller (device, country, last used). */
      sessions: () => get<SessionDTO[]>('/me/sessions'),
      /** Ends one session, or every other one with `'all'`. */
      signOutSession: (id: string) => del<{ signedOut: number }>(`/me/sessions/${enc(id)}`),
    },

    avatars: {
      list: (audience?: AvatarAudience) => get<AvatarDTO[]>('/avatars', { audience }),
      url: (id: string) => `${http.apiBase}/avatars/${enc(id)}.svg`,
    },

    photos: {
      url: (id: string) => `${http.apiBase}/photos/${enc(id)}`,
    },

    banks: {
      list: (profileId: string) => get<BankDTO[]>(`/profiles/${enc(profileId)}/banks`),
      create: (profileId: string, body: BankInput) => post<BankDTO>(`/profiles/${enc(profileId)}/banks`, body),
      update: (id: string, body: Partial<BankInput>) => patch<BankDTO>(`/banks/${enc(id)}`, body),
      remove: (id: string) => del<void>(`/banks/${enc(id)}`),
    },

    users: {
      list: (query?: { role?: Role; q?: string; active?: 'true' | 'false' }) => get<UserDTO[]>('/users', query),
      team: () => get<UserDTO[]>('/users/me/team'),
      get: (id: string) => get<UserDTO>(`/users/${enc(id)}`),
      create: (body: CreateUserBody) => post<UserDTO>('/users', body),
      update: (id: string, body: UpdateUserBody) => patch<UserDTO>(`/users/${enc(id)}`, body),
      /** Founder only, audited: sign-in email and linked Google account. */
      signIn: (id: string) => get<SignInDetailsDTO>(`/users/${enc(id)}/sign-in`),
      setSignInEmail: (id: string, email: string) => patch<SignInDetailsDTO>(`/users/${enc(id)}/sign-in`, { email }),
      unlinkGoogle: (id: string) => del<SignInDetailsDTO>(`/users/${enc(id)}/google`),
    },

    platforms: {
      list: () => get<PlatformDTO[]>('/platforms'),
      create: (body: PlatformInput) => post<PlatformDTO>('/platforms', body),
      update: (id: string, body: Partial<PlatformInput>) => patch<PlatformDTO>(`/platforms/${enc(id)}`, body),
    },

    profiles: {
      list: (query?: { q?: string; status?: ProfileStatus }) => get<ProfileDTO[]>('/profiles', query),
      get: (id: string) => get<ProfileDTO>(`/profiles/${enc(id)}`),
      create: (body: ProfileInput) => post<ProfileDTO>('/profiles', body),
      update: (id: string, body: Partial<ProfileInput>) => patch<ProfileDTO>(`/profiles/${enc(id)}`, body),
      approve: (id: string) => post<ProfileDTO>(`/profiles/${enc(id)}/approve`),
      reject: (id: string, reason: string) => post<ProfileDTO>(`/profiles/${enc(id)}/reject`, { reason }),
      setPhoto: (id: string, dataUrl: string) =>
        http.request<ProfileDTO>('PUT', `/profiles/${enc(id)}/photo`, { body: { dataUrl } }),
      removePhoto: (id: string) => del<ProfileDTO>(`/profiles/${enc(id)}/photo`),
      /** Founder: a Profile's registration status and/or rate (USD per hour) on one platform. */
      /** Founder: deactivate a Profile (Founders only see it afterwards) or bring it back. */
      setActive: (id: string, isActive: boolean) => patch<ProfileDTO>(`/profiles/${enc(id)}/active`, { isActive }),
      setPlatform: (id: string, platformId: string, body: { status?: PlatformRegistration; rate?: number | null }) =>
        http.request<ProfileDTO>('PUT', `/profiles/${enc(id)}/platforms/${enc(platformId)}`, { body }),
    },

    calls: {
      list: (query?: ListCallsParams) => get<Paginated<CallDTO>>('/calls', query),
      get: (id: string) => get<CallDetailDTO>(`/calls/${enc(id)}`),
      create: (body: CreateCallInput) => post<CallDTO>('/calls', body),
      update: (id: string, body: UpdateCallInput) => patch<CallDTO>(`/calls/${enc(id)}`, body),
      /** `ongoing` needs `ninjaLink`; `finished` needs `actualDurationMinutes` and `rating`. */
      transition: (id: string, to: CallStatus, extra?: Omit<TransitionInput, 'to'>) =>
        post<CallDTO>(`/calls/${enc(id)}/transition`, { to, ...extra }),
      history: (id: string) => get<StatusHistoryDTO[]>(`/calls/${enc(id)}/history`),
      messages: (id: string, cursor?: string | null, limit?: number) =>
        get<CursorPage<MessageDTO>>(`/calls/${enc(id)}/messages`, { cursor, limit }),
      postMessage: (id: string, body: string) => post<MessageDTO>(`/calls/${enc(id)}/messages`, { body }),
    },

    chat: {
      contacts: () => get<UserRef[]>('/chat/contacts'),
      conversations: () => get<ConversationDTO[]>('/chat/conversations'),
      conversation: (id: string) => get<ConversationDTO>(`/chat/conversations/${enc(id)}`),
      /** Opens (or creates) the one-to-one chat with a user. */
      start: (userId: string) => post<ConversationDTO>('/chat/conversations', { userId }),
      /** `cursor` loads older messages, `after` newer ones; neither loads the latest. */
      messages: (id: string, query: { cursor?: string | null; after?: string | null; limit?: number } = {}) =>
        get<ChatMessagePage>(`/chat/conversations/${enc(id)}/messages`, query),
      send: (id: string, body: string) => post<ChatMessageDTO>(`/chat/conversations/${enc(id)}/messages`, { body }),
      markRead: (id: string) => post<void>(`/chat/conversations/${enc(id)}/read`),
      makeTodo: (messageId: string) => post<TodoDTO>(`/chat/messages/${enc(messageId)}/todo`),
      removeTodo: (messageId: string) => del<void>(`/chat/messages/${enc(messageId)}/todo`),
    },

    todos: {
      /** `active` (the default) leaves out completed tasks. */
      list: (query?: { scope?: 'assigned' | 'created'; status?: TodoStatus | 'active' | 'all' }) => get<TodoDTO[]>('/todos', query),
      /** People the caller may give a task to. */
      assignees: () => get<UserRef[]>('/todos/assignees'),
      create: (input: { assigneeId: string; title: string; details?: string | null }) => post<TodoDTO>('/todos', input),
      remove: (id: string) => del<void>(`/todos/${enc(id)}`),
      done: (id: string, note?: string) => post<TodoDTO>(`/todos/${enc(id)}/done`, note ? { note } : {}),
      /** The giver confirms a done task: it becomes completed. */
      confirm: (id: string) => post<TodoDTO>(`/todos/${enc(id)}/confirm`),
      /** The giver sends a done or completed task back to the taker. */
      reopen: (id: string, note?: string) => post<TodoDTO>(`/todos/${enc(id)}/reopen`, note ? { note } : {}),
    },

    stats: {
      /** Founders: every Associate. Managers: their team. Associates: themselves. */
      associates: (query?: { period?: StatsPeriodKind; count?: number }) => get<AssociateStats>('/stats/associates', query),
      /** Founder only. */
      profiles: () => get<ProfileStatsRow[]>('/stats/profiles'),
      /** Founder only. */
      finance: (query?: { period?: StatsPeriodKind; count?: number }) => get<FinanceStats>('/stats/finance', query),
    },

    push: {
      /** The VAPID public key, or null when the server has push turned off. */
      config: () => get<{ publicKey: string | null }>('/push/config'),
      subscribe: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
        post<void>('/push/subscriptions', subscription),
      unsubscribe: (endpoint: string) => del<void>('/push/subscriptions', { endpoint }),
      test: () => post<{ browsers: number }>('/push/test'),
    },

    presence: {
      /** Online / away / offline for everyone the caller may chat with. */
      list: () => get<PresenceDTO[]>('/presence'),
    },

    dbDumps: {
      list: () => get<DbDumpDTO[]>('/db-dumps'),
      run: () => post<DbDumpDTO>('/db-dumps'),
      download: (id: string) => http.download(`/db-dumps/${enc(id)}/download`),
    },

    sessions: {
      /** Founder: anyone's signed-in sessions. */
      ofUser: (userId: string) => get<SessionDTO[]>(`/users/${enc(userId)}/sessions`),
      signOutUser: (userId: string) => del<{ signedOut: number }>(`/users/${enc(userId)}/sessions`),
    },

    audit: {
      /** Founder: who did what, newest first. `action` matches a family, e.g. `call`. */
      list: (query?: { userId?: string; action?: string; from?: string; to?: string; q?: string; page?: number; pageSize?: number }) =>
        get<Paginated<AuditEntryDTO>>('/audit', query),
      actions: () => get<string[]>('/audit/actions'),
    },

    notifications: {
      list: (query?: { unread?: 'true' | 'false'; limit?: number }) => get<NotificationList>('/notifications', query),
      markRead: (ids: string[]) => post<{ updated: number; unreadCount: number }>('/notifications/read', { ids }),
      markAllRead: () => post<{ updated: number; unreadCount: number }>('/notifications/read', { all: true }),
    },

    devices: {
      register: (platform: 'ios' | 'android' | 'web', token: string) => post<unknown>('/devices', { platform, token }),
      unregister: (token: string) => del<void>(`/devices/${enc(token)}`),
    },

    calendar: {
      get: (query: { from: string; to: string; expertId?: string }) => get<CalendarResponse>('/calendar', query),
      experts: (query: { from: string; to: string }) => get<ExpertsCalendarResponse>('/calendar/experts', query),
    },

    scheduleBlocks: {
      create: (expertId: string, body: BlockBodyInput) =>
        post<ScheduleBlockDTO>(`/experts/${enc(expertId)}/schedule-blocks`, body),
      update: (id: string, body: BlockPatchInput) => patch<BlockMutationResult>(`/schedule-blocks/${enc(id)}`, body),
      remove: (id: string, scope: EditScope = 'all', date?: string) =>
        del<BlockMutationResult>(`/schedule-blocks/${enc(id)}`, { scope, date }),
    },

    dashboard: {
      get: () => get<DashboardSummary>('/dashboard'),
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
