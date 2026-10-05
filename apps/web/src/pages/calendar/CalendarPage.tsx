import AddRounded from '@mui/icons-material/AddRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import EventBusyRounded from '@mui/icons-material/EventBusyRounded';
import VideoCallRounded from '@mui/icons-material/VideoCallRounded';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import type { CalendarCall, CalendarResponse, ExpertRef, ExpertsCalendarResponse, Occurrence } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ErrorState, PageHeader } from '@/components/common';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { TEAM_TIME_ZONE } from '@/lib/time';
import { expertColor } from '@/theme/theme';
import { BlockDialog, type BlockDialogState } from './BlockDialog';
import { CalendarFilter, type FilterOption } from './CalendarFilter';
import {
  atMinute,
  callDurationFor,
  formatDuration,
  loadClientZone,
  loadView,
  isPastSlot,
  newCallHref,
  parseAnchor,
  rangeLabel,
  saveClientZone,
  saveView,
  shiftAnchor,
  visibleRange,
  zoneLabel,
  type CalendarView,
} from './calendarUtils';
import { pal } from './EventBlocks';
import { FreeExpertsPanel, type RangeSelection } from './FreeExpertsPanel';
import { MonthGrid } from './MonthGrid';
import { TimeGrid, type ExtraZone, type GridColumn, type GridSelection } from './TimeGrid';
import {
  NO_MANAGER,
  parseIds,
  parseSubject,
  subjectExpertIds,
  subjectParam,
  useExpertCalendar,
  useExpertDirectory,
  useExpertsCalendar,
  type CalendarSubject,
} from './useCalendarData';
import { useNow } from './useNow';
import { ZoneClocks, type Clock } from './ZoneClocks';

const GRID_HEIGHT_CSS = 'max(460px, calc(100vh - 330px))';
const EMPTY_SOURCE = { calls: [], busy: [], occurrences: [] };

export default function CalendarPage() {
  const { user, zone } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const isExpert = user?.role === 'expert';
  const isFounder = user?.role === 'founder';

  // ---- view state ------------------------------------------------------------
  const [view, setViewState] = useState<CalendarView>(loadView);
  const setView = useCallback((v: CalendarView) => {
    setViewState(v);
    saveView(v);
  }, []);
  const [clientZone, setClientZoneState] = useState<string | null>(loadClientZone);
  const setClientZone = (z: string | null) => {
    setClientZoneState(z);
    saveClientZone(z);
  };

  const anchor = useMemo(() => parseAnchor(params.get('date'), zone), [params, zone]);
  const subject: CalendarSubject = isExpert ? { type: 'mine' } : parseSubject(params.get('expert'));
  // Experts see only their own calendar; Associates only their own calls, all under their own Manager.
  const profileIds = useMemo(() => (isExpert ? [] : parseIds(params.get('profile'))), [isExpert, params]);
  const managerIds = useMemo(() => (isFounder || user?.role === 'manager' ? parseIds(params.get('manager')) : []), [isFounder, user?.role, params]);

  const updateParams = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const goTo = useCallback(
    (d: DateTime) => {
      const today = DateTime.now().setZone(zone).startOf('day');
      updateParams({ date: d.hasSame(today, 'day') ? null : d.toISODate() });
    },
    [updateParams, zone],
  );

  const range = useMemo(() => visibleRange(view, anchor), [view, anchor]);

  // ---- data --------------------------------------------------------------------
  // Several Experts (or all of them) side by side; one Expert, or none, is a single column.
  const allMode = subject.type === 'all' || subject.type === 'experts';
  const directory = useExpertDirectory(!isExpert);
  const single = useExpertCalendar(
    range.fromIso,
    range.toIso,
    subject.type === 'expert' ? subject.id : undefined,
    Boolean(user) && !allMode,
  );
  const experts = useExpertsCalendar(range.fromIso, range.toIso, Boolean(user) && allMode);
  const active = allMode ? experts : single;
  const singleData: CalendarResponse | undefined = allMode ? undefined : single.data;
  const expertsData: ExpertsCalendarResponse | undefined = allMode ? experts.data : undefined;

  const selectedExpert: ExpertRef | null =
    singleData?.expert ??
    (subject.type === 'expert' ? (directory.experts.find((e) => e.expert.id === subject.id)?.expert ?? null) : null);
  const selectedSlot =
    subject.type === 'expert' ? directory.experts.find((e) => e.expert.id === subject.id)?.slot : undefined;
  const canEditBlocks = Boolean(singleData?.canEditBlocks && singleData.expert);

  const notes = useMemo(() => new Map((singleData?.rules ?? []).map((r) => [r.id, r.note])), [singleData]);

  /** The Expert columns ticked in the Experts filter, in their usual order. */
  const expertParam = subjectParam(subject);
  const shownExperts = useMemo(() => {
    const ids = subjectExpertIds(parseSubject(expertParam));
    return (expertsData?.experts ?? []).filter((c) => ids === null || ids.includes(c.expert.id));
  }, [expertsData, expertParam]);

  /** The Profiles and Managers filters narrow the calls; busy time and time off stay, they are about the Expert. */
  const matches = useCallback(
    (c: CalendarCall, skip?: 'profile' | 'manager') =>
      (skip === 'profile' || !profileIds.length || profileIds.includes(c.profile.id)) &&
      (skip === 'manager' || !managerIds.length || managerIds.includes(c.manager?.id ?? NO_MANAGER)),
    [profileIds, managerIds],
  );
  const filtering = profileIds.length > 0 || managerIds.length > 0;

  const columns = useMemo<GridColumn[]>(() => {
    if (allMode) {
      return shownExperts.map((c) => ({
        key: c.expert.id,
        source: { ...c, calls: c.calls.filter((call) => matches(call)) },
        expert: c.expert,
        color: expertColor(c.slot),
      }));
    }
    const source = singleData ?? EMPTY_SOURCE;
    return [{ key: 'main', source: { ...source, calls: source.calls.filter((call) => matches(call)) } }];
  }, [allMode, shownExperts, singleData, matches]);

  /** Every call in view before the Profiles and Managers filters: what those filters offer and count. */
  const callsInView = useMemo<CalendarCall[]>(
    () => (allMode ? shownExperts.flatMap((c) => c.calls) : (singleData?.calls ?? [])),
    [allMode, shownExperts, singleData],
  );

  const isEmpty = allMode
    ? Boolean(expertsData) && columns.every((c) => !c.source.calls.length && !c.source.busy.length && !c.source.occurrences.some((o) => o.kind === 'unavailable'))
    : Boolean(singleData) &&
      !columns[0]!.source.calls.length &&
      !singleData!.busy.length &&
      !singleData!.occurrences.some((o) => o.kind === 'unavailable');

  // ---- clocks & gutters ----------------------------------------------------------
  const clocks = useMemo<Clock[]>(() => {
    const list: Clock[] = [{ zone, label: isExpert ? 'Your time' : 'Team time', primary: true }];
    if (isExpert && zone !== TEAM_TIME_ZONE) list.push({ zone: TEAM_TIME_ZONE, label: 'Team time' });
    if (!isExpert && selectedExpert && selectedExpert.timeZone !== zone) {
      list.push({
        zone: selectedExpert.timeZone,
        label: `${selectedExpert.nickname}'s time`,
        color: selectedSlot != null ? expertColor(selectedSlot) : undefined,
      });
    }
    return list;
  }, [zone, isExpert, selectedExpert, selectedSlot]);

  const extraZones = useMemo<ExtraZone[]>(() => {
    const zones: ExtraZone[] = clocks.filter((c) => !c.primary).map((c) => ({ zone: c.zone, label: c.label }));
    if (clientZone && clientZone !== zone && !zones.some((z) => z.zone === clientZone)) {
      zones.push({ zone: clientZone, label: 'Client time' });
    }
    return zones;
  }, [clocks, clientZone, zone]);

  // ---- interactions ----------------------------------------------------------------
  const [dialog, setDialog] = useState<BlockDialogState | null>(null);
  const [dialogKey, setDialogKey] = useState(0);
  const [gridSelection, setGridSelection] = useState<GridSelection | null>(null);
  const [freePanel, setFreePanel] = useState<RangeSelection | null>(null);
  const [choice, setChoice] = useState<{ start: DateTime; end: DateTime; point: { x: number; y: number } } | null>(null);

  const openCreate = useCallback(
    (expert: ExpertRef, start: DateTime, end: DateTime, allDay: boolean) => {
      const local = start.setZone(expert.timeZone);
      const minutes = Math.max(15, Math.round(end.diff(start, 'minutes').minutes));
      setDialogKey((k) => k + 1);
      setDialog({
        mode: 'create',
        expert,
        startDate: local.toISODate()!,
        allDay,
        startMinute: allDay ? 540 : local.hour * 60 + local.minute,
        durationMinutes: allDay ? 60 : Math.min(1440, minutes),
      });
    },
    [],
  );

  const openEdit = useCallback(
    (o: Occurrence) => {
      const rule = singleData?.rules.find((r) => r.id === o.blockId);
      if (!rule || !singleData?.expert) {
        toast.error('This time off can no longer be edited. Refresh and try again.');
        return;
      }
      setDialogKey((k) => k + 1);
      setDialog({ mode: 'edit', expert: singleData.expert, rule, occurrence: o });
    },
    [singleData, toast],
  );

  const openCall = useCallback((id: string) => navigate(`/calls/${id}`), [navigate]);

  const selectMode: 'timeoff' | 'call' | 'choice' | 'free' = allMode
    ? 'free'
    : isExpert
      ? 'timeoff'
      : isFounder && canEditBlocks
        ? 'choice'
        : 'call';
  const selectable = !(isExpert && !canEditBlocks) && !(active.isLoading && !active.data);

  const onGridSelect = (sel: GridSelection, point: { x: number; y: number }) => {
    const day = range.days[sel.dayIndex]!;
    const start = atMinute(day, sel.startMin);
    const end = atMinute(day, sel.endMin);
    const minutes = end.diff(start, 'minutes').minutes;
    if (selectMode === 'timeoff' && singleData?.expert) {
      setGridSelection(sel);
      openCreate(singleData.expert, start, end, false);
    } else if (selectMode === 'free') {
      setGridSelection(sel);
      setFreePanel({ start, end, point });
    } else if (selectMode === 'choice') {
      setGridSelection(sel);
      setChoice({ start, end, point });
    } else if (isPastSlot(start)) {
      toast.error('That time has passed — pick a later slot');
    } else {
      navigate(newCallHref(start, minutes, subject.type === 'expert' ? subject.id : null));
    }
  };

  const clearSelection = () => {
    setGridSelection(null);
    setFreePanel(null);
    setChoice(null);
  };

  // ---- keyboard shortcuts ------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="presentation"]')) return;
      if (dialog || freePanel || choice) return;
      if (e.key === 't' || e.key === 'T') goTo(DateTime.now().setZone(zone));
      else if (e.key === 'ArrowLeft') goTo(shiftAnchor(view, anchor, -1));
      else if (e.key === 'ArrowRight') goTo(shiftAnchor(view, anchor, 1));
      else if (e.key === 'd') setView('day');
      else if (e.key === 'w') setView('week');
      else if (e.key === 'm') setView('month');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anchor, view, zone, goTo, setView, dialog, freePanel, choice]);

  // ---- filters ----------------------------------------------------------------------
  const setFilter = (key: 'expert' | 'profile' | 'manager', value: string | null) => {
    clearSelection();
    updateParams({ [key]: value });
  };

  const expertOptions = useMemo<FilterOption[]>(
    () => directory.experts.map((e) => ({ id: e.expert.id, label: e.expert.nickname, detail: zoneLabel(e.expert.timeZone), color: expertColor(e.slot) })),
    [directory.experts],
  );
  const tickedExperts = subjectExpertIds(subject) ?? expertOptions.map((o) => o.id);
  const onExpertsChange = (ids: string[]) => {
    const everyone = ids.length > 0 && expertOptions.length > 0 && expertOptions.every((o) => ids.includes(o.id));
    setFilter('expert', everyone ? 'all' : ids.length === 1 ? ids[0]! : ids.length ? ids.join(',') : null);
  };

  /** "3 calls in view" for an option. */
  const inView = (n: number) => (n ? `${n} call${n === 1 ? '' : 's'} in view` : 'No calls in view');

  const profilesQuery = useQuery({
    queryKey: qk.profiles.list({}),
    queryFn: () => api.profiles.list(),
    enabled: !isExpert,
    staleTime: 5 * 60_000,
  });
  const profileOptions = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const c of callsInView) if (matches(c, 'profile')) counts.set(c.profile.id, (counts.get(c.profile.id) ?? 0) + 1);
    const names = new Map((profilesQuery.data ?? []).map((p) => [p.id, p.name]));
    for (const c of callsInView) if (!names.has(c.profile.id)) names.set(c.profile.id, c.profile.name);
    // The Profiles with calls in view first, then the rest by name.
    return [...names.entries()]
      .map(([id, name]) => ({ id, label: name, count: counts.get(id) ?? 0 }))
      .sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || a.label.localeCompare(b.label))
      .map(({ id, label, count }) => ({ id, label, detail: inView(count) }));
  }, [profilesQuery.data, callsInView, matches]);

  // Managers can only list Associates and Experts, so the Managers come from the calls themselves;
  // the Founder also gets every Manager. Names seen once are kept for a filter that outlives its range.
  const managersQuery = useQuery({
    queryKey: qk.users.list({ role: 'manager' }),
    queryFn: () => api.users.list({ role: 'manager' }),
    enabled: isFounder,
    staleTime: 5 * 60_000,
  });
  const managerNames = useRef(new Map<string, string>());
  const managerOptions = useMemo<FilterOption[]>(() => {
    const names = managerNames.current;
    for (const m of managersQuery.data ?? []) names.set(m.id, m.nickname);
    if (user?.role === 'manager') names.set(user.id, user.nickname);
    const counts = new Map<string, number>();
    for (const c of callsInView) {
      const id = c.manager?.id ?? NO_MANAGER;
      if (c.manager) names.set(c.manager.id, c.manager.nickname);
      if (matches(c, 'manager')) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const options = [...names.entries()]
      .map(([id, name]) => ({ id, label: name, count: counts.get(id) ?? 0 }))
      .sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || a.label.localeCompare(b.label));
    if (counts.has(NO_MANAGER) || managerIds.includes(NO_MANAGER)) options.push({ id: NO_MANAGER, label: 'No Manager (the Founder’s)', count: counts.get(NO_MANAGER) ?? 0 });
    return options.map(({ id, label, count }) => ({ id, label, detail: inView(count) }));
  }, [managersQuery.data, callsInView, matches, user, managerIds]);

  const subtitle = isExpert
    ? canEditBlocks
      ? 'Your calls and time off. Drag on the grid to add time off.'
      : 'Your calls and time off.'
    : allMode
      ? 'Experts side by side. Drag across a time to see who is free.'
      : subject.type === 'expert'
        ? 'Drag across a time to start a call with this Expert.'
        : 'Calls you can see across all Experts.';

  const addTimeOffNow = () => {
    if (!singleData?.expert) return;
    const now = DateTime.now().setZone(zone);
    const base = anchor.hasSame(now, 'day') ? now.plus({ hours: 1 }).startOf('hour') : anchor.set({ hour: 9 });
    openCreate(singleData.expert, base, base.plus({ hours: 1 }), false);
  };

  const onMonthDayClick = (day: DateTime) => {
    if (isExpert && canEditBlocks && singleData?.expert) {
      // An all-day block on that calendar date in the Expert's zone.
      openCreate(singleData.expert, DateTime.fromObject({ year: day.year, month: day.month, day: day.day }, { zone: singleData.expert.timeZone }), day.plus({ days: 1 }), true);
    } else {
      goTo(day);
      setView('day');
    }
  };

  return (
    <Box>
      <PageHeader
        title="Calendar"
        subtitle={subtitle}
        actions={
          canEditBlocks ? (
            <Button variant="contained" startIcon={<EventBusyRounded />} onClick={addTimeOffNow}>
              Add time off
            </Button>
          ) : !isExpert ? (
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={() => navigate(subject.type === 'expert' ? `/calls/new?expertId=${subject.id}` : '/calls/new')}
            >
              New call
            </Button>
          ) : undefined
        }
      />

      <Paper variant="outlined" sx={{ borderRadius: '14px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)' }}>
        {/* ---------------- toolbar ---------------- */}
        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', lg: 'center' }}
          sx={(t) => ({ px: { xs: 1.5, sm: 2 }, py: 1.5, borderBottom: `1px solid ${pal(t).divider}` })}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, minWidth: 0 }} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" color="inherit" size="small" onClick={() => goTo(DateTime.now().setZone(zone))}>
              Today
            </Button>
            <Stack direction="row">
              <Tooltip title={`Previous ${view}`}>
                <IconButton size="small" onClick={() => goTo(shiftAnchor(view, anchor, -1))} aria-label={`Previous ${view}`}>
                  <ChevronLeftRounded />
                </IconButton>
              </Tooltip>
              <Tooltip title={`Next ${view}`}>
                <IconButton size="small" onClick={() => goTo(shiftAnchor(view, anchor, 1))} aria-label={`Next ${view}`}>
                  <ChevronRightRounded />
                </IconButton>
              </Tooltip>
            </Stack>
            <Typography variant="subtitle1" component="h2" noWrap sx={{ minWidth: 0, mr: 0.5 }}>
              {rangeLabel(view, anchor, range.days)}
            </Typography>
            <Tooltip title={`All times are shown in ${zone}`}>
              <Typography variant="caption" color="text.secondary" noWrap>
                {zoneLabel(zone, anchor)}
              </Typography>
            </Tooltip>
            {active.isFetching && active.data && <CircularProgress size={16} sx={{ ml: 0.5 }} aria-label="Refreshing" />}
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={view}
              onChange={(_, v: CalendarView | null) => v && setView(v)}
              aria-label="Calendar view"
            >
              <ToggleButton value="day" sx={{ px: 1.75 }}>
                Day
              </ToggleButton>
              <ToggleButton value="week" sx={{ px: 1.75 }}>
                Week
              </ToggleButton>
              <ToggleButton value="month" sx={{ px: 1.75 }}>
                Month
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>

        {/* ---------------- filters ---------------- */}
        {!isExpert && (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            flexWrap="wrap"
            useFlexGap
            sx={(t) => ({ px: { xs: 1.5, sm: 2 }, py: 1.25, borderBottom: `1px solid ${pal(t).divider}` })}
          >
            <CalendarFilter
              label="Experts"
              emptyText="All my calls"
              allLabel="All experts"
              options={expertOptions}
              selected={tickedExperts}
              loading={directory.isLoading}
              onChange={onExpertsChange}
            />
            <CalendarFilter
              label="Profiles"
              emptyText="Every Profile"
              options={profileOptions}
              selected={profileIds}
              loading={profilesQuery.isLoading}
              onChange={(ids) => setFilter('profile', ids.length ? ids.join(',') : null)}
            />
            {(isFounder || user?.role === 'manager') && (
              <CalendarFilter
                label="Managers"
                emptyText="Every Manager"
                options={managerOptions}
                selected={managerIds}
                loading={managersQuery.isLoading}
                onChange={(ids) => setFilter('manager', ids.length ? ids.join(',') : null)}
              />
            )}
            {(filtering || subject.type !== 'mine') && (
              <Button size="small" color="inherit" onClick={() => { clearSelection(); updateParams({ expert: null, profile: null, manager: null }); }}>
                Clear filters
              </Button>
            )}
          </Stack>
        )}

        {/* ---------------- clocks / legend ---------------- */}
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          alignItems={{ md: 'center' }}
          sx={(t) => ({ px: { xs: 1.5, sm: 2 }, py: 1, borderBottom: `1px solid ${pal(t).divider}` })}
        >
          <ZoneClocks clocks={clocks} clientZone={clientZone} onClientZoneChange={setClientZone} />
          {allMode && expertsData && <ExpertLegend experts={shownExperts.map((c) => ({ expert: c.expert, slot: c.slot }))} />}
        </Stack>

        <Box sx={{ position: 'relative' }}>
          {active.isFetching && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 20 }} />}

          {active.error ? (
            <Box sx={{ p: 2 }}>
              <ErrorState error={active.error} onRetry={() => void active.refetch()} />
            </Box>
          ) : null}

          {view === 'month' ? (
            <MonthGrid
              days={range.days}
              anchor={anchor}
              zone={zone}
              columns={columns}
              notes={notes}
              height={GRID_HEIGHT_CSS}
              onDayClick={onMonthDayClick}
              dayClickLabel={isExpert && canEditBlocks ? 'Add time off on' : 'Open'}
              onDateClick={(d) => {
                goTo(d);
                setView('day');
              }}
              onOpenCall={openCall}
              onEditTimeOff={canEditBlocks ? openEdit : undefined}
            />
          ) : (
            <TimeGrid
              days={range.days}
              zone={zone}
              columns={columns}
              extraZones={extraZones}
              scrollKey={view}
              selectable={selectable}
              defaultSelectMinutes={selectMode === 'timeoff' ? 60 : 30}
              selection={gridSelection}
              selectionHint={(m) =>
                selectMode === 'call'
                  ? `${callDurationFor(m)} min call`
                  : selectMode === 'free'
                    ? `${formatDuration(m)} · who's free?`
                    : formatDuration(m)
              }
              onSelect={onGridSelect}
              onOpenCall={openCall}
              onEditTimeOff={canEditBlocks ? openEdit : undefined}
              notes={notes}
              onDayHeaderClick={(d) => {
                goTo(d);
                setView('day');
              }}
              height={GRID_HEIGHT_CSS}
            />
          )}

          {active.isLoading && !active.data && (
            <Box
              sx={(t) => ({
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                bgcolor: t.alpha(pal(t).background.paper, 0.55),
                zIndex: 15,
              })}
            >
              <CircularProgress />
            </Box>
          )}

          {allMode && expertsData && shownExperts.length === 0 && (
            <Hint>{expertsData.experts.length ? 'None of the Experts ticked is active.' : 'No active Experts yet.'}</Hint>
          )}
        </Box>

        <Stack
          direction="row"
          spacing={2}
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
          useFlexGap
          sx={(t) => ({ px: 2, py: 1, borderTop: `1px solid ${pal(t).divider}` })}
        >
          <Typography variant="caption" color="text.secondary">
            {isEmpty
              ? filtering
                ? 'No calls match these filters in this range.'
                : allMode
                ? 'Nothing booked in this range — every Expert is free.'
                : isExpert
                  ? 'Nothing scheduled in this range.' + (canEditBlocks ? ' Drag on the grid to add time off.' : '')
                  : 'No calls in this range.'
              : `Times in ${zoneLabel(zone, anchor)}.`}
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={{ display: { xs: 'none', sm: 'block' } }}>
            Shortcuts: T today · ← → move · D W M views
          </Typography>
        </Stack>
      </Paper>

      {dialog && user && (
        <BlockDialog
          key={dialogKey}
          state={dialog}
          viewerZone={zone}
          showExpert={dialog.expert.id !== user.id}
          onClose={() => {
            setDialog(null);
            setGridSelection(null);
          }}
        />
      )}

      {freePanel && expertsData && (
        <FreeExpertsPanel
          selection={freePanel}
          experts={shownExperts}
          zone={zone}
          canSchedule={!isExpert}
          onClose={clearSelection}
        />
      )}

      <Menu
        open={Boolean(choice)}
        onClose={clearSelection}
        anchorReference="anchorPosition"
        anchorPosition={choice ? { top: choice.point.y, left: choice.point.x } : undefined}
        slotProps={{ paper: { sx: { minWidth: 240 } } }}
      >
        {choice && (
          <MenuItem
            disabled={isPastSlot(choice.start)}
            onClick={() => navigate(newCallHref(choice.start, choice.end.diff(choice.start, 'minutes').minutes, selectedExpert?.id))}
          >
            <ListItemIcon>
              <VideoCallRounded fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Schedule a call"
              secondary={
                isPastSlot(choice.start)
                  ? 'That time has passed'
                  : `${callDurationFor(choice.end.diff(choice.start, 'minutes').minutes)} min from ${choice.start.toFormat('h:mm a')}`
              }
            />
          </MenuItem>
        )}
        {choice && selectedExpert && (
          <MenuItem
            onClick={() => {
              const c = choice;
              setChoice(null);
              openCreate(selectedExpert, c.start, c.end, false);
            }}
          >
            <ListItemIcon>
              <EventBusyRounded fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary="Add time off"
              secondary={`${choice.start.toFormat('h:mm a')} – ${choice.end.toFormat('h:mm a')}`}
            />
          </MenuItem>
        )}
      </Menu>
    </Box>
  );
}

function ExpertLegend({ experts }: { experts: Array<{ expert: ExpertRef; slot: number }> }) {
  const now = useNow();
  return (
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" alignItems="center" sx={{ minWidth: 0, ml: { md: 'auto !important' } }}>
      {experts.map(({ expert, slot }) => {
        const color = expertColor(slot);
        const local = now.setZone(expert.timeZone);
        return (
          <Tooltip key={expert.id} title={`${expert.nickname} · ${expert.timeZone}`}>
            <Stack
              direction="row"
              spacing={0.75}
              alignItems="center"
              sx={{
                pl: 0.75,
                pr: 1.25,
                py: 0.5,
                borderRadius: 99,
                bgcolor: 'action.selected',
              }}
            >
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
              <Typography variant="caption" fontWeight={500}>
                {expert.nickname}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {local.toFormat('h:mm a ZZZZ')}
              </Typography>
            </Stack>
          </Tooltip>
        );
      })}
    </Stack>
  );
}

function Hint({ children }: { children: string }) {
  return (
    <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 10 }}>
      <Paper variant="outlined" sx={{ px: 2.5, py: 1.5, borderRadius: '10px' }}>
        <Typography variant="body2" color="text.secondary">
          {children}
        </Typography>
      </Paper>
    </Box>
  );
}
