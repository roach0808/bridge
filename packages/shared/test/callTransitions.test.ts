import { describe, expect, it } from 'vitest';
import {
  CALL_STATUSES,
  ROLES,
  TRANSITIONS,
  allowedTransitions,
  canTransition,
  edgeOwner,
  edgeOwners,
  findTransition,
  isOverride,
  isValidEdge,
  type CallStatus,
  type Role,
  type TransitionContext,
} from '../src';

/** The spec table, written out independently of the implementation. */
const SPEC: Array<[CallStatus, CallStatus, Role[]]> = [
  ['on_scheduling', 'scheduled', ['associate', 'manager', 'founder']],
  ['scheduled', 'confirmed', ['expert', 'founder']],
  ['scheduled', 'on_rescheduling', ['associate', 'manager', 'expert', 'founder']],
  ['confirmed', 'on_rescheduling', ['associate', 'manager', 'expert', 'founder']],
  ['on_rescheduling', 'scheduled', ['associate', 'manager', 'founder']],
  ['confirmed', 'ongoing', ['expert', 'founder']],
  ['confirmed', 'finished', ['expert', 'founder']],
  ['ongoing', 'finished', ['expert', 'founder']],
  ['finished', 'invoice_submit', ['founder']],
  ['invoice_submit', 'invoice_approve', ['founder']],
  ['invoice_approve', 'process_to_bank', ['founder']],
  // Called off before it starts: whoever runs the call, any Manager, the Founder.
  ['on_scheduling', 'cancelled', ['associate', 'manager', 'founder']],
  ['scheduled', 'cancelled', ['associate', 'manager', 'founder']],
  ['confirmed', 'cancelled', ['associate', 'manager', 'founder']],
  ['on_rescheduling', 'cancelled', ['associate', 'manager', 'founder']],
];

const specRoles = (from: CallStatus, to: CallStatus): Role[] =>
  SPEC.find(([f, t]) => f === from && t === to)?.[2] ?? [];

/** Context in which every relationship holds. */
const ALL: TransitionContext = { isCallAssociate: true, isCallExpert: true, managesCallAssociate: true, hasExpert: true };
/** Context in which no relationship holds. */
const NONE: TransitionContext = {
  isCallAssociate: false,
  isCallExpert: false,
  managesCallAssociate: false,
  hasExpert: true,
};

/** Context in which only the given role's relationship holds. */
function ctxFor(role: Role): TransitionContext {
  return {
    isCallAssociate: role === 'associate',
    isCallExpert: role === 'expert',
    managesCallAssociate: role === 'manager',
    hasExpert: true,
  };
}

const combos: Array<[Role, CallStatus, CallStatus]> = [];
for (const role of ROLES) for (const from of CALL_STATUSES) for (const to of CALL_STATUSES) combos.push([role, from, to]);

describe('TRANSITIONS table', () => {
  it('matches the spec table exactly (same edges, same roles)', () => {
    const normalise = (rows: Array<[CallStatus, CallStatus, Role[]]>) =>
      rows.map(([f, t, r]) => `${f}>${t}:${[...r].sort().join(',')}`).sort();
    expect(normalise(TRANSITIONS.map((t) => [t.from, t.to, t.roles]))).toEqual(normalise(SPEC));
  });

  it('has no duplicate edges', () => {
    const keys = TRANSITIONS.map((t) => `${t.from}>${t.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never allows a self-transition', () => {
    for (const s of CALL_STATUSES) expect(isValidEdge(s, s)).toBe(false);
  });

  it('process_to_bank is terminal', () => {
    expect(TRANSITIONS.filter((t) => t.from === 'process_to_bank')).toEqual([]);
  });

  it('cancelling is final, only before the call runs, and never by the Expert', () => {
    expect(TRANSITIONS.filter((t) => t.from === 'cancelled')).toEqual([]);
    expect(TRANSITIONS.filter((t) => t.to === 'cancelled').map((t) => t.from).sort()).toEqual(
      ['confirmed', 'on_rescheduling', 'on_scheduling', 'scheduled'],
    );
    for (const t of TRANSITIONS.filter((t) => t.to === 'cancelled')) expect(t.roles).not.toContain('expert');
  });

  it('nothing transitions back into on_scheduling', () => {
    expect(TRANSITIONS.filter((t) => t.to === 'on_scheduling')).toEqual([]);
  });

  it.each(SPEC.map(([f, t]) => [f, t] as const))('findTransition finds %s → %s', (from, to) => {
    expect(findTransition(from, to)).toMatchObject({ from, to });
  });
});

describe('canTransition: every role × from × to with relationship satisfied', () => {
  it.each(combos)('%s: %s → %s', (role, from, to) => {
    const expected = specRoles(from, to).includes(role);
    expect(canTransition(role, from, to, ALL)).toBe(expected);
    expect(canTransition(role, from, to, ctxFor(role))).toBe(expected);
  });
});

describe('canTransition: every role × from × to with relationship NOT satisfied', () => {
  it.each(combos)('%s: %s → %s', (role, from, to) => {
    // Only the Founder has no relationship requirement.
    const expected = role === 'founder' && specRoles(from, to).includes(role);
    expect(canTransition(role, from, to, NONE)).toBe(expected);
  });
});

describe('canTransition: the wrong relationship does not stand in for the right one', () => {
  const others: Array<[Role, TransitionContext]> = [
    ['associate', { ...NONE, isCallExpert: true, managesCallAssociate: true }],
    ['manager', { ...NONE, isCallExpert: true }],
    ['expert', { ...NONE, isCallAssociate: true, managesCallAssociate: true }],
  ];
  it.each(others)('%s with only other roles’ relationships is refused everywhere', (role, ctx) => {
    for (const [from, to] of SPEC) expect(canTransition(role, from, to, ctx)).toBe(false);
  });
});

describe('a manager running their own call', () => {
  const own: TransitionContext = { ...NONE, isCallAssociate: true, hasExpert: true };
  it('moves it like its associate, and it is not an override', () => {
    expect(canTransition('manager', 'on_scheduling', 'scheduled', own)).toBe(true);
    expect(isOverride('manager', 'on_scheduling', 'scheduled', own)).toBe(false);
    expect(isOverride('manager', 'on_scheduling', 'scheduled')).toBe(true);
    // Expert and Founder steps stay theirs.
    expect(canTransition('manager', 'scheduled', 'confirmed', own)).toBe(false);
    expect(isOverride('manager', 'finished', 'invoice_submit', own)).toBe(true);
  });
});

describe('allowedTransitions', () => {
  const pairs: Array<[Role, CallStatus]> = [];
  for (const role of ROLES) for (const from of CALL_STATUSES) pairs.push([role, from]);

  it.each(pairs)('%s from %s (related)', (role, from) => {
    const expected = SPEC.filter(([f, , roles]) => f === from && roles.includes(role)).map(([, t]) => t);
    expect([...allowedTransitions(role, from, ctxFor(role))].sort()).toEqual([...expected].sort());
  });

  it.each(pairs)('%s from %s (unrelated)', (role, from) => {
    const expected =
      role === 'founder' ? SPEC.filter(([f, , roles]) => f === from && roles.includes(role)).map(([, t]) => t) : [];
    expect([...allowedTransitions(role, from, NONE)].sort()).toEqual([...expected].sort());
  });

  it('a call must be confirmed before it can start or finish', () => {
    expect([...allowedTransitions('expert', 'scheduled', ctxFor('expert'))].sort()).toEqual(['confirmed', 'on_rescheduling']);
    expect([...allowedTransitions('expert', 'confirmed', ctxFor('expert'))].sort()).toEqual(['finished', 'on_rescheduling', 'ongoing']);
    expect(isValidEdge('scheduled', 'ongoing')).toBe(false);
    expect(isValidEdge('scheduled', 'finished')).toBe(false);
  });
});

describe('isOverride and edgeOwner', () => {
  const RESCHEDULE = (f: CallStatus, t: CallStatus) => t === 'on_rescheduling';
  const associateEdges = SPEC.filter(([f, t, r]) => r.includes('associate') && !RESCHEDULE(f, t));
  const expertEdges = SPEC.filter(([f, t, r]) => r.includes('expert') && !RESCHEDULE(f, t));

  it.each(SPEC.filter(([f, t]) => RESCHEDULE(f, t)).map(([f, t]) => [f, t] as const))(
    'rescheduling %s → %s belongs to the associate and the expert',
    (from, to) => {
      expect(edgeOwners(from, to)).toEqual(['associate', 'expert']);
      expect(isOverride('associate', from, to)).toBe(false);
      expect(isOverride('expert', from, to)).toBe(false);
      expect(isOverride('manager', from, to)).toBe(true);
      expect(isOverride('founder', from, to)).toBe(true);
    },
  );
  const founderEdges = SPEC.filter(([, , r]) => r.length === 1 && r[0] === 'founder');

  it.each(associateEdges.map(([f, t]) => [f, t] as const))('associate edge %s → %s', (from, to) => {
    expect(edgeOwner(from, to)).toBe('associate');
    expect(isOverride('associate', from, to)).toBe(false);
    expect(isOverride('manager', from, to)).toBe(true);
    expect(isOverride('founder', from, to)).toBe(true);
  });

  it.each(expertEdges.map(([f, t]) => [f, t] as const))('expert edge %s → %s', (from, to) => {
    expect(edgeOwner(from, to)).toBe('expert');
    expect(isOverride('expert', from, to)).toBe(false);
    expect(isOverride('founder', from, to)).toBe(true);
  });

  it.each(founderEdges.map(([f, t]) => [f, t] as const))('founder edge %s → %s is never an override for the founder', (from, to) => {
    expect(edgeOwner(from, to)).toBe('founder');
    expect(isOverride('founder', from, to)).toBe(false);
  });

  it('non-edges are never overrides and have no owner', () => {
    for (const from of CALL_STATUSES)
      for (const to of CALL_STATUSES) {
        if (isValidEdge(from, to)) continue;
        expect(edgeOwner(from, to)).toBeUndefined();
        for (const role of ROLES) expect(isOverride(role, from, to)).toBe(false);
      }
  });
});
