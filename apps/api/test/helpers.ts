import type { CallStatus, Role } from '@god/shared';
import argon2 from 'argon2';
import request, { type Response } from 'supertest';
import { expect } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/db';

export { prisma };
export const app = createApp();

export const PASSWORD = 'Correct-Horse-Battery-1';
const EMAIL_DOMAIN = 'fixtures.test';
let hashPromise: Promise<string> | null = null;
/** Argon2 is deliberately slow: hash the shared password once per worker. */
export const passwordHash = () => (hashPromise ??= argon2.hash(PASSWORD, { type: argon2.argon2id }));

// ---------------------------------------------------------------------------
// Database

/** Empties every table except the avatar catalog (and Prisma's migration log). */
export async function resetDb() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('avatars', '_prisma_migrations')`;
  if (!rows.length) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

// ---------------------------------------------------------------------------
// Fixtures

export interface FixtureUser {
  id: string;
  email: string;
  nickname: string;
  role: Role;
  managerId: string | null;
  timeZone: string;
}

export interface Fixtures {
  founder: FixtureUser;
  m1: FixtureUser;
  m2: FixtureUser;
  /** Associates of m1. */
  a1: FixtureUser;
  a2: FixtureUser;
  /** Associates of m2. */
  a3: FixtureUser;
  a4: FixtureUser;
  /** Expert in Asia/Seoul. */
  e1: FixtureUser;
  /** Expert in Europe/London. */
  e2: FixtureUser;
  /** Expert in America/New_York. */
  e3: FixtureUser;
  users: FixtureUser[];
  emails: string[];
  platform: { id: string; name: string };
  platform2: { id: string; name: string };
  approvedProfile: { id: string; name: string };
  /** Pending profile authored by a1. */
  pendingProfile: { id: string; name: string };
  /** Pending profile authored by a3 (m2's team). */
  pendingProfileTeam2: { id: string; name: string };
}

/** Fixture users get distinct, increasing join times: several features order users by `createdAt`. */
let joinClock = Date.parse('2026-01-01T00:00:00Z');

async function makeUser(
  nickname: string,
  role: Role,
  opts: { managerId?: string; timeZone?: string; isActive?: boolean } = {},
): Promise<FixtureUser> {
  const email = `${nickname.toLowerCase()}@${EMAIL_DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      nickname,
      role,
      email,
      passwordHash: await passwordHash(),
      managerId: opts.managerId ?? null,
      avatarId: `${role}-01`,
      timeZone: opts.timeZone ?? 'America/New_York',
      isActive: opts.isActive ?? true,
      createdAt: new Date((joinClock += 1000)),
    },
  });
  return { id: user.id, email, nickname, role, managerId: user.managerId, timeZone: user.timeZone };
}

export async function seedFixtures(): Promise<Fixtures> {
  await resetDb();
  const founder = await makeUser('Founder', 'founder');
  const m1 = await makeUser('ManagerOne', 'manager');
  const m2 = await makeUser('ManagerTwo', 'manager');
  const a1 = await makeUser('AssocOne', 'associate', { managerId: m1.id });
  const a2 = await makeUser('AssocTwo', 'associate', { managerId: m1.id });
  const a3 = await makeUser('AssocThree', 'associate', { managerId: m2.id });
  const a4 = await makeUser('AssocFour', 'associate', { managerId: m2.id });
  const e1 = await makeUser('ExpertSeoul', 'expert', { timeZone: 'Asia/Seoul' });
  const e2 = await makeUser('ExpertLondon', 'expert', { timeZone: 'Europe/London' });
  const e3 = await makeUser('ExpertNY', 'expert', { timeZone: 'America/New_York' });
  const users = [founder, m1, m2, a1, a2, a3, a4, e1, e2, e3];

  const platform = await prisma.platform.create({ data: { name: 'GLG', url: 'https://glg.example', priority: 1, country: 'US' } });
  const platform2 = await prisma.platform.create({ data: { name: 'AlphaSights', url: 'https://alpha.example', priority: 2, country: 'GB' } });
  const approvedProfile = await prisma.profile.create({
    data: { name: 'Dana Approved', avatarId: 'profile-01', status: 'approved', createdById: founder.id, reviewedById: founder.id, reviewedAt: new Date() },
  });
  const pendingProfile = await prisma.profile.create({
    data: { name: 'Pat Pending', avatarId: 'profile-02', status: 'pending', createdById: a1.id },
  });
  const pendingProfileTeam2 = await prisma.profile.create({
    data: { name: 'Quinn Pending', avatarId: 'profile-03', status: 'pending', createdById: a3.id },
  });

  return {
    founder, m1, m2, a1, a2, a3, a4, e1, e2, e3, users,
    emails: users.map((u) => u.email),
    platform: { id: platform.id, name: platform.name },
    platform2: { id: platform2.id, name: platform2.name },
    approvedProfile: { id: approvedProfile.id, name: approvedProfile.name },
    pendingProfile: { id: pendingProfile.id, name: pendingProfile.name },
    pendingProfileTeam2: { id: pendingProfileTeam2.id, name: pendingProfileTeam2.name },
  };
}

export interface MakeCallOptions {
  associate: FixtureUser;
  expert?: FixtureUser | null;
  status?: CallStatus;
  scheduledAt?: string;
  durationMinutes?: number;
  createdBy?: FixtureUser;
  projectDetails?: string;
  notes?: string | null;
  /** Defaults to 1000 for a call already processed to bank (the database requires one). */
  realIncome?: number | null;
}

/** Inserts a call (and its first history row) directly, bypassing the API. */
export async function makeCall(fx: Fixtures, opts: MakeCallOptions) {
  const call = await prisma.call.create({
    data: {
      status: opts.status ?? 'on_scheduling',
      platformId: fx.platform.id,
      profileId: fx.approvedProfile.id,
      associateId: opts.associate.id,
      expertId: opts.expert === undefined ? fx.e1.id : (opts.expert?.id ?? null),
      scheduledAt: new Date(opts.scheduledAt ?? '2027-02-01T09:00:00Z'),
      durationMinutes: opts.durationMinutes ?? 60,
      projectDetails: opts.projectDetails ?? 'Market sizing for industrial pumps',
      platformAssociateName: 'Jordan at GLG',
      notes: opts.notes ?? null,
      realIncome: opts.realIncome !== undefined ? opts.realIncome : opts.status === 'process_to_bank' ? 1000 : null,
      createdById: (opts.createdBy ?? opts.associate).id,
    },
  });
  await prisma.callStatusHistory.create({
    data: { callId: call.id, fromStatus: null, toStatus: call.status, actorId: (opts.createdBy ?? opts.associate).id },
  });
  return call;
}

// ---------------------------------------------------------------------------
// HTTP

const EMAIL_RE = new RegExp(`[a-z0-9._%+-]+@${EMAIL_DOMAIN.replace('.', '\\.')}`, 'gi');

/**
 * Anonymity (§2.2): a response body may never contain a fixture email address,
 * except the caller's own on the endpoints that return the caller (`/me`, auth).
 */
export function assertNoEmails(res: Response, allowedEmail?: string) {
  const text = res.text ?? JSON.stringify(res.body ?? '');
  const found = [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
  const leaked = found.filter((e) => e !== allowedEmail?.toLowerCase());
  const req = (res as Response & { req?: { method?: string; path?: string } }).req;
  expect(leaked, `${req?.method} ${req?.path} leaked email(s)`).toEqual([]);
}

const SELF_ENDPOINTS = /^\/api\/v1\/(me(\/|$|\?)|auth\/)/;

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export class Client {
  constructor(
    public readonly token: string | null,
    public readonly email: string | null = null,
  ) {}

  private async send(method: Method, path: string, body?: unknown, query?: Record<string, unknown>): Promise<Response> {
    const url = path.startsWith('/api/') || path === '/healthz' ? path : `/api/v1${path}`;
    let req = request(app)[method](url);
    if (this.token) req = req.set('Authorization', `Bearer ${this.token}`);
    if (query) req = req.query(query as Record<string, string>);
    if (body !== undefined) req = req.send(body as object);
    const res = await req;
    assertNoEmails(res, SELF_ENDPOINTS.test(url) ? (this.email ?? undefined) : undefined);
    return res;
  }

  get = (path: string, query?: Record<string, unknown>) => this.send('get', path, undefined, query);
  post = (path: string, body?: unknown) => this.send('post', path, body ?? {});
  patch = (path: string, body?: unknown) => this.send('patch', path, body ?? {});
  put = (path: string, body?: unknown) => this.send('put', path, body ?? {});
  delete = (path: string, query?: Record<string, unknown>) => this.send('delete', path, undefined, query);
}

export const anon = new Client(null);

export async function loginRaw(email: string, password = PASSWORD) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  assertNoEmails(res, email);
  return res;
}

/** Logs in through the API and returns the bearer access token. */
export async function login(email: string): Promise<string> {
  const res = await loginRaw(email);
  expect(res.status, `login ${email}: ${res.text}`).toBe(200);
  return res.body.accessToken as string;
}

/** A Client authenticated as the fixture user. */
export async function as(user: FixtureUser): Promise<Client> {
  return new Client(await login(user.email), user.email);
}

/** Logs every listed fixture user in at once. */
export async function clientsFor<K extends keyof Fixtures>(fx: Fixtures, keys: K[]): Promise<Record<K, Client>> {
  const entries = await Promise.all(keys.map(async (k) => [k, await as(fx[k] as FixtureUser)] as const));
  return Object.fromEntries(entries) as Record<K, Client>;
}

export function expectError(res: Response, status: number, code?: string) {
  expect(res.status, res.text).toBe(status);
  expect(res.body).toHaveProperty('error.code');
  expect(res.body).toHaveProperty('error.message');
  if (code) expect(res.body.error.code).toBe(code);
}
