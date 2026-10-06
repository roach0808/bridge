import AddRounded from '@mui/icons-material/AddRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import EventNoteRounded from '@mui/icons-material/EventNoteRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import { Box, Button, IconButton, ListSubheader, Menu, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import {
  CALL_DURATIONS,
  SCHEDULING_GROUP_LABELS,
  SCHEDULING_GROUPS,
  SCHEDULING_LATE_MINUTES,
  SCHEDULING_MAX_SLOTS,
  SCHEDULING_REASON_LABELS,
  SCHEDULING_REASONS,
  SCHEDULING_TEMPLATES,
  renderSchedulingMessage,
  schedulingMessageSchema,
  schedulingSideOf,
  schedulingTemplatesFor,
  type Role,
  type SchedulingMessage,
  type SchedulingSlotType,
  type SchedulingSlotValue,
  type SchedulingTemplate,
  type SchedulingTemplateKey,
} from '@god/shared';
import type { DateTime } from 'luxon';
import { useState } from 'react';
import { zoneAbbr } from '@/lib/time';

/**
 * Between an Expert and the team, a message is one of the set sentences
 * (scheduling.ts in @god/shared): pick one, fill its blanks from the pickers,
 * check how it reads, send. Times are picked on the sender's clock; the other
 * person reads them on theirs.
 */

/** A day and a time of day. */
interface When {
  date: DateTime | null;
  time: DateTime | null;
}
type Draft =
  | When
  | When[]
  | { date: DateTime | null; start: DateTime | null; end: DateTime | null }
  | { from: DateTime | null; to: DateTime | null }
  | DateTime
  | number
  | string
  | null;

const noWhen: When = { date: null, time: null };

function emptyDraft(type: SchedulingSlotType): Draft {
  switch (type) {
    case 'datetime':
      return noWhen;
    case 'datetimes':
      return [noWhen];
    case 'range':
      return { date: null, start: null, end: null };
    case 'days':
      return { from: null, to: null };
    case 'duration':
      return 30;
    case 'reason':
      return '';
    default:
      return null;
  }
}

/** The instant a day and a time make in the zone, or nothing until both are there. */
function instant(day: DateTime | null, time: DateTime | null, zone: string): string | undefined {
  if (!day?.isValid || !time?.isValid) return undefined;
  return day.setZone(zone, { keepLocalTime: true }).startOf('day').set({ hour: time.hour, minute: time.minute }).toUTC().toISO() ?? undefined;
}

const calendarDay = (day: DateTime | null, zone: string) => (day?.isValid ? (day.setZone(zone, { keepLocalTime: true }).toISODate() ?? undefined) : undefined);

/** What a blank holds once it is filled in, or nothing while it isn't. */
function valueOf(type: SchedulingSlotType, draft: Draft, zone: string): SchedulingSlotValue | undefined {
  switch (type) {
    case 'datetime': {
      const w = draft as When;
      return instant(w.date, w.time, zone);
    }
    case 'datetimes': {
      const list = (draft as When[]).map((w) => instant(w.date, w.time, zone));
      return list.every((v): v is string => v !== undefined) ? list : undefined;
    }
    case 'range': {
      const r = draft as { date: DateTime | null; start: DateTime | null; end: DateTime | null };
      const start = instant(r.date, r.start, zone);
      const end = instant(r.date, r.end, zone);
      return start && end ? { start, end } : undefined;
    }
    case 'day':
      return calendarDay(draft as DateTime | null, zone);
    case 'days': {
      const r = draft as { from: DateTime | null; to: DateTime | null };
      const from = calendarDay(r.from, zone);
      const to = calendarDay(r.to, zone);
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [key, setKey] = useState<SchedulingTemplateKey | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const mine = schedulingTemplatesFor(schedulingSideOf(role));

  const pick = (next: SchedulingTemplateKey) => {
    setAnchor(null);
    setKey(next);
    const slots: SchedulingTemplate['slots'] = SCHEDULING_TEMPLATES[next].slots;
    setDrafts(Object.fromEntries(Object.entries(slots).map(([name, type]) => [name, emptyDraft(type)])));
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

  const send = async () => {
    if (!message || sending) return;
    try {
      await onSend(message);
      reset();
    } catch {
      // The thread says what went wrong; the message stays here to try again.
    }
  };

  return (
    <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
      {template ? (
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
            <Button variant="contained" endIcon={<SendRounded />} disabled={!message || sending} onClick={() => void send()}>
              Send
            </Button>
          </Stack>
        </Stack>
      ) : (
        <>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<EventNoteRounded />}
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={{ justifyContent: 'flex-start' }}
          >
            Choose a scheduling message
          </Button>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.75, px: 0.5 }}>
            Experts and the team chat in set messages, only to schedule calls.
          </Typography>
        </>
      )}
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { maxHeight: 440, width: anchor?.clientWidth ?? 420, maxWidth: 'calc(100vw - 32px)' } } }}
      >
        {SCHEDULING_GROUPS.flatMap((group) => {
          const keys = mine.filter((k) => SCHEDULING_TEMPLATES[k].group === group);
          if (!keys.length) return [];
          return [
            <ListSubheader key={group} sx={{ lineHeight: '32px' }}>
              {SCHEDULING_GROUP_LABELS[group]}
            </ListSubheader>,
            ...keys.map((k) => (
              <MenuItem key={k} onClick={() => pick(k)} sx={{ whiteSpace: 'normal', typography: 'body2', py: 0.9 }}>
                {outline(SCHEDULING_TEMPLATES[k])}
              </MenuItem>
            )),
          ];
        })}
      </Menu>
    </Box>
  );
}

/** The picker for one blank. */
function SlotField({ type, draft, zone, onChange }: { type: SchedulingSlotType; draft: Draft; zone: string; onChange: (draft: Draft) => void }) {
  const zoneLabel = zoneAbbr(zone);
  switch (type) {
    case 'datetime':
      return <WhenFields value={draft as When} zone={zone} zoneLabel={zoneLabel} onChange={onChange} />;
    case 'datetimes': {
      const list = draft as When[];
      return (
        <Stack spacing={1}>
          {list.map((w, i) => (
            <Stack key={i} direction="row" spacing={0.5} alignItems="center">
              <Box sx={{ flex: 1 }}>
                <WhenFields value={w} zone={zone} zoneLabel={zoneLabel} onChange={(next) => onChange(list.map((x, j) => (j === i ? next : x)))} />
              </Box>
              {list.length > 1 && (
                <IconButton size="small" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove this time">
                  <CloseRounded sx={{ fontSize: 18 }} />
                </IconButton>
              )}
            </Stack>
          ))}
          {list.length < SCHEDULING_MAX_SLOTS && (
            <Button size="small" startIcon={<AddRounded />} onClick={() => onChange([...list, noWhen])} sx={{ alignSelf: 'flex-start' }}>
              Add another time
            </Button>
          )}
        </Stack>
      );
    }
    case 'range': {
      const r = draft as { date: DateTime | null; start: DateTime | null; end: DateTime | null };
      return (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <DatePicker label="Date" value={r.date} timezone={zone} disablePast onChange={(date) => onChange({ ...r, date })} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
          <TimePicker label={`From (${zoneLabel})`} value={r.start} timezone={zone} minutesStep={5} onChange={(start) => onChange({ ...r, start })} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
          <TimePicker label={`To (${zoneLabel})`} value={r.end} timezone={zone} minutesStep={5} onChange={(end) => onChange({ ...r, end })} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
        </Stack>
      );
    }
    case 'day':
      return <DatePicker label="Day" value={draft as DateTime | null} timezone={zone} disablePast onChange={onChange} slotProps={{ textField: { size: 'small', fullWidth: true } }} />;
    case 'days': {
      const r = draft as { from: DateTime | null; to: DateTime | null };
      return (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <DatePicker label="From" value={r.from} timezone={zone} disablePast onChange={(from) => onChange({ ...r, from })} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
          <DatePicker label="To" value={r.to} timezone={zone} disablePast onChange={(to) => onChange({ ...r, to })} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
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

function WhenFields({ value, zone, zoneLabel, onChange }: { value: When; zone: string; zoneLabel: string; onChange: (when: When) => void }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
      <DatePicker label="Date" value={value.date} timezone={zone} disablePast onChange={(date) => onChange({ ...value, date })} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
      <TimePicker label={`Time (${zoneLabel})`} value={value.time} timezone={zone} minutesStep={5} onChange={(time) => onChange({ ...value, time })} slotProps={{ textField: { size: 'small', fullWidth: true } }} />
    </Stack>
  );
}
