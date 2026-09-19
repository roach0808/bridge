import {
  CREATABLE_ROLES,
  createUserSchema,
  defaultAvatarFor,
  isAvatarForAudience,
  listUsersQuerySchema,
  signInEmailSchema,
  type SignInDetailsDTO,
  updateUserSchema,
} from '@god/shared';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { hashPassword } from '../auth/auth.routes';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { idParam, iso, isoOrNull, parseBody, parseQuery } from '../http';
import { disconnectUser } from '../realtime/hub';
import { toUserDTO, userSelect } from '../serializers';

/** Calls that need nobody any more. */
const DONE_STATUSES = ['finished', 'invoice_submit', 'invoice_approve', 'process_to_bank'] as const;

export const usersRouter = Router();
usersRouter.use('/users', requireAuth, requireRole('founder', 'manager'));

/** Users a Manager may see: every Associate and every Expert (§6.2). */
function visibleUsersWhere(actor: Actor): Prisma.UserWhereInput {
  // Deleted accounts are gone from every list; only their past work still names them.
  if (actor.role === 'founder') return { deletedAt: null };
  // A Manager works with every Associate (runs calls with them, gives them tasks);
  // editing accounts stays limited to their own team (PATCH below).
  return { deletedAt: null, role: { in: ['associate', 'expert'] } };
}

async function loadVisibleUser(actor: Actor, id: string | null) {
  if (!id) throw notFound('User');
  const user = await prisma.user.findFirst({ where: { AND: [{ id }, visibleUsersWhere(actor)] }, select: userSelect });
  if (!user) throw notFound('User');
  return user;
}

async function assertManager(managerId: string | null | undefined) {
  if (!managerId) throw badRequest('An Associate needs a Manager', { issues: [{ path: 'managerId', message: 'Choose a Manager' }] });
  const manager = await prisma.user.findUnique({ where: { id: managerId }, select: { role: true, isActive: true } });
  if (!manager || manager.role !== 'manager' || !manager.isActive) {
    throw badRequest('Manager must be an active Manager', { issues: [{ path: 'managerId', message: 'Not an active Manager' }] });
  }
}

usersRouter.get('/users/me/team', requireRole('manager'), async (req, res) => {
  const actor = actorOf(req);
  const team = await prisma.user.findMany({
    where: { role: 'associate', managerId: actor.id, deletedAt: null },
    select: userSelect,
    orderBy: [{ isActive: 'desc' }, { nickname: 'asc' }],
  });
  res.json(team.map(toUserDTO));
});

usersRouter.get('/users', async (req, res) => {
  const actor = actorOf(req);
  const query = parseQuery(listUsersQuerySchema, req);
  const users = await prisma.user.findMany({
    where: {
      AND: [
        visibleUsersWhere(actor),
        query.role ? { role: query.role } : {},
        query.active ? { isActive: query.active === 'true' } : {},
        query.q ? { nickname: { contains: query.q, mode: 'insensitive' } } : {},
      ],
    },
    select: userSelect,
    orderBy: [{ role: 'asc' }, { nickname: 'asc' }],
  });
  res.json(users.map(toUserDTO));
});

usersRouter.post('/users', async (req, res) => {
  const actor = actorOf(req);
  const input = parseBody(createUserSchema, req);

  if (!CREATABLE_ROLES[actor.role].includes(input.role)) {
    throw forbidden(`A ${actor.role} cannot create a ${input.role}`);
  }
  let managerId: string | null = null;
  if (input.role === 'associate') {
    managerId = actor.role === 'manager' ? actor.id : (input.managerId ?? null);
    if (actor.role === 'manager' && input.managerId && input.managerId !== actor.id) {
      throw forbidden('Managers can only add Associates to their own team');
    }
    await assertManager(managerId);
  } else if (input.managerId) {
    throw badRequest('Only Associates have a Manager');
  }
  if (input.timeZone && input.role !== 'expert') {
    throw badRequest('Only Experts have their own time zone', { issues: [{ path: 'timeZone', message: 'Experts only' }] });
  }
  const avatarId = input.avatarId ?? defaultAvatarFor(input.role);
  if (!isAvatarForAudience(avatarId, input.role)) {
    throw badRequest('Choose an avatar from the role’s set', { issues: [{ path: 'avatarId', message: 'Wrong avatar set' }] });
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { nickname: { equals: input.nickname, mode: 'insensitive' } }] },
    select: { email: true },
  });
  if (existing) {
    const field = existing.email === input.email ? 'email' : 'nickname';
    throw conflict(`That ${field} is already in use`, 'conflict', { field });
  }

  const user = await prisma.user.create({
    data: {
      nickname: input.nickname,
      role: input.role,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      managerId,
      avatarId,
      ...(input.role === 'expert' && input.timeZone ? { timeZone: input.timeZone } : {}),
    },
    select: userSelect,
  });
  res.status(201).json(toUserDTO(user));
});

usersRouter.get('/users/:id', async (req, res) => {
  const user = await loadVisibleUser(actorOf(req), idParam(req));
  res.json(toUserDTO(user));
});

/**
 * Founder only: deletes the account. Everything personal goes (email, password, Google,
 * sessions, devices, picture, notifications) and the nickname is freed, while their calls,
 * messages and audit entries stay, showing a removed user.
 */
usersRouter.delete('/users/:id', requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const id = idParam(req);
  const target = id ? await prisma.user.findFirst({ where: { id, deletedAt: null }, select: userSelect }) : null;
  if (!target) throw notFound('User');
  if (target.id === actor.id) throw badRequest('You cannot delete your own account');

  const [team, openCalls, founders] = await Promise.all([
    prisma.user.count({ where: { managerId: target.id, deletedAt: null } }),
    prisma.call.count({ where: { status: { notIn: [...DONE_STATUSES] }, OR: [{ associateId: target.id }, { expertId: target.id }] } }),
    target.role === 'founder' ? prisma.user.count({ where: { role: 'founder', deletedAt: null } }) : Promise.resolve(2),
  ]);
  if (team) throw conflict(`Move ${target.nickname}’s ${team === 1 ? 'Associate' : 'Associates'} to another Manager first`);
  if (openCalls) throw conflict(`${target.nickname} still has ${openCalls} call${openCalls === 1 ? '' : 's'} to finish or hand over`);
  if (founders < 2) throw conflict('The last Founder cannot be deleted');

  const suffix = target.id.replace(/-/g, '').slice(0, 6);
  await prisma.$transaction(async (tx) => {
    // Erase everything that could sign them in or identify them.
    await tx.authIdentity.deleteMany({ where: { userId: target.id } });
    await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.webPushSubscription.deleteMany({ where: { userId: target.id } });
    await tx.notification.deleteMany({ where: { userId: target.id } });
    await tx.user.update({
      where: { id: target.id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        nickname: `Removed user ${suffix}`,
        email: `deleted-${target.id}@deleted.invalid`,
        passwordHash: await hashPassword(randomUUID()),
        photoId: null,
        managerId: null,
      },
    });
    if (target.photoId) await tx.photo.deleteMany({ where: { id: target.photoId } });
  });
  disconnectUser(target.id);
  res.status(204).end();
});

async function signInDetails(id: string): Promise<SignInDetailsDTO> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { email: true, identities: { where: { provider: 'google' } } },
  });
  if (!user) throw notFound('User');
  const link = user.identities[0];
  return {
    email: user.email,
    google: link ? { email: link.email, linkedAt: iso(link.createdAt), lastUsedAt: isoOrNull(link.lastUsedAt) } : null,
  };
}

/** Founder only: the sign-in email and the linked Google account. Recorded in the audit trail. */
usersRouter.get('/users/:id/sign-in', requireRole('founder'), async (req, res) => {
  const id = idParam(req);
  if (!id) throw notFound('User');
  res.json(await signInDetails(id));
});

/** Founder only: changes the sign-in email, which Google sign-in is matched against the first time. */
usersRouter.patch('/users/:id/sign-in', requireRole('founder'), async (req, res) => {
  const id = idParam(req);
  if (!id) throw notFound('User');
  const { email } = parseBody(signInEmailSchema, req);
  const taken = await prisma.user.findFirst({ where: { email, NOT: { id } }, select: { id: true } });
  if (taken) throw conflict('That email is already in use', 'conflict', { field: 'email' });
  const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw notFound('User');
  await prisma.user.update({ where: { id }, data: { email } });
  res.json(await signInDetails(id));
});

/** Founder only: unlinks the Google account, e.g. when someone switches Gmail addresses. */
usersRouter.delete('/users/:id/google', requireRole('founder'), async (req, res) => {
  const id = idParam(req);
  if (!id) throw notFound('User');
  await prisma.authIdentity.deleteMany({ where: { userId: id, provider: 'google' } });
  res.json(await signInDetails(id));
});

usersRouter.patch('/users/:id', async (req, res) => {
  const actor = actorOf(req);
  const target = await loadVisibleUser(actor, idParam(req));
  const input = parseBody(updateUserSchema, req);

  if (actor.role === 'manager') {
    if (target.role !== 'associate' || target.managerId !== actor.id) {
      throw forbidden('Managers can only change their own Associates');
    }
    if (input.managerId !== undefined || input.timeZone !== undefined) {
      throw forbidden('Only the Founder can move Associates or set time zones');
    }
  }
  if (target.id === actor.id && input.isActive === false) throw badRequest('You cannot deactivate yourself');
  if (target.role === 'founder' && actor.role !== 'founder') throw forbidden();
  if (input.timeZone !== undefined && target.role !== 'expert') {
    throw badRequest('Only Experts have their own time zone');
  }
  if (input.managerId !== undefined) {
    if (target.role !== 'associate') throw badRequest('Only Associates have a Manager');
    await assertManager(input.managerId);
  }
  if (input.nickname) {
    const taken = await prisma.user.findFirst({
      where: { nickname: { equals: input.nickname, mode: 'insensitive' }, NOT: { id: target.id } },
      select: { id: true },
    });
    if (taken) throw conflict('That nickname is already in use', 'conflict', { field: 'nickname' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: target.id },
      data: {
        nickname: input.nickname,
        isActive: input.isActive,
        timeZone: input.timeZone,
        ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
      },
      select: userSelect,
    });
    if (input.isActive === false) {
      await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return user;
  });
  if (input.isActive === false) disconnectUser(target.id);
  res.json(toUserDTO(updated));
});
