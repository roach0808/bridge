import AddRounded from '@mui/icons-material/AddRounded';
import { Box, Button, Divider, Popover, Stack, Typography } from '@mui/material';
import type { ExpertColumn } from '@god/shared';
import { DateTime } from 'luxon';
import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { UserAvatar } from '@/components/identity';
import { expertColor } from '@/theme/theme';
import { CONFLICT_LABELS, callDurationFor, conflictsFor, formatDuration, isPastSlot, newCallHref } from './calendarUtils';

export interface RangeSelection {
  start: DateTime;
  end: DateTime;
  point: { x: number; y: number };
}

/** Who is free for a dragged range in the all-experts view. */
export function FreeExpertsPanel({
  selection,
  experts,
  zone,
  canSchedule,
  onClose,
}: {
  selection: RangeSelection | null;
  experts: ExpertColumn[];
  zone: string;
  canSchedule: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const rows = useMemo(() => {
    if (!selection) return { free: [], taken: [] };
    const all = experts.map((col) => ({ col, reasons: conflictsFor(col, selection.start, selection.end) }));
    return { free: all.filter((r) => !r.reasons.length), taken: all.filter((r) => r.reasons.length) };
  }, [selection, experts]);

  if (!selection) return null;
  const minutes = selection.end.diff(selection.start, 'minutes').minutes;
  const duration = callDurationFor(minutes);
  const s = selection.start.setZone(zone);
  const e = selection.end.setZone(zone);

  const expertTime = (tz: string) => {
    const a = selection.start.setZone(tz);
    const b = selection.end.setZone(tz);
    const viewerDate = selection.start.setZone(zone).toISODate();
    const dayNote = a.toISODate() === viewerDate ? '' : ` (${a.toFormat('ccc')})`;
    return `${a.toFormat('h:mm a')} – ${b.toFormat('h:mm a')} ${a.toFormat('ZZZZ')}${dayNote}`;
  };

  return (
    <Popover
      open
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: selection.point.y, left: selection.point.x }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{ paper: { sx: { width: 340, maxWidth: 'calc(100vw - 24px)', borderRadius: '14px', border: 1, borderColor: 'divider', boxShadow: '0 12px 32px rgba(0, 0, 0, 0.12)' } } }}
    >
      <Box sx={{ px: 2, pt: 1.75, pb: 1.25 }}>
        <Typography variant="subtitle2">{s.toFormat('cccc, LLL d')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {s.toFormat('h:mm a')} – {e.toFormat('h:mm a ZZZZ')} · {formatDuration(minutes)}
        </Typography>
        {canSchedule && minutes !== duration && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
            Calls are booked as {duration} min from the start time.
          </Typography>
        )}
      </Box>
      <Divider />
      <Box sx={{ maxHeight: 360, overflowY: 'auto', py: 1 }}>
        <SectionTitle dot="success.main">
          Free ({rows.free.length})
        </SectionTitle>
        {rows.free.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 0.5 }}>
            Nobody is free for the whole range.
          </Typography>
        )}
        {rows.free.map(({ col }) => (
          <ExpertRow key={col.expert.id} col={col} subtitle={expertTime(col.expert.timeZone)}>
            {canSchedule && (
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<AddRounded />}
                disabled={isPastSlot(selection.start)}
                onClick={() => navigate(newCallHref(selection.start, minutes, col.expert.id))}
              >
                Schedule
              </Button>
            )}
          </ExpertRow>
        ))}
        {rows.taken.length > 0 && (
          <>
            <SectionTitle dot="text.disabled">
              Not free ({rows.taken.length})
            </SectionTitle>
            {rows.taken.map(({ col, reasons }) => (
              <ExpertRow key={col.expert.id} col={col} subtitle={reasons.map((r) => CONFLICT_LABELS[r]).join(' · ')} muted />
            ))}
          </>
        )}
      </Box>
    </Popover>
  );
}

function SectionTitle({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ px: 2, pt: 1, pb: 0.5 }}>
      <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: dot }} />
      <Typography variant="caption" color="text.secondary">
        {children}
      </Typography>
    </Stack>
  );
}

function ExpertRow({
  col,
  subtitle,
  muted,
  children,
}: {
  col: ExpertColumn;
  subtitle: string;
  muted?: boolean;
  children?: ReactNode;
}) {
  const color = expertColor(col.slot);
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: 2, py: 0.75, opacity: muted ? 0.7 : 1 }}>
      <UserAvatar avatarId={col.expert.avatarId} photoId={col.expert.photoId} label={col.expert.nickname} size={30} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
          <Typography variant="body2" fontWeight={550} noWrap>
            {col.expert.nickname}
          </Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {subtitle}
        </Typography>
      </Box>
      {children}
    </Stack>
  );
}
