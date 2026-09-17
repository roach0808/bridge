import BlockRounded from '@mui/icons-material/BlockRounded';
import EventBusyRounded from '@mui/icons-material/EventBusyRounded';
import RepeatRounded from '@mui/icons-material/RepeatRounded';
import { Box, ButtonBase, Stack, Tooltip, Typography, alpha, type Theme } from '@mui/material';
import { STATUS_LABELS, type CalendarCall, type Occurrence } from '@god/shared';
import { DateTime } from 'luxon';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { STATUS_COLORS, StatusBadge, StatusChip } from '@/components/StatusChip';
import { UserChip } from '@/components/identity';
import { formatRange } from '@/lib/time';

/** Palette tokens that follow the active colour scheme (CSS variables). */
export const pal = (t: Theme) => (t.vars ?? t).palette;

export const hatch = (t: Theme, strength = 0.09) =>
  `repeating-linear-gradient(135deg, ${t.alpha(pal(t).text.primary, strength)} 0 5px, transparent 5px 10px)`;

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function BlockShell({
  children,
  accent,
  background,
  hoverBackground,
  onClick,
  label,
  tooltip,
  dashed,
  sx,
}: {
  children: ReactNode;
  accent: string | ((t: Theme) => string);
  background: string | ((t: Theme) => string);
  hoverBackground?: string | ((t: Theme) => string);
  onClick?: () => void;
  label: string;
  tooltip?: ReactNode;
  dashed?: boolean;
  sx?: object;
}) {
  const resolve = (v: string | ((t: Theme) => string), t: Theme) => (typeof v === 'function' ? v(t) : v);
  const interactive = Boolean(onClick);
  const body = (
    <ButtonBase
      component="div"
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : -1}
      aria-label={label}
      disableRipple={!interactive}
      onPointerDown={stop}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick?.();
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick?.();
        }
      }}
      sx={(t) => ({
        width: '100%',
        height: '100%',
        display: 'block',
        textAlign: 'left',
        overflow: 'hidden',
        borderRadius: '8px',
        px: 0.75,
        py: 0.25,
        cursor: interactive ? 'pointer' : 'default',
        background: resolve(background, t),
        borderLeft: `3px ${dashed ? 'dashed' : 'solid'} ${resolve(accent, t)}`,
        transition: 'background-color 120ms, box-shadow 120ms',
        '&:hover': interactive && hoverBackground ? { background: resolve(hoverBackground, t) } : undefined,
        '&:focus-visible': { outline: `2px solid ${pal(t).primary.main}`, outlineOffset: 1 },
        // Narrow Expert sub-columns: keep only the title.
        '@container (max-width: 72px)': { px: 0.5, borderLeftWidth: 2, '& .cal-sub': { display: 'none' } },
        ...sx,
      })}
    >
      {children}
    </ButtonBase>
  );
  return tooltip ? (
    <Tooltip title={tooltip} placement="right" enterDelay={350} disableInteractive>
      {body}
    </Tooltip>
  ) : (
    body
  );
}

function CallTooltip({ call, zone }: { call: CalendarCall; zone: string }) {
  return (
    <Stack spacing={0.75} sx={{ py: 0.5 }}>
      <Typography variant="body2" fontWeight={600}>
        {call.profile.name}
      </Typography>
      <Box>
        <StatusChip status={call.status} />
      </Box>
      <Typography variant="caption" component="div">
        {DateTime.fromISO(call.scheduledAt).setZone(zone).toFormat('ccc, LLL d')} ·{' '}
        {formatRange(call.scheduledAt, call.endsAt, zone)} · {call.platform.name}
      </Typography>
      <Stack direction="row" spacing={1.5}>
        <UserChip user={call.associate} size={20} subtitle="Associate" showRole={false} />
        {call.expert && <UserChip user={call.expert} size={20} subtitle="Expert" showRole={false} />}
      </Stack>
    </Stack>
  );
}

export function CallBlock({
  call,
  zone,
  heightPx,
  tint,
  onOpen,
}: {
  call: CalendarCall;
  zone: string;
  heightPx: number;
  tint?: string;
  onOpen: (id: string) => void;
}) {
  const color = STATUS_COLORS[call.status];
  const bg = tint ?? color;
  const tiny = heightPx < 26;
  const roomy = heightPx >= 56;
  const time = formatRange(call.scheduledAt, call.endsAt, zone);
  return (
    <BlockShell
      accent={color}
      background={alpha(bg, 0.16)}
      hoverBackground={alpha(bg, 0.26)}
      onClick={() => onOpen(call.id)}
      label={`${call.profile.name}, ${time}, ${STATUS_LABELS[call.status]}`}
      tooltip={<CallTooltip call={call} zone={zone} />}
    >
      {tiny ? (
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
          <StatusBadge status={call.status} compact />
          <Typography variant="caption" noWrap component="div" sx={{ fontWeight: 600, lineHeight: 1.35, fontSize: 11, minWidth: 0 }}>
            {call.profile.name}{' '}
            <Box component="span" className="cal-sub" sx={{ color: 'text.secondary', fontWeight: 500 }}>
              {DateTime.fromISO(call.scheduledAt).setZone(zone).toFormat('h:mm')}
            </Box>
          </Typography>
        </Stack>
      ) : (
        <>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography variant="caption" noWrap component="div" sx={{ fontWeight: 600, lineHeight: 1.3, fontSize: 12, minWidth: 0, flex: 1 }}>
              {call.profile.name}
            </Typography>
            <StatusBadge status={call.status} />
          </Stack>
          <Typography className="cal-sub" variant="caption" noWrap component="div" sx={{ color: 'text.secondary', lineHeight: 1.3, fontSize: 11 }}>
            {time}
            {!roomy && ` · ${call.platform.name}`}
          </Typography>
          {roomy && (
            <Typography className="cal-sub" variant="caption" noWrap component="div" sx={{ color: 'text.secondary', lineHeight: 1.3, fontSize: 11 }}>
              {call.platform.name}
            </Typography>
          )}
        </>
      )}
    </BlockShell>
  );
}

export function BusyBlock({ start, end, zone, heightPx }: { start: string; end: string; zone: string; heightPx: number }) {
  return (
    <BlockShell
      accent={(t) => t.alpha(pal(t).text.primary, 0.25)}
      background={(t) => `${hatch(t)}, ${t.alpha(pal(t).text.primary, 0.04)}`}
      label={`Busy ${formatRange(start, end, zone)}`}
      tooltip={`Busy · ${formatRange(start, end, zone)}`}
    >
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary', minWidth: 0 }}>
        <BlockRounded sx={{ fontSize: 12 }} />
        <Typography variant="caption" noWrap sx={{ fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
          Busy
        </Typography>
        {heightPx >= 30 && (
          <Typography className="cal-sub" variant="caption" noWrap sx={{ fontSize: 11, minWidth: 0 }}>
            {formatRange(start, end, zone)}
          </Typography>
        )}
      </Stack>
    </BlockShell>
  );
}

export function timeOffTitle(note: string | null | undefined) {
  return note?.trim() ? note : 'Time off';
}

export function TimeOffBlock({
  occurrence,
  zone,
  note,
  heightPx,
  onEdit,
}: {
  occurrence: Occurrence;
  zone: string;
  note?: string | null;
  heightPx: number;
  onEdit?: (o: Occurrence) => void;
}) {
  const range = occurrence.allDay ? 'All day (Expert’s time)' : formatRange(occurrence.startsAt, occurrence.endsAt, zone);
  const title = timeOffTitle(note);
  return (
    <BlockShell
      accent={(t) => pal(t).warning.main}
      background={(t) => t.alpha(pal(t).warning.main, 0.1)}
      hoverBackground={(t) => t.alpha(pal(t).warning.main, 0.18)}
      onClick={onEdit ? () => onEdit(occurrence) : undefined}
      label={`${title}, ${range}`}
      tooltip={`${title} · ${range}${occurrence.isRecurring ? ' · repeats' : ''}`}
    >
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
        <EventBusyRounded sx={{ fontSize: 13, color: 'warning.main' }} />
        <Typography variant="caption" noWrap sx={{ fontWeight: 600, fontSize: 11.5, flex: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {occurrence.isRecurring && <RepeatRounded sx={{ fontSize: 12, color: 'text.secondary' }} />}
      </Stack>
      {heightPx >= 34 && (
        <Typography className="cal-sub" variant="caption" noWrap component="div" sx={{ color: 'text.secondary', fontSize: 11 }}>
          {range}
        </Typography>
      )}
    </BlockShell>
  );
}

/** One-line pill for the all-day row and month cells. */
export function EventPill({
  kind,
  title,
  badge,
  accent,
  tint,
  onClick,
  tooltip,
  repeat,
}: {
  kind: 'call' | 'timeoff' | 'busy';
  title: ReactNode;
  /** Shown at the end of the pill, e.g. a call's status badge. */
  badge?: ReactNode;
  accent?: string;
  tint?: string;
  onClick?: () => void;
  tooltip?: ReactNode;
  repeat?: boolean;
}) {
  const pill = (
    <ButtonBase
      component="div"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : -1}
      disableRipple={!onClick}
      onPointerDown={stop}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick?.();
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (onClick && e.key === 'Enter') onClick();
      }}
      sx={(t) => {
        const base =
          kind === 'timeoff'
            ? { bg: t.alpha(pal(t).warning.main, 0.12), hover: t.alpha(pal(t).warning.main, 0.2), bar: pal(t).warning.main }
            : kind === 'busy'
              ? { bg: `${hatch(t)}, ${t.alpha(pal(t).text.primary, 0.04)}`, hover: undefined, bar: t.alpha(pal(t).text.primary, 0.25) }
              : { bg: alpha(tint ?? accent ?? '#64748b', 0.16), hover: alpha(tint ?? accent ?? '#64748b', 0.26), bar: accent ?? '#64748b' };
        return {
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          width: '100%',
          height: 20,
          px: 0.75,
          borderRadius: '6px',
          justifyContent: 'flex-start',
          background: base.bg,
          borderLeft: `3px solid ${base.bar}`,
          cursor: onClick ? 'pointer' : 'default',
          overflow: 'hidden',
          '&:hover': onClick && base.hover ? { background: base.hover } : undefined,
          '&:focus-visible': { outline: `2px solid ${pal(t).primary.main}` },
        };
      }}
    >
      {kind === 'timeoff' && <EventBusyRounded sx={{ fontSize: 12, color: 'warning.main' }} />}
      <Typography variant="caption" noWrap sx={{ fontSize: 11, fontWeight: 600, flex: 1, minWidth: 0, lineHeight: 1 }}>
        {title}
      </Typography>
      {badge}
      {repeat && <RepeatRounded sx={{ fontSize: 11, color: 'text.secondary' }} />}
    </ButtonBase>
  );
  return tooltip ? (
    <Tooltip title={tooltip} enterDelay={350} disableInteractive>
      {pill}
    </Tooltip>
  ) : (
    pill
  );
}

export { CallTooltip };
