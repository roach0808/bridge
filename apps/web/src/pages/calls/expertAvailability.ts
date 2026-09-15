import type { ExpertColumn, ExpertRef, Role } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { api } from '@/lib/api';
import { AVAILABILITY_ENABLED } from '@/lib/features';
import { qk } from '@/lib/queryKeys';

export type ExpertAvailability =
  | { state: 'free' }
  | { state: 'call'; label: string }
  | { state: 'busy' }
  | { state: 'time_off' }
  | { state: 'outside_hours' };

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  Date.parse(aStart) < Date.parse(bEnd) && Date.parse(bStart) < Date.parse(aEnd);

/** Whether an Expert is free for [start, end), ignoring `excludeCallId`. */
export function availabilityFor(
  column: ExpertColumn,
  start: string,
  end: string,
  excludeCallId?: string,
): ExpertAvailability {
  const call = column.calls.find(
    (c) => c.id !== excludeCallId && c.status !== 'on_scheduling' && overlaps(c.scheduledAt, c.endsAt, start, end),
  );
  if (call) return { state: 'call', label: call.profile.name };
  // A tentative call that is the one being edited shows up as `busy` for other viewers only
  // when it is blocking, so `busy` never contains the excluded call's own interval twice.
  if (column.busy.some((b) => overlaps(b.startsAt, b.endsAt, start, end))) return { state: 'busy' };
  if (column.occurrences.some((o) => o.kind === 'unavailable' && overlaps(o.startsAt, o.endsAt, start, end)))
    return { state: 'time_off' };
  if (AVAILABILITY_ENABLED) {
    const windows = column.occurrences.filter((o) => o.kind === 'available');
    if (windows.length && !windows.some((o) => Date.parse(o.startsAt) <= Date.parse(start) && Date.parse(o.endsAt) >= Date.parse(end)))
      return { state: 'outside_hours' };
  }
  return { state: 'free' };
}

export const AVAILABILITY_LABEL: Record<ExpertAvailability['state'], string> = {
  free: 'Free',
  call: 'Has a call',
  busy: 'Busy',
  time_off: 'Time off',
  outside_hours: 'Outside working hours',
};

/**
 * Every active Expert's calendar for the day around [start, end), so forms
 * can show each Expert's local time and whether they are free.
 */
export function useExpertsAround(start: string | null, end: string | null, role: Role) {
  const from = start ? DateTime.fromISO(start).minus({ hours: 12 }).toUTC().startOf('hour').toISO()! : '';
  const to = end ? DateTime.fromISO(end).plus({ hours: 12 }).toUTC().startOf('hour').toISO()! : '';
  return useQuery({
    queryKey: qk.calendar.experts(from, to),
    queryFn: () => api.calendar.experts({ from, to }),
    enabled: Boolean(start && end) && role !== 'expert',
    staleTime: 15_000,
  });
}

export const expertLocalTime = (expert: ExpertRef, iso: string) =>
  DateTime.fromISO(iso).setZone(expert.timeZone);
