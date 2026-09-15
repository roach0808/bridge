import {
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
      return { associate: { managerId: actor.id } };
    case 'associate':
      return { associateId: actor.id };
    case 'expert':
      return { expertId: actor.id };
  }
}

export function canViewCall(actor: Pick<Actor, 'id' | 'role'>, call: CallAccessShape): boolean {
  switch (actor.role) {
    case 'founder':
      return true;
    case 'manager':
      return call.associate.managerId === actor.id;
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
  const ownsScheduling =
    actor.role === 'founder' ||
    (actor.role === 'manager' && call.associate.managerId === actor.id) ||
    (actor.role === 'associate' && call.associateId === actor.id);
  const supervises = actor.role === 'founder' || (actor.role === 'manager' && call.associate.managerId === actor.id);

  return {
    edit: ownsScheduling && (scheduling || actor.role === 'founder'),
    reassignAssociate: supervises,
    reassignExpert:
      (supervises && scheduling) ||
      (actor.role === 'associate' && call.associateId === actor.id && call.status === 'on_scheduling'),
    editInvoice: actor.role === 'founder',
  };
}
