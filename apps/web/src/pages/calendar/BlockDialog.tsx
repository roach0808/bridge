import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import RepeatRounded from '@mui/icons-material/RepeatRounded';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import {
  MAX_SERIES_DAYS,
  describeRepeat,
  normalizeBlock,
  validateBlock,
  type BlockKind,
  type BlockRule,
  type EditScope,
  type ExpertRef,
  type Frequency,
  type Occurrence,
  type ScheduleBlockDTO,
} from '@god/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/common';
import { UserChip } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { AVAILABILITY_ENABLED } from '@/lib/features';
import { qk } from '@/lib/queryKeys';
import { formatDuration, zoneLabel } from './calendarUtils';
import { ScopeDialog } from './ScopeDialog';

export type BlockDialogState =
  | {
      mode: 'create';
      expert: ExpertRef;
      startDate: string;
      allDay: boolean;
      startMinute: number;
      durationMinutes: number;
    }
  | { mode: 'edit'; expert: ExpertRef; rule: ScheduleBlockDTO; occurrence: Occurrence };

type MonthlyMode = 'day' | 'nth' | 'last';
type EndPreset = '1w' | '1m' | '3m' | '6m' | '1y' | 'date';

const END_PRESETS: Array<{ value: EndPreset; label: string }> = [
  { value: '1w', label: '1 week' },
  { value: '1m', label: '1 month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
  { value: '1y', label: '1 year' },
  { value: 'date', label: 'Pick a date' },
];

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ORDINALS = ['first', 'second', 'third', 'fourth'];
const QUICK_DURATIONS = [30, 60, 120, 240, 480];

interface FormState {
  kind: BlockKind;
  allDay: boolean;
  date: string;
  startMinute: number;
  durationMinutes: number;
  frequency: Frequency;
  interval: number;
  weekdays: number[];
  monthlyMode: MonthlyMode;
  endPreset: EndPreset;
  untilDate: string | null;
  note: string;
}

const dateOf = (iso: string) => DateTime.fromISO(iso, { zone: 'utc' });

function presetUntil(date: string, preset: EndPreset): string | null {
  const d = dateOf(date);
  const span = { '1w': { weeks: 1 }, '1m': { months: 1 }, '3m': { months: 3 }, '6m': { months: 6 }, '1y': { years: 1 } } as const;
  if (preset === 'date') return null;
  return d.plus(span[preset]).minus({ days: 1 }).toISODate();
}

function initialForm(state: BlockDialogState): FormState {
  if (state.mode === 'create') {
    return {
      kind: 'unavailable',
      allDay: state.allDay,
      date: state.startDate,
      startMinute: state.startMinute,
      durationMinutes: state.durationMinutes,
      frequency: 'none',
      interval: 1,
      weekdays: [dateOf(state.startDate).weekday],
      monthlyMode: 'day',
      endPreset: '3m',
      untilDate: presetUntil(state.startDate, '3m'),
      note: '',
    };
  }
  const { rule, occurrence } = state;
  const r = rule.repeat;
  return {
    kind: rule.kind,
    allDay: rule.allDay,
    date: occurrence.date,
    startMinute: rule.startMinute,
    durationMinutes: rule.durationMinutes,
    frequency: r.frequency,
    interval: r.interval,
    weekdays: r.weekdays.length ? r.weekdays : [dateOf(occurrence.date).weekday],
    monthlyMode: r.setPosition === -1 ? 'last' : r.setPosition != null ? 'nth' : 'day',
    endPreset: r.untilDate ? 'date' : '3m',
    untilDate: r.untilDate ?? presetUntil(occurrence.date, '3m'),
    note: rule.note ?? '',
  };
}

function monthlyFields(date: string, mode: MonthlyMode) {
  const d = dateOf(date);
  if (mode === 'day') return { monthDay: d.day, setPosition: null, weekday: null };
  if (mode === 'last') return { monthDay: null, setPosition: -1, weekday: d.weekday };
  return { monthDay: null, setPosition: Math.min(4, Math.ceil(d.day / 7)), weekday: d.weekday };
}

function buildRule(form: FormState, timeZone: string, startDate = form.date): BlockRule {
  const repeating = form.frequency !== 'none';
  const monthly = form.frequency === 'monthly' || form.frequency === 'yearly';
  return normalizeBlock({
    kind: form.kind,
    timeZone,
    startDate,
    allDay: form.allDay,
    startMinute: form.allDay ? 0 : form.startMinute,
    durationMinutes: form.allDay ? 1440 : form.durationMinutes,
    repeat: {
      frequency: form.frequency,
      interval: repeating ? form.interval : 1,
      weekdays: form.frequency === 'weekly' ? form.weekdays : [],
      ...(monthly ? monthlyFields(form.date, form.monthlyMode) : { monthDay: null, setPosition: null, weekday: null }),
      month: form.frequency === 'yearly' ? dateOf(form.date).month : null,
      untilDate: repeating ? form.untilDate : null,
    },
    exceptionDates: [],
    note: form.note.trim() || null,
  });
}

/** Maps validation / server paths onto the form's inputs. */
function fieldFor(path: string): string {
  const p = path.replace(/^changes\./, '');
  if (p === 'repeat.setPosition' || p === 'repeat.weekday' || p === 'repeat.monthDay' || p === 'repeat.month') return 'repeat.monthly';
  return p;
}

export function BlockDialog({
  state,
  viewerZone,
  showExpert,
  onClose,
}: {
  state: BlockDialogState | null;
  viewerZone: string;
  showExpert: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState | null>(state ? initialForm(state) : null);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [scopeFor, setScopeFor] = useState<'edit' | 'delete' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (state) {
      setForm(initialForm(state));
      setSubmitted(false);
      setServerErrors({});
      setServerError(null);
      setScopeFor(null);
    }
  }, [state]);

  const blockZone = state?.mode === 'edit' ? state.rule.timeZone : (state?.expert.timeZone ?? viewerZone);
  const rule = useMemo(() => (form ? buildRule(form, blockZone) : null), [form, blockZone]);
  const issues = useMemo(() => (rule ? validateBlock(rule) : []), [rule]);
  const clientErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const i of issues) out[fieldFor(i.path)] ??= i.message;
    return out;
  }, [issues]);
  const errors: Record<string, string> = submitted ? { ...serverErrors, ...clientErrors } : serverErrors;

  const onMutationError = (err: unknown) => {
    const fields = Object.fromEntries(Object.entries(fieldErrors(err)).map(([k, v]) => [fieldFor(k), v]));
    setServerErrors(fields);
    setServerError(errorMessage(err));
  };

  const done = (message: string) => {
    void queryClient.invalidateQueries({ queryKey: qk.calendar.all });
    toast.success(message);
    setScopeFor(null);
    onClose();
  };

  const save = useMutation({
    mutationFn: async (scope: EditScope | null) => {
      if (!state || !form || !rule) throw new Error('Nothing to save');
      if (state.mode === 'create') {
        return api.scheduleBlocks.create(state.expert.id, {
          kind: rule.kind,
          startDate: rule.startDate,
          allDay: rule.allDay,
          startMinute: rule.startMinute,
          durationMinutes: rule.durationMinutes,
          repeat: rule.repeat,
          note: rule.note ?? null,
        });
      }
      const original = state.rule;
      const repeating = original.repeat.frequency !== 'none';
      const effectiveScope: EditScope = repeating ? (scope ?? 'all') : 'all';
      // "All events" moves the whole series by the same number of days the user moved this occurrence.
      let startDate = form.date;
      if (repeating && effectiveScope === 'all') {
        const shift = dateOf(form.date).diff(dateOf(state.occurrence.date), 'days').days;
        startDate = dateOf(original.startDate).plus({ days: Math.round(shift) }).toISODate()!;
      }
      return api.scheduleBlocks.update(original.id, {
        scope: effectiveScope,
        ...(repeating && effectiveScope !== 'all' ? { occurrenceDate: state.occurrence.date } : {}),
        changes: {
          kind: rule.kind,
          startDate,
          allDay: rule.allDay,
          startMinute: rule.startMinute,
          durationMinutes: rule.durationMinutes,
          repeat: rule.repeat,
          note: rule.note ?? null,
        },
      });
    },
    onSuccess: () => done(state?.mode === 'create' ? 'Time off added' : 'Time off updated'),
    onError: (err) => {
      setScopeFor(null);
      onMutationError(err);
    },
  });

  const remove = useMutation({
    mutationFn: async (scope: EditScope) => {
      if (state?.mode !== 'edit') throw new Error('Nothing to delete');
      const repeating = state.rule.repeat.frequency !== 'none';
      return api.scheduleBlocks.remove(state.rule.id, repeating ? scope : 'all', repeating && scope !== 'all' ? state.occurrence.date : undefined);
    },
    onSuccess: () => done('Time off deleted'),
    onError: (err) => {
      setScopeFor(null);
      onMutationError(err);
    },
  });

  if (!state || !form || !rule) return null;

  const set = (patch: Partial<FormState>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setServerErrors({});
    setServerError(null);
  };
  const setDate = (date: string) => {
    const patch: Partial<FormState> = { date };
    if (form.endPreset !== 'date') patch.untilDate = presetUntil(date, form.endPreset);
    if (form.frequency === 'weekly' && form.weekdays.length === 1) patch.weekdays = [dateOf(date).weekday];
    set(patch);
  };

  const editing = state.mode === 'edit';
  const originalRepeating = editing && state.rule.repeat.frequency !== 'none';
  const repeatChanged =
    editing && JSON.stringify(normalizeBlock({ ...state.rule, note: null }).repeat) !== JSON.stringify(rule.repeat);
  const busy = save.isPending || remove.isPending;

  const submit = () => {
    setSubmitted(true);
    if (issues.length) return;
    if (originalRepeating) setScopeFor('edit');
    else save.mutate(null);
  };
  const askDelete = () => {
    if (originalRepeating) setScopeFor('delete');
    else setConfirmDelete(true);
  };

  const d = dateOf(form.date);
  const endMinute = form.startMinute + form.durationMinutes;
  const nextDay = endMinute > 1440 || (endMinute === 1440 && form.startMinute > 0);
  const unit = { none: '', daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[form.frequency];
  const position = Math.ceil(d.day / 7);
  const isLastWeek = d.plus({ days: 7 }).month !== d.month;

  // Preview in the viewer's zone when the Expert keeps another clock.
  const zonesDiffer = blockZone !== viewerZone;
  const localStart = DateTime.fromObject({ year: d.year, month: d.month, day: d.day }, { zone: blockZone }).plus({
    minutes: form.allDay ? 0 : form.startMinute,
  });
  const localEnd = localStart.plus({ minutes: form.allDay ? 1440 : form.durationMinutes });
  const viewerPreview = `${localStart.setZone(viewerZone).toFormat('ccc, LLL d · h:mm a')} – ${localEnd
    .setZone(viewerZone)
    .toFormat(localEnd.setZone(viewerZone).hasSame(localStart.setZone(viewerZone), 'day') ? 'h:mm a ZZZZ' : 'ccc h:mm a ZZZZ')}`;

  const timeValue = (minute: number) => DateTime.fromObject({ hour: Math.floor(minute / 60) % 24, minute: minute % 60 });

  return (
    <>
      <Dialog open={Boolean(state)} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
        <DialogTitle sx={{ pb: 1 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
            <span>{editing ? 'Edit time off' : 'Add time off'}</span>
            {showExpert && <UserChip user={state.expert} size={24} showRole={false} />}
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            {serverError && !Object.keys(serverErrors).some((k) => knownFields[k]) && <Alert severity="error">{serverError}</Alert>}

            {AVAILABILITY_ENABLED && (
              <ToggleButtonGroup
                exclusive
                size="small"
                value={form.kind}
                onChange={(_, v: BlockKind | null) => v && set({ kind: v })}
              >
                <ToggleButton value="unavailable">Time off</ToggleButton>
                <ToggleButton value="available">Available</ToggleButton>
              </ToggleButtonGroup>
            )}

            <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap gap={1}>
              <FormControlLabel
                control={<Switch checked={form.allDay} onChange={(_, v) => set({ allDay: v })} />}
                label="All day"
              />
              <Typography variant="caption" color="text.secondary">
                {`${showExpert ? `${state.expert.nickname}'s time` : 'Your time'} · ${zoneLabel(blockZone, localStart)}`}
              </Typography>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <DatePicker
                label="Date"
                value={DateTime.fromISO(form.date)}
                onChange={(v) => v?.isValid && setDate(v.toISODate()!)}
                slotProps={{
                  textField: { size: 'small', fullWidth: true, error: Boolean(errors.startDate), helperText: errors.startDate },
                }}
              />
              {!form.allDay && (
                <>
                  <TimePicker
                    label="Start"
                    value={timeValue(form.startMinute)}
                    minutesStep={5}
                    onChange={(v) => v?.isValid && set({ startMinute: v.hour * 60 + v.minute })}
                    slotProps={{
                      textField: { size: 'small', fullWidth: true, error: Boolean(errors.startMinute), helperText: errors.startMinute },
                    }}
                  />
                  <TimePicker
                    label="End"
                    value={timeValue(endMinute % 1440)}
                    minutesStep={5}
                    onChange={(v) => {
                      if (!v?.isValid) return;
                      let dur = v.hour * 60 + v.minute - form.startMinute;
                      if (dur <= 0) dur += 1440;
                      set({ durationMinutes: Math.min(1440, dur) });
                    }}
                    slotProps={{
                      textField: {
                        size: 'small',
                        fullWidth: true,
                        error: Boolean(errors.durationMinutes),
                        helperText: errors.durationMinutes ?? (nextDay ? 'Next day' : undefined),
                      },
                    }}
                  />
                </>
              )}
            </Stack>

            {!form.allDay && (
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                  Duration {formatDuration(form.durationMinutes)}
                </Typography>
                {QUICK_DURATIONS.map((m) => (
                  <Chip
                    key={m}
                    size="small"
                    label={formatDuration(m)}
sx={{
                      bgcolor: form.durationMinutes === m ? 'action.selected' : 'transparent',
                      color: form.durationMinutes === m ? 'text.primary' : 'text.secondary',
                      border: 1,
                      borderColor: form.durationMinutes === m ? 'transparent' : 'divider',
                      '&&:hover': { bgcolor: form.durationMinutes === m ? 'action.selected' : 'action.hover' },
                    }}
                    onClick={() => set({ durationMinutes: m })}
                  />
                ))}
              </Stack>
            )}

            {((originalRepeating && state.mode === 'edit') || zonesDiffer) && (
              <Stack spacing={0.25} sx={{ mt: '-8px !important' }}>
                {zonesDiffer && (
                  <Typography variant="caption" color="text.secondary">
                    In your calendar: {viewerPreview}
                  </Typography>
                )}
                {originalRepeating && state.mode === 'edit' && (
                  <Typography variant="caption" color="text.secondary">
                    Part of a series starting {dateOf(state.rule.startDate).toFormat('LLL d, yyyy')} — you're editing the{' '}
                    {dateOf(state.occurrence.date).toFormat('LLL d')} occurrence.
                  </Typography>
                )}
              </Stack>
            )}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              <TextField
                select
                label="Repeat"
                value={form.frequency}
                onChange={(e) => {
                  const frequency = e.target.value as Frequency;
                  set({
                    frequency,
                    weekdays: form.weekdays.length ? form.weekdays : [d.weekday],
                    untilDate: form.untilDate ?? presetUntil(form.date, form.endPreset === 'date' ? '3m' : form.endPreset),
                  });
                }}
                sx={{ flex: 2 }}
              >
                <MenuItem value="none">Does not repeat</MenuItem>
                <MenuItem value="daily">Daily</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="monthly">Monthly</MenuItem>
                <MenuItem value="yearly">Yearly</MenuItem>
              </TextField>
              {form.frequency !== 'none' && (
                <TextField
                  label="Every"
                  type="number"
                  value={form.interval}
                  onChange={(e) => set({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
                  error={Boolean(errors['repeat.interval'])}
                  helperText={errors['repeat.interval']}
                  slotProps={{
                    htmlInput: { min: 1, max: 99 },
                    input: {
                      endAdornment: (
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 1, whiteSpace: 'nowrap' }}>
                          {form.interval === 1 ? unit : `${unit}s`}
                        </Typography>
                      ),
                    },
                  }}
                  sx={{ flex: 1 }}
                />
              )}
            </Stack>

            {form.frequency === 'weekly' && (
              <Box>
                <ToggleButtonGroup
                  size="small"
                  value={form.weekdays}
                  onChange={(_, v: number[]) => set({ weekdays: v })}
                  aria-label="Weekdays"
                  sx={{ flexWrap: 'wrap' }}
                >
                  {WEEKDAYS.map((label, i) => (
                    <ToggleButton key={i} value={i + 1} aria-label={WEEKDAY_NAMES[i]} sx={{ width: 40 }}>
                      {label}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                {errors['repeat.weekdays'] && (
                  <Typography variant="caption" color="error" component="div" sx={{ mt: 0.5 }}>
                    {errors['repeat.weekdays']}
                  </Typography>
                )}
              </Box>
            )}

            {(form.frequency === 'monthly' || form.frequency === 'yearly') && (
              <TextField
                select
                label="On"
                value={form.monthlyMode === 'nth' && position > 4 ? 'last' : form.monthlyMode}
                onChange={(e) => set({ monthlyMode: e.target.value as MonthlyMode })}
                error={Boolean(errors['repeat.monthly'])}
                helperText={errors['repeat.monthly']}
              >
                <MenuItem value="day">
                  Day {d.day}
                  {form.frequency === 'yearly' ? ` of ${d.toFormat('LLLL')}` : ''}
                </MenuItem>
                {position <= 4 && (
                  <MenuItem value="nth">
                    The {ORDINALS[position - 1]} {d.toFormat('cccc')}
                    {form.frequency === 'yearly' ? ` of ${d.toFormat('LLLL')}` : ''}
                  </MenuItem>
                )}
                {isLastWeek && (
                  <MenuItem value="last">
                    The last {d.toFormat('cccc')}
                    {form.frequency === 'yearly' ? ` of ${d.toFormat('LLLL')}` : ''}
                  </MenuItem>
                )}
              </TextField>
            )}

            {form.frequency !== 'none' && (
              <Box>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.75 }}>
                  Ends after
                </Typography>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                  {END_PRESETS.map((p) => (
                    <Chip
                      key={p.value}
                      label={p.label}
                      size="small"
sx={{
                      bgcolor: form.endPreset === p.value ? 'action.selected' : 'transparent',
                      color: form.endPreset === p.value ? 'text.primary' : 'text.secondary',
                      border: 1,
                      borderColor: form.endPreset === p.value ? 'transparent' : 'divider',
                      '&&:hover': { bgcolor: form.endPreset === p.value ? 'action.selected' : 'action.hover' },
                    }}
                      onClick={() =>
                        set({ endPreset: p.value, untilDate: p.value === 'date' ? form.untilDate : presetUntil(form.date, p.value) })
                      }
                    />
                  ))}
                </Stack>
                {form.endPreset === 'date' && (
                  <Box sx={{ mt: 1.5, maxWidth: 260 }}>
                    <DatePicker
                      label="End date"
                      value={form.untilDate ? DateTime.fromISO(form.untilDate) : null}
                      minDate={DateTime.fromISO(form.date)}
                      maxDate={DateTime.fromISO(form.date).plus({ days: MAX_SERIES_DAYS })}
                      onChange={(v) => set({ untilDate: v?.isValid ? v.toISODate() : null })}
                      slotProps={{
                        textField: {
                          size: 'small',
                          fullWidth: true,
                          error: Boolean(errors['repeat.untilDate']),
                          helperText: errors['repeat.untilDate'] ?? 'Up to 3 years',
                        },
                      }}
                    />
                  </Box>
                )}
                {form.endPreset !== 'date' && errors['repeat.untilDate'] && (
                  <Typography variant="caption" color="error" component="div" sx={{ mt: 0.5 }}>
                    {errors['repeat.untilDate']}
                  </Typography>
                )}
              </Box>
            )}

            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{
                px: 1.5,
                py: 1,
                borderRadius: '10px',
                bgcolor: 'background.subtle',
                color: 'text.primary',
              }}
            >
              <RepeatRounded sx={{ fontSize: 17, color: 'text.secondary' }} />
              <Typography variant="body2">
                {form.allDay ? 'All day' : `${timeValue(form.startMinute).toFormat('h:mm a')} for ${formatDuration(form.durationMinutes)}`}{' '}
                · {form.frequency === 'none' ? d.toFormat('ccc, LLL d, yyyy') : editing ? describeRepeat(rule) : `${describeRepeat(rule)} (from ${d.toFormat('LLL d')})`}
              </Typography>
            </Stack>

            <TextField
              label="Note (optional)"
              value={form.note}
              onChange={(e) => set({ note: e.target.value })}
              multiline
              minRows={2}
              error={Boolean(errors.note)}
              helperText={errors.note ?? 'Only you and the Founder can see this'}
              slotProps={{ htmlInput: { maxLength: 1000 } }}
            />

            {submitted && issues.length > 0 && !Object.keys(clientErrors).some((k) => k in knownFields) && (
              <Alert severity="warning">{issues[0]!.message}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          {editing && (
            <Button color="error" startIcon={<DeleteOutlineRounded />} onClick={askDelete} disabled={busy} sx={{ mr: 'auto' }}>
              Delete
            </Button>
          )}
          <Button color="inherit" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="contained" onClick={submit} disabled={busy || (submitted && issues.length > 0)}>
            {save.isPending && !scopeFor ? <CircularProgress size={18} color="inherit" /> : editing ? 'Save' : 'Add time off'}
          </Button>
        </DialogActions>
      </Dialog>

      <ScopeDialog
        open={scopeFor !== null}
        action={scopeFor ?? 'edit'}
        allowThis={scopeFor === 'delete' || !repeatChanged}
        busy={busy}
        onClose={() => setScopeFor(null)}
        onConfirm={(scope) => (scopeFor === 'delete' ? remove.mutate(scope) : save.mutate(scope))}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete time off?"
        description="This removes the time off from the calendar."
        confirmLabel="Delete"
        destructive
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => remove.mutateAsync('all')}
      />
    </>
  );
}

const knownFields: Record<string, true> = {
  startDate: true,
  startMinute: true,
  durationMinutes: true,
  'repeat.interval': true,
  'repeat.weekdays': true,
  'repeat.monthly': true,
  'repeat.untilDate': true,
  note: true,
};
