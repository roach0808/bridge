import type { ListCallsParams } from '@god/api-client';

/** Centralised TanStack Query keys so invalidation stays consistent. */
export const qk = {
  me: ['me'] as const,
  dashboard: ['dashboard'] as const,
  calls: {
    all: ['calls'] as const,
    list: (params: ListCallsParams) => ['calls', 'list', params] as const,
    detail: (id: string) => ['calls', 'detail', id] as const,
    /** The Finance tab: calls that took place, with the viewer's totals. */
    finance: (params: object) => ['calls', 'finance', params] as const,
    /** The Founder's open payment cycle, and the closed ones. */
    cycle: ['calls', 'cycle'] as const,
    cycles: ['calls', 'cycles'] as const,
    waiting: ['calls', 'waiting'] as const,
    messages: (id: string) => ['calls', 'messages', id] as const,
  },
  calendar: {
    all: ['calendar'] as const,
    expert: (from: string, to: string, expertId?: string) => ['calendar', 'expert', from, to, expertId ?? null] as const,
    experts: (from: string, to: string) => ['calendar', 'experts', from, to] as const,
  },
  users: {
    all: ['users'] as const,
    list: (params?: object) => ['users', 'list', params ?? {}] as const,
    team: ['users', 'team'] as const,
  },
  platforms: ['platforms'] as const,
  profiles: {
    all: ['profiles'] as const,
    list: (params?: object) => ['profiles', 'list', params ?? {}] as const,
    detail: (id: string) => ['profiles', 'detail', id] as const,
  },
  notifications: ['notifications'] as const,
  sessions: ['sessions'] as const,
  audit: {
    all: ['audit'] as const,
    list: (params?: object) => ['audit', 'list', params ?? {}] as const,
    actions: ['audit', 'actions'] as const,
  },
  presence: ['presence'] as const,
  dbDumps: ['db-dumps'] as const,
  chat: {
    all: ['chat'] as const,
    conversations: ['chat', 'conversations'] as const,
    conversation: (id: string) => ['chat', 'conversation', id] as const,
    messages: (id: string) => ['chat', 'messages', id] as const,
    contacts: ['chat', 'contacts'] as const,
    observed: ['chat', 'observed'] as const,
    observedMessages: (id: string) => ['chat', 'observed', id] as const,
  },
  todos: {
    all: ['todos'] as const,
    board: (status: string) => ['todos', 'board', status] as const,
    list: (params?: object) => ['todos', 'list', params ?? {}] as const,
  },
  stats: {
    all: ['stats'] as const,
    associates: (period: string, count: number) => ['stats', 'associates', period, count] as const,
    profiles: ['stats', 'profiles'] as const,
    finance: (period: string, count: number) => ['stats', 'finance', period, count] as const,
  },
  banks: (profileId: string) => ['banks', profileId] as const,
  avatars: (audience?: string) => ['avatars', audience ?? 'all'] as const,
};
