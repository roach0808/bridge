import EventBusyRounded from '@mui/icons-material/EventBusyRounded';
import { Box, ButtonBase, Stack, Tooltip, Typography } from '@mui/material';
import type { Occurrence } from '@god/shared';
import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { STATUS_COLORS } from '@/components/StatusChip';
import { AVAILABILITY_ENABLED } from '@/lib/features';
import { buildEvents, overlapsDay, type TimedEvent } from './calendarUtils';
import { CallTooltip, EventPill, pal, timeOffTitle } from './EventBlocks';
import type { GridColumn } from './TimeGrid';
import { useNow } from './useNow';

const MAX_ITEMS = 3;

type DayItem =
  | { kind: 'event'; event: TimedEvent }
  | { kind: 'allday'; occurrence: Occurrence };

export function MonthGrid({
  days,
  anchor,
  zone,
  columns,
  notes,
  height,
  onDayClick,
  onDateClick,
  onOpenCall,
  onEditTimeOff,
  dayClickLabel,
}: {
  days: DateTime[];
  anchor: DateTime;
  zone: string;
  columns: GridColumn[];
  notes?: Map<string, string | null>;
  height: string | number;
  /** Click on the empty part of a cell. */
  onDayClick?: (day: DateTime) => void;
  /** Click on the date number or "+N more". */
  onDateClick: (day: DateTime) => void;
  onOpenCall: (id: string) => void;
  onEditTimeOff?: (o: Occurrence) => void;
  dayClickLabel?: string;
}) {
  const now = useNow();
  const multi = columns.some((c) => c.expert);
  const today = now.setZone(zone);

  const perColumn = useMemo(
    () => columns.map((c) => ({ column: c, ...buildEvents(c.source, zone, AVAILABILITY_ENABLED, c.color) })),
    [columns, zone],
  );

  const cells = useMemo(
    () =>
      days.map((day) =>
        perColumn.map((p) => {
          const iso = day.toISODate();
          const allDay: DayItem[] = p.allDay
            .filter((o) => DateTime.fromISO(o.startsAt).setZone(zone).toISODate() === iso)
            .map((occurrence) => ({ kind: 'allday', occurrence }));
          const timed: DayItem[] = p.timed
            .filter((e) => overlapsDay(e.start, e.end, day))
            .sort((a, b) => a.start.toMillis() - b.start.toMillis())
            .map((event) => ({ kind: 'event', event }));
          return { column: p.column, items: [...allDay, ...timed] };
        }),
      ),
    [days, perColumn, zone],
  );

  return (
    <Box sx={{ height, overflow: 'auto' }}>
      <Box sx={{ minWidth: 640, height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={(t) => ({
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            borderBottom: `1px solid ${pal(t).divider}`,
            position: 'sticky',
            top: 0,
            bgcolor: 'background.paper',
            zIndex: 2,
          })}
        >
          {days.slice(0, 7).map((d) => (
            <Typography
              key={d.weekday}
              variant="caption"
              sx={{ py: 1, textAlign: 'center', fontWeight: 500, color: 'text.secondary', fontSize: 12 }}
            >
              {d.toFormat('ccc')}
            </Typography>
          ))}
        </Box>
        <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gridAutoRows: 'minmax(112px, 1fr)' }}>
          {days.map((day, i) => {
            const inMonth = day.month === anchor.month;
            const isToday = day.hasSame(today, 'day');
            const dayCells = cells[i]!;
            return (
              <Box
                key={day.toISODate()}
                onClick={onDayClick ? () => onDayClick(day) : undefined}
                role={onDayClick ? 'button' : undefined}
                aria-label={onDayClick ? `${dayClickLabel ?? 'Open'} ${day.toFormat('DDDD')}` : undefined}
                sx={(t) => ({
                  borderRight: (i + 1) % 7 ? `1px solid ${pal(t).divider}` : 'none',
                  borderBottom: i < 35 ? `1px solid ${pal(t).divider}` : 'none',
                  p: 0.5,
                  minWidth: 0,
                  overflow: 'hidden',
                  cursor: onDayClick ? 'pointer' : 'default',
                  bgcolor: inMonth ? 'transparent' : t.alpha(pal(t).text.primary, 0.025),
                  transition: 'background-color 120ms',
                  '&:hover': onDayClick ? { bgcolor: t.alpha(pal(t).text.primary, 0.03) } : undefined,
                })}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.25 }}>
                  <ButtonBase
                    onClick={(e) => {
                      e.stopPropagation();
                      onDateClick(day);
                    }}
                    aria-label={`Open ${day.toFormat('DDDD')}`}
                    sx={(t) => ({
                      minWidth: 26,
                      height: 26,
                      px: 0.5,
                      borderRadius: 99,
                      fontSize: 12.5,
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      color: isToday ? pal(t).primary.contrastText : inMonth ? pal(t).text.primary : pal(t).text.disabled,
                      bgcolor: isToday ? pal(t).primary.main : 'transparent',
                      '&:hover': { bgcolor: isToday ? pal(t).primary.dark : t.alpha(pal(t).text.primary, 0.08) },
                    })}
                  >
                    {day.day === 1 ? day.toFormat('LLL d') : day.day}
                  </ButtonBase>
                </Stack>
                {multi ? (
                  <ExpertDots cells={dayCells} />
                ) : (
                  <SingleDayList
                    items={dayCells[0]?.items ?? []}
                    zone={zone}
                    notes={notes}
                    onOpenCall={onOpenCall}
                    onEditTimeOff={onEditTimeOff}
                    onMore={() => onDateClick(day)}
                  />
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

function SingleDayList({
  items,
  zone,
  notes,
  onOpenCall,
  onEditTimeOff,
  onMore,
}: {
  items: DayItem[];
  zone: string;
  notes?: Map<string, string | null>;
  onOpenCall: (id: string) => void;
  onEditTimeOff?: (o: Occurrence) => void;
  onMore: () => void;
}) {
  const visible = items.length > MAX_ITEMS ? items.slice(0, MAX_ITEMS - 1) : items;
  const hidden = items.length - visible.length;
  return (
    <Stack spacing={0.25}>
      {visible.map((item, i) => {
        if (item.kind === 'allday') {
          const title = timeOffTitle(item.occurrence.blockId ? notes?.get(item.occurrence.blockId) : null);
          return (
            <EventPill
              key={`a${i}`}
              kind="timeoff"
              title={title}
              repeat={item.occurrence.isRecurring}
              tooltip={`${title} · all day`}
              onClick={onEditTimeOff ? () => onEditTimeOff(item.occurrence) : undefined}
            />
          );
        }
        const ev = item.event;
        const time = ev.start.setZone(zone).toFormat(ev.start.minute ? 'h:mm' : 'h a');
        if (ev.type === 'call') {
          return (
            <EventPill
              key={ev.key}
              kind="call"
              accent={STATUS_COLORS[ev.call.status]}
              title={
                <>
                  <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                    {time}
                  </Box>{' '}
                  {ev.call.profile.name}
                </>
              }
              tooltip={<CallTooltip call={ev.call} zone={zone} />}
              onClick={() => onOpenCall(ev.call.id)}
            />
          );
        }
        if (ev.type === 'busy') {
          return <EventPill key={ev.key} kind="busy" title={`${time} Busy`} tooltip="Busy" />;
        }
        const title = timeOffTitle(ev.occurrence.blockId ? notes?.get(ev.occurrence.blockId) : null);
        return (
          <EventPill
            key={ev.key}
            kind="timeoff"
            title={`${time} ${title}`}
            repeat={ev.occurrence.isRecurring}
            tooltip={title}
            onClick={onEditTimeOff ? () => onEditTimeOff(ev.occurrence) : undefined}
          />
        );
      })}
      {hidden > 0 && (
        <ButtonBase
          onClick={(e) => {
            e.stopPropagation();
            onMore();
          }}
          sx={(t) => ({
            justifyContent: 'flex-start',
            px: 0.75,
            height: 20,
            borderRadius: '6px',
            fontSize: 11,
            fontWeight: 500,
            color: 'text.secondary',
            '&:hover': { bgcolor: t.alpha(pal(t).text.primary, 0.06) },
          })}
        >
          +{hidden} more
        </ButtonBase>
      )}
    </Stack>
  );
}

function ExpertDots({ cells }: { cells: Array<{ column: GridColumn; items: DayItem[] }> }) {
  const active = cells
    .map(({ column, items }) => {
      const calls = items.filter((i) => i.kind === 'event' && i.event.type === 'call').length;
      const busy = items.filter((i) => i.kind === 'event' && i.event.type === 'busy').length;
      const timeOff = items.some((i) => i.kind === 'allday' || (i.kind === 'event' && i.event.type === 'timeoff'));
      return { column, calls, busy, timeOff };
    })
    .filter((c) => c.calls || c.busy || c.timeOff);
  return (
    <Stack direction="row" flexWrap="wrap" useFlexGap gap={0.5} sx={{ pt: 0.25 }}>
      {active.map(({ column, calls, busy, timeOff }) => {
        const color = column.color ?? '#64748b';
        const parts = [
          calls ? `${calls} call${calls > 1 ? 's' : ''}` : null,
          busy ? `${busy} busy` : null,
          timeOff ? 'time off' : null,
        ].filter(Boolean);
        return (
          <Tooltip key={column.key} title={`${column.expert?.nickname ?? ''}: ${parts.join(', ')}`} disableInteractive>
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.4}
              onClick={(e) => e.stopPropagation()}
              sx={{
                pl: 0.5,
                pr: 0.75,
                height: 20,
                borderRadius: 99,
                bgcolor: 'action.selected',
              }}
            >
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color }} />
              {calls + busy > 0 && (
                <Typography variant="caption" sx={{ fontSize: 10.5, fontWeight: 500, lineHeight: 1 }}>
                  {calls + busy}
                </Typography>
              )}
              {timeOff && <EventBusyRounded sx={{ fontSize: 11, color: 'warning.main' }} />}
            </Stack>
          </Tooltip>
        );
      })}
    </Stack>
  );
}
