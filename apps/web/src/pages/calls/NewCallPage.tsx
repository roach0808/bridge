import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import LinkedIn from '@mui/icons-material/LinkedIn';
import PersonOffRounded from '@mui/icons-material/PersonOffRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import {
  Autocomplete,
  Box,
  Button,
  ButtonBase,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { CALL_DURATIONS, type ExpertColumn, type ProfileDTO, type UserDTO } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { PageHeader } from '@/components/common';
import { UserAvatar } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { zoneAbbr, zoneCity } from '@/lib/time';
import { expertColor } from '@/theme/theme';
import { AVAILABILITY_LABEL, availabilityFor, useExpertsAround, type ExpertAvailability } from './expertAvailability';

const flag = (cc: string) =>
  cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';

function Step({ n, title, subtitle, children }: { n: number; title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
        <Stack direction="row" spacing={1.25} alignItems="flex-start" sx={{ mb: 2 }}>
          <Box
            sx={{
              width: 22,
              height: 22,
              mt: '1px',
              flexShrink: 0,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 600,
              fontSize: 12,
              bgcolor: 'action.selected',
              color: 'text.secondary',
            }}
          >
            {n}
          </Box>
          <Box>
            <Typography variant="subtitle1" component="h2" lineHeight={1.5}>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}

const AVAILABILITY_DOT: Record<ExpertAvailability['state'], string> = {
  free: 'success.main',
  call: 'error.main',
  busy: 'error.main',
  time_off: 'warning.main',
  outside_hours: 'warning.main',
};

const optionSx = (selected: boolean) => ({
  display: 'block',
  textAlign: 'left',
  width: '100%',
  p: 1.5,
  borderRadius: '10px',
  border: '1px solid',
  borderColor: selected ? 'text.secondary' : 'divider',
  bgcolor: selected ? 'action.hover' : 'transparent',
  transition: 'border-color .15s, background-color .15s',
  '&:hover': { bgcolor: 'action.hover' },
});

function ExpertOption({
  column,
  start,
  selected,
  onSelect,
  end,
}: {
  column: ExpertColumn;
  start: string;
  end: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const availability = availabilityFor(column, start, end);
  const local = DateTime.fromISO(start).setZone(column.expert.timeZone);
  const color = expertColor(column.slot);
  const hour = local.hour;
  const unsocial = hour < 7 || hour >= 22;
  return (
    <ButtonBase
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      sx={optionSx(selected)}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        <UserAvatar avatarId={column.expert.avatarId} photoId={column.expert.photoId} label={column.expert.nickname} size={34} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
            <Typography variant="body2" fontWeight={550} noWrap>
              {column.expert.nickname}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div">
            {local.toFormat('ccc h:mm a')} {local.toFormat('ZZZZ')} · {zoneCity(column.expert.timeZone)}
            {unsocial && (
              <Box component="span" sx={{ color: 'warning.main' }}>
                {' · unsocial hour'}
              </Box>
            )}
          </Typography>
        </Box>
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            height: 24,
            px: 1,
            borderRadius: 999,
            bgcolor: 'action.selected',
            fontSize: '0.75rem',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: AVAILABILITY_DOT[availability.state] }} />
          {availability.state === 'call' ? `Call: ${availability.label}` : AVAILABILITY_LABEL[availability.state]}
        </Box>
      </Stack>
    </ButtonBase>
  );
}

interface FormState {
  profile: ProfileDTO | null;
  platformId: string;
  associateId: string | null;
  platformAssociateName: string;
  projectDetails: string;
  notes: string;
  date: DateTime | null;
  time: DateTime | null;
  durationMinutes: number;
  expertId: string | null;
}

export default function NewCallPage() {
  const me = useMe();
  const { zone } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();

  const initial = useMemo<FormState>(() => {
    const startParam = params.get('start');
    const start = startParam ? DateTime.fromISO(startParam).setZone(zone) : null;
    const validStart = start?.isValid ? start : null;
    const duration = Number(params.get('duration'));
    return {
      profile: null,
      platformId: '',
      associateId: null,
      platformAssociateName: '',
      projectDetails: '',
      notes: '',
      date: validStart,
      time: validStart,
      durationMinutes: (CALL_DURATIONS as readonly number[]).includes(duration) ? duration : 60,
      expertId: params.get('expertId'),
    };
  }, [params, zone]);
  const [form, setForm] = useState<FormState>(initial);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const profiles = useQuery({ queryKey: qk.profiles.list({ status: 'approved' }), queryFn: () => api.profiles.list({ status: 'approved' }) });
  const platforms = useQuery({ queryKey: qk.platforms, queryFn: api.platforms.list });
  const needsAssociate = me.role === 'founder' || me.role === 'manager';
  const associates = useQuery<UserDTO[]>({
    queryKey: me.role === 'manager' ? qk.users.team : qk.users.list({ role: 'associate', active: 'true' }),
    queryFn: () => (me.role === 'manager' ? api.users.team() : api.users.list({ role: 'associate', active: 'true' })),
    enabled: needsAssociate,
  });

  const start = useMemo(() => {
    if (!form.date?.isValid || !form.time?.isValid) return null;
    const dt = DateTime.fromObject(
      { year: form.date.year, month: form.date.month, day: form.date.day, hour: form.time.hour, minute: form.time.minute },
      { zone },
    );
    return dt.isValid ? dt : null;
  }, [form.date, form.time, zone]);
  const startIso = start?.toUTC().toISO() ?? null;
  const endIso = start?.plus({ minutes: form.durationMinutes }).toUTC().toISO() ?? null;
  const experts = useExpertsAround(startIso, endIso, me.role);
  const selectedExpert = experts.data?.experts.find((c) => c.expert.id === form.expertId) ?? null;

  const create = useMutation({
    mutationFn: () =>
      api.calls.create({
        profileId: form.profile!.id,
        platformId: form.platformId,
        associateId: needsAssociate ? form.associateId : undefined,
        expertId: form.expertId,
        scheduledAt: startIso!,
        durationMinutes: form.durationMinutes,
        projectDetails: form.projectDetails,
        platformAssociateName: form.platformAssociateName,
        notes: form.notes || null,
      }),
    onSuccess: (call) => {
      void queryClient.invalidateQueries({ queryKey: qk.calls.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.calendar.all });
      toast.success('Call created');
      navigate(`/calls/${call.id}`, { replace: true });
    },
    onError: (err) => {
      setConfirm(null);
      toast.error(errorMessage(err));
    },
  });
  const errors = fieldErrors(create.error);

  const missing: string[] = [];
  if (!form.profile) missing.push('profile');
  if (!form.platformId) missing.push('platform');
  if (needsAssociate && !form.associateId) missing.push('associate');
  if (!form.platformAssociateName.trim()) missing.push('platform associate');
  if (!form.projectDetails.trim()) missing.push('project details');
  if (!start) missing.push('date and time');

  /** §9.1: ask before saving when the time is today, past, clashing or in time off. */
  const warnings = (): string[] => {
    if (!start) return [];
    const out: string[] = [];
    const now = DateTime.now().setZone(zone);
    if (start < now) out.push('The start time is in the past.');
    else if (start.hasSame(now, 'day')) out.push('The call is today.');
    if (selectedExpert && startIso && endIso) {
      const a = availabilityFor(selectedExpert, startIso, endIso);
      if (a.state === 'call' || a.state === 'busy') out.push(`${selectedExpert.expert.nickname} already has a call at that time.`);
      if (a.state === 'time_off') out.push(`${selectedExpert.expert.nickname} is on time off then.`);
      if (a.state === 'outside_hours') out.push(`That is outside ${selectedExpert.expert.nickname}'s working hours.`);
    }
    return out;
  };

  const submit = () => {
    if (missing.length) return;
    const w = warnings();
    if (w.length) setConfirm(w);
    else create.mutate();
  };

  const sortedExperts = useMemo(() => {
    const cols = experts.data?.experts ?? [];
    if (!startIso || !endIso) return cols;
    const rank = (c: ExpertColumn) => (availabilityFor(c, startIso, endIso).state === 'free' ? 0 : 1);
    return [...cols].sort((a, b) => rank(a) - rank(b) || a.slot - b.slot);
  }, [experts.data, startIso, endIso]);

  return (
    <>
      <PageHeader
        title="New call"
        subtitle="Starts in On scheduling. The Expert can change until it’s scheduled. Fields marked * are required."
        actions={
          <Button variant="outlined" color="inherit" startIcon={<CalendarMonthRounded />} component={RouterLink} to="/calendar?expert=all">
            All experts calendar
          </Button>
        }
      />

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 320px' }, alignItems: 'start' }}>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Step n={1} title="Profile *" subtitle="Approved, active profiles only. Ask the Founder to add someone new.">
            <Autocomplete
              options={(profiles.data ?? []).filter((p) => p.isActive)}
              loading={profiles.isLoading}
              value={form.profile}
              onChange={(_, v) => set('profile', v)}
              getOptionLabel={(p) => p.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              filterOptions={(opts, { inputValue }) => {
                const q = inputValue.toLowerCase();
                return opts.filter((o) => o.name.toLowerCase().includes(q) || o.briefExperience.toLowerCase().includes(q));
              }}
              renderOption={({ key, ...props }, p) => (
                <li key={key} {...props}>
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 0.5, minWidth: 0 }}>
                    <UserAvatar avatarId={p.avatarId} photoId={p.photoId} label={p.name} size={36} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={500}>
                        {p.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div" noWrap sx={{ maxWidth: 520 }}>
                        {p.briefExperience}
                      </Typography>
                    </Box>
                  </Stack>
                </li>
              )}
              renderInput={(p) => <TextField {...p} label="Profile" required placeholder="Search by name or experience" error={Boolean(errors.profileId)} helperText={errors.profileId} autoFocus />}
            />
            {form.profile && (
              <Stack direction="row" spacing={1.5} sx={{ mt: 2, p: 1.5, borderRadius: '10px', bgcolor: 'background.subtle' }}>
                <UserAvatar avatarId={form.profile.avatarId} photoId={form.profile.photoId} label={form.profile.name} size={40} />
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" fontWeight={550}>
                      {form.profile.name}
                    </Typography>
                    {form.profile.linkedinUrl && (
                      <a href={form.profile.linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
                        <LinkedIn sx={{ fontSize: 16, color: 'text.secondary', display: 'block' }} />
                      </a>
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {form.profile.briefExperience}
                  </Typography>
                </Box>
              </Stack>
            )}
          </Step>

          <Step n={2} title="Project *">
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <TextField
                select
                label="Platform"
                required
                value={form.platformId}
                onChange={(e) => set('platformId', e.target.value)}
                error={Boolean(errors.platformId)}
                helperText={errors.platformId}
              >
                {(platforms.data ?? []).map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <span>{flag(p.country)}</span>
                      <span>{p.name}</span>
                      <Typography component="span" variant="caption" color="text.secondary">
                        #{p.priority}
                      </Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Platform associate"
                required
                value={form.platformAssociateName}
                onChange={(e) => set('platformAssociateName', e.target.value)}
                error={Boolean(errors.platformAssociateName)}
                helperText={errors.platformAssociateName ?? "The platform's own staff contact, not our Associate"}
              />
              {needsAssociate && (
                <Autocomplete
                  sx={{ gridColumn: '1 / -1' }}
                  options={(associates.data ?? []).filter((a) => a.isActive)}
                  loading={associates.isLoading}
                  value={(associates.data ?? []).find((a) => a.id === form.associateId) ?? null}
                  onChange={(_, v) => set('associateId', v?.id ?? null)}
                  getOptionLabel={(a) => a.nickname}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  renderOption={({ key, ...props }, a) => (
                    <li key={key} {...props}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <UserAvatar avatarId={a.avatarId} photoId={a.photoId} label={a.nickname} size={24} />
                        <span>{a.nickname}</span>
                        {me.role === 'founder' && a.manager && (
                          <Typography variant="caption" color="text.secondary">
                            · {a.manager.nickname}&apos;s team
                          </Typography>
                        )}
                      </Stack>
                    </li>
                  )}
                  renderInput={(p) => (
                    <TextField {...p} label="Associate" required helperText={errors.associateId ?? 'Owns scheduling for this call'} error={Boolean(errors.associateId)} />
                  )}
                />
              )}
              <TextField
                sx={{ gridColumn: '1 / -1' }}
                label="Project details"
                required
                multiline
                minRows={4}
                value={form.projectDetails}
                onChange={(e) => set('projectDetails', e.target.value)}
                error={Boolean(errors.projectDetails)}
                helperText={errors.projectDetails ?? 'The project brief from the platform'}
              />
              <TextField
                sx={{ gridColumn: '1 / -1' }}
                label="Internal notes (optional)"
                multiline
                minRows={2}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Box>
          </Step>

          <Step n={3} title="When *" subtitle={`Team time · ${zoneCity(zone)} (${zoneAbbr(zone, start ?? DateTime.now())})`}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
              <DatePicker
                label={`Date (${zoneAbbr(zone)})`}
                value={form.date}
                timezone={zone}
                onChange={(v) => set('date', v)}
                slotProps={{ textField: { fullWidth: true, size: 'small', error: Boolean(errors.scheduledAt), helperText: errors.scheduledAt } }}
              />
              <TimePicker
                label={`Start time (${zoneAbbr(zone)})`}
                value={form.time}
                timezone={zone}
                minutesStep={15}
                onChange={(v) => set('time', v)}
                slotProps={{ textField: { fullWidth: true, size: 'small' } }}
              />
              <Box sx={{ gridColumn: '1 / -1' }}>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                  Duration
                </Typography>
                <ToggleButtonGroup exclusive fullWidth size="small" value={form.durationMinutes} onChange={(_, v) => v && set('durationMinutes', v)}>
                  {CALL_DURATIONS.map((d) => (
                    <ToggleButton key={d} value={d}>
                      {d} min
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Box>
            </Box>
            {start && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                {start.toFormat('cccc, LLLL d · h:mm a')} – {start.plus({ minutes: form.durationMinutes }).toFormat('h:mm a ZZZZ')}
              </Typography>
            )}
          </Step>

          <Step n={4} title="Expert" subtitle="Optional for now. Free Experts are listed first.">
            {!start ? (
              <Typography variant="body2" color="text.secondary">
                Pick a date and time to see each Expert&apos;s local time and availability.
              </Typography>
            ) : experts.isLoading ? (
              <Stack spacing={1}>
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} variant="rounded" height={66} />
                ))}
              </Stack>
            ) : (
              <Stack spacing={1} role="radiogroup" aria-label="Expert">
                <ButtonBase
                  onClick={() => set('expertId', null)}
                  role="radio"
                  aria-checked={!form.expertId}
                  sx={{ ...optionSx(!form.expertId), display: 'flex', justifyContent: 'flex-start', gap: 1.5 }}
                >
                  <Box sx={{ width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center', bgcolor: 'action.selected' }}>
                    <PersonOffRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
                  </Box>
                  <Typography variant="body2" fontWeight={550}>
                    Decide later
                  </Typography>
                </ButtonBase>
                {sortedExperts.map((col) => (
                  <ExpertOption
                    key={col.expert.id}
                    column={col}
                    start={startIso!}
                    end={endIso!}
                    selected={form.expertId === col.expert.id}
                    onSelect={() => set('expertId', col.expert.id)}
                  />
                ))}
              </Stack>
            )}
          </Step>
        </Stack>

        <Card sx={{ position: { lg: 'sticky' }, top: { lg: 120 } }}>
          <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
            <Typography variant="subtitle1" component="h2" sx={{ mb: 2 }}>
              Summary
            </Typography>
            <Stack spacing={1.25}>
              <SummaryRow label="Profile" value={form.profile?.name} />
              <SummaryRow label="Platform" value={platforms.data?.find((p) => p.id === form.platformId)?.name} />
              {needsAssociate && <SummaryRow label="Associate" value={associates.data?.find((a) => a.id === form.associateId)?.nickname} />}
              <SummaryRow label="When" value={start ? `${start.toFormat('LLL d, h:mm a ZZZZ')} · ${form.durationMinutes}m` : undefined} />
              <SummaryRow
                label="Expert"
                value={
                  selectedExpert
                    ? `${selectedExpert.expert.nickname} · ${DateTime.fromISO(startIso!).setZone(selectedExpert.expert.timeZone).toFormat('h:mm a ZZZZ')}`
                    : 'Decide later'
                }
              />
            </Stack>
            {missing.length > 0 && (
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2 }}>
                Still needed: {missing.join(', ')}
              </Typography>
            )}
            <Button fullWidth variant="contained" sx={{ mt: 2.5, minHeight: 40 }} disabled={missing.length > 0 || create.isPending} onClick={submit}>
              {create.isPending ? <CircularProgress size={22} color="inherit" /> : 'Create call'}
            </Button>
            <Button fullWidth color="inherit" sx={{ mt: 1 }} onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      </Box>

      <Dialog open={Boolean(confirm)} onClose={() => !create.isPending && setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Create this call anyway?</DialogTitle>
        <DialogContent>
          <List dense disablePadding>
            {confirm?.map((w) => (
              <ListItem key={w} disableGutters>
                <ListItemIcon sx={{ minWidth: 34 }}>
                  <WarningAmberRounded color="warning" />
                </ListItemIcon>
                <ListItemText primary={w} />
              </ListItem>
            ))}
          </List>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            New calls are tentative, so a clash only blocks the call once it is scheduled.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button color="inherit" onClick={() => setConfirm(null)} disabled={create.isPending}>
            Go back
          </Button>
          <Button variant="contained" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <CircularProgress size={18} color="inherit" /> : 'Create call'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function SummaryRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        fontWeight={500}
        textAlign="right"
        sx={{ color: value ? 'text.primary' : 'text.disabled', minWidth: 0, wordBreak: 'break-word' }}
      >
        {value ?? '—'}
      </Typography>
    </Stack>
  );
}
