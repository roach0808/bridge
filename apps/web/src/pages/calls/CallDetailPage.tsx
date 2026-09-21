import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import CancelOutlined from '@mui/icons-material/CancelOutlined';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import BadgeOutlined from '@mui/icons-material/BadgeOutlined';
import VideocamRounded from '@mui/icons-material/VideocamRounded';
import LinkedIn from '@mui/icons-material/LinkedIn';
import ManageSearchRounded from '@mui/icons-material/ManageSearchRounded';
import PaidOutlined from '@mui/icons-material/PaidOutlined';
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
  PAYEE_LABELS,
  STATUS_LABELS,
  edgeOwner,
  isOverride,
  type CallDetailDTO,
  type CallDTO,
  type CallStatus,
  type Payee,
  type TransitionInput,
  type UpdateCallInput,
  type UserRef,
} from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { ConfirmDialog, EmptyState, ErrorState, Field } from '@/components/common';
import { ProfileDetailsDialog } from '@/components/ProfileDetails';
import { RoleBadge, UserAvatar, UserChip } from '@/components/identity';
import { STATUS_COLORS, StatusChip } from '@/components/StatusChip';
import { useToast } from '@/components/ToastProvider';
import { api, socket } from '@/lib/api';
import { errorMessage, fieldErrors, isApiError } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { patchCallInCache } from '@/realtime/RealtimeProvider';
import { durationLabel, formatDateTime, formatUsd, inZone, relativeTime, soon, timeOfDay, whenLabel, zoneAbbr, zoneCity } from '@/lib/time';
import { useCallOwners } from './callOwners';
import { AVAILABILITY_LABEL, availabilityFor, useExpertsAround } from './expertAvailability';
import { MessageThread } from './MessageThread';
import { MoneyPill, PaidMark, callMoney, formatPercent } from './money';
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

  // §6.10: an invoice for a Profile with no open bank account cannot be paid out.
  const noBank = call.allowedTransitions.includes('invoice_submit') && call.bankReady === false;

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
  const cancelling = target === 'cancelled';
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

  // Cancelling is not a step along the way; it gets its own quiet button.
  const forward = call.allowedTransitions.filter((t) => t !== 'cancelled');

  if (!call.allowedTransitions.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {call.status === 'cancelled'
          ? 'This call was cancelled.'
          : call.status === 'process_to_bank' || (me.role === 'expert' && call.status === 'finished')
            ? 'This call is complete.'
            : 'No actions for you at this stage.'}
      </Typography>
    );
  }

  return (
    <>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ md: 'flex-end' }} alignItems="center">
        {forward.map((to) => {
          const override = isOverride(me.role, call.status, to, { isCallAssociate: call.associate.id === me.id });
          const backwards = to === 'on_rescheduling';
          // One primary action: the first forward move. Everything else stays quiet.
          const primary = !backwards && to === forward.find((t) => t !== 'on_rescheduling');
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
        {call.allowedTransitions.includes('cancelled') && (
          <Tooltip title="Call it off: the time is freed and the call earns nothing">
            <span>
              <Button
                size="small"
                color="error"
                startIcon={<CancelOutlined />}
                disabled={transition.isPending}
                onClick={() => open('cancelled')}
                sx={{ color: 'error.main' }}
              >
                Cancel call
              </Button>
            </span>
          </Tooltip>
        )}
      </Stack>
      <Dialog open={Boolean(target)} onClose={() => !transition.isPending && setTarget(null)} maxWidth="xs" fullWidth>
        {target && (
          <>
            <DialogTitle>
              {target === 'confirmed'
                ? 'Confirm this call?'
                : expertReschedule
                  ? 'Request rescheduling?'
                  : cancelling
                    ? `Cancel the call with ${call.profile.name}?`
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
              {(target === 'confirmed' || target === 'ongoing') && me.role === 'expert' && (
                <Alert
                  severity={call.gptLink ? 'success' : 'warning'}
                  icon={<ManageSearchRounded />}
                  sx={{ mb: 2 }}
                  action={
                    call.gptLink ? (
                      <Button color="inherit" size="small" href={call.gptLink} target="_blank" rel="noopener noreferrer">
                        Open
                      </Button>
                    ) : undefined
                  }
                >
                  {call.gptLink
                    ? 'Prepare with the deep search data before the call.'
                    : 'The deep search data for this call is not there yet; the Founder adds it before the call.'}
                </Alert>
              )}
              {cancelling && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <strong>This cannot be undone.</strong> The call is called off for good
                  {call.expert ? `, ${call.expert.nickname}’s time is freed` : ''} and it earns nothing. Everyone on the
                  call is told. To keep it and find another time, use “Needs rescheduling” instead.
                </Alert>
              )}
              {target === 'invoice_submit' && noBank && (
                <Alert
                  severity="warning"
                  sx={{ mb: 2 }}
                  action={
                    <Button color="inherit" size="small" href={`/profiles/${call.profile.id}`} target="_blank" rel="noopener">
                      Profile
                    </Button>
                  }
                >
                  <strong>{call.profile.name} has no bank account yet.</strong> The invoice can be submitted, but nothing
                  can be paid out until bank details are added.
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
              {isOverride(me.role, call.status, target, { isCallAssociate: call.associate.id === me.id }) && (
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
                    helperText={errors.ninjaLink ?? (ninjaLink !== '' && !linkValid ? 'Enter a full link starting with https://' : 'Only the Expert and the Founder can see it')}
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
                    label={expertReschedule ? 'Reason for rescheduling' : cancelling ? 'Why is it cancelled? (optional)' : 'Comment (optional)'}
                    required={expertReschedule}
                    placeholder={
                      expertReschedule
                        ? 'e.g. A conflict came up — I can do Thursday afternoon instead.'
                        : cancelling
                          ? 'e.g. The client called it off.'
                          : undefined
                    }
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
                {cancelling ? 'Keep the call' : 'Cancel'}
              </Button>
              <Button
                variant="contained"
                color={cancelling ? 'error' : 'primary'}
                disabled={transition.isPending || !ready}
                onClick={confirm}
              >
                {transition.isPending ? <CircularProgress size={18} color="inherit" /> : cancelling ? 'Cancel call' : 'Confirm'}
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
  const associates = useCallOwners(open && kind === 'associate');

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
      : associates.data;
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

/**
 * The deep search data the Expert prepares the call with (§9.1): the Founder
 * adds the link while the call is being prepared, the Expert reads it.
 */
function DeepSearchCard({ call }: { call: CallDTO }) {
  const toast = useToast();
  const update = useUpdateCall(call);
  const [link, setLink] = useState(call.gptLink ?? '');
  useEffect(() => setLink(call.gptLink ?? ''), [call.gptLink]);
  const editable = call.permissions.editGptLink;
  const trimmed = link.trim();
  const valid = trimmed === '' || /^https?:\/\/\S+$/i.test(trimmed);
  const dirty = trimmed !== (call.gptLink ?? '');

  return (
    <SectionCard title="Deep search data">
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
        What the Expert reads to prepare for the call. Only the Founder and the Expert can see this.
      </Typography>
      {editable ? (
        <Stack spacing={1.5}>
          <TextField
            label="Link"
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            error={!valid}
            helperText={valid ? 'Paste the link to the deep search for this call' : 'Enter a full link starting with https://'}
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
        <Button variant="contained" startIcon={<ManageSearchRounded />} href={call.gptLink} target="_blank" rel="noopener noreferrer">
          Open deep search data
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
  // A cancelled call is never paid for, whatever the rate says.
  const cancelled = call.status === 'cancelled';

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
                {cancelled ? 'None — cancelled' : effective === null ? 'Needs a rate' : 'After the call (rate × real duration)'}
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
                {cancelled ? 'None — cancelled' : 'Entered when paid to bank'}
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
        {call.permissions.editRate && !cancelled && (
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

/** One person's pay on the call, with the button to mark it for whoever pays it. */
function PayoutRow({
  call,
  payee,
  who,
  detail,
  amount,
  paidAt,
  zone,
  extra,
}: {
  call: CallDTO;
  payee: Payee;
  who: UserRef | null;
  detail: string;
  amount: number | null;
  paidAt: string | null;
  zone: string;
  extra?: ReactNode;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useMe();
  const mark = useMutation({
    mutationFn: (paid: boolean) => api.finance.markPaid({ payee, callIds: [call.id], paid }),
    onSuccess: (_, paid) => {
      void queryClient.invalidateQueries({ queryKey: qk.calls.all });
      toast.success(paid ? `Marked paid to ${who?.nickname ?? PAYEE_LABELS[payee]}` : 'Marked not paid');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const canMark = call.payouts.canMark.includes(payee);
  const mine = who?.id === me.id;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr auto', sm: 'minmax(0, 1fr) auto auto' }, gap: 1.5, alignItems: 'center', py: 1.25 }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="caption" color="text.secondary" sx={{ width: 76, flexShrink: 0 }}>
            {PAYEE_LABELS[payee]}
          </Typography>
          {who ? <UserChip user={who} size={22} showRole={false} /> : <Typography variant="body2" color="text.secondary">Nobody</Typography>}
          {mine && (
            <Typography variant="caption" color="primary.main" fontWeight={600}>
              you
            </Typography>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25, pl: { sm: '84px' } }}>
          {detail}
        </Typography>
        {extra}
      </Box>
      <Stack alignItems="flex-end" spacing={0.25}>
        <Typography variant="body1" fontWeight={650} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {amount === null ? '—' : formatUsd(amount)}
        </Typography>
        {amount !== null && <PaidMark line={{ amount, paidAt }} zone={zone} />}
      </Stack>
      {canMark ? (
        <Button
          size="small"
          variant={paidAt ? 'text' : 'outlined'}
          color={paidAt ? 'inherit' : 'primary'}
          disabled={mark.isPending}
          onClick={() => mark.mutate(!paidAt)}
          sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, justifySelf: { xs: 'start', sm: 'end' }, whiteSpace: 'nowrap', color: paidAt ? 'text.secondary' : undefined }}
        >
          {mark.isPending ? <CircularProgress size={16} color="inherit" /> : paidAt ? 'Mark not paid' : 'Mark paid'}
        </Button>
      ) : (
        <Box sx={{ display: { xs: 'none', sm: 'block' } }} />
      )}
    </Box>
  );
}

/** Founder: the Expert's rate on this call, fixed when it finished, correctable until the Expert is paid. */
function ExpertRateEditor({ call }: { call: CallDTO }) {
  const toast = useToast();
  const update = useUpdateCall(call);
  const current = call.payouts.expert?.rate ?? null;
  const text = (r: number | null) => (r === null ? '' : String(r));
  const [value, setValue] = useState(text(current));
  useEffect(() => setValue(text(current)), [current]);
  const empty = value.trim() === '';
  const n = Number(value);
  const valid = empty || (Number.isFinite(n) && n >= 0 && n <= MAX_PLATFORM_RATE);
  const next = empty ? null : Math.round(n * 100) / 100;
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, pl: { sm: '84px' } }}>
      <TextField
        size="small"
        label="Rate for this call ($/h)"
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={!valid}
        slotProps={{ htmlInput: { min: 0, step: 5 } }}
        sx={{ width: 180 }}
      />
      <Button
        size="small"
        variant="outlined"
        disabled={!valid || next === current || update.isPending}
        onClick={() =>
          update.mutate({ expertRate: next }, { onSuccess: () => toast.success('Expert rate saved'), onError: (e) => toast.error(errorMessage(e)) })
        }
      >
        {update.isPending ? <CircularProgress size={16} /> : 'Save'}
      </Button>
    </Stack>
  );
}

/**
 * Who is paid what for this call (§3.1), as far as the viewer may know: the
 * Founder pays the Expert and the Manager, the Manager passes the Associate's
 * part on. Each line says whether it has been paid.
 */
function PayoutsCard({ call, zone }: { call: CallDTO; zone: string }) {
  const me = useMe();
  const { expert, manager, associate } = call.payouts;
  const took = ['finished', 'invoice_submit', 'invoice_approve', 'process_to_bank'].includes(call.status);
  const waitingForBank = took && call.status !== 'process_to_bank' && (me.role === 'manager' || me.role === 'associate');
  if (!expert && !manager && !associate && !waitingForBank) return null;

  return (
    <SectionCard title={me.role === 'expert' ? 'Your pay' : 'Payouts'} action={<PaidOutlined sx={{ fontSize: 20, color: 'text.secondary' }} />}>
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
        {expert && (
          <PayoutRow
            call={call}
            payee="expert"
            who={expert.user}
            amount={expert.amount}
            paidAt={expert.paidAt}
            zone={zone}
            detail={
              expert.rate === null
                ? 'No hourly rate yet — set it on the Expert, or for this call below'
                : `${formatUsd(expert.rate)}/h × ${expert.minutes ?? '—'} min, the rate when the call finished`
            }
            extra={call.permissions.editExpertRate ? <ExpertRateEditor call={call} /> : undefined}
          />
        )}
        {manager && (
          <PayoutRow
            call={call}
            payee="manager"
            who={manager.user}
            amount={manager.amount}
            paidAt={manager.paidAt}
            zone={zone}
            detail={`${formatPercent(manager.percent)} of the real income${
              associate && manager.keeps !== null ? ` — ${formatUsd(manager.keeps)} to keep after the Associate’s part` : ''
            }`}
          />
        )}
        {associate && (
          <PayoutRow
            call={call}
            payee="associate"
            who={associate.user}
            amount={associate.amount}
            paidAt={associate.paidAt}
            zone={zone}
            detail={`${formatPercent(associate.percent)} of the real income, paid by the Manager out of their share`}
          />
        )}
        {waitingForBank && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 1.25 }}>
            {me.role === 'manager' ? 'Your share' : 'Your part'} is worked out from the real income once this call is paid to bank.
          </Typography>
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
  const [deleting, setDeleting] = useState(false);
  const queryClient = useQueryClient();
  const pageToast = useToast();

  // Someone else deleted this call while it was open: leave the page.
  const deletingHere = useRef(false);
  useEffect(() => {
    const onDeleted = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id || deletingHere.current) return;
      pageToast.info('This call was deleted');
      navigate('/calls', { replace: true });
    };
    window.addEventListener('god:call-deleted', onDeleted);
    return () => window.removeEventListener('god:call-deleted', onDeleted);
  }, [id, navigate, pageToast]);

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
  const money = callMoney(call, me.role);
  const preparing = ['on_scheduling', 'scheduled', 'confirmed', 'on_rescheduling', 'ongoing'].includes(call.status);

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
                  <Tooltip title={formatDateTime(call.scheduledAt, zone)}>
                    <Typography variant="body2" fontWeight={soon(call.scheduledAt) ? 600 : 400}>
                      {whenLabel(call.scheduledAt, zone)} · {durationLabel(call.durationMinutes)}
                    </Typography>
                  </Tooltip>
                  {money && (
                    <>
                      <Typography variant="body2" color="text.disabled">
                        ·
                      </Typography>
                      <MoneyPill money={money} />
                    </>
                  )}
                </Stack>
              </Box>
            </Stack>
            <Stack spacing={1} alignItems={{ xs: 'flex-start', md: 'flex-end' }} sx={{ flexShrink: 0 }}>
              <TransitionBar call={call} />
              {me.role === 'founder' && (
                <Button size="small" color="error" startIcon={<DeleteOutlineRounded />} onClick={() => setDeleting(true)}>
                  Delete call
                </Button>
              )}
            </Stack>
          </Stack>
          <Box sx={{ mt: 3 }}>
            <StatusProgress status={call.status} role={me.role} />
          </Box>
        </CardContent>
      </Card>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.4fr) minmax(360px, 1fr)' }, alignItems: 'start' }}>
        <Stack spacing={2.5} sx={{ minWidth: 0 }}>
          {/* While the call is being prepared, the deep search data comes first. */}
          {(me.role === 'founder' || me.role === 'expert') && preparing && <DeepSearchCard call={call} />}
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
              <Field label={`Time (${zoneCity(zone)})`}>
                <Tooltip title={formatDateTime(call.scheduledAt, zone)}>
                  <Typography variant="body2">{whenLabel(call.scheduledAt, zone)}</Typography>
                </Tooltip>
              </Field>
              <Field label="Platform">{call.platform.name}</Field>
              {money && (
                <Field label={money.label}>
                  <Tooltip title={money.hint}>
                    <Typography variant="body2" fontWeight={650} sx={{ color: money.color }}>
                      {money.value}
                    </Typography>
                  </Tooltip>
                </Field>
              )}
              <Field label="Duration">
                {durationLabel(call.durationMinutes)} · ends {timeOfDay(call.endsAt, zone)}
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

          <PayoutsCard call={call} zone={zone} />
          {me.role !== 'expert' && <RateCard call={call} />}
          {(me.role === 'founder' || me.role === 'expert') && !preparing && <DeepSearchCard call={call} />}


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
      <ConfirmDialog
        open={deleting}
        title={`Delete the call with ${call.profile.name}?`}
        description="The call is removed for good, with its status history, messages and the notifications about it. Statistics and income stop counting it. This cannot be undone."
        confirmLabel="Delete call"
        destructive
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          deletingHere.current = true;
          await api.calls.remove(call.id).catch((err: unknown) => {
            deletingHere.current = false;
            throw err;
          });
          queryClient.removeQueries({ queryKey: qk.calls.detail(call.id) });
          void queryClient.invalidateQueries({ queryKey: qk.calls.all });
          void queryClient.invalidateQueries({ queryKey: qk.calendar.all });
          void queryClient.invalidateQueries({ queryKey: qk.dashboard });
          pageToast.success('Call deleted');
          navigate('/calls', { replace: true });
        }}
      />
    </>
  );
}
