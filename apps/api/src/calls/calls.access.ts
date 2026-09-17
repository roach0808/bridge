import {
  INVOICING_STATUSES,
  STATUS_STAGE,
  allowedTransitions,
  type CallPermissions,
  type CallStatus,
  type TransitionContext,
} from '@god/shared';
import type { Prisma } from '@prisma/client';
import type { Actor } from '../auth/middleware';

/** The minimal shape of a Call needed for access decisions. */
export interface CallAccessShape {
  status: CallStatus;
  associateId: string;
  expertId: string | null;
  associate: { managerId: string | null };
}

/** Prisma filter for the Calls a user may see (§2.3 "View Call"). */
export function visibleCallsWhere(actor: Pick<Actor, 'id' | 'role'>): Prisma.CallWhereInput {
  switch (actor.role) {
    case 'founder':
      return {};
    case 'manager':
      // Their team's calls, and the calls they run themselves.
      return { OR: [{ associate: { managerId: actor.id } }, { associateId: actor.id }] };
    case 'associate':
      return { associateId: actor.id };
    case 'expert':
      return { expertId: actor.id };
  }
}

/** Status-history rows a user may see: Experts don't see the invoicing steps. */
export function visibleHistoryWhere(actor: Pick<Actor, 'role'>): Prisma.CallStatusHistoryWhereInput {
  return actor.role === 'expert' ? { toStatus: { notIn: [...INVOICING_STATUSES] } } : {};
}

export function canViewCall(actor: Pick<Actor, 'id' | 'role'>, call: CallAccessShape): boolean {
  switch (actor.role) {
    case 'founder':
      return true;
    case 'manager':
      return call.associate.managerId === actor.id || call.associateId === actor.id;
    case 'associate':
      return call.associateId === actor.id;
    case 'expert':
      return call.expertId === actor.id;
  }
}

export function transitionContext(actor: Pick<Actor, 'id'>, call: CallAccessShape): TransitionContext {
  return {
    isCallAssociate: call.associateId === actor.id,
    isCallExpert: call.expertId === actor.id,
    managesCallAssociate: call.associate.managerId === actor.id,
    hasExpert: call.expertId !== null,
  };
}

export function allowedTransitionsFor(actor: Pick<Actor, 'id' | 'role'>, call: CallAccessShape): CallStatus[] {
  if (!canViewCall(actor, call)) return [];
  return allowedTransitions(actor.role, call.status, transitionContext(actor, call));
}

/**
 * Field-level permissions (§2.3):
 * - Scheduling details are edited by whoever owns scheduling while the call is
 *   still in the scheduling stage.
 * - Associates may reassign the Expert on their own call only before it is
 *   scheduled; Managers and the Founder during the whole scheduling stage.
 * - Invoice fields belong to the Founder.
 */
export function callPermissions(actor: Pick<Actor, 'id' | 'role'>, call: CallAccessShape): CallPermissions {
  const scheduling = STATUS_STAGE[call.status] === 'scheduling';
  // A Manager supervises their team's calls and their own (which they may hand to their team).
  const supervises =
    actor.role === 'founder' ||
    (actor.role === 'manager' && (call.associate.managerId === actor.id || call.associateId === actor.id));
  const ownsScheduling = supervises || (actor.role === 'associate' && call.associateId === actor.id);

  return {
    edit: ownsScheduling && (scheduling || actor.role === 'founder'),
    reassignAssociate: supervises,
    // The Associate may swap the Expert for as long as they own the scheduling stage.
    reassignExpert: (supervises || (actor.role === 'associate' && call.associateId === actor.id)) && scheduling,
    editIncome: actor.role === 'founder',
    editGptLink: actor.role === 'founder',
    editRate: ownsScheduling,
  };
}
