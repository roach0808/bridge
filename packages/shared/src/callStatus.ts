export const CALL_STATUSES = [
  'on_scheduling',
  'scheduled',
  'confirmed',
  'on_rescheduling',
  'ongoing',
  'finished',
  'invoice_submit',
  'invoice_approve',
  'process_to_bank',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const STAGES = ['scheduling', 'execution', 'invoicing'] as const;
export type Stage = (typeof STAGES)[number];

export const STATUS_STAGE: Record<CallStatus, Stage> = {
  on_scheduling: 'scheduling',
  scheduled: 'scheduling',
  confirmed: 'scheduling',
  on_rescheduling: 'scheduling',
  ongoing: 'execution',
  finished: 'execution',
  invoice_submit: 'invoicing',
  invoice_approve: 'invoicing',
  process_to_bank: 'invoicing',
};

export const STATUS_LABELS: Record<CallStatus, string> = {
  on_scheduling: 'On scheduling',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  on_rescheduling: 'On rescheduling',
  ongoing: 'Ongoing',
  finished: 'Finished',
  invoice_submit: 'Invoice submitted',
  invoice_approve: 'Invoice approved',
  process_to_bank: 'Processed to bank',
};

export const STAGE_LABELS: Record<Stage, string> = {
  scheduling: 'Scheduling',
  execution: 'Execution',
  invoicing: 'Invoicing',
};

export const STAGE_STATUSES: Record<Stage, CallStatus[]> = {
  scheduling: ['on_scheduling', 'scheduled', 'confirmed', 'on_rescheduling'],
  execution: ['ongoing', 'finished'],
  invoicing: ['invoice_submit', 'invoice_approve', 'process_to_bank'],
};

/** Statuses in which a call occupies the Expert's time (§3.3). */
export const BLOCKING_STATUSES: readonly CallStatus[] = [
  'scheduled',
  'confirmed',
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

export const CALL_DURATIONS = [15, 30, 45, 60] as const;
export type CallDuration = (typeof CALL_DURATIONS)[number];

export const TERMINAL_STATUSES: readonly CallStatus[] = ['process_to_bank'];
