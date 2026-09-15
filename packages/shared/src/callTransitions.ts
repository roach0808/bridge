import type { CallStatus } from './callStatus';
import type { Role } from './roles';

export interface Transition {
  from: CallStatus;
  to: CallStatus;
  roles: Role[];
}

/** The single source of truth for the Call workflow (§4.3). */
export const TRANSITIONS: Transition[] = [
  { from: 'on_scheduling',   to: 'scheduled',       roles: ['associate', 'manager', 'founder'] },
  { from: 'scheduled',       to: 'on_rescheduling', roles: ['associate', 'manager', 'founder'] },
  { from: 'on_rescheduling', to: 'scheduled',       roles: ['associate', 'manager', 'founder'] },
  { from: 'scheduled',       to: 'ongoing',         roles: ['expert', 'founder'] },
  { from: 'scheduled',       to: 'finished',        roles: ['expert', 'founder'] },
  { from: 'ongoing',         to: 'finished',        roles: ['expert', 'founder'] },
  { from: 'finished',        to: 'invoice_submit',  roles: ['founder'] },
  { from: 'invoice_submit',  to: 'invoice_approve', roles: ['founder'] },
  { from: 'invoice_approve', to: 'process_to_bank', roles: ['founder'] },
];

/** The role that normally owns each edge; anyone else allowed is an override. */
const EDGE_OWNER: Record<string, Role> = {
  'on_scheduling>scheduled': 'associate',
  'scheduled>on_rescheduling': 'associate',
  'on_rescheduling>scheduled': 'associate',
  'scheduled>ongoing': 'expert',
  'scheduled>finished': 'expert',
  'ongoing>finished': 'expert',
  'finished>invoice_submit': 'founder',
  'invoice_submit>invoice_approve': 'founder',
  'invoice_approve>process_to_bank': 'founder',
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
      return ctx.managesCallAssociate;
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

/** True when the actor is not the edge's normal owner. */
export function isOverride(role: Role, from: CallStatus, to: CallStatus): boolean {
  const owner = EDGE_OWNER[`${from}>${to}`];
  return owner !== undefined && owner !== role;
}

export function edgeOwner(from: CallStatus, to: CallStatus): Role | undefined {
  return EDGE_OWNER[`${from}>${to}`];
}
