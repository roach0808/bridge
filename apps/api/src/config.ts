import { z } from 'zod';

const duration = z
  .string()
  .regex(/^\d+[smhd]$/, 'Use a duration such as 15m or 30d');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: duration.default('15m'),
  /**
   * How long a signed-in session lasts. `never` (the default) means it lasts
   * until the user signs out, or is deactivated.
   */
  REFRESH_TOKEN_TTL: z.union([z.literal('never'), duration]).default('never'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  PORT: z.coerce.number().int().default(4000),
  /** Proxy hops in front of the API whose X-Forwarded-For is trusted (e.g. 2 for Vercel → Render). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).default(5),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  /** Nightly database dumps; off in tests. */
  DB_DUMPS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** Web Push (browser notifications). Disabled unless both keys are set; generate with `npx web-push generate-vapid-keys`. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@god-system.app'),
  PUSH_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const config = load();

export function durationToMs(value: string): number {
  const n = Number(value.slice(0, -1));
  const unit = value.slice(-1);
  const factor = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit as 's' | 'm' | 'h' | 'd'];
  return n * factor;
}

export const isProduction = config.NODE_ENV === 'production';
export const cookieSecure = config.COOKIE_SECURE ?? isProduction;
