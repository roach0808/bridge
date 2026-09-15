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
  FEATURES,
  MAX_ACTUAL_DURATION_MINUTES,
  STATUS_LABELS,
  edgeOwner,
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
import { formatDateTime, formatMoney, inZone, relativeTime, zoneAbbr, zoneCity } from '@/lib/time';
import { AVAILABILITY_LABEL, availabilityFor, useExpertsAround } from './expertAvailability';
import { MessageThread } from './MessageThread';
import { StatusProgress } from './StatusProgress';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'KRW', 'JPY', 'SGD', 'CNY', 'AUD', 'CAD'];

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
  // Starting needs the Ninja link; finishing needs the real duration and a rating.
  const [ninjaLink, setNinjaLink] = useState('');
  const [actualMinutes, setActualMinutes] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [ratingHover, setRatingHover] = useState(-1);
  const [feedback, setFeedback] = useState('');

  const open = (to: CallStatus) => {
    setTarget(to);
    setComment('');
    setNinjaLink(call.ninjaLink ?? '');
    setActualMinutes(String(call.durationMinutes));
    setRating(null);
    setFeedback('');
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
  const ready =
    target === 'ongoing' ? linkValid : target === 'finished' ? minutesValid && rating !== null : true;

  const confirm = () => {
    if (!target || !ready) return;
    transition.mutate({
      to: target,
      comment: comment.trim() || undefined,
      ...(target === 'ongoing' ? { ninjaLink: ninjaLink.trim() } : {}),
      ...(target === 'finished'
        ? { actualDurationMinutes: minutes, rating: rating ?? undefined, feedback: feedback.trim() || undefined }
        : {}),
    });
  };

  if (!call.allowedTransitions.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {call.status === 'process_to_bank' ? 'This call is complete.' : 'No actions for you at this stage.'}
      </Typography>
    );
  }

  return (
    <>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap justifyContent={{ md: 'flex-end' }}>
        {call.allowedTransitions.map((to) => {
          const override = edgeOwner(call.status, to) !== me.role;
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
                  {backwards ? 'Needs rescheduling' : `Mark ${STATUS_LABELS[to].toLowerCase()}`}
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
            <DialogTitle>Move to {STATUS_LABELS[target]}?</DialogTitle>
            <DialogContent>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <StatusChip status={call.status} />
                <Typography color="text.secondary">→</Typography>
                <StatusChip status={target} />
              </Stack>
              {edgeOwner(call.status, target) !== me.role && (
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
                  <>
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
                    <Box>
                      <Typography variant="body2" fontWeight={500} id="call-rating-label">
                        How did the call go? *
                      </Typography>
                      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.5 }}>
                        <Rating
                          name="call-rating"
                          aria-labelledby="call-rating-label"
                          value={rating}
                          max={5}
                          size="large"
                          onChange={(_, v) => setRating(v)}
                          onChangeActive={(_, v) => setRatingHover(v)}
                        />
                        <Typography variant="body2" color="text.secondary">
                          {RATING_LABELS[ratingHover !== -1 ? ratingHover : (rating ?? 0)] ?? ''}
                        </Typography>
                      </Stack>
                      {errors.rating && (
                        <Typography variant="caption" color="error">
                          {errors.rating}
                        </Typography>
                      )}
                    </Box>
                    <TextField
                      label="Anything to add? (optional)"
                      placeholder="e.g. The call went well — the client wants a follow-up next month."
                      multiline
                      minRows={2}
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                    />
                  </>
                )}
                {target !== 'finished' && (
                  <TextField
                    label="Comment (optional)"
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

function InvoiceCard({ call }: { call: CallDTO }) {
  const toast = useToast();
  const update = useUpdateCall(call);
  const [amount, setAmount] = useState(call.invoiceAmount ?? '');
  const [currency, setCurrency] = useState(call.invoiceCurrency ?? 'USD');
  useEffect(() => {
    setAmount(call.invoiceAmount ?? '');
    setCurrency(call.invoiceCurrency ?? 'USD');
  }, [call.invoiceAmount, call.invoiceCurrency]);
  const dirty = amount !== (call.invoiceAmount ?? '') || (amount !== '' && currency !== (call.invoiceCurrency ?? 'USD'));

  return (
    <SectionCard title="Invoice">
      <Stack spacing={2}>
        <Stack direction="row" spacing={1}>
          <TextField
            label="Amount"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
          />
          <TextField select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} sx={{ width: 120 }}>
            {CURRENCIES.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <Button
          variant="outlined"
          disabled={!dirty || update.isPending}
          onClick={() =>
            update.mutate(
              { invoiceAmount: amount === '' ? null : Number(amount), invoiceCurrency: amount === '' ? null : currency },
              { onSuccess: () => toast.success('Invoice saved'), onError: (e) => toast.error(errorMessage(e)) },
            )
          }
        >
          {update.isPending ? <CircularProgress size={18} /> : 'Save invoice'}
        </Button>
        <Typography variant="caption" color="text.secondary">
          Current: {formatMoney(call.invoiceAmount, call.invoiceCurrency)}
        </Typography>
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
            <StatusProgress status={call.status} />
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

          {me.role === 'founder' && ['finished', 'invoice_submit', 'invoice_approve', 'process_to_bank'].includes(call.status) && (
            <InvoiceCard call={call} />
          )}
          {me.role !== 'founder' && call.invoiceAmount && (
            <SectionCard title="Invoice">
              <Typography variant="h5">{formatMoney(call.invoiceAmount, call.invoiceCurrency)}</Typography>
            </SectionCard>
          )}

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
