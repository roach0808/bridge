import {
  CREATABLE_ROLES,
  createUserSchema,
  defaultAvatarFor,
  isAvatarForAudience,
  listUsersQuerySchema,
  updateUserSchema,
} from '@god/shared';
import type { Prisma } from '@prisma/client';
import { Router } from 'express';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { hashPassword } from '../auth/auth.routes';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { idParam, parseBody, parseQuery } from '../http';
import { disconnectUser } from '../realtime/hub';
import { toUserDTO, userSelect } from '../serializers';

export const usersRouter = Router();
usersRouter.use('/users', requireAuth, requireRole('founder', 'manager'));

/** Users a Manager may see: their own Associates plus every Expert (§6.2). */
function visibleUsersWhere(actor: Actor): Prisma.UserWhereInput {
  if (actor.role === 'founder') return {};
  return { OR: [{ role: 'associate', managerId: actor.id }, { role: 'expert' }] };
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
    where: { role: 'associate', managerId: actor.id },
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
