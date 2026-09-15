export const ERROR_CODES = {
  validation: 'validation_error',
  unauthenticated: 'unauthenticated',
  invalidCredentials: 'invalid_credentials',
  tokenExpired: 'token_expired',
  forbidden: 'forbidden',
  notFound: 'not_found',
  conflict: 'conflict',
  invalidTransition: 'invalid_transition',
  expertRequired: 'expert_required',
  expertBusy: 'expert_busy',
  profileNotApproved: 'profile_not_approved',
  rateLimited: 'rate_limited',
  inactive: 'user_inactive',
  internal: 'internal_error',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
