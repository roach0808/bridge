import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import BadgeOutlined from '@mui/icons-material/BadgeOutlined';
import VideocamRounded from '@mui/icons-material/VideocamRounded';
import LinkedIn from '@mui/icons-material/LinkedIn';
import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Link,
  MenuItem,
  Rating,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { joinCallRoom } from '@god/api-client';
import {
  CALL_DURATIONS,
  MAX_PLATFORM_RATE,
  FEATURES,
  MAX_ACTUAL_DURATION_MINUTES,
  STATUS_LABELS,
  edgeOwner,
  isOverride,
  type CallDetailDTO,
  type CallDTO,
  type CallStatus,
  type TransitionInput,
  type UpdateCallInput,
  type UserRef,
} from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, Field } from '@/components/common';
import { ProfileDetailsDialog } from '@/components/ProfileDetails';
import { RoleBadge, UserAvatar, UserChip } from '@/components/identity';
import { STATUS_COLORS, StatusChip } from '@/components/StatusChip';
import { useToast } from '@/components/ToastProvider';
import { api, socket } from '@/lib/api';
import { errorMessage, fieldErrors, isApiError } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { patchCallInCache } from '@/realtime/RealtimeProvider';
import { formatDateTime, formatUsd, inZone, relativeTime, zoneAbbr, zoneCity } from '@/lib/time';
import { AVAILABILITY_LABEL, availabilityFor, useExpertsAround } from './expertAvailability';
import { MessageThread } from './MessageThread';
import { StatusProgress } from './StatusProgress';


function useUpdateCall(call: CallDTO) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCallInput) => api.calls.update(call.id, body),
    onSuccess: (updated) => {
      patchCallInCache(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: qk.calls.detail(call.id) });
      void queryClient.invalidateQueries({ queryKey: qk.calendar.all });
    },
  });
}

// ---------------------------------------------------------------------------

const RATING_LABELS: Record<number, string> = { 1: 'Went badly', 2: 'Not great', 3: 'Okay', 4: 'Went well', 5: 'Went very well' };

function TransitionBar({ call }: { call: CallDTO }) {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<CallStatus | null>(null);
  const [comment, setComment] = useState('');
  // Starting needs the Ninja link; finishing needs how long the call really took;
  // paying needs what actually reached the bank.
  const [ninjaLink, setNinjaLink] = useState('');
  const [actualMinutes, setActualMinutes] = useState('');
  const [income, setIncome] = useState('');

  const open = (to: CallStatus) => {
    setTarget(to);
    setComment('');
    setNinjaLink(call.ninjaLink ?? '');
    setActualMinutes(String(call.durationMinutes));
    // Start from the expected price; the bank usually pays a little less.
    setIncome(call.expectedPrice === null ? '' : String(call.expectedPrice));
    transition.reset();
  };

  const transition = useMutation({
    mutationFn: ({ to, ...extra }: TransitionInput) => api.calls.transition(call.id, to, extra),
    onSuccess: (updated) => {
      patchCallInCache(queryClient, updated);
      void queryClient.invalidateQueries({ queryKey: qk.calls.detail(call.id) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      toast.success(`Moved to ${STATUS_LABELS[updated.status]}`);
      setTarget(null);
    },
    onError: (err) => {
      // §9.3: a 409 refreshes the Call and shows the reason.
      if (isApiError(err) && err.status === 409) void queryClient.invalidateQueries({ queryKey: qk.calls.detail(call.id) });
      if (!Object.keys(fieldErrors(err)).length) toast.error(errorMessage(err));
    },
  });
  const errors = fieldErrors(transition.error);

  const minutes = Number(actualMinutes);
  const minutesValid = Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_ACTUAL_DURATION_MINUTES;
  const linkValid = /^https?:\/\/\S+$/i.test(ninjaLink.trim());
  const incomeValue = Number(income);
  const incomeValid = income.trim() !== '' && Number.isFinite(incomeValue) && incomeValue >= 0 && Math.round(incomeValue * 100) === incomeValue * 100;
  // An Expert asking to reschedule must say why, so the Associate knows what to arrange.
  const expertReschedule = target === 'on_rescheduling' && me.role === 'expert';
  const ready =
    target === 'ongoing'
      ? linkValid
      : target === 'finished'
        ? minutesValid
        : target === 'process_to_bank'
          ? incomeValid
          : expertReschedule
          ? comment.trim() !== ''
          : true;

  const confirm = () => {
    if (!target || !ready) return;
    transition.mutate({
      to: target,
      comment: comment.trim() || undefined,
      ...(target === 'ongoing' ? { ninjaLink: ninjaLink.trim() } : {}),
      ...(target === 'finished' ? { actualDurationMinutes: minutes } : {}),
      ...(target === 'process_to_bank' ? { realIncome: incomeValue } : {}),
    });
  };

  if (!call.allowedTransitions.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {call.status === 'process_to_bank' || (me.role === 'expert' && call.status === 'finished')
          ? 'This call is complete.'
          : 'No actions for you at this stage.'}
      </Typography>
    );
  }

  return (
    <>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ md: 'flex-end' }}>
        {call.allowedTransitions.map((to) => {
          const override = isOverride(me.role, call.status, to);
          const backwards = to === 'on_rescheduling';
          // One primary action: the first forward move. Everything else stays quiet.
          const primary = !backwards && to === call.allowedTransitions.find((t) => t !== 'on_rescheduling');
          return (
            <Tooltip key={to} title={override ? `Override: normally done by the ${edgeOwner(call.status, to)}` : ''}>
              <span>
                <Button
                  variant={primary ? 'contained' : 'outlined'}
                  color={primary ? 'primary' : 'inherit'}
                  startIcon={transition.isPending && transition.variables?.to === to ? <CircularProgress size={16} color="inherit" /> : undefined}
                  disabled={transition.isPending}
                  onClick={() => open(to)}
                >
                  {backwards
                    ? me.role === 'expert'
                      ? 'Request rescheduling'
                      : 'Needs rescheduling'
                    : to === 'confirmed'
                      ? 'Confirm time'
                      : `Mark ${STATUS_LABELS[to].toLowerCase()}`}
                  {override && (
                    <Box component="span" sx={{ ml: 0.75, fontSize: 11, fontWeight: 500, opacity: 0.7 }}>
                      override
                    </Box>
                  )}
                </Button>
              </span>
            </Tooltip>
          );
        })}
      </Stack>
      <Dialog open={Boolean(target)} onClose={() => !transition.isPending && setTarget(null)} maxWidth="xs" fullWidth>
        {target && (
          <>
            <DialogTitle>
              {target === 'confirmed'
                ? 'Confirm this call?'
                : expertReschedule
                  ? 'Request rescheduling?'
                  : `Move to ${STATUS_LABELS[target]}?`}
            </DialogTitle>
            <DialogContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <StatusChip status={call.status} />
                <Typography color="text.secondary">→</Typography>
                <StatusChip status={target} />
              </Stack>
              {target === 'confirmed' && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  You confirm that {me.role === 'expert' ? 'you are' : 'the Expert is'} available on{' '}
                  <strong>{formatDateTime(call.scheduledAt, call.expert?.timeZone ?? me.timeZone)}</strong> for{' '}
                  {call.durationMinutes} minutes and can take the call.
                </Alert>
              )}
              {expertReschedule && (
                <Alert
                  severity="warning"
                  sx={{ mb: 2 }}
                  action={
                    <Button color="inherit" size="small" href="/calendar" target="_blank" rel="noopener">
                      Calendar
                    </Button>
                  }
                >
                  <strong>Update your calendar first.</strong> Mark the times you can no longer make as unavailable and
                  add your new availability, so the Associate can find a slot that works.
                </Alert>
              )}
              {isOverride(me.role, call.status, target) && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  You are acting on behalf of the {edgeOwner(call.status, target)}. This is recorded as an override.
                </Alert>
              )}
              <Stack spacing={2}>
                {target === 'ongoing' && (
                  <TextField
                    label="Ninja link"
                    required
                    type="url"
                    placeholder="https://vdo.ninja/?room=…"
                    value={ninjaLink}
                    onChange={(e) => setNinjaLink(e.target.value)}
                    error={Boolean(errors.ninjaLink) || (ninjaLink !== '' && !linkValid)}
                    helperText={errors.ninjaLink ?? (ninjaLink !== '' && !linkValid ? 'Enter a full link starting with https://' : 'Everyone on the call can open it')}
                    autoFocus
                  />
                )}
                {target === 'finished' && (
                  <TextField
                    label="Actual duration (minutes)"
                    required
                    type="number"
                    value={actualMinutes}
                    onChange={(e) => setActualMinutes(e.target.value)}
                    error={Boolean(errors.actualDurationMinutes) || (actualMinutes !== '' && !minutesValid)}
                    helperText={errors.actualDurationMinutes ?? `Booked for ${call.durationMinutes} min`}
                    slotProps={{ htmlInput: { min: 1, max: MAX_ACTUAL_DURATION_MINUTES, step: 1 } }}
                    autoFocus
                  />
                )}
                {target === 'process_to_bank' && (
                  <TextField
                    label="Real income (USD)"
                    required
                    type="number"
                    value={income}
                    onChange={(e) => setIncome(e.target.value)}
                    error={Boolean(errors.realIncome) || (income !== '' && !incomeValid)}
                    helperText={
                      errors.realIncome ??
                      `What reached the bank. Expected ${formatUsd(call.expectedPrice)} (rate × ${call.actualDurationMinutes ?? '—'} min).`
                    }
                    slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
                    autoFocus
                  />
                )}
                {target !== 'finished' && (
                  <TextField
                    label={expertReschedule ? 'Reason for rescheduling' : 'Comment (optional)'}
                    required={expertReschedule}
                    placeholder={expertReschedule ? 'e.g. A conflict came up — I can do Thursday afternoon instead.' : undefined}
                    multiline
                    minRows={2}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    autoFocus={target !== 'ongoing'}
                  />
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
              <Button color="inherit" onClick={() => setTarget(null)} disabled={transition.isPending}>
                Cancel
              </Button>
              <Button
                variant="contained"
                disabled={transition.isPending || !ready}
                onClick={confirm}
              >
                {transition.isPending ? <CircularProgress size={18} color="inherit" /> : 'Confirm'}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------

function SectionCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2, minHeight: 30 }}>
          <Typography variant="subtitle1" component="h2">
            {title}
          </Typography>
          {action}
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

function EditDetailsDialog({ call, open, onClose }: { call: CallDTO; open: boolean; onClose: () => void }) {
  const { zone } = useAuth();
  const toast = useToast();
  const update = useUpdateCall(call);
  const { data: platforms } = useQuery({ queryKey: qk.platforms, queryFn: api.platforms.list, enabled: open });
  const [form, setForm] = useState<{
    scheduledAt: DateTime;
    durationMinutes: number;
    platformId: string;
    platformAssociateName: string;
    projectDetails: string;
    notes: string;
  }>(() => ({
    scheduledAt: inZone(call.scheduledAt, zone),
    durationMinutes: call.durationMinutes,
    platformId: call.platform.id,
    platformAssociateName: call.platformAssociateName,
    projectDetails: call.projectDetails,
    notes: call.notes ?? '',
  }));
  useEffect(() => {
    if (open) {
      setForm({
        scheduledAt: inZone(call.scheduledAt, zone),
        durationMinutes: call.durationMinutes,
        platformId: call.platform.id,
        platformAssociateName: call.platformAssociateName,
        projectDetails: call.projectDetails,
        notes: call.notes ?? '',
      });
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const errors = fieldErrors(update.error);

  const save = () =>
    update.mutate(
      {
        scheduledAt: form.scheduledAt.toUTC().toISO()!,
        durationMinutes: form.durationMinutes,
        platformId: form.platformId,
        platformAssociateName: form.platformAssociateName,
        projectDetails: form.projectDetails,
        notes: form.notes,
      },
      {
        onSuccess: () => {
          toast.success('Call updated');
          onClose();
        },
      },
    );

  return (
    <Dialog open={open} onClose={update.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit call details</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {update.error && !Object.keys(errors).length ? <Alert severity="error">{errorMessage(update.error)}</Alert> : null}
          <DateTimePicker
            label={`Start (${zoneAbbr(zone)})`}
            value={form.scheduledAt}
            timezone={zone}
            onChange={(v) => {
              if (v?.isValid) setForm((f) => ({ ...f, scheduledAt: v }));
            }}
            minutesStep={5}
            slotProps={{ textField: { fullWidth: true, size: 'small', error: Boolean(errors.scheduledAt), helperText: errors.scheduledAt } }}
          />
          <Box>
            <Typography variant="caption" color="text.secondary">
              Duration
            </Typography>
            <ToggleButtonGroup
              exclusive
              fullWidth
              size="small"
              value={form.durationMinutes}
              onChange={(_, v) => v && setForm((f) => ({ ...f, durationMinutes: v }))}
              sx={{ mt: 0.5 }}
            >
              {CALL_DURATIONS.map((d) => (
                <ToggleButton key={d} value={d}>
                  {d} min
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>
          <TextField select label="Platform" value={form.platformId} onChange={(e) => setForm((f) => ({ ...f, platformId: e.target.value }))}>
            {(platforms ?? [call.platform]).map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Platform associate"
            helperText={errors.platformAssociateName ?? "The platform's own staff contact"}
            error={Boolean(errors.platformAssociateName)}
            value={form.platformAssociateName}
            onChange={(e) => setForm((f) => ({ ...f, platformAssociateName: e.target.value }))}
          />
          <TextField
            label="Project details"
            multiline
            minRows={3}
            error={Boolean(errors.projectDetails)}
            helperText={errors.projectDetails}
            value={form.projectDetails}
            onChange={(e) => setForm((f) => ({ ...f, projectDetails: e.target.value }))}
          />
          <TextField label="Internal notes" multiline minRows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={update.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={update.isPending || !form.projectDetails.trim() || !form.platformAssociateName.trim()}>
          {update.isPending ? <CircularProgress size={18} color="inherit" /> : 'Save changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ReassignDialog({
  call,
  kind,
  open,
  onClose,
}: {
  call: CallDTO;
  kind: 'associate' | 'expert';
  open: boolean;
  onClose: () => void;
}) {
  const me = useMe();
  const toast = useToast();
  const update = useUpdateCall(call);
  const [selected, setSelected] = useState<string | null>(kind === 'expert' ? (call.expert?.id ?? null) : call.associate.id);
  useEffect(() => {
    if (open) setSelected(kind === 'expert' ? (call.expert?.id ?? null) : call.associate.id);
  }, [open, kind, call.expert?.id, call.associate.id]);

  const experts = useExpertsAround(open && kind === 'expert' ? call.scheduledAt : null, call.endsAt, me.role);
  const associates = useQuery({
    queryKey: me.role === 'manager' ? qk.users.team : qk.users.list({ role: 'associate', active: 'true' }),
    queryFn: () => (me.role === 'manager' ? api.users.team() : api.users.list({ role: 'associate', active: 'true' })),
    enabled: open && kind === 'associate',
  });

  const options: Array<UserRef & { hint?: string; free?: boolean }> =
    kind === 'expert'
      ? (experts.data?.experts ?? []).map((col) => {
          const a = availabilityFor(col, call.scheduledAt, call.endsAt, call.id);
          return {
            ...col.expert,
            free: a.state === 'free',
            hint: `${inZone(call.scheduledAt, col.expert.timeZone).toFormat('h:mm a ZZZZ')} · ${AVAILABILITY_LABEL[a.state]}`,
          };
        })
      : (associates.data ?? []).filter((u) => u.isActive);
  const value = options.find((o) => o.id === selected) ?? null;
  const loading = kind === 'expert' ? experts.isLoading : associates.isLoading;

  const save = () =>
    update.mutate(kind === 'expert' ? { expertId: selected } : { associateId: selected ?? undefined }, {
      onSuccess: () => {
        toast.success(kind === 'expert' ? 'Expert updated' : 'Associate updated');
        onClose();
      },
    });

  return (
    <Dialog open={open} onClose={update.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{kind === 'expert' ? 'Assign Expert' : 'Reassign Associate'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {update.error ? <Alert severity="error">{errorMessage(update.error)}</Alert> : null}
          <Autocomplete
            options={options}
            loading={loading}
            value={value}
            onChange={(_, v) => setSelected(v?.id ?? null)}
            getOptionLabel={(o) => o.nickname}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderOption={({ key, ...props }, o) => (
              <li key={key} {...props}>
                <Stack direction="row" spacing={1.25} alignItems="center" sx={{ width: '100%' }}>
                  <UserAvatar avatarId={o.avatarId} photoId={o.photoId} label={o.nickname} size={28} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={500}>
                      {o.nickname}
                    </Typography>
                    {o.hint && (
                      <Typography variant="caption" color="text.secondary">
                        {o.hint}
                      </Typography>
                    )}
                  </Box>
                  {o.free !== undefined && (
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: o.free ? 'success.main' : 'warning.main' }} />
                  )}
                </Stack>
              </li>
            )}
            renderInput={(params) => <TextField {...params} label={kind === 'expert' ? 'Expert' : 'Associate'} autoFocus />}
          />
          {kind === 'expert' && call.status !== 'on_scheduling' && (
            <Typography variant="caption" color="text.secondary">
              The call is booked, so the new Expert must be free at this time.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {kind === 'expert' && call.status === 'on_scheduling' && call.expert && (
          <Button color="inherit" onClick={() => setSelected(null)} sx={{ mr: 'auto' }}>
            Unassign
          </Button>
        )}
        <Button color="inherit" onClick={onClose} disabled={update.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={save} disabled={update.isPending || (kind === 'associate' && !selected)}>
          {update.isPending ? <CircularProgress size={18} color="inherit" /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Founder: correct what reached the bank after the call was processed. */
function RealIncomeEditor({ call }: { call: CallDTO }) {
  const toast = useToast();
  const update = useUpdateCall(call);
  const text = (n: number | null) => (n === null ? '' : String(n));
  const [value, setValue] = useState(text(call.realIncome));
  useEffect(() => setValue(text(call.realIncome)), [call.realIncome]);
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 0 && Math.round(n * 100) === n * 100;
  const dirty = valid && n !== call.realIncome;
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <TextField
        label="Correct real income (USD)"
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={value !== '' && !valid}
        slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
        sx={{ maxWidth: 260 }}
      />
      <Button
        variant="outlined"
        sx={{ mt: 1 }}
        disabled={!dirty || update.isPending}
        onClick={() =>
          update.mutate({ realIncome: n }, { onSuccess: () => toast.success('Real income saved'), onError: (e) => toast.error(errorMessage(e)) })
        }
      >
        {update.isPending ? <CircularProgress size={18} /> : 'Save'}
      </Button>
    </Stack>
  );
}

/** The research link: set by the Founder, read by the Founder and the Expert. */
function GptLinkCard({ call }: { call: CallDTO }) {
  const toast = useToast();
  const update = useUpdateCall(call);
  const [link, setLink] = useState(call.gptLink ?? '');
  useEffect(() => setLink(call.gptLink ?? ''), [call.gptLink]);
  const editable = call.permissions.editGptLink;
  const trimmed = link.trim();
  const valid = trimmed === '' || /^https?:\/\/\S+$/i.test(trimmed);
  const dirty = trimmed !== (call.gptLink ?? '');

  return (
    <SectionCard title="GPT link">
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
        Only the Founder and the Expert can see this.
      </Typography>
      {editable ? (
        <Stack spacing={1.5}>
          <TextField
            label="Link"
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            error={!valid}
            helperText={valid ? 'Paste the research chat for this call' : 'Enter a full link starting with https://'}
            placeholder="https://chatgpt.com/share/…"
          />
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Button
              variant="outlined"
              disabled={!dirty || !valid || update.isPending}
              onClick={() =>
                update.mutate(
                  { gptLink: trimmed || null },
                  { onSuccess: () => toast.success('GPT link saved'), onError: (e) => toast.error(errorMessage(e)) },
                )
              }
            >
              {update.isPending ? <CircularProgress size={18} /> : 'Save link'}
            </Button>
            {call.gptLink && (
              <Button size="small" color="inherit" href={call.gptLink} target="_blank" rel="noopener noreferrer" sx={{ color: 'text.secondary' }}>
                Open
              </Button>
            )}
          </Stack>
        </Stack>
      ) : call.gptLink ? (
        <Button variant="contained" href={call.gptLink} target="_blank" rel="noopener noreferrer">
          Open GPT link
        </Button>
      ) : (
        <Typography variant="body2" color="text.secondary">
          The Founder has not added one yet.
        </Typography>
      )}
    </SectionCard>
  );
}

/** The Profile's rate on this platform, and a special rate for this call only. */
function RateCard({ call }: { call: CallDTO }) {
  const toast = useToast();
  const update = useUpdateCall(call);
  const text = (r: number | null) => (r === null ? '' : String(r));
  const [override, setOverride] = useState(text(call.rateOverride));
  useEffect(() => setOverride(text(call.rateOverride)), [call.rateOverride]);
  const empty = override.trim() === '';
  const value = Number(override);
  const valid = empty || (Number.isFinite(value) && value >= 0 && value <= MAX_PLATFORM_RATE);
  const next = empty ? null : Math.round(value * 100) / 100;
  const dirty = next !== call.rateOverride;
  const effective = call.rateOverride ?? call.platformRate;

  return (
    <SectionCard title="Rate & payment">
      <Stack spacing={1.5}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr' }}>
          <Field label={`${call.platform.name} rate`}>
            {call.platformRate === null ? (
              <Typography variant="body2" color="text.disabled">
                Not set
              </Typography>
            ) : (
              `$${call.platformRate}/h`
            )}
          </Field>
          <Field label="This call">
            {effective === null ? (
              <Typography variant="body2" color="text.disabled">
                Not set
              </Typography>
            ) : (
              <Typography variant="body2" fontWeight={600}>
                ${effective}/h{call.rateOverride !== null ? ' (special)' : ''}
              </Typography>
            )}
          </Field>
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: '1fr 1fr', pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Field label="Expected price">
            {call.expectedPrice === null ? (
              <Typography variant="body2" color="text.disabled">
                {effective === null ? 'Needs a rate' : 'After the call (rate × real duration)'}
              </Typography>
            ) : (
              <Tooltip title={`$${effective}/h × ${call.actualDurationMinutes} min`}>
                <Typography variant="body2" fontWeight={600}>
                  {formatUsd(call.expectedPrice)}
                </Typography>
              </Tooltip>
            )}
          </Field>
          <Field label="Real income">
            {call.realIncome === null ? (
              <Typography variant="body2" color="text.disabled">
                Entered when paid to bank
              </Typography>
            ) : (
              <Typography variant="body2" fontWeight={600}>
                {formatUsd(call.realIncome)}
                {call.expectedPrice !== null && call.realIncome !== call.expectedPrice && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
                    ({formatUsd(call.realIncome - call.expectedPrice)})
                  </Typography>
                )}
              </Typography>
            )}
          </Field>
        </Box>
        {call.permissions.editIncome && call.status === 'process_to_bank' && <RealIncomeEditor call={call} />}
        {call.permissions.editRate && (
          <Stack direction="row" spacing={1.5} alignItems="flex-start">
            <TextField
              label="Special rate for this call"
              type="number"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              error={!valid}
              helperText={valid ? 'Leave empty to use the platform rate' : 'Enter a rate of 0 or more'}
              slotProps={{ htmlInput: { min: 0, step: 50 } }}
              sx={{ maxWidth: 260 }}
            />
            <Button
              variant="outlined"
              sx={{ mt: 1 }}
              disabled={!dirty || !valid || update.isPending}
              onClick={() =>
                update.mutate(
                  { rateOverride: next },
                  { onSuccess: () => toast.success('Rate saved'), onError: (e) => toast.error(errorMessage(e)) },
                )
              }
            >
              {update.isPending ? <CircularProgress size={18} /> : 'Save'}
            </Button>
          </Stack>
        )}
      </Stack>
    </SectionCard>
  );
}

function CallReportCard({ call }: { call: CallDTO }) {
  if (!call.ninjaLink && call.rating === null && call.actualDurationMinutes === null) return null;
  return (
    <SectionCard title="Call">
      <Stack spacing={2}>
        {call.ninjaLink && (
          <Field label="Ninja link">
            <Button
              size="small"
              variant={call.status === 'ongoing' ? 'contained' : 'outlined'}
              startIcon={<VideocamRounded />}
              href={call.ninjaLink}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ mt: 0.5 }}
            >
              {call.status === 'ongoing' ? 'Join call' : 'Open link'}
            </Button>
          </Field>
        )}
        {call.actualDurationMinutes !== null && (
          <Field label="Actual duration">
            {call.actualDurationMinutes} minutes
            {call.actualDurationMinutes !== call.durationMinutes && (
              <Typography component="span" variant="body2" color="text.secondary">
                {' '}
                (booked {call.durationMinutes})
              </Typography>
            )}
          </Field>
        )}
        {call.rating !== null && (
          <Field label="How the call went">
            <Stack direction="row" spacing={1} alignItems="center">
              <Rating value={call.rating} readOnly size="small" />
              <Typography variant="body2" color="text.secondary">
                {RATING_LABELS[call.rating]}
              </Typography>
            </Stack>
            {call.feedback && (
              <Typography variant="body2" sx={{ mt: 0.75, whiteSpace: 'pre-wrap' }}>
                “{call.feedback}”
              </Typography>
            )}
          </Field>
        )}
      </Stack>
    </SectionCard>
  );
}

function HistoryTimeline({ call, zone }: { call: CallDetailDTO; zone: string }) {
  return (
    <SectionCard title="Status history">
      <Box sx={{ position: 'relative', pl: 2.5 }}>
        <Box sx={{ position: 'absolute', left: 3, top: 8, bottom: 8, width: '1px', bgcolor: 'divider' }} />
        {[...call.history].reverse().map((h) => (
            <Box key={h.id} sx={{ position: 'relative', pb: 2.25, '&:last-of-type': { pb: 0 } }}>
              <Box
                sx={{
                  position: 'absolute',
                  left: -20,
                  top: 6,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: STATUS_COLORS[h.toStatus],
                  boxShadow: (t) => `0 0 0 3px ${t.vars!.palette.background.paper}`,
                }}
              />
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="body2" fontWeight={500}>
                  {h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} → ${STATUS_LABELS[h.toStatus]}` : 'Created'}
                </Typography>
                {h.isOverride && <Chip size="small" label="Override" sx={{ height: 20, bgcolor: 'action.selected', color: 'text.secondary' }} />}
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <UserChip user={h.actor} size={20} />
                <Tooltip title={formatDateTime(h.createdAt, zone)}>
                  <Typography variant="caption" color="text.secondary">
                    {relativeTime(h.createdAt)}
                  </Typography>
                </Tooltip>
              </Stack>
              {h.comment && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                  “{h.comment}”
                </Typography>
              )}
            </Box>
        ))}
      </Box>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------

export default function CallDetailPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const { zone } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [reassign, setReassign] = useState<'associate' | 'expert' | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const { data: call, isLoading, error, refetch } = useQuery({
    queryKey: qk.calls.detail(id),
    queryFn: () => api.calls.get(id),
    enabled: Boolean(id),
  });

  // Join the call room while the screen is open (§7.2).
  useEffect(() => (id ? joinCallRoom(socket, id) : undefined), [id]);

  if (error) {
    return isApiError(error) && error.status === 404 ? (
      <EmptyState
        title="Call not found"
        description="It may not exist, or it is not visible to your role."
        action={<Button onClick={() => navigate('/calls')}>Back to calls</Button>}
      />
    ) : (
      <ErrorState error={error} onRetry={refetch} />
    );
  }
  if (isLoading || !call) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={180} />
        <Skeleton variant="rounded" height={320} />
      </Stack>
    );
  }

  const expertZone = call.expert?.timeZone ?? null;
  const perms = call.permissions;

  return (
    <>
      <Button
        size="small"
        startIcon={<ArrowBackRounded />}
        color="inherit"
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/calls'))}
        sx={{ mb: 1.5, ml: -1, color: 'text.secondary' }}
      >
        Back
      </Button>

      <Card sx={{ mb: 2.5, overflow: 'hidden' }}>
        <CardContent sx={{ p: { xs: 2, md: 3 }, '&:last-child': { pb: { xs: 2, md: 3 } } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} justifyContent="space-between">
            <Stack direction="row" spacing={2} alignItems="flex-start" sx={{ minWidth: 0 }}>
              <UserAvatar avatarId={call.profile.avatarId} photoId={call.profile.photoId} label={call.profile.name} size={56} />
              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="h5" component="h1">
                    {call.profile.name}
                  </Typography>
                  <StatusChip status={call.status} size="medium" testId="call-status" />
                  {call.profile.linkedinUrl && (
                    <Tooltip title="LinkedIn">
                      <IconButton size="small" component="a" href={call.profile.linkedinUrl} target="_blank" rel="noopener noreferrer">
                        <LinkedIn sx={{ fontSize: 18, color: 'text.secondary' }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {call.profile.briefExperience}
                </Typography>
                <Link
                  component="button"
                  variant="body2"
                  underline="hover"
                  onClick={() => setProfileOpen(true)}
                  sx={{ mt: 0.75, display: 'inline-flex', alignItems: 'center', gap: 0.5, fontWeight: 500 }}
                >
                  <BadgeOutlined sx={{ fontSize: 16 }} /> View profile details
                </Link>
                <Stack direction="row" spacing={1} sx={{ mt: 1.25 }} flexWrap="wrap" useFlexGap alignItems="center">
                  <Typography variant="body2" fontWeight={500}>
                    {call.platform.name}
                  </Typography>
                  <Typography variant="body2" color="text.disabled">
                    ·
                  </Typography>
                  <Typography variant="body2">
                    {formatDateTime(call.scheduledAt, zone)} · {call.durationMinutes} min
                  </Typography>
                </Stack>
              </Box>
            </Stack>
            <Stack spacing={1} alignItems={{ xs: 'flex-start', md: 'flex-end' }} sx={{ flexShrink: 0 }}>
              <TransitionBar call={call} />
            </Stack>
          </Stack>
          <Box sx={{ mt: 3 }}>
            <StatusProgress status={call.status} role={me.role} />
          </Box>
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.4fr) minmax(360px, 1fr)' }, alignItems: 'start' }}>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          <SectionCard
            title="Details"
            action={
              perms.edit && (
                <Button size="small" color="inherit" startIcon={<EditRounded />} onClick={() => setEditing(true)} sx={{ color: 'text.secondary' }}>
                  Edit
                </Button>
              )
            }
          >
            <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <Field label={`Time (${zoneCity(zone)})`}>{formatDateTime(call.scheduledAt, zone)}</Field>
              <Field label="Duration">
                {call.durationMinutes} minutes · ends {inZone(call.endsAt, zone).toFormat('h:mm a')}
              </Field>
              {expertZone && expertZone !== zone && (
                <Field label={`Expert's local time (${zoneCity(expertZone)})`}>
                  {formatDateTime(call.scheduledAt, expertZone)}
                </Field>
              )}
              <Field label="Platform associate">{call.platformAssociateName}</Field>
              <Box sx={{ gridColumn: '1 / -1' }}>
                <Field label="Project details">
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {call.projectDetails}
                  </Typography>
                </Field>
              </Box>
              {call.notes && (
                <Box sx={{ gridColumn: '1 / -1' }}>
                  <Field label="Internal notes">
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {call.notes}
                    </Typography>
                  </Field>
                </Box>
              )}
              <Field label="Created">
                {formatDateTime(call.createdAt, zone)} by {call.createdBy.nickname}
              </Field>
              <Field label="Last updated">{relativeTime(call.updatedAt)}</Field>
            </Box>
          </SectionCard>

          <SectionCard title="People">
            <Stack spacing={1.5}>
              {(
                [
                  ['Associate', call.associate, perms.reassignAssociate ? 'associate' : null],
                  ['Expert', call.expert, perms.reassignExpert ? 'expert' : null],
                  ['Manager', call.manager, null],
                ] as const
              ).map(([label, user, kind]) => (
                <Stack key={label} direction="row" alignItems="center" spacing={2}>
                  <Typography variant="body2" color="text.secondary" sx={{ width: 84 }}>
                    {label}
                  </Typography>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <UserChip user={user} size={30} showRole={false} />
                  </Box>
                  {user && <RoleBadge role={user.role} />}
                  {kind && (
                    <Tooltip title={user ? `Change ${label.toLowerCase()}` : `Assign ${label.toLowerCase()}`}>
                      <IconButton size="small" onClick={() => setReassign(kind)}>
                        <SwapHorizRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              ))}
            </Stack>
            {!call.expert && call.allowedTransitions.includes('scheduled') && (
              <Alert severity="info" sx={{ mt: 2 }} action={perms.reassignExpert ? <Button color="inherit" size="small" onClick={() => setReassign('expert')}>Assign</Button> : undefined}>
                Assign an Expert before scheduling this call.
              </Alert>
            )}
          </SectionCard>

          {(me.role === 'founder' || me.role === 'expert') && <GptLinkCard call={call} />}
          {me.role !== 'expert' && <RateCard call={call} />}


          {FEATURES.messages && (
            <>
              <CallReportCard call={call} />
              <HistoryTimeline call={call} zone={zone} />
            </>
          )}
        </Stack>

        <Stack spacing={2.5} sx={{ position: { lg: 'sticky' }, top: { lg: 120 }, minWidth: 0 }}>
          {FEATURES.messages ? (
            <MessageThread callId={call.id} zone={zone} />
          ) : (
            <>
              <CallReportCard call={call} />
              <HistoryTimeline call={call} zone={zone} />
            </>
          )}
        </Stack>
      </Box>

      <ProfileDetailsDialog profileId={profileOpen ? call.profile.id : null} onClose={() => setProfileOpen(false)} />

      <EditDetailsDialog call={call} open={editing} onClose={() => setEditing(false)} />
      <ReassignDialog call={call} kind={reassign ?? 'expert'} open={Boolean(reassign)} onClose={() => setReassign(null)} />
    </>
  );
}
