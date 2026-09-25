import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { Alert, Box, Button, Collapse, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { NO_START_DATE_WARNING, ROLE_LABELS, isActiveTodo, type TodoDTO, type UserRef } from '@god/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { zoneAbbr } from '@/lib/time';
import { FormDialog } from '../admin/adminShared';
import { useRefreshTodos } from './todoShared';

/**
 * The whole of a task in one place (§18): who it is for, when to begin, when it
 * must be finished, what it should produce and how anyone can tell it is done.
 *
 * Start By and Complete By are two separate rows, with their own words, because
 * the one mistake this form exists to prevent is reading a deadline as the day
 * to begin. A task can be saved with nothing but a title, so quick capture
 * stays quick; everything else can be filled in later.
 */

/** A day, and optionally a time of day, in one zone. */
interface When {
  date: DateTime | null;
  time: DateTime | null;
}

const empty: When = { date: null, time: null };

/** Reads a stored instant back into the two fields, in the task's own zone. */
function toWhen(at: string | null, hasTime: boolean, zone: string): When {
  if (!at) return empty;
  const dt = DateTime.fromISO(at, { zone: 'utc' }).setZone(zone);
  return { date: dt, time: hasTime ? dt : null };
}

/** The instant to store: the day at the given time, or the start of that day. */
function toInstant(when: When, zone: string): { at: string | null; hasTime: boolean } {
  if (!when.date?.isValid) return { at: null, hasTime: false };
  const day = when.date.setZone(zone, { keepLocalTime: true }).startOf('day');
  if (!when.time?.isValid) return { at: day.toUTC().toISO()!, hasTime: false };
  return { at: day.set({ hour: when.time.hour, minute: when.time.minute }).toUTC().toISO()!, hasTime: true };
}

export function TaskDialog({
  open,
  todo,
  assignee,
  onClose,
}: {
  open: boolean;
  /** The task being changed; left out, the dialog gives a new one. */
  todo?: TodoDTO | null;
  /** Who a new task is for, when the board already knows. */
  assignee?: UserRef;
  onClose: () => void;
}) {
  const me = useMe();
  const { zone } = useAuth();
  const refresh = useRefreshTodos();
  const toast = useToast();
  const editing = Boolean(todo);

  const [assigneeId, setAssigneeId] = useState(me.id);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [startBy, setStartBy] = useState<When>(empty);
  const [completeBy, setCompleteBy] = useState<When>(empty);
  const [deliverable, setDeliverable] = useState('');
  const [definitionOfDone, setDefinitionOfDone] = useState('');
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [more, setMore] = useState(false);
  const [again, setAgain] = useState(false);

  // Who the task can be for, or handed to: the giver may pass on a task of
  // theirs that is still unfinished and did not come from a chat.
  const handOver = Boolean(todo && todo.createdBy.id === me.id && !todo.conversationId && isActiveTodo(todo.status));
  const ownerIsMine = (!editing && !assignee) || handOver;
  const people = useQuery({ queryKey: [...qk.todos.all, 'assignees'], queryFn: api.todos.assignees, enabled: open && ownerIsMine });
  const board = useQuery({ queryKey: qk.todos.board('active'), queryFn: () => api.todos.board({ status: 'active' }), enabled: open && more });
  // Everything else still to do, as candidates for "what must happen first".
  const candidates = useMemo(
    () => (board.data ?? []).flatMap((p) => p.tasks).filter((t) => t.id !== todo?.id),
    [board.data, todo?.id],
  );

  // The zone the times belong to: the task's own, or the owner's.
  const taskZone = todo?.timeZone ?? zone;

  useEffect(() => {
    if (!open) return;
    setAssigneeId(todo?.assignee.id ?? assignee?.id ?? me.id);
    setTitle(todo?.title ?? '');
    setDetails(todo?.details ?? '');
    setStartBy(toWhen(todo?.startByAt ?? null, todo?.startByHasTime ?? false, taskZone));
    setCompleteBy(toWhen(todo?.completeByAt ?? null, todo?.completeByHasTime ?? false, taskZone));
    setDeliverable(todo?.expectedDeliverable ?? '');
    setDefinitionOfDone(todo?.definitionOfDone ?? '');
    setDependsOn(todo?.dependsOn.map((d) => d.id) ?? []);
    setMore(Boolean(todo?.expectedDeliverable || todo?.definitionOfDone || todo?.dependsOn.length || todo?.details));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, todo?.id, assignee?.id]);

  const start = toInstant(startBy, taskZone);
  const complete = toInstant(completeBy, taskZone);
  const backwards = Boolean(start.at && complete.at && complete.at < start.at);
  const fromChat = Boolean(todo?.conversationId);

  const body = {
    details: details.trim() || null,
    startByAt: start.at,
    startByHasTime: start.hasTime,
    completeByAt: complete.at,
    completeByHasTime: complete.hasTime,
    timeZone: taskZone,
    expectedDeliverable: deliverable.trim() || null,
    definitionOfDone: definitionOfDone.trim() || null,
    dependsOn,
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!todo) return api.todos.create({ assigneeId, title: title.trim(), ...body });
      // Handing it over first, so the rest is saved onto the task as it now is.
      if (assigneeId !== todo.assignee.id) await api.todos.move(todo.id, assigneeId);
      return api.todos.update(todo.id, { ...body, ...(fromChat ? {} : { title: title.trim() }) });
    },
    onSuccess: (saved) => {
      refresh(saved);
      toast.success(editing ? 'Task saved' : saved.assignee.id === me.id ? 'Task added' : `Task given to ${saved.assignee.nickname}`);
      if (again && !editing) {
        // Same person, same dates: the next task in a batch usually shares them.
        setTitle('');
        setDetails('');
        setDeliverable('');
        setDefinitionOfDone('');
        setDependsOn([]);
        setAgain(false);
      } else {
        onClose();
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const errors = fieldErrors(save.error);
  const zoneLabel = zoneAbbr(taskZone);

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      title={editing ? 'Task' : 'New task'}
      subtitle={editing ? `Given by ${todo!.createdBy.nickname}` : undefined}
      submitLabel={editing ? 'Save' : assigneeId === me.id ? 'Add task' : 'Give task'}
      pending={save.isPending}
      submitDisabled={!title.trim() || backwards}
      onSubmit={() => save.mutate()}
      secondaryAction={
        editing ? undefined : (
          <Button
            onClick={() => {
              setAgain(true);
              save.mutate();
            }}
            disabled={save.isPending || !title.trim() || backwards}
          >
            Save &amp; create another
          </Button>
        )
      }
    >
      {ownerIsMine ?
        <TextField
          select
          required
          label="Owner"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
          helperText={editing && assigneeId !== todo!.assignee.id ? `Saving hands this task to ${people.data?.find((u) => u.id === assigneeId)?.nickname}` : undefined}
        >
          {(people.data ?? []).map((u) => (
            <MenuItem key={u.id} value={u.id}>
              {u.id === me.id ? 'You' : u.nickname}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {ROLE_LABELS[u.role]}
              </Typography>
            </MenuItem>
          ))}
        </TextField>
      : editing ?
        <TextField label="Owner" value={todo!.assignee.nickname} disabled />
      : null}

      <TextField
        required
        label="Task"
        placeholder="e.g. Send 20 SME invitations"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={fromChat}
        helperText={fromChat ? 'This task came from a chat message, so its words are the message.' : errors.title}
        error={Boolean(errors.title)}
        slotProps={{ htmlInput: { maxLength: 200 } }}
      />

      {/* Two rows, never one: when to begin, and when it must already be finished. */}
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        <WhenRow
          label="Start"
          hint="Begin work no later than this"
          color="primary.main"
          value={startBy}
          zone={taskZone}
          zoneLabel={zoneLabel}
          onChange={setStartBy}
        />
        <WhenRow
          label="End date"
          hint="Must already be finished by this"
          color="text.primary"
          value={completeBy}
          zone={taskZone}
          zoneLabel={zoneLabel}
          onChange={setCompleteBy}
          error={backwards ? 'The end date cannot be before the start' : errors.completeByAt}
        />
        {completeBy.date && !startBy.date && <Alert severity="warning">{NO_START_DATE_WARNING}</Alert>}
      </Box>

      <Button
        size="small"
        onClick={() => setMore((m) => !m)}
        endIcon={<ExpandMoreRounded sx={{ transform: more ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />}
        sx={{ alignSelf: 'flex-start' }}
      >
        {more ? 'Fewer details' : 'More details'}
      </Button>

      <Collapse in={more} unmountOnExit>
        <Stack spacing={2}>
          <TextField
            label="Description"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 5000 } }}
          />
          <TextField
            label="Expected deliverable"
            placeholder="What must be produced or accomplished"
            value={deliverable}
            onChange={(e) => setDeliverable(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <TextField
            label="Definition of done"
            placeholder="How anyone can tell it is finished"
            value={definitionOfDone}
            onChange={(e) => setDefinitionOfDone(e.target.value)}
            multiline
            minRows={2}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
          />
          <TextField
            select
            label="Waits for"
            value={dependsOn}
            onChange={(e) => setDependsOn(typeof e.target.value === 'string' ? [e.target.value] : e.target.value)}
            helperText="Tasks that must happen first"
            slotProps={{ select: { multiple: true, renderValue: (v) => `${(v as string[]).length} task(s)` } }}
          >
            {candidates.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.title ?? t.message?.body}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {t.assignee.nickname}
                </Typography>
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Collapse>
    </FormDialog>
  );
}

/** One of the two dates: a day, and a time of day only when the hour matters. */
function WhenRow({
  label,
  hint,
  color,
  value,
  zone,
  zoneLabel,
  onChange,
  error,
}: {
  label: string;
  hint: string;
  color: string;
  value: When;
  zone: string;
  zoneLabel: string;
  onChange: (when: When) => void;
  error?: string;
}) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color, fontWeight: 700, display: 'block' }}>
        {label}
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1, fontWeight: 400 }}>
          {hint}
        </Typography>
      </Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 0.5 }}>
        <DatePicker
          label="Date"
          value={value.date}
          timezone={zone}
          onChange={(date) => onChange({ ...value, date })}
          slotProps={{
            textField: { size: 'small', fullWidth: true, error: Boolean(error), helperText: error },
            field: { clearable: true, onClear: () => onChange(empty) },
          }}
        />
        <TimePicker
          label={`Time (${zoneLabel}) — optional`}
          value={value.time}
          timezone={zone}
          disabled={!value.date}
          minutesStep={5}
          onChange={(time) => onChange({ ...value, time })}
          slotProps={{
            textField: { size: 'small', fullWidth: true },
            field: { clearable: true, onClear: () => onChange({ ...value, time: null }) },
          }}
        />
      </Stack>
    </Box>
  );
}
