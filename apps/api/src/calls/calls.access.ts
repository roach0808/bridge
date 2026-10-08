import {
  ACTIVE_STATUSES,
  FINANCE_STATUSES,
  STATUS_STAGE,
  hiddenStatusesFor,
  allowedTransitions,
  type CallPermissions,
  type CallStatus,
  type TransitionContext,
} from '@god/shared';
import type { Prisma } from '@prisma/client';
import { supervisesWork, type Role } from '@god/shared';
import type { Actor } from '../auth/middleware';

/** The minimal shape of a Call needed for access decisions. */
export interface CallAccessShape {
  status: CallStatus;
  associateId: string;
  expertId: string | null;
  expertPaidAt?: Date | null;
  associate: { role: string; managerId: string | null };
}

type Viewer = Pick<Actor, 'id' | 'role' | 'managerId'>;

/** The Founder oversees every call; a Manager every Associate's call, and their own. */
const supervisesCall = (actor: Pick<Actor, 'id' | 'role'>, call: CallAccessShape) =>
  supervisesWork(actor, { id: call.associateId, role: call.associate.role as Role });

/** The team a call belongs to, by its Manager: the Manager who runs it, or the Manager of the Associate who does. */
export const callTeamOf = (call: Pick<CallAccessShape, 'associateId' | 'associate'>): string | null =>
  call.associate.role === 'manager' ? call.associateId : call.associate.managerId;

/**
 * An Associate handles every call of their team as their own: their own, their
 * teammates' (the Associates under the same Manager) and their Manager's.
 */
const teamCallOf = (actor: Viewer, call: CallAccessShape) =>
  actor.role === 'associate' && (call.associateId === actor.id || (actor.managerId !== null && callTeamOf(call) === actor.managerId));

/** Prisma filter for the Calls a user may see (§2.3 "View Call"). */
export function visibleCallsWhere(actor: Viewer): Prisma.CallWhereInput {
  switch (actor.role) {
    case 'founder':
      return {};
    case 'manager':
      // Every Associate's calls, and the calls they run themselves.
      return { OR: [{ associate: { role: 'associate' } }, { associateId: actor.id }] };
    case 'associate':
      // Their own calls, their teammates' and their Manager's.
      return actor.managerId
        ? { OR: [{ associateId: actor.id }, { associateId: actor.managerId }, { associate: { managerId: actor.managerId } }] }
        : { associateId: actor.id };
    case 'expert':
      return { expertId: actor.id };
  }
}

/**
 * Status-history rows a user may see: Experts don't see the invoicing steps, and
 * Associates and Managers don't see the research step (§2.3).
 */
export function visibleHistoryWhere(actor: Pick<Actor, 'role'>): Prisma.CallStatusHistoryWhereInput {
  const hidden = hiddenStatusesFor(actor.role);
  return hidden.length ? { toStatus: { notIn: hidden } } : {};
}

export function canViewCall(actor: Viewer, call: CallAccessShape): boolean {
  switch (actor.role) {
    case 'founder':
      return true;
    case 'manager':
      return supervisesCall(actor, call);
    case 'associate':
      return teamCallOf(actor, call);
    case 'expert':
      return call.expertId === actor.id;
  }
}

export function transitionContext(actor: Viewer, call: CallAccessShape): TransitionContext {
  return {
    // An Associate moves any call of their team along, as its own Associate would.
    isCallAssociate: call.associateId === actor.id || teamCallOf(actor, call),
    isCallExpert: call.expertId === actor.id,
    managesCallAssociate: actor.role === 'manager' && supervisesCall(actor, call),
    hasExpert: call.expertId !== null,
  };
}

export function allowedTransitionsFor(actor: Viewer, call: CallAccessShape): CallStatus[] {
  if (!canViewCall(actor, call)) return [];
  return allowedTransitions(actor.role, call.status, transitionContext(actor, call));
}

/**
 * Field-level permissions (§2.3):
 * - Scheduling details are edited by whoever owns scheduling while the call is
 *   still in the scheduling stage.
 * - Associates handle every call of their team (their own, their teammates'
 *   and their Manager's) as their own; Managers and the Founder every call
 *   they oversee.
 * - Invoice fields belong to the Founder.
 * - A finished call's real duration is corrected by the Founder or a Manager over it.
 * - Once paid to bank the shares are settled on the call's Associate, so it
 *   can no longer be handed to someone else.
 */
export function callPermissions(actor: Viewer, call: CallAccessShape): CallPermissions {
  const scheduling = STATUS_STAGE[call.status] === 'scheduling';
  // A Manager runs every Associate's call, and their own (which they may hand on).
  const supervises = actor.role === 'founder' || (actor.role === 'manager' && supervisesCall(actor, call));
  const ownsScheduling = supervises || teamCallOf(actor, call);

  return {
    edit: ownsScheduling && (scheduling || actor.role === 'founder'),
    reassignAssociate: supervises && call.status !== 'process_to_bank',
    // The Associate may swap the Expert for as long as they own the scheduling stage.
    reassignExpert: ownsScheduling && scheduling,
    editIncome: actor.role === 'founder',
    editResearchLink: actor.role === 'founder',
    // Associates never see a call's rate or income.
    editRate: ownsScheduling && actor.role !== 'associate',
    // The meeting details matter until the call has taken place; the Founder can always correct them.
    editMeeting: ownsScheduling && (ACTIVE_STATUSES.includes(call.status) || actor.role === 'founder'),
    // The Expert's rate is fixed when the call finishes; the Founder may still correct it until the Expert is paid.
    editExpertRate: actor.role === 'founder' && FINANCE_STATUSES.includes(call.status) && !call.expertPaidAt,
    // The Expert reports the minutes when finishing; whoever oversees the call may correct them, until the
    // Expert is paid for them.
    editActualDuration: supervises && FINANCE_STATUSES.includes(call.status) && !call.expertPaidAt,
  };
}
