import type { ExpertColumn, ExpertRef } from '@god/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/**
 * What the calendar is showing for a non-Expert viewer: every call they can see
 * (no Expert ticked), one Expert's calendar, or several Experts side by side
 * (`all` keeps every active Expert, including ones added later).
 */
export type CalendarSubject = { type: 'mine' } | { type: 'all' } | { type: 'expert'; id: string } | { type: 'experts'; ids: string[] };

/** `?expert=` holds `all`, one id, or ids separated by commas. */
export function parseSubject(value: string | null): CalendarSubject {
  if (value === 'all') return { type: 'all' };
  const ids = [...new Set((value ?? '').split(',').filter((id) => id && id !== 'mine'))];
  if (ids.length === 1) return { type: 'expert', id: ids[0]! };
  if (ids.length > 1) return { type: 'experts', ids };
  return { type: 'mine' };
}

export const subjectParam = (s: CalendarSubject) =>
  s.type === 'expert' ? s.id : s.type === 'experts' ? s.ids.join(',') : s.type === 'mine' ? null : 'all';

/** The Experts a subject names; null for every Expert. */
export const subjectExpertIds = (s: CalendarSubject): string[] | null =>
  s.type === 'all' ? null : s.type === 'expert' ? [s.id] : s.type === 'experts' ? s.ids : [];

/** `?profile=` / `?manager=`: ids separated by commas. */
export const parseIds = (value: string | null) => [...new Set((value ?? '').split(',').filter(Boolean))];

/** A call with no Manager (the Founder runs it) is filtered as this. */
export const NO_MANAGER = 'none';

/** A single-Expert or "my calls" calendar. */
export function useExpertCalendar(fromIso: string, toIso: string, expertId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.calendar.expert(fromIso, toIso, expertId),
    queryFn: () => api.calendar.get({ from: fromIso, to: toIso, ...(expertId ? { expertId } : {}) }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useExpertsCalendar(fromIso: string, toIso: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.calendar.experts(fromIso, toIso),
    queryFn: () => api.calendar.experts({ from: fromIso, to: toIso }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/**
 * The Expert directory (with colour slots and zones) for the selector. Uses a
 * one-day window of the experts calendar so associates can use it too; the key
 * is stable for the whole UTC day so it is fetched once.
 */
export function useExpertDirectory(enabled: boolean) {
  const { from, to } = useMemo(() => {
    const start = DateTime.utc().startOf('day');
    return {
      from: start.toISO({ suppressMilliseconds: true })!,
      to: start.plus({ days: 1 }).toISO({ suppressMilliseconds: true })!,
    };
  }, []);
  const query = useQuery({
    queryKey: qk.calendar.experts(from, to),
    queryFn: () => api.calendar.experts({ from, to }),
    enabled,
    staleTime: 5 * 60_000,
  });
  const experts = useMemo<Array<{ expert: ExpertRef; slot: number }>>(
    () => (query.data?.experts ?? []).map((c: ExpertColumn) => ({ expert: c.expert, slot: c.slot })),
    [query.data],
  );
  return { experts, isLoading: query.isLoading, error: query.error };
}
