import CloseRounded from '@mui/icons-material/CloseRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import LinkedIn from '@mui/icons-material/LinkedIn';
import LockOutlined from '@mui/icons-material/LockOutlined';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  TextField,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  MAX_PLATFORM_RATE,
  PLATFORM_REGISTRATIONS,
  PLATFORM_REGISTRATION_LABELS,
  type PlatformRegistration,
  type ProfileDTO,
} from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useState, type ReactNode } from 'react';
import { useMe } from '@/auth/AuthProvider';
import { BanksDialog } from '@/components/BanksDialog';
import { ErrorState, Field } from '@/components/common';
import { UserAvatar } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';

export function DotPill({ color, children }: { color: string; children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        height: 22,
        px: 1,
        borderRadius: 999,
        bgcolor: 'action.selected',
        fontSize: '0.72rem',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />
      {children}
    </Box>
  );
}

export const PLATFORM_REGISTRATION_COLORS: Record<PlatformRegistration, string> = {
  not_registered: '#9aa0a6',
  registered: '#3fb68b',
  banned: '#dc4a4a',
};

export function PlatformStatusChip({ status }: { status: PlatformRegistration }) {
  return <DotPill color={PLATFORM_REGISTRATION_COLORS[status]}>{PLATFORM_REGISTRATION_LABELS[status]}</DotPill>;
}

const rateFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
/** A platform rate for display, e.g. "$1,000/h". */
export const formatRate = (rate: number) => `${rateFormat.format(rate).replace(/\.00$/, '')}/h`;

function useSetPlatform(profileId: string, platformId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (body: { status?: PlatformRegistration; rate?: number | null }) => api.profiles.setPlatform(profileId, platformId, body),
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.profiles.detail(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Founder-only inline editor for one profile × platform status. */
export function PlatformStatusSelect({
  profile,
  platformId,
  status,
  rate,
}: {
  profile: Pick<ProfileDTO, 'id' | 'name'>;
  platformId: string;
  status: PlatformRegistration;
  /** Needed to mark the Profile registered. */
  rate?: number | null;
}) {
  const toast = useToast();
  const mutation = useSetPlatform(profile.id, platformId);
  const value = mutation.isPending && mutation.variables?.status ? mutation.variables.status : status;
  return (
    <Select
      size="small"
      variant="standard"
      disableUnderline
      value={value}
      disabled={mutation.isPending}
      onChange={(e) => {
        const next = e.target.value as PlatformRegistration;
        if (next === 'registered' && rate == null) {
          toast.error('Set the hourly rate first — you can change it later');
          return;
        }
        mutation.mutate({ status: next });
      }}
      renderValue={(v) => <PlatformStatusChip status={v} />}
      inputProps={{ 'aria-label': `${profile.name} platform status` }}
      sx={{ '& .MuiSelect-select': { py: 0.25, display: 'flex', alignItems: 'center' } }}
    >
      {PLATFORM_REGISTRATIONS.map((s) => (
        <MenuItem key={s} value={s}>
          <PlatformStatusChip status={s} />
        </MenuItem>
      ))}
    </Select>
  );
}

/** Founder-only inline editor for a Profile's rate on one platform; saves on Enter or when leaving the field. */
export function PlatformRateField({
  profile,
  platformId,
  rate,
  registered,
}: {
  profile: Pick<ProfileDTO, 'id' | 'name'>;
  platformId: string;
  rate: number | null;
  /** A registered Profile must keep a rate, so the field cannot be cleared. */
  registered?: boolean;
}) {
  const mutation = useSetPlatform(profile.id, platformId);
  const text = (r: number | null) => (r === null ? '' : String(r));
  const [draft, setDraft] = useState(text(rate));
  useEffect(() => setDraft(text(rate)), [rate]);
  const empty = draft.trim() === '';
  const value = Number(draft);
  const valid = empty ? !registered : Number.isFinite(value) && value >= 0 && value <= MAX_PLATFORM_RATE;

  const save = () => {
    if (!valid) return setDraft(text(rate));
    const next = empty ? null : Math.round(value * 100) / 100;
    if (next !== rate) mutation.mutate({ rate: next });
  };

  return (
    <TextField
      size="small"
      variant="standard"
      type="number"
      value={draft}
      error={!valid}
      disabled={mutation.isPending}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(text(rate));
      }}
      slotProps={{
        input: {
          disableUnderline: false,
          startAdornment: <InputAdornment position="start">$</InputAdornment>,
          endAdornment: <InputAdornment position="end">/h</InputAdornment>,
        },
        htmlInput: { min: 0, step: 50, placeholder: 'not set', 'aria-label': `${profile.name} rate`, style: { width: 64 } },
      }}
    />
  );
}

/** Founder-only: take a Profile out of use, or bring it back. */
export function ProfileActiveToggle({ profile, size = 'small' }: { profile: ProfileDTO; size?: 'small' | 'medium' }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => api.profiles.setActive(profile.id, !profile.isActive),
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.profiles.detail(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
      toast.success(saved.isActive ? `“${saved.name}” is active again` : `“${saved.name}” deactivated — only Founders see it now`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Button size={size} color="inherit" disabled={mutation.isPending} onClick={() => mutation.mutate()} sx={{ color: 'text.secondary' }}>
      {mutation.isPending ? <CircularProgress size={14} /> : profile.isActive ? 'Deactivate' : 'Activate'}
    </Button>
  );
}

export function DeactivatedPill() {
  return <DotPill color="#9aa0a6">Deactivated</DotPill>;
}

function ageOf(dateOfBirth: string): number {
  return Math.floor(-DateTime.fromISO(dateOfBirth).diffNow('years').years);
}

function TextBlock({ label, text }: { label: string; text: string | null }) {
  return (
    <Field label={label}>
      <Typography
        variant="body2"
        color={text ? 'text.primary' : 'text.disabled'}
        sx={{ whiteSpace: 'pre-wrap', fontStyle: text ? 'normal' : 'italic' }}
      >
        {text || 'Not provided'}
      </Typography>
    </Field>
  );
}

function ProfileDetailsBody({ profile: p }: { profile: ProfileDTO }) {
  const isFounder = useMe().role === 'founder';
  const [banksOpen, setBanksOpen] = useState(false);
  const dash = <Typography component="span" variant="body2" color="text.disabled">—</Typography>;
  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
        <Field label="Date of birth">
          {p.dateOfBirth ? `${DateTime.fromISO(p.dateOfBirth).toFormat('LLL d, yyyy')} (${ageOf(p.dateOfBirth)})` : dash}
        </Field>
        <Field label="Gender">{p.gender ?? dash}</Field>
        <Field label="Nationality">{p.nationality ?? dash}</Field>
        <Field label="Location">{p.location ?? dash}</Field>
      </Box>
      {p.platformStatuses && (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
          <Field label="Email">{p.email ?? dash}</Field>
          <Field label="Phone">{p.phone ?? dash}</Field>
          <Field label="Onboarded">{p.onboardedAt ? DateTime.fromISO(p.onboardedAt).toFormat('LLL d, yyyy') : dash}</Field>
        </Box>
      )}
      <TextBlock label="Brief experience" text={p.briefExperience} />
      <TextBlock label="Career history" text={p.careerHistory} />
      <TextBlock label="Education" text={p.education} />

      {isFounder && (
        <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: 'background.subtle', border: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1.25 }}>
            <LockOutlined sx={{ fontSize: 15, color: 'text.secondary' }} />
            <Typography variant="caption" color="text.secondary" fontWeight={600}>
              Private — only Founders see this
            </Typography>
          </Stack>
          <Stack spacing={1.75}>
            <Field label={p.addresses?.length === 1 ? 'Address' : 'Addresses'}>
              {p.addresses?.length ? (
                <Stack spacing={0.75}>
                  {p.addresses.map((a) => (
                    <Box key={a.id}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600} component="div">
                        {a.label}
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {a.address}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.disabled" fontStyle="italic">
                  Not provided
                </Typography>
              )}
            </Field>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Field label="Bank details">
                {p.bankCount ? `${p.bankCount} bank account${p.bankCount === 1 ? '' : 's'}` : 'None added'}
              </Field>
              <Button size="small" variant="outlined" onClick={() => setBanksOpen(true)}>
                {p.bankCount ? 'View & edit' : 'Add bank'}
              </Button>
            </Stack>
          </Stack>
          <BanksDialog profile={p} open={banksOpen} onClose={() => setBanksOpen(false)} startAdding={!p.bankCount} />
        </Box>
      )}

      {p.platformStatuses && (
        <>
          <Divider />
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Expert network platforms
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              Rate per hour on each platform. Required to mark a Profile registered, and editable at any time afterwards. Not shown to Experts.
            </Typography>
            {p.platformStatuses.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No platforms yet.
              </Typography>
            ) : (
              <Stack divider={<Divider flexItem />}>
                {p.platformStatuses.map(({ platform, status, rate }) => (
                  <Stack key={platform.id} direction="row" alignItems="center" spacing={2} sx={{ py: 0.75, minHeight: 40 }}>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {platform.name}
                    </Typography>
                    {isFounder ? (
                      <>
                        <PlatformRateField profile={p} platformId={platform.id} rate={rate} registered={status === 'registered'} />
                        <PlatformStatusSelect profile={p} platformId={platform.id} status={status} rate={rate} />
                      </>
                    ) : (
                      <>
                        <Typography variant="body2" color={rate === null ? 'text.disabled' : 'text.secondary'}>
                          {rate === null ? 'No rate' : formatRate(rate)}
                        </Typography>
                        <PlatformStatusChip status={status} />
                      </>
                    )}
                  </Stack>
                ))}
              </Stack>
            )}
          </Box>
        </>
      )}
    </Stack>
  );
}

/**
 * Detailed view of a profile. Experts get the personal details and history;
 * other roles also see the profile's status on each expert network platform.
 */
export function ProfileDetailsDialog({
  profileId,
  onClose,
  onEdit,
}: {
  profileId: string | null;
  onClose: () => void;
  onEdit?: (profile: ProfileDTO) => void;
}) {
  const query = useQuery({
    queryKey: qk.profiles.detail(profileId ?? ''),
    queryFn: () => api.profiles.get(profileId!),
    enabled: Boolean(profileId),
  });
  const p = query.data;

  return (
    <Dialog open={Boolean(profileId)} onClose={onClose} maxWidth="sm" fullWidth scroll="paper">
      <Stack direction="row" spacing={2} alignItems="center" sx={{ px: 3, pt: 2.5, pb: 1.5 }}>
        {p ? (
          <UserAvatar avatarId={p.avatarId} photoId={p.photoId} label={p.name} size={56} />
        ) : (
          <Skeleton variant="circular" width={56} height={56} />
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="h6" component="h2" noWrap>
              {p ? p.name : <Skeleton width={180} />}
            </Typography>
            {p?.linkedinUrl && (
              <Tooltip title="Open LinkedIn">
                <IconButton size="small" component="a" href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
                  <LinkedIn sx={{ fontSize: 18, color: 'text.secondary' }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" color="text.secondary">
              Profile details
            </Typography>
            {p && !p.isActive && <DeactivatedPill />}
          </Stack>
        </Box>
        <IconButton onClick={onClose} aria-label="Close">
          <CloseRounded />
        </IconButton>
      </Stack>
      <DialogContent dividers>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : p ? (
          <ProfileDetailsBody profile={p} />
        ) : (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress size={24} />
          </Stack>
        )}
      </DialogContent>
      {p && onEdit && (
        <DialogActions sx={{ px: 3, py: 1.5, justifyContent: 'space-between' }}>
          <ProfileActiveToggle profile={p} />
          <Button startIcon={<EditOutlined />} onClick={() => onEdit(p)}>
            Edit profile
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
