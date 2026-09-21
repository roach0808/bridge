/**
 * Who is paid what for a call (§3.1 "Money on a call"). The Founder is the only
 * payer and pays two people per call:
 * - the Expert: their hourly rate when the call finished × the real duration;
 * - the Manager: a share of the real income (the Profile's Manager share, 15%
 *   unless the Founder set another), once the bank has paid.
 * The Associate's own share is part of the Manager's share: the Manager passes
 * it on and keeps the rest (15% − 10% = 5% with the defaults).
 */
export const PAYEES = ['expert', 'manager', 'associate'] as const;
export type Payee = (typeof PAYEES)[number];

export const PAYEE_LABELS: Record<Payee, string> = {
  expert: 'Expert',
  manager: 'Manager',
  associate: 'Associate',
};

export const DEFAULT_MANAGER_SHARE_PERCENT = 15;
/** A new Associate's share until the Founder sets another. */
export const DEFAULT_ASSOCIATE_SHARE_PERCENT = 10;

/** `percent` % of `amount`, rounded to cents. */
export function shareOf(amount: number, percent: number): number {
  return Math.round(amount * percent) / 100;
}

/** The Associate's part never exceeds the Manager's share it is taken from. */
export function associateShareWithin(associatePercent: number, managerPercent: number): number {
  return Math.min(associatePercent, managerPercent);
}
