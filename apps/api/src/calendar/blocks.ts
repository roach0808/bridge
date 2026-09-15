import type { BlockRule, ScheduleBlockDTO } from '@god/shared';
import type { Prisma } from '@prisma/client';
import { dateOnly, fromDateOnly, iso } from '../http';

type BlockRow = Prisma.ScheduleBlockGetPayload<object>;

export function rowToRule(row: BlockRow): BlockRule {
  return {
    id: row.id,
    kind: row.kind,
    timeZone: row.timeZone,
    startDate: dateOnly(row.startDate),
    allDay: row.allDay,
    startMinute: row.startMinute,
    durationMinutes: row.durationMinutes,
    repeat: {
      frequency: row.frequency,
      interval: row.interval,
      weekdays: row.weekdays,
      monthDay: row.monthDay,
      setPosition: row.setPosition,
      weekday: row.weekday,
      month: row.month,
      untilDate: row.untilDate ? dateOnly(row.untilDate) : null,
    },
    exceptionDates: row.exceptionDates,
    note: row.note,
  };
}

export function toBlockDTO(row: BlockRow): ScheduleBlockDTO {
  return {
    ...rowToRule(row),
    id: row.id,
    expertId: row.expertId,
    note: row.note,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

/** Columns for insert/update from a rule (id, expert and author are set by the caller). */
export function ruleToData(rule: BlockRule) {
  return {
    kind: rule.kind,
    timeZone: rule.timeZone,
    startDate: fromDateOnly(rule.startDate),
    allDay: rule.allDay,
    startMinute: rule.startMinute,
    durationMinutes: rule.durationMinutes,
    frequency: rule.repeat.frequency,
    interval: rule.repeat.interval,
    weekdays: rule.repeat.weekdays,
    monthDay: rule.repeat.monthDay,
    setPosition: rule.repeat.setPosition,
    weekday: rule.repeat.weekday,
    month: rule.repeat.month,
    untilDate: rule.repeat.untilDate ? fromDateOnly(rule.repeat.untilDate) : null,
    exceptionDates: rule.exceptionDates,
    note: rule.note ?? null,
  } satisfies Omit<Prisma.ScheduleBlockUncheckedCreateInput, 'expertId' | 'createdById'>;
}
