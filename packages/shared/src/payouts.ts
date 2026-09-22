/**
 * Who is paid what for a call (§3.1 "Money on a call"). The Founder is the only
 * payer and pays two people per call:
 * - the Expert: their hourly rate when the call finished × the real duration;
 * - the Manager: a share of the real income (the Profile's Manager share, 15%
 *   unless the Founder set another), once the bank has paid.
 * The Associate's percent is a portion of the Manager's share, which the
 * Manager passes on: with 15% and 50%, the Associate gets 7.5% of the income
 * and the Manager keeps 7.5%. Everyone is paid once a month (payment cycles).
 */
export const PAYEES = ['expert', 'manager', 'associate'] as const;
export type Payee = (typeof PAYEES)[number];

export const PAYEE_LABELS: Record<Payee, string> = {
  expert: 'Expert',
  manager: 'Manager',
  associate: 'Associate',
};

export const DEFAULT_MANAGER_SHARE_PERCENT = 15;
/** A new Associate's portion of their Manager's share, until the Founder or the Manager sets another. */
export const DEFAULT_ASSOCIATE_SHARE_PERCENT = 50;

/** `percent` % of `amount`, rounded to cents. */
export function shareOf(amount: number, percent: number): number {
  return Math.round(amount * percent) / 100;
}

/** The Associate's part: their percent of the Manager's percent of `amount`, to the cent. */
export function associateShareOf(amount: number, managerPercent: number, associatePercent: number): number {
  return Math.round((amount * managerPercent * associatePercent) / 100) / 100;
}
