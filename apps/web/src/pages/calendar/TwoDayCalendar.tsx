import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import { Alert, Box, Button, Card, Stack, Typography } from '@mui/material';
import type { PersonalEventOccurrence } from '@god/shared';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { errorMessage } from '@/lib/errors';
import { BlockDialog, type BlockDialogState } from './BlockDialog';
import { TimeGrid, type GridColumn } from './TimeGrid';
import { useExpertCalendar, usePersonalEvents } from './useCalendarData';
import { useNow } from './useNow';

const EMPTY_SOURCE = { calls: [], busy: [], occurrences: [] };

/**
 * Today and tomorrow, as the Calendar page draws them, from the same data: every
 * call the Founder can see, and their own events. For a look at the day from the
 * dashboard: calls open and own events edit on click, and anything new starts
 * from the Calendar page.
 */
export function TwoDayCalendar({ height }: { height: number | string }) {
  const { zone } = useAuth();
  const navigate = useNavigate();
  const today = useNow().setZone(zone).toISODate()!;
  const { days, fromIso, toIso } = useMemo(() => {
    const first = DateTime.fromISO(today, { zone }).startOf('day');
    const list = [first, first.plus({ days: 1 }).startOf('day')];
    const iso = (d: DateTime) => d.toUTC().toISO({ suppressMilliseconds: true })!;
    return { days: list, fromIso: iso(first), toIso: iso(first.plus({ days: 2 }).startOf('day')) };
  }, [today, zone]);

  const calendar = useExpertCalendar(fromIso, toIso, undefined, true);
  const personal = usePersonalEvents(fromIso, toIso, true);
  const [dialog, setDialog] = useState<BlockDialogState | null>(null);
  const [dialogKey, setDialogKey] = useState(0);

  const columns = useMemo<GridColumn[]>(
    () => [{ key: 'main', source: { ...(calendar.data ?? EMPTY_SOURCE), events: personal.data?.occurrences ?? [] } }],
    [calendar.data, personal.data],
  );
  const eventTitles = useMemo(() => new Map((personal.data?.events ?? []).map((e) => [e.id, e.title])), [personal.data]);

  const editEvent = (o: PersonalEventOccurrence) => {
    const rule = personal.data?.events.find((e) => e.id === o.eventId);
    if (!rule) return;
    setDialogKey((k) => k + 1);
    setDialog({ mode: 'edit', target: { type: 'event', timeZone: rule.timeZone }, rule, occurrence: o });
  };
  const error = calendar.error ?? personal.error;

  return (
    <Card sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Typography variant="subtitle2">Today and tomorrow</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" component={RouterLink} to="/calendar" startIcon={<CalendarMonthRounded />} sx={{ minHeight: 26 }}>
          Open calendar
        </Button>
      </Stack>
      {error ? (
        <Alert severity="error" sx={{ mx: 2, mb: 2 }}>
          {errorMessage(error)}
        </Alert>
      ) : (
        <TimeGrid
          days={days}
          zone={zone}
          columns={columns}
          extraZones={[]}
          scrollKey="dashboard"
          selectable={false}
          defaultSelectMinutes={30}
          selection={null}
          onSelect={() => undefined}
          onOpenCall={(id) => navigate(`/calls/${id}`)}
          eventTitles={eventTitles}
          onEditEvent={editEvent}
          height={height}
        />
      )}
      {dialog && <BlockDialog key={dialogKey} state={dialog} viewerZone={zone} showExpert={false} onClose={() => setDialog(null)} />}
    </Card>
  );
}
