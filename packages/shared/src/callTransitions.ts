import type { CallStatus } from './callStatus';
import type { Role } from './roles';

export interface Transition {
  from: CallStatus;
  to: CallStatus;
  roles: Role[];
}

/**
 * The single source of truth for the Call workflow (§4.3). The Expert confirms
 * a scheduled time before the call can start, and either side can send a
 * scheduled or confirmed call back for rescheduling.
 */
export const TRANSITIONS: Transition[] = [
  { from: 'on_scheduling',   to: 'scheduled',       roles: ['associate', 'manager', 'founder'] },
  { from: 'scheduled',       to: 'confirmed',       roles: ['expert', 'founder'] },
  { from: 'scheduled',       to: 'on_rescheduling', roles: ['associate', 'manager', 'expert', 'founder'] },
  { from: 'confirmed',       to: 'on_rescheduling', roles: ['associate', 'manager', 'expert', 'founder'] },
  { from: 'on_rescheduling', to: 'scheduled',       roles: ['associate', 'manager', 'founder'] },
  { from: 'confirmed',       to: 'ongoing',         roles: ['expert', 'founder'] },
  { from: 'confirmed',       to: 'finished',        roles: ['expert', 'founder'] },
  { from: 'ongoing',         to: 'finished',        roles: ['expert', 'founder'] },
  { from: 'finished',        to: 'invoice_submit',  roles: ['founder'] },
  { from: 'invoice_submit',  to: 'invoice_approve', roles: ['founder'] },
  { from: 'invoice_approve', to: 'process_to_bank', roles: ['founder'] },
];

/**
 * The roles that normally own each edge (first = primary); anyone else allowed
 * is an override. Rescheduling belongs to both the Associate and the Expert.
 */
const EDGE_OWNERS: Record<string, Role[]> = {
  'on_scheduling>scheduled': ['associate'],
  'scheduled>confirmed': ['expert'],
  'scheduled>on_rescheduling': ['associate', 'expert'],
  'confirmed>on_rescheduling': ['associate', 'expert'],
  'on_rescheduling>scheduled': ['associate'],
  'confirmed>ongoing': ['expert'],
  'confirmed>finished': ['expert'],
  'ongoing>finished': ['expert'],
  'finished>invoice_submit': ['founder'],
  'invoice_submit>invoice_approve': ['founder'],
  'invoice_approve>process_to_bank': ['founder'],
};

/**
 * Relationship facts about the acting user and the Call. The server computes
 * these; clients never send them.
 */
export interface TransitionContext {
  /** Actor is the Call's associate. */
  isCallAssociate: boolean;
  /** Actor is the Call's expert. */
  isCallExpert: boolean;
  /** Actor manages the Call's associate. */
  managesCallAssociate: boolean;
  /** The Call has an expert assigned (required to enter `scheduled`). */
  hasExpert?: boolean;
}

export function findTransition(from: CallStatus, to: CallStatus): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function isValidEdge(from: CallStatus, to: CallStatus): boolean {
  return findTransition(from, to) !== undefined;
}

function hasRelationship(role: Role, ctx: TransitionContext): boolean {
  switch (role) {
    case 'founder':
      return true;
    case 'manager':
      // A Manager may also run calls of their own, like an Associate.
      return ctx.managesCallAssociate || ctx.isCallAssociate;
    case 'associate':
      return ctx.isCallAssociate;
    case 'expert':
      return ctx.isCallExpert;
  }
}

export function canTransition(
  role: Role,
  from: CallStatus,
  to: CallStatus,
  ctx: TransitionContext,
): boolean {
  const t = findTransition(from, to);
  if (!t) return false;
  if (!t.roles.includes(role)) return false;
  return hasRelationship(role, ctx);
}

export function allowedTransitions(
  role: Role,
  from: CallStatus,
  ctx: TransitionContext,
): CallStatus[] {
  return TRANSITIONS.filter((t) => t.from === from && canTransition(role, from, t.to, ctx)).map(
    (t) => t.to,
  );
}

/**
 * True when the actor is not the edge's normal owner. Whoever owns the call
 * (a Manager running their own call too) acts as its Associate.
 */
export function isOverride(role: Role, from: CallStatus, to: CallStatus, ctx?: Pick<TransitionContext, 'isCallAssociate'>): boolean {
  const owners = EDGE_OWNERS[`${from}>${to}`];
  if (owners === undefined) return false;
  if (ctx?.isCallAssociate && owners.includes('associate')) return false;
  return !owners.includes(role);
}

/** The primary owner of an edge. */
export function edgeOwner(from: CallStatus, to: CallStatus): Role | undefined {
  return EDGE_OWNERS[`${from}>${to}`]?.[0];
}

/** Every role that normally owns an edge. */
export function edgeOwners(from: CallStatus, to: CallStatus): Role[] {
  return EDGE_OWNERS[`${from}>${to}`] ?? [];
}
