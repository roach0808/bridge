import type { ExpertColumn, ExpertRef } from '@god/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

/** What the calendar is showing for a non-Expert viewer. */
export type CalendarSubject = { type: 'mine' } | { type: 'all' } | { type: 'expert'; id: string };

export function parseSubject(value: string | null): CalendarSubject {
  if (value === 'all') return { type: 'all' };
  if (value && value !== 'mine') return { type: 'expert', id: value };
  return { type: 'mine' };
}

export const subjectParam = (s: CalendarSubject) => (s.type === 'expert' ? s.id : s.type === 'mine' ? null : 'all');

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
