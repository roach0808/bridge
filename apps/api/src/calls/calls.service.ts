import {
  ERROR_CODES,
  FEATURES,
  INVOICING_STATUSES,
  STATUS_LABELS,
  canTransition,
  isOverride,
  isValidEdge,
  listCallsQuerySchema,
  statusFilterForRole,
  type CallDetailDTO,
  type CallDTO,
  type CallStatus,
  type NotificationType,
  type Paginated,
  type createCallSchema,
  type transitionSchema,
  type updateCallSchema,
} from '@god/shared';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type { Actor } from '../auth/middleware';
import { prisma, type Tx } from '../db';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors';
import { logger } from '../logger';
import { deliverAll, notify, type Deliver } from '../notifications/notify';
import { emitToUser } from '../realtime/hub';
import { historyInclude, messageInclude, toHistoryDTO, toMessageDTO } from '../serializers';
import { callPermissions, canViewCall, transitionContext, visibleCallsWhere, visibleHistoryWhere } from './calls.access';
import { callInclude, toCallDTO, type CallRow } from './calls.serialize';

type CreateCallInput = z.output<typeof createCallSchema>;
type UpdateCallInput = z.output<typeof updateCallSchema>;
type ListCallsQuery = z.output<typeof listCallsQuerySchema>;
type TransitionInput = z.output<typeof transitionSchema>;

const actorRef = (actor: Actor) => ({ nickname: actor.nickname, role: actor.role });

/** The Associate, Expert, the Associate's Manager, and every active Founder. */
export async function participantIds(db: Tx | typeof prisma, call: CallRow): Promise<string[]> {
  const founders = await db.user.findMany({ where: { role: 'founder', isActive: true }, select: { id: true } });
  const ids = [call.associateId, call.expertId, call.associate.managerId, ...founders.map((f) => f.id)];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** Sends each participant the Call as they are allowed to see it (§4.4 step 4). */
export async function broadcastCall(callId: string): Promise<void> {
  // Runs fire-and-forget after the response: it must never reject, or the
  // unhandled rejection would take the whole process down.
  try {
    const call = await prisma.call.findUnique({ where: { id: callId }, include: callInclude });
    if (!call) return;
    const users = await prisma.user.findMany({
      where: { id: { in: await participantIds(prisma, call) }, isActive: true },
      select: { id: true, role: true },
    });
    for (const user of users) {
      if (canViewCall(user, call)) emitToUser(user.id, 'call:updated', toCallDTO(call, user));
    }
  } catch (err) {
    logger.warn({ err, callId }, 'call broadcast failed');
  }
}

async function loadCallForActor(db: Tx | typeof prisma, actor: Actor, id: string | null): Promise<CallRow> {
  if (!id) throw notFound('Call');
  const call = await db.call.findUnique({ where: { id }, include: callInclude });
  if (!call || !canViewCall(actor, call)) throw notFound('Call');
  return call;
}

async function lockCall(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM calls WHERE id = ${id}::uuid FOR UPDATE`;
}

async function assertActiveUser(id: string, role: 'associate' | 'expert', field: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true, managerId: true } });
  if (!user || user.role !== role || !user.isActive) {
    const label = role === 'associate' ? 'Associate' : 'Expert';
    throw badRequest(`Choose an active ${label}`, { issues: [{ path: field, message: `Not an active ${label}` }] });
  }
  return user;
}

/**
 * Who may run a call (be its Associate): an active Associate, or an active Manager.
 * A Manager chooses themselves or an Associate on their team.
 */
async function assertCallOwner(actor: Actor, id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true, managerId: true } });
  if (!user || !user.isActive || (user.role !== 'associate' && user.role !== 'manager')) {
    throw badRequest('Choose an active Associate or Manager', { issues: [{ path: 'associateId', message: 'Not an active Associate or Manager' }] });
  }
  if (actor.role === 'manager' && id !== actor.id && !(user.role === 'associate' && user.managerId === actor.id)) {
    throw forbidden('Managers choose themselves or their own team');
  }
  return user;
}

/** Re-throws database conflicts inside a transaction with a typed error. */
function rethrowOverlap(err: unknown): never {
  if (err instanceof Error && err.message.includes('calls_expert_no_overlap')) {
    throw new HttpError(409, ERROR_CODES.expertBusy, 'The Expert already has a call at that time');
  }
  throw err;
}

// ---------------------------------------------------------------------------

export async function listCalls(actor: Actor, query: ListCallsQuery): Promise<Paginated<CallDTO>> {
  const where: Prisma.CallWhereInput = {
    AND: [
      visibleCallsWhere(actor),
      query.status ? { status: { in: statusFilterForRole(actor.role, query.status) } } : {},
      query.associateId ? { associateId: query.associateId } : {},
      query.expertId ? { expertId: query.expertId } : {},
      query.platformId ? { platformId: query.platformId } : {},
      query.from ? { scheduledAt: { gte: new Date(query.from) } } : {},
      query.to ? { scheduledAt: { lt: new Date(query.to) } } : {},
      query.q
        ? {
            OR: [
              { profile: { name: { contains: query.q, mode: 'insensitive' } } },
              { platform: { name: { contains: query.q, mode: 'insensitive' } } },
              { projectDetails: { contains: query.q, mode: 'insensitive' } },
              { platformAssociateName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  };
  const sort = query.sort ?? '-scheduledAt';
  const field = sort.replace('-', '') as 'scheduledAt' | 'updatedAt' | 'createdAt';
  const direction = sort.startsWith('-') ? 'desc' : 'asc';

  const [total, rows] = await prisma.$transaction([
    prisma.call.count({ where }),
    prisma.call.findMany({
      where,
      include: callInclude,
      orderBy: [{ [field]: direction }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: rows.map((c) => toCallDTO(c, actor)), page: query.page, pageSize: query.pageSize, total };
}

export async function getCallDetail(actor: Actor, id: string | null): Promise<CallDetailDTO> {
  const call = await loadCallForActor(prisma, actor, id);
  const [messages, history] = await Promise.all([
    !FEATURES.messages ? [] : prisma.message.findMany({
      where: { callId: call.id },
      include: messageInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    }),
    prisma.callStatusHistory.findMany({
      where: { callId: call.id, ...visibleHistoryWhere(actor) },
      include: historyInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  ]);
  return {
    ...toCallDTO(call, actor),
    messages: messages.reverse().map(toMessageDTO),
    history: history.map(toHistoryDTO),
  };
}

export async function getCallForActor(actor: Actor, id: string | null): Promise<CallRow> {
  return loadCallForActor(prisma, actor, id);
}

export async function createCall(actor: Actor, input: CreateCallInput): Promise<CallDTO> {
  if (actor.role === 'expert') throw forbidden('Experts do not create calls');

  let associateId: string;
  if (actor.role === 'associate') {
    if (input.associateId && input.associateId !== actor.id) {
      throw forbidden('Associates create calls for themselves');
    }
    associateId = actor.id;
  } else if (actor.role === 'manager' && (!input.associateId || input.associateId === actor.id)) {
    // Managers run calls themselves too.
    associateId = actor.id;
  } else {
    if (!input.associateId) {
      throw badRequest('Choose the Associate for this call', { issues: [{ path: 'associateId', message: 'Required' }] });
    }
    await assertCallOwner(actor, input.associateId);
    associateId = input.associateId;
  }
  if (input.expertId) await assertActiveUser(input.expertId, 'expert', 'expertId');

  const [platform, profile] = await Promise.all([
    prisma.platform.findUnique({ where: { id: input.platformId }, select: { id: true } }),
    prisma.profile.findUnique({ where: { id: input.profileId }, select: { id: true, status: true, isActive: true } }),
  ]);
  if (!platform) throw badRequest('Choose a platform', { issues: [{ path: 'platformId', message: 'Unknown platform' }] });
  if (!profile) throw badRequest('Choose a profile', { issues: [{ path: 'profileId', message: 'Unknown profile' }] });
  if (profile.status !== 'approved') {
    throw conflict('A call can only use an approved profile', ERROR_CODES.profileNotApproved);
  }
  if (!profile.isActive) {
    throw conflict('That profile is deactivated', ERROR_CODES.profileNotApproved);
  }

  const { call, delivers } = await prisma.$transaction(async (tx) => {
    const created = await tx.call.create({
      data: {
        status: 'on_scheduling',
        platformId: input.platformId,
        profileId: input.profileId,
        associateId,
        expertId: input.expertId ?? null,
        scheduledAt: new Date(input.scheduledAt),
        durationMinutes: input.durationMinutes,
        projectDetails: input.projectDetails,
        platformAssociateName: input.platformAssociateName,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
      include: callInclude,
    });
    await tx.callStatusHistory.create({
      data: { callId: created.id, fromStatus: null, toStatus: 'on_scheduling', actorId: actor.id, isOverride: false },
    });
    const others = (await participantIds(tx, created)).filter((id) => id !== actor.id);
    const delivers: Deliver[] = [];
    const payload = {
      callId: created.id,
      to: 'on_scheduling' as const,
      actor: actorRef(actor),
      summary: `New call with ${created.profile.name} on ${created.platform.name}`,
    };
    const assigned = others.filter((id) => id === created.expertId || id === created.associateId);
    delivers.push(await notify(tx, assigned, 'call.assigned', payload));
    delivers.push(await notify(tx, others.filter((id) => !assigned.includes(id)), 'call.created', payload));
    return { call: created, delivers };
  });

  deliverAll(delivers);
  void broadcastCall(call.id);
  return toCallDTO(call, actor);
}

export async function updateCall(actor: Actor, id: string | null, input: UpdateCallInput): Promise<CallDTO> {
  const current = await loadCallForActor(prisma, actor, id);
  const perms = callPermissions(actor, current);

  const schedulingFields: (keyof UpdateCallInput)[] = [
    'scheduledAt',
    'durationMinutes',
    'projectDetails',
    'platformAssociateName',
    'platformId',
    'notes',
  ];
  if (schedulingFields.some((f) => input[f] !== undefined) && !perms.edit) {
    throw forbidden('You cannot edit this call’s details at its current stage');
  }
  if (input.associateId !== undefined && input.associateId !== current.associateId) {
    if (!perms.reassignAssociate) throw forbidden('You cannot reassign the Associate');
    await assertCallOwner(actor, input.associateId);
  }
  if (input.expertId !== undefined && input.expertId !== current.expertId) {
    if (!perms.reassignExpert) throw forbidden('You cannot reassign the Expert at this stage');
    if (input.expertId === null && current.status !== 'on_scheduling') {
      throw conflict('A scheduled call must keep an Expert', ERROR_CODES.expertRequired);
    }
    if (input.expertId) await assertActiveUser(input.expertId, 'expert', 'expertId');
  }
  if (input.realIncome !== undefined) {
    if (!perms.editIncome) throw forbidden('Only the Founder records what reached the bank');
    // Before payment there is nothing to correct; the amount is entered with the payment step.
    if (current.status !== 'process_to_bank') {
      throw conflict('Real income is entered when the call is processed to bank');
    }
    if (input.realIncome === null) throw badRequest('A paid call must keep its real income', { issues: [{ path: 'realIncome', message: 'Required once paid' }] });
  }
  if (input.gptLink !== undefined && !perms.editGptLink) {
    throw forbidden('Only the Founder sets the GPT link');
  }
  if (input.rateOverride !== undefined && !perms.editRate) {
    throw forbidden('You cannot set this call’s rate');
  }
  if (input.platformId) {
    const exists = await prisma.platform.findUnique({ where: { id: input.platformId }, select: { id: true } });
    if (!exists) throw badRequest('Choose a platform', { issues: [{ path: 'platformId', message: 'Unknown platform' }] });
  }

  // The Expert confirmed a specific time: moving it needs their confirmation again.
  const timeChanged =
    (input.scheduledAt !== undefined && new Date(input.scheduledAt).getTime() !== current.scheduledAt.getTime()) ||
    (input.durationMinutes !== undefined && input.durationMinutes !== current.durationMinutes);
  const unconfirm = current.status === 'confirmed' && timeChanged;

  const { call, delivers } = await prisma.$transaction(async (tx) => {
    await lockCall(tx, current.id);
    const updated = await tx.call
      .update({
        where: { id: current.id },
        data: {
          status: unconfirm ? 'scheduled' : undefined,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
          durationMinutes: input.durationMinutes,
          projectDetails: input.projectDetails,
          platformAssociateName: input.platformAssociateName,
          platformId: input.platformId,
          notes: input.notes,
          associateId: input.associateId,
          expertId: input.expertId,
          realIncome: input.realIncome === undefined ? undefined : input.realIncome,
          gptLink: input.gptLink,
          rateOverride: input.rateOverride === undefined ? undefined : input.rateOverride,
        },
        include: callInclude,
      })
      .catch(rethrowOverlap);
    if (unconfirm) {
      await tx.callStatusHistory.create({
        data: {
          callId: current.id,
          fromStatus: 'confirmed',
          toStatus: 'scheduled',
          actorId: actor.id,
          isOverride: false,
          comment: 'Time changed — the Expert needs to confirm again',
        },
      });
    }

    const before = new Set(await participantIds(tx, current));
    const after = await participantIds(tx, updated);
    // Money-only edits are none of the Expert's business.
    const MONEY_FIELDS = ['realIncome', 'rateOverride'];
    const moneyOnly = Object.entries(input).every(([k, v]) => v === undefined || MONEY_FIELDS.includes(k));
    const recipients = [...new Set([...before, ...after])].filter(
      (uid) => uid !== actor.id && !(moneyOnly && uid === updated.expertId),
    );
    const newlyAssigned = [updated.expertId, updated.associateId].filter(
      (uid): uid is string => Boolean(uid) && !before.has(uid!) && uid !== actor.id,
    );
    const payload = {
      callId: updated.id,
      actor: actorRef(actor),
      summary: unconfirm
        ? `Call with ${updated.profile.name} moved to a new time — please confirm again`
        : `Call with ${updated.profile.name} was updated`,
    };
    const delivers = [
      await notify(tx, newlyAssigned, 'call.assigned', { ...payload, summary: `You were assigned a call with ${updated.profile.name}` }),
      await notify(tx, recipients.filter((uid) => !newlyAssigned.includes(uid)), 'call.updated', payload),
    ];
    return { call: updated, delivers };
  });

  deliverAll(delivers);
  void broadcastCall(call.id);
  return toCallDTO(call, actor);
}

export async function transitionCall(actor: Actor, id: string | null, input: TransitionInput): Promise<CallDTO> {
  const { to, comment } = input;
  const { call, delivers } = await prisma.$transaction(async (tx) => {
    if (!id) throw notFound('Call');
    await lockCall(tx, id);
    const current = await loadCallForActor(tx, actor, id);
    const from = current.status as CallStatus;

    if (!isValidEdge(from, to)) {
      throw conflict(
        `A call cannot move from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}`,
        ERROR_CODES.invalidTransition,
        { from, to },
      );
    }
    if (!canTransition(actor.role, from, to, transitionContext(actor, current))) {
      throw forbidden(`You cannot move this call to ${STATUS_LABELS[to]}`);
    }
    if (to === 'on_rescheduling' && actor.role === 'expert' && !comment) {
      throw badRequest('Tell the Associate why the call needs rescheduling', {
        issues: [{ path: 'comment', message: 'Add a reason for rescheduling' }],
      });
    }
    if (to === 'scheduled' && !current.expertId) {
      throw conflict('Assign an Expert before scheduling the call', ERROR_CODES.expertRequired);
    }
    // Money has to be known before a finished call can be invoiced (§ rates).
    if (to === 'invoice_submit' && current.rateOverride === null) {
      const platformRate = await tx.profilePlatformStatus.findUnique({
        where: { profileId_platformId: { profileId: current.profileId, platformId: current.platformId } },
        select: { rate: true },
      });
      if (!platformRate?.rate) {
        throw conflict(
          `Set ${current.profile.name}'s hourly rate on ${current.platform.name} before invoicing this call`,
          ERROR_CODES.rateRequired,
          { profileId: current.profileId, platformId: current.platformId },
        );
      }
    }

    // The schema already requires these for `ongoing` / `finished`.
    const data: Prisma.CallUpdateInput = { status: to };
    if (to === 'ongoing') data.ninjaLink = input.ninjaLink;
    if (to === 'finished') {
      data.actualDurationMinutes = input.actualDurationMinutes;
      data.rating = input.rating;
      data.feedback = input.feedback ?? null;
    }
    // The bank never pays exactly the expected price: record what actually arrived.
    if (to === 'process_to_bank') data.realIncome = input.realIncome;
    const updated = await tx.call
      .update({ where: { id }, data, include: callInclude })
      .catch(rethrowOverlap);
    await tx.callStatusHistory.create({
      data: {
        callId: id,
        fromStatus: from,
        toStatus: to,
        actorId: actor.id,
        isOverride: isOverride(actor.role, from, to, { isCallAssociate: current.associateId === actor.id }),
        comment: comment ?? null,
      },
    });
    // Experts are not told about invoicing.
    const invoicing = INVOICING_STATUSES.includes(to);
    const recipients = (await participantIds(tx, updated)).filter(
      (uid) => uid !== actor.id && !(invoicing && uid === updated.expertId),
    );
    const type: NotificationType = 'call.status_changed';
    const deliver = await notify(tx, recipients, type, {
      callId: id,
      from,
      to,
      actor: actorRef(actor),
      summary: `${updated.profile.name}: ${STATUS_LABELS[from]} → ${STATUS_LABELS[to]}`,
    });
    return { call: updated, delivers: [deliver] };
  });

  deliverAll(delivers);
  void broadcastCall(call.id);
  return toCallDTO(call, actor);
}

export function isPrismaError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError;
}
