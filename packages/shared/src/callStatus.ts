import type { Role } from './roles';

export const CALL_STATUSES = [
  'on_scheduling',
  'scheduled',
  'confirmed',
  /** The Founder prepared the research data; the Expert may start. Hidden from Associates and Managers. */
  'research_ready',
  'on_rescheduling',
  'ongoing',
  'finished',
  'invoice_submit',
  'invoice_approve',
  'process_to_bank',
  /** Called off before it started: no call, no income (§4.5). */
  'cancelled',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const STAGES = ['scheduling', 'execution', 'invoicing', 'cancelled'] as const;
export type Stage = (typeof STAGES)[number];

/** The stages a call travels through; `cancelled` is a dead end beside them. */
export const TRACK_STAGES: readonly Stage[] = ['scheduling', 'execution', 'invoicing'];

export const STATUS_STAGE: Record<CallStatus, Stage> = {
  on_scheduling: 'scheduling',
  scheduled: 'scheduling',
  confirmed: 'scheduling',
  research_ready: 'scheduling',
  on_rescheduling: 'scheduling',
  ongoing: 'execution',
  finished: 'execution',
  invoice_submit: 'invoicing',
  invoice_approve: 'invoicing',
  process_to_bank: 'invoicing',
  cancelled: 'cancelled',
};

export const STATUS_LABELS: Record<CallStatus, string> = {
  on_scheduling: 'On scheduling',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  research_ready: 'Research data ready',
  on_rescheduling: 'On rescheduling',
  ongoing: 'Ongoing',
  finished: 'Finished',
  invoice_submit: 'Invoice submitted',
  invoice_approve: 'Invoice approved',
  process_to_bank: 'Processed to bank',
  cancelled: 'Cancelled',
};

/** Room-saving names for calendar blocks and other tight spots. */
export const SHORT_STATUS_LABELS: Record<CallStatus, string> = {
  on_scheduling: 'Scheduling',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  research_ready: 'Research ready',
  on_rescheduling: 'Rescheduling',
  ongoing: 'Ongoing',
  finished: 'Done',
  invoice_submit: 'Invoiced',
  invoice_approve: 'Approved',
  process_to_bank: 'Paid',
  cancelled: 'Cancelled',
};

export const STAGE_LABELS: Record<Stage, string> = {
  scheduling: 'Scheduling',
  execution: 'Execution',
  invoicing: 'Invoicing',
  cancelled: 'Cancelled',
};

export const STAGE_STATUSES: Record<Stage, CallStatus[]> = {
  scheduling: ['on_scheduling', 'scheduled', 'confirmed', 'research_ready', 'on_rescheduling'],
  execution: ['ongoing', 'finished'],
  invoicing: ['invoice_submit', 'invoice_approve', 'process_to_bank'],
  cancelled: ['cancelled'],
};

/** Statuses in which a call occupies the Expert's time (§3.3). */
export const BLOCKING_STATUSES: readonly CallStatus[] = [
  'scheduled',
  'confirmed',
  'research_ready',
  'on_rescheduling',
  'ongoing',
  'finished',
  'invoice_submit',
  'invoice_approve',
  'process_to_bank',
];

export function isBlockingStatus(status: CallStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}

/** Statuses at or after `scheduled` that require an expert. */
export const EXPERT_REQUIRED_STATUSES = BLOCKING_STATUSES;

/**
 * Whose move it is: the statuses where a role is the one holding the call up.
 * Managers carry the scheduling steps for the Associates they oversee, as well as their own.
 */
export const WAITING_STATUSES: Record<Role, readonly CallStatus[]> = {
  // A confirmed call waits for the Founder's research data before the Expert can start.
  founder: ['confirmed', 'finished', 'invoice_submit', 'invoice_approve'],
  manager: ['on_scheduling', 'on_rescheduling'],
  associate: ['on_scheduling', 'on_rescheduling'],
  expert: ['scheduled', 'research_ready', 'ongoing'],
};

export const CALL_DURATIONS = [15, 30, 45, 60] as const;
export type CallDuration = (typeof CALL_DURATIONS)[number];

export const TERMINAL_STATUSES: readonly CallStatus[] = ['process_to_bank', 'cancelled'];

/**
 * A call can still be called off while it has not started (§4.5). Cancelling is
 * final: the Expert's time is freed and the call earns nothing.
 */
export const CANCELLABLE_STATUSES: readonly CallStatus[] = ['on_scheduling', 'scheduled', 'confirmed', 'research_ready', 'on_rescheduling'];

/**
 * The two halves of the Calls page (§9.1): calls still on their way (being
 * scheduled or running), and calls that took place, where the money is.
 */
export const ACTIVE_STATUSES: readonly CallStatus[] = ['on_scheduling', 'scheduled', 'confirmed', 'research_ready', 'on_rescheduling', 'ongoing'];
export const FINANCE_STATUSES: readonly CallStatus[] = ['finished', 'invoice_submit', 'invoice_approve', 'process_to_bank'];

/** The invoicing stage. Experts never see it: to them these calls are simply finished. */
export const INVOICING_STATUSES: readonly CallStatus[] = STAGE_STATUSES.invoicing;

/**
 * Steps some roles never see, and what those roles see instead: Experts see
 * invoiced calls as finished; Associates and Managers see a call whose research
 * data is ready as simply confirmed.
 */
const SHOWN_AS: Record<Role, Partial<Record<CallStatus, CallStatus>>> = {
  founder: {},
  manager: { research_ready: 'confirmed' },
  associate: { research_ready: 'confirmed' },
  expert: { invoice_submit: 'finished', invoice_approve: 'finished', process_to_bank: 'finished' },
};

/** The statuses a role never sees (their history rows are left out). */
export function hiddenStatusesFor(role: Role): CallStatus[] {
  return Object.keys(SHOWN_AS[role]) as CallStatus[];
}

/** The status a role is shown for a call. */
export function statusForRole(role: Role, status: CallStatus): CallStatus {
  return SHOWN_AS[role][status] ?? status;
}

/** The statuses of a stage a role sees. */
export function stageStatusesForRole(role: Role, stage: Stage): CallStatus[] {
  const hidden = hiddenStatusesFor(role);
  return STAGE_STATUSES[stage].filter((s) => !hidden.includes(s));
}

/** The stages a role sees (Experts: scheduling and execution only). */
export function stagesForRole(role: Role): Stage[] {
  return role === 'expert' ? STAGES.filter((s) => s !== 'invoicing') : [...STAGES];
}

/**
 * Turns a status filter from a role into the statuses to query: a status the
 * role sees also matches the hidden ones shown as it (for Experts, `finished`
 * matches invoiced calls), and a hidden status matches nothing.
 */
export function statusFilterForRole(role: Role, statuses: CallStatus[]): CallStatus[] {
  const hidden = hiddenStatusesFor(role);
  const visible = statuses.filter((s) => !hidden.includes(s));
  return [...visible, ...hidden.filter((h) => visible.includes(statusForRole(role, h)))];
}

/**
 * What a call should earn: the hourly rate for the minutes it actually took,
 * rounded to cents. Null until both the rate and the real duration are known.
 */
export function expectedPrice(ratePerHour: number | null, actualMinutes: number | null): number | null {
  if (ratePerHour === null || actualMinutes === null) return null;
  return Math.round(ratePerHour * actualMinutes * 100 / 60) / 100;
}
