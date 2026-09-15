import { z } from 'zod';
import { AVATAR_AUDIENCES } from './avatars';
import { CALL_DURATIONS, CALL_STATUSES } from './callStatus';
import { CHAT_MESSAGE_MAX, TODO_STATUSES } from './chat';
import { ROLES } from './roles';
import {
  BLOCK_KINDS,
  EDIT_SCOPES,
  FREQUENCIES,
  isIsoDate,
} from './scheduleBlocks';
import { isValidTimeZone } from './timezones';

const trimmed = (label: string, max = 5000) =>
  z
    .string({ required_error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} is too long`);

const optionalText = (max = 10000) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v.trim() === '' ? null : v));

export const uuid = z.string().uuid('Must be a valid id');
export const isoDateTime = z.string().datetime({ offset: true, message: 'Must be an ISO-8601 date-time' });
export const isoDate = z.string().refine(isIsoDate, 'Must be a date in yyyy-mm-dd form');
export const timeZone = z.string().refine(isValidTimeZone, 'Must be an IANA time zone such as Asia/Seoul');
export const nickname = z
  .string()
  .trim()
  .min(2, 'Nickname must be at least 2 characters')
  .max(32, 'Nickname must be at most 32 characters')
  .regex(/^[\p{L}\p{N}_.-]+$/u, 'Nickname may contain letters, numbers, dot, dash and underscore');
export const password = z.string().min(10, 'Password must be at least 10 characters').max(200);

// --- Auth -------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(1).optional() });

export const changePasswordSchema = z.object({ current: z.string().min(1), next: password });

export const avatarSchema = z.object({ avatarId: z.string().min(1) });

export const timeZoneSchema = z.object({ timeZone });

export const avatarQuerySchema = z.object({ audience: z.enum(AVATAR_AUDIENCES).optional() });

// --- Users ------------------------------------------------------------------

export const createUserSchema = z.object({
  nickname,
  role: z.enum(ROLES),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password,
  managerId: uuid.nullish(),
  avatarId: z.string().min(1).optional(),
  timeZone: timeZone.optional(),
});

export const updateUserSchema = z
  .object({
    nickname: nickname.optional(),
    managerId: uuid.nullish(),
    isActive: z.boolean().optional(),
    timeZone: timeZone.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const listUsersQuerySchema = z.object({
  role: z.enum(ROLES).optional(),
  q: z.string().trim().optional(),
  active: z.enum(['true', 'false']).optional(),
});

// --- Platforms --------------------------------------------------------------

export const platformSchema = z.object({
  name: trimmed('Name', 120),
  url: z.string().trim().url('Enter a valid URL'),
  priority: z.coerce.number().int().min(0).max(1000),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter country code'),
});
export const updatePlatformSchema = platformSchema.partial();

// --- Profiles ---------------------------------------------------------------

export const PROFILE_STATUSES = ['pending', 'approved', 'rejected'] as const;

/** A profile's standing on an expert network platform; unset means not registered. */
export const PLATFORM_REGISTRATIONS = ['not_registered', 'registered', 'banned'] as const;
export type PlatformRegistration = (typeof PLATFORM_REGISTRATIONS)[number];
export const PLATFORM_REGISTRATION_LABELS: Record<PlatformRegistration, string> = {
  not_registered: 'Not registered',
  registered: 'Registered',
  banned: 'Banned',
};

export const GENDERS = ['Male', 'Female', 'Other'] as const;

const optionalShortText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const profileSchema = z.object({
  name: trimmed('Name', 160),
  linkedinUrl: z
    .string()
    .trim()
    .url('Enter a valid URL')
    .nullish()
    .or(z.literal('').transform(() => null)),
  briefExperience: optionalText(4000).transform((v) => v ?? ''),
  avatarId: z.string().min(1, 'Choose an avatar'),
  dateOfBirth: isoDate
    .refine((d) => d >= '1900-01-01' && Date.parse(d) <= Date.now(), 'Enter a real date of birth')
    .nullish()
    .or(z.literal('').transform(() => null)),
  gender: optionalShortText(40),
  nationality: optionalShortText(80),
  location: optionalShortText(160),
  education: optionalText(4000),
  careerHistory: optionalText(8000),
  /** Founder only; ignored from anyone else. */
  currentAddress: optionalText(1000),
});
export const updateProfileSchema = profileSchema.partial();

/** A Profile's rate on a platform when the Founder hasn't set one (USD per hour). */
export const DEFAULT_PLATFORM_RATE = 1000;
export const MAX_PLATFORM_RATE = 1_000_000;

/** Founder sets a Profile's standing and/or rate on one platform. */
export const profilePlatformStatusSchema = z
  .object({
    status: z.enum(PLATFORM_REGISTRATIONS).optional(),
    rate: z.coerce
      .number({ invalid_type_error: 'Enter a number' })
      .min(0, 'The rate cannot be negative')
      .max(MAX_PLATFORM_RATE, 'That rate is too high')
      .multipleOf(0.01, 'Use at most two decimals')
      .optional(),
  })
  .refine((v) => v.status !== undefined || v.rate !== undefined, 'Nothing to update');

export const rejectProfileSchema = z.object({ reason: trimmed('Reason', 1000) });
export const listProfilesQuerySchema = z.object({
  q: z.string().trim().optional(),
  status: z.enum(PROFILE_STATUSES).optional(),
});

// --- Calls ------------------------------------------------------------------

export const durationMinutes = z.coerce
  .number()
  .refine((n) => (CALL_DURATIONS as readonly number[]).includes(n), 'Duration must be 15, 30, 45 or 60 minutes');

export const createCallSchema = z.object({
  platformId: uuid,
  profileId: uuid,
  associateId: uuid.nullish(),
  expertId: uuid.nullish(),
  scheduledAt: isoDateTime,
  durationMinutes,
  projectDetails: trimmed('Project details'),
  platformAssociateName: trimmed('Platform associate', 160),
  notes: optionalText(),
});

export const updateCallSchema = z
  .object({
    associateId: uuid.optional(),
    expertId: uuid.nullable().optional(),
    platformId: uuid.optional(),
    scheduledAt: isoDateTime.optional(),
    durationMinutes: durationMinutes.optional(),
    projectDetails: trimmed('Project details').optional(),
    platformAssociateName: trimmed('Platform associate', 160).optional(),
    notes: optionalText().optional(),
    invoiceAmount: z.coerce.number().min(0).max(9_999_999_999.99).nullable().optional(),
    invoiceCurrency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code')
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const MAX_ACTUAL_DURATION_MINUTES = 600;

/**
 * Moving to `ongoing` needs the Ninja link; moving to `finished` needs the
 * real duration. `rating` and `feedback` are optional leftovers of an older
 * finish form and are no longer asked for.
 */
export const transitionSchema = z
  .object({
    to: z.enum(CALL_STATUSES),
    comment: optionalText(2000).optional(),
    ninjaLink: z.string().trim().url('Enter a valid link').optional(),
    actualDurationMinutes: z.coerce
      .number()
      .int('Enter whole minutes')
      .min(1, 'Enter how many minutes the call took')
      .max(MAX_ACTUAL_DURATION_MINUTES, `At most ${MAX_ACTUAL_DURATION_MINUTES} minutes`)
      .optional(),
    rating: z.coerce.number().int().min(1, 'Rate from 1 to 5').max(5, 'Rate from 1 to 5').optional(),
    feedback: optionalText(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.to === 'ongoing' && !v.ninjaLink) {
      ctx.addIssue({ code: 'custom', path: ['ninjaLink'], message: 'Add the Ninja link to start the call' });
    }
    if (v.to === 'finished') {
      if (v.actualDurationMinutes === undefined) {
        ctx.addIssue({ code: 'custom', path: ['actualDurationMinutes'], message: 'Enter how many minutes the call took' });
      }
    }
  });

export const listCallsQuerySchema = z.object({
  status: z
    .union([z.enum(CALL_STATUSES), z.array(z.enum(CALL_STATUSES))])
    .optional()
    .transform((v) => (v == null ? undefined : Array.isArray(v) ? v : [v])),
  associateId: uuid.optional(),
  expertId: uuid.optional(),
  platformId: uuid.optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  q: z.string().trim().optional(),
  sort: z.enum(['scheduledAt', '-scheduledAt', 'updatedAt', '-updatedAt', 'createdAt', '-createdAt']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const messageSchema = z.object({ body: trimmed('Message', 5000) });
export const messagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// --- Chat & to-dos ------------------------------------------------------------

export const startConversationSchema = z.object({ userId: uuid });
export const chatMessageSchema = z.object({ body: trimmed('Message', CHAT_MESSAGE_MAX) });
export const chatMessagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const todoDoneSchema = z.object({ note: optionalText(2000).optional() });
export const listTodosQuerySchema = z.object({
  /** `assigned` = to-dos assigned to me; `created` = to-dos I (a Founder) created. */
  scope: z.enum(['assigned', 'created']).default('assigned'),
  status: z.enum(TODO_STATUSES).optional(),
});

// --- Notifications & devices -------------------------------------------------

export const markReadSchema = z.union([
  z.object({ ids: z.array(uuid).min(1) }),
  z.object({ all: z.literal(true) }),
]);
export const listNotificationsQuerySchema = z.object({
  unread: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const webPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export const webPushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) });

export const deviceSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  token: z.string().min(1).max(500),
});

// --- Calendar & schedule blocks ----------------------------------------------

export const MAX_CALENDAR_RANGE_DAYS = 62;

export const calendarQuerySchema = z
  .object({ from: isoDateTime, to: isoDateTime, expertId: uuid.optional() })
  .superRefine((v, ctx) => {
    const span = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
    if (span <= 0) ctx.addIssue({ code: 'custom', path: ['to'], message: '`to` must be after `from`' });
    if (span > MAX_CALENDAR_RANGE_DAYS)
      ctx.addIssue({ code: 'custom', path: ['to'], message: `Range can be at most ${MAX_CALENDAR_RANGE_DAYS} days` });
  });

export const repeatSchema = z.object({
  frequency: z.enum(FREQUENCIES).default('none'),
  interval: z.coerce.number().int().default(1),
  weekdays: z.array(z.number().int()).default([]),
  monthDay: z.number().int().nullable().default(null),
  setPosition: z.number().int().nullable().default(null),
  weekday: z.number().int().nullable().default(null),
  month: z.number().int().nullable().default(null),
  untilDate: isoDate.nullable().default(null),
});

export const blockBodySchema = z.object({
  kind: z.enum(BLOCK_KINDS),
  startDate: isoDate,
  allDay: z.boolean().default(false),
  startMinute: z.number().int().default(0),
  durationMinutes: z.number().int().default(60),
  repeat: repeatSchema.default({}),
  note: optionalText(1000).optional(),
});

export const blockPatchSchema = z.object({
  scope: z.enum(EDIT_SCOPES).default('all'),
  occurrenceDate: isoDate.optional(),
  changes: z.object({
    kind: z.enum(BLOCK_KINDS).optional(),
    startDate: isoDate.optional(),
    allDay: z.boolean().optional(),
    startMinute: z.number().int().optional(),
    durationMinutes: z.number().int().optional(),
    repeat: repeatSchema.partial().optional(),
    note: optionalText(1000).optional(),
  }),
});

export const blockDeleteQuerySchema = z.object({
  scope: z.enum(EDIT_SCOPES).default('all'),
  date: isoDate.optional(),
});

// --- Banks & photos ------------------------------------------------------------

const optionalCode = (len: 2 | 3, message: string) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || new RegExp(`^[A-Z]{${len}}$`).test(v), message);

export const bankSchema = z.object({
  bankName: trimmed('Bank name', 160),
  accountHolder: trimmed('Account holder', 160),
  accountNumber: trimmed('Account number or IBAN', 64),
  swiftBic: optionalText(20),
  routingNumber: optionalText(40),
  country: optionalCode(2, 'Use a two-letter country code'),
  currency: optionalCode(3, 'Use a three-letter currency code'),
  notes: optionalText(1000),
  isPrimary: z.boolean().default(false),
});
export const updateBankSchema = bankSchema.partial();

export const PHOTO_MAX_BYTES = 400 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** A client-resized picture as a data URL, e.g. `data:image/webp;base64,…`. */
export const photoUploadSchema = z.object({
  dataUrl: z
    .string()
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Upload a JPEG, PNG or WebP image')
    .max(Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 40, 'The image is too large (max 400 KB)'),
});

export type BankInput = z.input<typeof bankSchema>;

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type PlatformInput = z.infer<typeof platformSchema>;
export type ProfileInput = z.input<typeof profileSchema>;
export type CreateCallInput = z.input<typeof createCallSchema>;
export type UpdateCallInput = z.input<typeof updateCallSchema>;
export type TransitionInput = z.input<typeof transitionSchema>;
export type ListCallsQuery = z.input<typeof listCallsQuerySchema>;
export type BlockBodyInput = z.input<typeof blockBodySchema>;
export type BlockPatchInput = z.input<typeof blockPatchSchema>;
