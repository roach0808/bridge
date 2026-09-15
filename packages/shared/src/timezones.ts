import { DateTime, IANAZone } from 'luxon';
import { TEAM_TIME_ZONE } from './roles';
import type { Role } from './roles';

export function isValidTimeZone(zone: string): boolean {
  if (!zone || /^[+-]?\d/.test(zone) || /^(utc|gmt)[+-]/i.test(zone)) return false;
  return IANAZone.isValidZone(zone);
}

/** Experts see their own zone; everyone else works on team time (§9.3). */
export function displayZoneFor(user: { role: Role; timeZone: string }): string {
  return user.role === 'expert' ? user.timeZone : TEAM_TIME_ZONE;
}

/** Short zone label such as "EDT" or "KST" for a given instant. */
export function zoneAbbreviation(zone: string, at: Date | string = new Date()): string {
  const dt = typeof at === 'string' ? DateTime.fromISO(at) : DateTime.fromJSDate(at);
  return dt.setZone(zone).toFormat('ZZZZ');
}

export function formatInZone(
  iso: string,
  zone: string,
  format = "ccc, LLL d · h:mm a",
): string {
  return DateTime.fromISO(iso, { zone: 'utc' }).setZone(zone).toFormat(format);
}

export const COMMON_TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;
