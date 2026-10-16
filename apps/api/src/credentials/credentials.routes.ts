import { credentialSchema, teamIdOf, updateCredentialSchema, type CredentialDTO } from '@god/shared';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { decryptSecret, encryptSecret } from '../banks/secret';
import { prisma } from '../db';
import { conflict, notFound } from '../errors';
import { idParam, iso, parseBody } from '../http';
import { visibleProfilesWhere } from '../profiles/profiles.routes';
import { toUserRef, userRefSelect } from '../serializers';

/**
 * Password managers (§6.17): saved logins for a Profile, or for a team. They
 * are seen, revealed and kept by the Founders and by the team concerned — the
 * team handling the Profile, or the team itself — and by nobody else; Experts
 * never. Passwords are stored encrypted and each reveal is in the audit trail.
 */
export const credentialsRouter = Router();
credentialsRouter.use(['/credentials', '/profiles/:id/credentials', '/teams/:id/credentials'], requireAuth, requireRole('founder', 'manager', 'associate'));

const credentialInclude = {
  createdBy: { select: userRefSelect },
  updatedBy: { select: userRefSelect },
} satisfies Prisma.CredentialInclude;

type CredentialRow = Prisma.CredentialGetPayload<{ include: typeof credentialInclude }>;

const toCredentialDTO = (c: CredentialRow): CredentialDTO => ({
  id: c.id,
  profileId: c.profileId,
  teamId: c.teamId,
  nickname: c.nickname,
  platform: c.platform,
  login: c.login,
  hasPassword: c.passwordEnc !== null,
  createdBy: toUserRef(c.createdBy),
  updatedBy: toUserRef(c.updatedBy),
  createdAt: iso(c.createdAt),
  updatedAt: iso(c.updatedAt),
});

const order: Prisma.CredentialOrderByWithRelationInput[] = [{ platform: 'asc' }, { nickname: 'asc' }, { createdAt: 'asc' }];

/** An empty password removes it; leaving it out keeps the saved one. */
const passwordData = (password: string | null | undefined) =>
  password === undefined ? {} : { passwordEnc: password ? encryptSecret(password) : null };

async function loadProfile(actor: Actor, id: string | null) {
  const profile = id ? await prisma.profile.findFirst({ where: { AND: [{ id }, visibleProfilesWhere(actor)] }, select: { id: true } }) : null;
  if (!profile) throw notFound('Profile');
  return profile;
}

/** A team's own password manager: the Founders', and that team's (§2.4). */
async function loadTeam(actor: Actor, id: string | null) {
  const mine = actor.role === 'founder' || (id !== null && teamIdOf(actor) === id);
  const team = id && mine ? await prisma.user.findFirst({ where: { id, role: 'manager', deletedAt: null }, select: { id: true } }) : null;
  if (!team) throw notFound('Team');
  return team;
}

/** A login the caller may use; anyone else is told it does not exist. */
async function loadCredential(actor: Actor, id: string | null): Promise<CredentialRow> {
  const c = id ? await prisma.credential.findUnique({ where: { id }, include: credentialInclude }) : null;
  if (!c) throw notFound('Login');
  try {
    if (c.profileId) await loadProfile(actor, c.profileId);
    else await loadTeam(actor, c.teamId);
  } catch {
    throw notFound('Login');
  }
  return c;
}

const list = (where: Prisma.CredentialWhereInput) =>
  prisma.credential.findMany({ where, include: credentialInclude, orderBy: order }).then((rows) => rows.map(toCredentialDTO));

async function create(actor: Actor, req: Parameters<typeof parseBody>[1], owner: { profileId: string } | { teamId: string }) {
  const { password, ...input } = parseBody(credentialSchema, req);
  const row = await prisma.credential.create({
    data: { ...input, login: input.login ?? null, ...passwordData(password), ...owner, createdById: actor.id, updatedById: actor.id },
    include: credentialInclude,
  });
  return toCredentialDTO(row);
}

credentialsRouter.get('/profiles/:id/credentials', async (req, res) => {
  const profile = await loadProfile(actorOf(req), idParam(req));
  res.json(await list({ profileId: profile.id }));
});

credentialsRouter.post('/profiles/:id/credentials', async (req, res) => {
  const actor = actorOf(req);
  const profile = await loadProfile(actor, idParam(req));
  res.status(201).json(await create(actor, req, { profileId: profile.id }));
});

credentialsRouter.get('/teams/:id/credentials', async (req, res) => {
  const team = await loadTeam(actorOf(req), idParam(req));
  res.json(await list({ teamId: team.id }));
});

credentialsRouter.post('/teams/:id/credentials', async (req, res) => {
  const actor = actorOf(req);
  const team = await loadTeam(actor, idParam(req));
  res.status(201).json(await create(actor, req, { teamId: team.id }));
});

/** Reveals the saved password. Each reveal is written to the audit trail. */
credentialsRouter.get('/credentials/:id/password', async (req, res) => {
  const c = await loadCredential(actorOf(req), idParam(req));
  if (!c.passwordEnc) return res.json({ password: null });
  const password = decryptSecret(c.passwordEnc);
  if (password === null) throw conflict('This password cannot be read with the current encryption key; enter it again', 'secret_unreadable');
  res.json({ password });
});

credentialsRouter.patch('/credentials/:id', async (req, res) => {
  const actor = actorOf(req);
  const current = await loadCredential(actor, idParam(req));
  const { password, ...input } = parseBody(updateCredentialSchema, req);
  const row = await prisma.credential.update({
    where: { id: current.id },
    data: { ...input, ...passwordData(password), updatedById: actor.id },
    include: credentialInclude,
  });
  res.json(toCredentialDTO(row));
});

credentialsRouter.delete('/credentials/:id', async (req, res) => {
  const current = await loadCredential(actorOf(req), idParam(req));
  await prisma.credential.delete({ where: { id: current.id } });
  res.status(204).end();
});
