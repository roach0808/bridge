import { TEAM_TIME_ZONE, displayZoneFor, type Role } from '@god/shared';
import { DateTime } from 'luxon';

export { TEAM_TIME_ZONE };

export function viewerZone(user: { role: Role; timeZone: string } | null | undefined): string {
  return user ? displayZoneFor(user) : TEAM_TIME_ZONE;
}

export const inZone = (iso: string, zone: string) => DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone);

export const zoneAbbr = (zone: string, at: DateTime | string = DateTime.now()) =>
  (typeof at === 'string' ? DateTime.fromISO(at) : at).setZone(zone).toFormat('ZZZZ');

/** "Mon, Sep 15 · 9:00 AM EDT" */
export function formatDateTime(iso: string, zone: string, withZone = true): string {
  const dt = inZone(iso, zone);
  return `${dt.toFormat('ccc, LLL d · h:mm a')}${withZone ? ` ${dt.toFormat('ZZZZ')}` : ''}`;
}

export const formatTime = (iso: string, zone: string) => inZone(iso, zone).toFormat('h:mm a');
export const formatDate = (iso: string, zone: string) => inZone(iso, zone).toFormat('ccc, LLL d, yyyy');

/** "9:00 – 9:45 AM" */
export function formatRange(startIso: string, endIso: string, zone: string): string {
  const s = inZone(startIso, zone);
  const e = inZone(endIso, zone);
  const sameMeridiem = s.toFormat('a') === e.toFormat('a');
  return `${s.toFormat(sameMeridiem ? 'h:mm' : 'h:mm a')} – ${e.toFormat('h:mm a')}`;
}

export function relativeTime(iso: string): string {
  return DateTime.fromISO(iso).toRelative({ style: 'short' }) ?? '';
}

/** "Today", "Tomorrow", "Yesterday", or "Mon, Sep 15" in the zone. */
export function dayLabel(iso: string, zone: string): string {
  const d = inZone(iso, zone).startOf('day');
  const today = DateTime.now().setZone(zone).startOf('day');
  const diff = Math.round(d.diff(today, 'days').days);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toFormat('ccc, LLL d');
}

export const zoneCity = (zone: string) => zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;

export function formatMoney(amount: string | null, currency: string | null): string {
  if (amount == null) return '—';
  const n = Number(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD' }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ''}`.trim();
  }
}

const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** A USD amount: `$1,250` when whole, `$942.50` otherwise; an em dash when unknown. */
export const formatUsd = (amount: number | null | undefined) =>
  amount == null ? '—' : (Number.isInteger(amount) ? usdWhole : usdCents).format(amount);
