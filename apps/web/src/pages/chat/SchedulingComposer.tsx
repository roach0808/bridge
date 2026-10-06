import AddRounded from '@mui/icons-material/AddRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import {
  Autocomplete,
  Box,
  Button,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import {
  CALL_DURATIONS,
  SCHEDULING_GROUP_LABELS,
  SCHEDULING_LATE_MINUTES,
  SCHEDULING_MAX_SLOTS,
  SCHEDULING_REASON_LABELS,
  SCHEDULING_REASONS,
  SCHEDULING_TEMPLATES,
  findTypedDay,
  findTypedTime,
  formatSchedulingMoment,
  parseTypedTime,
  renderSchedulingMessage,
  schedulingMessageSchema,
  schedulingSideOf,
  suggestSchedulingTemplates,
  typedInstant,
  type Role,
  type SchedulingMessage,
  type SchedulingReason,
  type SchedulingSlotType,
  type SchedulingSlotValue,
  type SchedulingTemplate,
  type SchedulingTemplateKey,
} from '@god/shared';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { zoneAbbr } from '@/lib/time';

/**
 * Between an Expert and the team, a message is one of the set sentences
 * (scheduling.ts in @god/shared). Type what you want to say and the matching
 * sentences come up; pick one, fill its blanks, check how it reads, send. Times
 * are typed ("3pm", "3:30 PM ET") on the sender's clock unless they name a zone;
 * the other person reads them on theirs. Yes and No go in one tap.
 */

/** A day and a typed time of day. */
interface When {
  date: DateTime | null;
  time: string;
}
interface Span {
  date: DateTime | null;
  start: string;
  end: string;
}
type Draft = When | When[] | Span | { from: DateTime | null; to: DateTime | null } | DateTime | number | string | null;

/** What was typed in the search box that can fill a blank: a time, a day, minutes, a reason. */
interface Hints {
  time: string;
  day: DateTime | null;
  minutes: number | null;
  reason: SchedulingReason | '';
}

const REASON_WORDS: Record<SchedulingReason, RegExp> = {
  conflict: /\b(conflict|clash|busy|another meeting)\b/i,
  illness: /\b(sick|ill|illness|unwell|doctor)\b/i,
  travel: /\b(travel|travelling|traveling|flight|trip|airport)\b/i,
  emergency: /\b(emergency|urgent)\b/i,
};

function hintsFrom(query: string, zone: string): Hints {
  const day = findTypedDay(query, zone);
  const minutes = /\b(\d{1,2})\s*(?:min|mins|minutes|m)\b/i.exec(query);
  const reason = SCHEDULING_REASONS.find((r) => REASON_WORDS[r].test(query)) ?? '';
  return {
    time: findTypedTime(query) ?? '',
    day: day ? DateTime.fromISO(day, { zone }) : null,
    minutes: minutes ? Number(minutes[1]) : null,
    reason,
  };
}

function draftFor(type: SchedulingSlotType, hints: Hints): Draft {
  const when: When = { date: hints.day, time: hints.time };
  switch (type) {
    case 'datetime':
      return when;
    case 'datetimes':
      return [when];
    case 'range':
      return { date: hints.day, start: hints.time, end: '' };
    case 'day':
      return hints.day;
    case 'days':
      return { from: hints.day, to: hints.day };
    case 'duration':
      return (CALL_DURATIONS as readonly number[]).includes(hints.minutes ?? 0) ? hints.minutes : 30;
    case 'late':
      return (SCHEDULING_LATE_MINUTES as readonly number[]).includes(hints.minutes ?? 0) ? hints.minutes : null;
    case 'reason':
      return hints.reason;
  }
}

const calendarDay = (day: DateTime | null) => (day?.isValid ? day.toISODate() : null);

/**
 * The instant a day and a typed time make, or nothing until both are there and
 * readable. A time without a zone is on `zone`.
 */
function instantOf(day: DateTime | null, time: string, zone: string): string | undefined {
  const d = calendarDay(day);
  const parsed = parseTypedTime(time, zone);
  return d && parsed?.ok ? (typedInstant(d, parsed.time) ?? undefined) : undefined;
}

/** The zone a span's end is on: the one its start named, unless the end names its own. */
function endZone(span: Span, zone: string): string {
  const start = parseTypedTime(span.start, zone);
  return start?.ok ? start.time.zone : zone;
}

/** What a blank holds once it is filled in, or nothing while it isn't. */
function valueOf(type: SchedulingSlotType, draft: Draft, zone: string): SchedulingSlotValue | undefined {
  switch (type) {
    case 'datetime': {
      const w = draft as When;
      return instantOf(w.date, w.time, zone);
    }
    case 'datetimes': {
      const list = (draft as When[]).map((w) => instantOf(w.date, w.time, zone));
      return list.every((v): v is string => v !== undefined) ? list : undefined;
    }
    case 'range': {
      const r = draft as Span;
      const start = instantOf(r.date, r.start, zone);
      const end = instantOf(r.date, r.end, endZone(r, zone));
      return start && end ? { start, end } : undefined;
    }
    case 'day':
      return calendarDay(draft as DateTime | null) ?? undefined;
    case 'days': {
      const r = draft as { from: DateTime | null; to: DateTime | null };
      const from = calendarDay(r.from);
      const to = calendarDay(r.to);
      return from && to ? { from, to } : undefined;
    }
    case 'duration':
    case 'late':
      return typeof draft === 'number' ? draft : undefined;
    case 'reason':
      return draft ? (draft as string) : undefined;
  }
}

/** The sentence with its blanks left open, as the list shows it. */
const outline = (template: SchedulingTemplate) => template.text.replace(/\{\w+\}/g, '___');

export function SchedulingComposer({
  role,
  zone,
  sending,
  onSend,
}: {
  role: Role;
  zone: string;
  sending: boolean;
  onSend: (message: SchedulingMessage) => Promise<unknown>;
}) {
  const [query, setQuery] = useState('');
  const [key, setKey] = useState<SchedulingTemplateKey | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const side = schedulingSideOf(role);
  const suggestions = suggestSchedulingTemplates(query, side);
  const typing = query.trim() !== '';

  const pick = (next: SchedulingTemplateKey, hints: Hints) => {
    const slots: SchedulingTemplate['slots'] = SCHEDULING_TEMPLATES[next].slots;
    setKey(next);
    setQuery('');
    setDrafts(Object.fromEntries(Object.entries(slots).map(([name, type]) => [name, draftFor(type, hints)])));
  };
  const reset = () => {
    setKey(null);
    setDrafts({});
  };

  const template: SchedulingTemplate | null = key ? SCHEDULING_TEMPLATES[key] : null;
  const slots = Object.entries(template?.slots ?? {});
  const values = slots.map(([name, type]) => [name, valueOf(type, drafts[name] ?? null, zone)] as const);
  const complete = values.every(([, v]) => v !== undefined);
  const parsed = key && complete ? schedulingMessageSchema.safeParse({ key, params: Object.fromEntries(values) }) : null;
  const message = parsed?.success ? parsed.data : null;
  const problem = parsed && !parsed.success ? parsed.error.issues[0]?.message : null;
  const set = (name: string, draft: Draft) => setDrafts((d) => ({ ...d, [name]: draft }));

  const send = async (m: SchedulingMessage | null = message) => {
    if (!m || sending) return;
    try {
      await onSend(m);
      reset();
    } catch {
      // The thread says what went wrong; the message stays here to try again.
    }
  };


  if (template) {
    return (
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Stack spacing={1.25}>
          <Stack direction="row" alignItems="center">
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ flex: 1 }}>
              {SCHEDULING_GROUP_LABELS[template.group]}
            </Typography>
            <IconButton size="small" onClick={reset} aria-label="Choose another message">
              <CloseRounded sx={{ fontSize: 18 }} />
            </IconButton>
          </Stack>
          {slots.map(([name, type]) => (
            <SlotField key={name} type={type} draft={drafts[name] ?? null} zone={zone} onChange={(d) => set(name, d)} />
          ))}
          <Box sx={{ px: 1.5, py: 1, borderRadius: 2.5, bgcolor: 'action.hover', typography: 'body2', color: message ? 'text.primary' : 'text.secondary' }}>
            {message ? renderSchedulingMessage(message, zone) : outline(template)}
          </Box>
          {problem && (
            <Typography variant="caption" color="error">
              {problem}
            </Typography>
          )}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={reset}>Cancel</Button>
            {/* With nothing to fill in, Enter sends it straight away. */}
            <Button variant="contained" endIcon={<SendRounded />} disabled={!message || sending} onClick={() => void send()} autoFocus={!slots.length}>
              Send
            </Button>
          </Stack>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Button size="small" variant="contained" color="success" startIcon={<CheckRounded />} disabled={sending} onClick={() => void send({ key: 'yes', params: {} })}>
          Yes
        </Button>
        <Button size="small" variant="contained" color="inherit" startIcon={<CloseRounded />} disabled={sending} onClick={() => void send({ key: 'no', params: {} })}>
          No
        </Button>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, textAlign: 'right' }}>
          Set messages only, to schedule calls
        </Typography>
      </Stack>
      <Autocomplete<SchedulingTemplateKey>
        options={suggestions}
        value={null}
        inputValue={query}
        onInputChange={(_e, text, reason) => reason !== 'reset' && setQuery(text)}
        onChange={(_e, next) => next && pick(next, hintsFrom(query, zone))}
        filterOptions={(keys) => keys}
        groupBy={typing ? undefined : (k) => SCHEDULING_GROUP_LABELS[SCHEDULING_TEMPLATES[k].group]}
        getOptionLabel={(k) => outline(SCHEDULING_TEMPLATES[k])}
        renderOption={({ key: optionKey, ...props }, k) => (
          <Box component="li" key={optionKey} {...props} sx={{ typography: 'body2', whiteSpace: 'normal' }}>
            {preview(SCHEDULING_TEMPLATES[k], query, zone)}
          </Box>
        )}
        autoHighlight
        openOnFocus
        blurOnSelect
        disabled={sending}
        noOptionsText="No set message says that. Try “time”, “reschedule”, “late” or “cancel”."
        slotProps={{ popper: { placement: 'top-start' }, listbox: { sx: { maxHeight: 360 } } }}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            placeholder="Type what you want to say: reschedule, 3pm ET, late…"
            slotProps={{
              input: {
                ...params.InputProps,
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: { ...params.inputProps, 'aria-label': 'Find a scheduling message' },
            }}
          />
        )}
      />
    </Box>
  );
}

/** A suggestion as it would read with what was typed: the day and time typed go in the first time blank. */
function preview(template: SchedulingTemplate, query: string, zone: string): string {
  const time = findTypedTime(query);
  const day = findTypedDay(query, zone);
  const when = [day && DateTime.fromISO(day, { zone }).toFormat('ccc, LLL d'), time].filter(Boolean).join(' at ');
  let used = false;
  return template.text.replace(/\{(\w+)\}/g, (_whole, name: string) => {
    const type = template.slots[name];
    if (when && !used && (type === 'datetime' || type === 'datetimes' || type === 'range')) {
      used = true;
      return when;
    }
    return '___';
  });
}

/** A time of day, typed: "3pm", "3:30 PM ET", "15:30". It says how it reads as you type. */
function TimeText({
  label,
  value,
  day,
  zone,
  ownZone = zone,
  onChange,
}: {
  label: string;
  value: string;
  day: DateTime | null;
  /** The zone a time without one is on. */
  zone: string;
  /** The writer's own zone, which the result is shown in. */
  ownZone?: string;
  onChange: (text: string) => void;
}) {
  const parsed = parseTypedTime(value, zone);
  const d = calendarDay(day);
  const at = parsed?.ok && d ? typedInstant(d, parsed.time) : null;
  const elsewhere = parsed?.ok && parsed.time.zone !== ownZone;
  const helper = !parsed
    ? `Like 3pm, 3:30 PM ET or 15:30 · ${zoneAbbr(zone)} unless you add a zone`
    : !parsed.ok
      ? parsed.error
      : at
        ? `${formatSchedulingMoment(at, ownZone)}${elsewhere ? ' (your time)' : ''}${Date.parse(at) < Date.now() ? ' · already past' : ''}`
        : `${DateTime.fromObject({ hour: parsed.time.hour, minute: parsed.time.minute }).toFormat('h:mm a')} ${zoneAbbr(parsed.time.zone)} · choose the date`;
  return (
    <TextField
      size="small"
      fullWidth
      label={label}
      placeholder="3pm ET"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={Boolean(parsed && !parsed.ok)}
      helperText={helper}
      slotProps={{
        htmlInput: { maxLength: 40, autoComplete: 'off' },
        formHelperText: { sx: { color: !parsed?.ok ? undefined : at && Date.parse(at) < Date.now() ? 'warning.main' : 'success.main' } },
      }}
    />
  );
}

const DATE_FIELD = { textField: { size: 'small' as const, fullWidth: true } };

/** The fields for one blank. */
function SlotField({ type, draft, zone, onChange }: { type: SchedulingSlotType; draft: Draft; zone: string; onChange: (draft: Draft) => void }) {
  switch (type) {
    case 'datetime':
      return <WhenFields value={draft as When} zone={zone} onChange={onChange} />;
    case 'datetimes': {
      const list = draft as When[];
      return (
        <Stack spacing={1}>
          {list.map((w, i) => (
            <Stack key={i} direction="row" spacing={0.5} alignItems="flex-start">
              <Box sx={{ flex: 1 }}>
                <WhenFields value={w} zone={zone} onChange={(next) => onChange(list.map((x, j) => (j === i ? next : x)))} />
              </Box>
              {list.length > 1 && (
                <IconButton size="small" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove this time" sx={{ mt: 0.5 }}>
                  <CloseRounded sx={{ fontSize: 18 }} />
                </IconButton>
              )}
            </Stack>
          ))}
          {list.length < SCHEDULING_MAX_SLOTS && (
            <Button size="small" startIcon={<AddRounded />} onClick={() => onChange([...list, { date: list.at(-1)?.date ?? null, time: '' }])} sx={{ alignSelf: 'flex-start' }}>
              Add another time
            </Button>
          )}
        </Stack>
      );
    }
    case 'range': {
      const r = draft as Span;
      return (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-start">
          <DatePicker label="Date" value={r.date} timezone={zone} disablePast onChange={(date) => onChange({ ...r, date })} slotProps={DATE_FIELD} />
          <TimeText label="From" value={r.start} day={r.date} zone={zone} onChange={(start) => onChange({ ...r, start })} />
          <TimeText label="To" value={r.end} day={r.date} zone={endZone(r, zone)} ownZone={zone} onChange={(end) => onChange({ ...r, end })} />
        </Stack>
      );
    }
    case 'day':
      return <DatePicker label="Day" value={draft as DateTime | null} timezone={zone} disablePast onChange={onChange} slotProps={DATE_FIELD} />;
    case 'days': {
      const r = draft as { from: DateTime | null; to: DateTime | null };
      return (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <DatePicker label="From" value={r.from} timezone={zone} disablePast onChange={(from) => onChange({ ...r, from })} slotProps={DATE_FIELD} />
          <DatePicker label="To" value={r.to} timezone={zone} disablePast onChange={(to) => onChange({ ...r, to })} slotProps={DATE_FIELD} />
        </Stack>
      );
    }
    case 'duration':
    case 'late':
      return (
        <ToggleButtonGroup exclusive size="small" value={draft} onChange={(_e, v: number | null) => v !== null && onChange(v)} aria-label={type === 'duration' ? 'Call length' : 'Minutes late'}>
          {(type === 'duration' ? CALL_DURATIONS : SCHEDULING_LATE_MINUTES).map((n) => (
            <ToggleButton key={n} value={n} sx={{ px: 1.5 }}>
              {n} min
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      );
    case 'reason':
      return (
        <TextField select size="small" label="Reason" value={draft as string} onChange={(e) => onChange(e.target.value)} fullWidth>
          {SCHEDULING_REASONS.map((r) => (
            <MenuItem key={r} value={r}>
              {SCHEDULING_REASON_LABELS[r].replace(/^an? /, '').replace(/^./, (c) => c.toUpperCase())}
            </MenuItem>
          ))}
        </TextField>
      );
  }
}

function WhenFields({ value, zone, onChange }: { value: When; zone: string; onChange: (when: When) => void }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="flex-start">
      <DatePicker label="Date" value={value.date} timezone={zone} disablePast onChange={(date) => onChange({ ...value, date })} slotProps={DATE_FIELD} />
      <TimeText label="Time" value={value.time} day={value.date} zone={zone} onChange={(time) => onChange({ ...value, time })} />
    </Stack>
  );
}
