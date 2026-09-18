import { Box, Stack, Tooltip, Typography, alpha } from '@mui/material';
import type { ExpertRef, Occurrence } from '@god/shared';
import { DateTime } from 'luxon';
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AVAILABILITY_ENABLED } from '@/lib/features';
import {
  DAY_MINUTES,
  DEFAULT_SCROLL_HOUR,
  GRID_HEIGHT,
  HOUR_HEIGHT,
  SNAP_MINUTES,
  atMinute,
  buildEvents,
  dayLengthHours,
  formatDuration,
  formatMinuteRange,
  gutterLabel,
  layoutDay,
  minuteInDay,
  snap,
  snapFloor,
  type CalendarSource,
} from './calendarUtils';
import { BusyBlock, CallBlock, EventPill, TimeOffBlock, pal, timeOffTitle } from './EventBlocks';
import { useNow } from './useNow';

export interface GridColumn {
  key: string;
  source: CalendarSource;
  /** Expert sub-column (all-experts mode). */
  expert?: ExpertRef;
  color?: string;
}

export interface GridSelection {
  dayIndex: number;
  startMin: number;
  endMin: number;
}

export interface ExtraZone {
  zone: string;
  label: string;
}

const MAIN_GUTTER = 60;
const EXTRA_GUTTER = 48;
const DAY_HEADER_HEIGHT = 52;

export function TimeGrid({
  days,
  zone,
  columns,
  extraZones,
  scrollKey,
  selectable,
  defaultSelectMinutes,
  selection,
  selectionHint,
  onSelect,
  onOpenCall,
  onEditTimeOff,
  notes,
  onDayHeaderClick,
  height,
}: {
  days: DateTime[];
  zone: string;
  columns: GridColumn[];
  extraZones: ExtraZone[];
  scrollKey: string;
  selectable: boolean;
  defaultSelectMinutes: number;
  /** A settled selection to keep highlighted (e.g. while a dialog is open). */
  selection: GridSelection | null;
  selectionHint?: (minutes: number) => string;
  onSelect: (sel: GridSelection, point: { x: number; y: number }) => void;
  onOpenCall: (id: string) => void;
  onEditTimeOff?: (o: Occurrence) => void;
  notes?: Map<string, string | null>;
  onDayHeaderClick?: (day: DateTime) => void;
  height: string | number;
}) {
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const multi = columns.length > 1 || Boolean(columns[0]?.expert);

  // Default scroll to ~7 AM whenever the view/range kind changes.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = DEFAULT_SCROLL_HOUR * HOUR_HEIGHT - 8;
  }, [scrollKey]);

  const prepared = useMemo(
    () => columns.map((c) => ({ column: c, ...buildEvents(c.source, zone, AVAILABILITY_ENABLED, c.color) })),
    [columns, zone],
  );

  const laidOut = useMemo(
    () => days.map((day) => prepared.map((p) => ({ placed: layoutDay(p.timed, day, multi ? 16 : 20), p }))),
    [days, prepared, multi],
  );

  const allDayByDay = useMemo(
    () =>
      days.map((day) => {
        const iso = day.toISODate();
        return prepared.flatMap((p) =>
          p.allDay
            .filter((o) => DateTime.fromISO(o.startsAt).setZone(zone).toISODate() === iso)
            .map((o) => ({ o, column: p.column })),
        );
      }),
    [days, prepared, zone],
  );
  const hasAllDay = allDayByDay.some((d) => d.length > 0);

  const todayIndex = days.findIndex((d) => d.hasSame(now.setZone(zone), 'day'));
  const refDay = days[todayIndex >= 0 ? todayIndex : 0]!;

  // ---- drag selection ------------------------------------------------------
  const [drag, setDrag] = useState<GridSelection | null>(null);
  const dragRef = useRef<{
    dayIndex: number;
    anchor: number;
    pointerId: number;
    touch: boolean;
    x: number;
    y: number;
    moved: boolean;
    current: GridSelection;
  } | null>(null);

  const minuteAt = (el: HTMLElement, clientY: number) => {
    const rect = el.getBoundingClientRect();
    return ((clientY - rect.top) / HOUR_HEIGHT) * 60;
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>, dayIndex: number) => {
    if (!selectable || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const anchor = snapFloor(minuteAt(e.currentTarget, e.clientY));
    const touch = e.pointerType === 'touch';
    const current = { dayIndex, startMin: anchor, endMin: Math.min(DAY_MINUTES, anchor + SNAP_MINUTES) };
    dragRef.current = { dayIndex, anchor, pointerId: e.pointerId, touch, x: e.clientX, y: e.clientY, moved: false, current };
    if (touch) return; // touch: tap to create, drag scrolls
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(current);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (Math.abs(e.clientY - d.y) > 4 || Math.abs(e.clientX - d.x) > 4) d.moved = true;
    if (d.touch) return;
    const raw = minuteAt(e.currentTarget, e.clientY);
    const next =
      raw >= d.anchor
        ? { startMin: d.anchor, endMin: Math.max(d.anchor + SNAP_MINUTES, snap(raw)) }
        : { startMin: snapFloor(raw), endMin: d.anchor + SNAP_MINUTES };
    if (d.current.startMin === next.startMin && d.current.endMin === next.endMin) return;
    d.current = { dayIndex: d.dayIndex, ...next };
    setDrag(d.current);
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    const { current } = d;
    setDrag(null);
    if (cancelled) return;
    if (d.touch) {
      if (d.moved) return;
      const end = Math.min(DAY_MINUTES, d.anchor + defaultSelectMinutes);
      onSelect({ dayIndex: d.dayIndex, startMin: Math.max(0, end - defaultSelectMinutes), endMin: end }, { x: e.clientX, y: e.clientY });
      return;
    }
    // A plain click (no drag) selects the default length from the clicked slot.
    const sel = d.moved ? current : { ...current, endMin: Math.min(DAY_MINUTES, current.startMin + defaultSelectMinutes) };
    onSelect(sel, { x: e.clientX, y: e.clientY });
  };

  const shown = drag ?? selection;

  const gutterWidth = MAIN_GUTTER + extraZones.length * EXTRA_GUTTER;
  const minDayWidth = multi
    ? columns.length * (days.length === 1 ? 110 : 30)
    : days.length === 1
      ? 260
      : 110;

  return (
    <Box
      ref={scrollRef}
      sx={{ overflow: 'auto', height, position: 'relative', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
    >
      <Box sx={{ minWidth: gutterWidth + days.length * minDayWidth, position: 'relative' }}>
        {/* ---------------- sticky header ---------------- */}
        <Box
          sx={(t) => ({
            position: 'sticky',
            top: 0,
            zIndex: 7,
            bgcolor: 'background.paper',
            borderBottom: `1px solid ${pal(t).divider}`,
          })}
        >
          <Box sx={{ display: 'flex' }}>
            <Box
              sx={{
                width: gutterWidth,
                flexShrink: 0,
                position: 'sticky',
                left: 0,
                zIndex: 8,
                bgcolor: 'background.paper',
                display: 'flex',
                alignItems: 'flex-end',
                pb: 0.5,
              }}
            >
              {extraZones.map((z) => (
                <GutterZoneLabel key={z.zone} width={EXTRA_GUTTER} abbr={now.setZone(z.zone).toFormat('ZZZZ')} title={z.label} />
              ))}
              <GutterZoneLabel width={MAIN_GUTTER} abbr={now.setZone(zone).toFormat('ZZZZ')} title="Times shown in this zone" strong />
            </Box>
            {days.map((day, i) => (
              <DayHeader
                key={day.toISODate()}
                day={day}
                today={i === todayIndex}
                columns={multi ? columns : []}
                wide={days.length === 1}
                onClick={onDayHeaderClick && days.length > 1 ? () => onDayHeaderClick(day) : undefined}
              />
            ))}
          </Box>
          {hasAllDay && (
            <Box sx={(t) => ({ display: 'flex', borderTop: `1px solid ${pal(t).divider}` })}>
              <Box
                sx={{
                  width: gutterWidth,
                  flexShrink: 0,
                  position: 'sticky',
                  left: 0,
                  zIndex: 8,
                  bgcolor: 'background.paper',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  pr: 1,
                }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10.5 }}>
                  All day
                </Typography>
              </Box>
              {allDayByDay.map((items, i) => (
                <Stack
                  key={days[i]!.toISODate()}
                  spacing={0.25}
                  sx={(t) => ({ flex: 1, minWidth: 0, p: 0.25, borderLeft: `1px solid ${pal(t).divider}`, minHeight: 26 })}
                >
                  {items.map(({ o, column }, j) => {
                    const note = o.blockId ? notes?.get(o.blockId) : undefined;
                    const title = timeOffTitle(note);
                    return (
                      <EventPill
                        key={`${o.blockId}-${j}`}
                        kind="timeoff"
                        repeat={o.isRecurring}
                        title={
                          column.expert ? (
                            <>
                              <Box component="span" sx={{ color: column.color, fontWeight: 600 }}>
                                {column.expert.nickname}
                              </Box>{' '}
                              · {title}
                            </>
                          ) : (
                            title
                          )
                        }
                        tooltip={`${column.expert ? `${column.expert.nickname} · ` : ''}${title} · all day`}
                        onClick={onEditTimeOff && !column.expert ? () => onEditTimeOff(o) : undefined}
                      />
                    );
                  })}
                </Stack>
              ))}
            </Box>
          )}
        </Box>

        {/* ---------------- body ---------------- */}
        <Box sx={{ display: 'flex', position: 'relative' }}>
          <Box
            sx={(t) => ({
              width: gutterWidth,
              flexShrink: 0,
              position: 'sticky',
              left: 0,
              zIndex: 6,
              bgcolor: 'background.paper',
              display: 'flex',
              borderRight: `1px solid ${pal(t).divider}`,
            })}
          >
            {extraZones.map((z) => (
              <HourGutter key={z.zone} width={EXTRA_GUTTER} day={refDay} zone={z.zone} faint />
            ))}
            <HourGutter width={MAIN_GUTTER} day={refDay} zone={zone} />
          </Box>

          {days.map((day, dayIndex) => {
            const weekend = day.weekday >= 6;
            const isToday = dayIndex === todayIndex;
            return (
              <Box
                key={day.toISODate()}
                data-day={day.toISODate()}
                onPointerDown={(e) => handlePointerDown(e, dayIndex)}
                onPointerMove={handlePointerMove}
                onPointerUp={(e) => finish(e, false)}
                onPointerCancel={(e) => finish(e, true)}
                sx={(t) => ({
                  flex: 1,
                  minWidth: 0,
                  height: GRID_HEIGHT,
                  position: 'relative',
                  display: 'flex',
                  borderLeft: dayIndex === 0 ? 'none' : `1px solid ${pal(t).divider}`,
                  cursor: selectable ? 'crosshair' : 'default',
                  userSelect: 'none',
                  backgroundColor: weekend ? t.alpha(pal(t).text.primary, 0.018) : 'transparent',
                  backgroundImage: `linear-gradient(to bottom, ${pal(t).divider} 0 1px, transparent 1px ${HOUR_HEIGHT / 2}px, ${t.alpha(pal(t).text.primary, 0.035)} ${HOUR_HEIGHT / 2}px ${HOUR_HEIGHT / 2 + 1}px, transparent ${HOUR_HEIGHT / 2 + 1}px)`,
                  backgroundSize: `100% ${HOUR_HEIGHT}px`,
                })}
              >
                {laidOut[dayIndex]!.map(({ placed, p }, colIndex) => (
                  <Box
                    key={p.column.key}
                    sx={(t) => ({
                      flex: 1,
                      minWidth: 0,
                      position: 'relative',
                      borderLeft: multi && colIndex > 0 ? `1px dashed ${t.alpha(pal(t).text.primary, 0.08)}` : 'none',
                      bgcolor: p.column.color ? alpha(p.column.color, 0.035) : undefined,
                    })}
                  >
                    {p.available
                      .filter((o) => DateTime.fromISO(o.startsAt) < day.plus({ days: 1 }) && DateTime.fromISO(o.endsAt) > day)
                      .map((o, k) => {
                        const s = minuteInDay(DateTime.fromISO(o.startsAt), day);
                        const e = minuteInDay(DateTime.fromISO(o.endsAt), day);
                        return (
                          <Box
                            key={`av-${k}`}
                            sx={(t) => ({
                              position: 'absolute',
                              left: 0,
                              right: 0,
                              top: (s / 60) * HOUR_HEIGHT,
                              height: ((e - s) / 60) * HOUR_HEIGHT,
                              bgcolor: t.alpha(pal(t).success.main, 0.08),
                              pointerEvents: 'none',
                            })}
                          />
                        );
                      })}
                    {placed.map((pl) => {
                      const hPx = pl.height;
                      const ev = pl.event;
                      return (
                        <Box
                          key={ev.key}
                          sx={{
                            position: 'absolute',
                            top: pl.top + 1,
                            height: hPx - 2,
                            left: `calc(${pl.left * 100}% + 2px)`,
                            width: `calc(${pl.width * 100}% - 4px)`,
                            zIndex: ev.type === 'call' ? 2 : 1,
                            containerType: 'inline-size',
                          }}
                        >
                          {ev.type === 'call' && (
                            <CallBlock call={ev.call} zone={zone} heightPx={hPx} tint={ev.tint} onOpen={onOpenCall} />
                          )}
                          {ev.type === 'busy' && (
                            <BusyBlock start={ev.busy.startsAt} end={ev.busy.endsAt} zone={zone} heightPx={hPx} tentative={ev.busy.tentative} />
                          )}
                          {ev.type === 'timeoff' && (
                            <TimeOffBlock
                              occurrence={ev.occurrence}
                              zone={zone}
                              heightPx={hPx}
                              note={ev.occurrence.blockId ? notes?.get(ev.occurrence.blockId) : undefined}
                              onEdit={p.column.expert ? undefined : onEditTimeOff}
                            />
                          )}
                        </Box>
                      );
                    })}
                  </Box>
                ))}

                {isToday && <NowLine minute={minuteInDay(now, day)} />}

                {shown && shown.dayIndex === dayIndex && (
                  <SelectionBox day={day} sel={shown} hint={selectionHint} />
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}

function GutterZoneLabel({ width, abbr, title, strong }: { width: number; abbr: string; title: string; strong?: boolean }) {
  return (
    <Tooltip title={title}>
      <Typography
        variant="caption"
        noWrap
        sx={{
          width,
          textAlign: 'right',
          pr: 1,
          fontSize: 10,
          fontWeight: strong ? 600 : 500,
          color: strong ? 'text.primary' : 'text.secondary',
          letterSpacing: '0.02em',
        }}
      >
        {abbr}
      </Typography>
    </Tooltip>
  );
}

function HourGutter({ width, day, zone, faint }: { width: number; day: DateTime; zone: string; faint?: boolean }) {
  return (
    <Box sx={{ width, position: 'relative', height: GRID_HEIGHT, flexShrink: 0 }}>
      {Array.from({ length: 24 }, (_, h) => {
        if (h === 0) return null;
        const { text, dayShift } = gutterLabel(day, h, zone);
        return (
          <Typography
            key={h}
            variant="caption"
            component="div"
            noWrap
            sx={{
              position: 'absolute',
              top: h * HOUR_HEIGHT - 8,
              right: 8,
              fontSize: faint ? 10 : 10.5,
              lineHeight: '16px',
              color: faint ? 'text.disabled' : 'text.secondary',
              fontWeight: faint ? 400 : 500,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {text}
            {dayShift !== 0 && (
              <Box component="sup" sx={{ fontSize: 8, ml: 0.25 }}>
                {dayShift > 0 ? `+${dayShift}` : dayShift}
              </Box>
            )}
          </Typography>
        );
      })}
    </Box>
  );
}

function DayHeader({
  day,
  today,
  columns,
  wide,
  onClick,
}: {
  day: DateTime;
  today: boolean;
  columns: GridColumn[];
  wide: boolean;
  onClick?: () => void;
}) {
  const hours = dayLengthHours(day);
  return (
    <Box sx={(t) => ({ flex: 1, minWidth: 0, borderLeft: `1px solid ${pal(t).divider}` })}>
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        justifyContent="center"
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={(e) => onClick && e.key === 'Enter' && onClick()}
        sx={{ height: DAY_HEADER_HEIGHT, cursor: onClick ? 'pointer' : 'default', px: 0.5 }}
      >
        <Typography
          variant="caption"
          sx={{ fontWeight: 500, color: today ? 'primary.main' : 'text.secondary', fontSize: 12 }}
        >
          {day.toFormat('ccc')}
        </Typography>
        <Box
          sx={(t) => ({
            minWidth: 28,
            height: 28,
            px: 0.5,
            borderRadius: 99,
            display: 'grid',
            placeItems: 'center',
            fontWeight: 600,
            fontSize: 14,
            fontVariantNumeric: 'tabular-nums',
            color: today ? pal(t).primary.contrastText : pal(t).text.primary,
            bgcolor: today ? pal(t).primary.main : 'transparent',
            transition: 'background-color 120ms',
            ...(onClick && !today ? { '&:hover': { bgcolor: t.alpha(pal(t).text.primary, 0.06) } } : {}),
          })}
        >
          {day.day}
        </Box>
        {hours !== 24 && (
          <Tooltip title={`Daylight saving change: this day has ${hours} hours`}>
            <Typography variant="caption" sx={{ fontSize: 9.5, fontWeight: 700, color: 'warning.main' }}>
              {hours}h
            </Typography>
          </Tooltip>
        )}
      </Stack>
      {columns.length > 0 && (
        <Box sx={{ display: 'flex', px: 0.25, pb: 0.5, gap: 0.25 }}>
          {columns.map((c) =>
            wide && c.expert ? (
              <Stack key={c.key} direction="row" spacing={0.5} alignItems="center" justifyContent="center" sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: c.color, flexShrink: 0 }} />
                <Typography variant="caption" noWrap sx={{ fontWeight: 500, fontSize: 11 }}>
                  {c.expert.nickname}
                </Typography>
              </Stack>
            ) : (
              <Tooltip key={c.key} title={c.expert?.nickname ?? ''}>
                <Box sx={{ flex: 1, height: 3, borderRadius: 2, bgcolor: c.color }} />
              </Tooltip>
            ),
          )}
        </Box>
      )}
    </Box>
  );
}

function NowLine({ minute }: { minute: number }) {
  return (
    <Box
      aria-hidden
      sx={(t) => ({
        position: 'absolute',
        left: 0,
        right: 0,
        top: (minute / 60) * HOUR_HEIGHT,
        height: 2,
        bgcolor: pal(t).error.main,
        zIndex: 3,
        pointerEvents: 'none',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: -5,
          top: -4,
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: pal(t).error.main,
        },
      })}
    />
  );
}

function SelectionBox({ day, sel, hint }: { day: DateTime; sel: GridSelection; hint?: (minutes: number) => string }) {
  const minutes = atMinute(day, sel.endMin).diff(atMinute(day, sel.startMin), 'minutes').minutes;
  return (
    <Box
      sx={(t) => ({
        position: 'absolute',
        left: 2,
        right: 2,
        top: (sel.startMin / 60) * HOUR_HEIGHT,
        height: Math.max(14, ((sel.endMin - sel.startMin) / 60) * HOUR_HEIGHT),
        backgroundColor: pal(t).background.paper,
        backgroundImage: `linear-gradient(${t.alpha(pal(t).primary.main, 0.2)}, ${t.alpha(pal(t).primary.main, 0.2)})`,
        border: `1.5px solid ${pal(t).primary.main}`,
        borderRadius: '8px',
        zIndex: 4,
        pointerEvents: 'none',
        px: 0.75,
        py: 0.25,
        overflow: 'hidden',
        boxShadow: `0 6px 18px ${t.alpha(pal(t).primary.main, 0.25)}`,
      })}
    >
      <Typography variant="caption" noWrap component="div" sx={{ fontWeight: 700, fontSize: 11.5, color: 'primary.main' }}>
        {formatMinuteRange(day, sel.startMin, sel.endMin)}
      </Typography>
      <Typography variant="caption" noWrap component="div" sx={{ fontSize: 11, color: 'primary.main', opacity: 0.85 }}>
        {hint ? hint(minutes) : formatDuration(minutes)}
      </Typography>
    </Box>
  );
}
