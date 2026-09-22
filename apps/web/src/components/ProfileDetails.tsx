import CloseRounded from '@mui/icons-material/CloseRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
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
  type ProfileStatus,
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

/** Green where the Profile is registered, red where it is not (a red ring where it is banned). */
export const PLATFORM_REGISTRATION_COLORS: Record<PlatformRegistration, string> = {
  not_registered: '#dc4a4a',
  registered: '#3fb68b',
  banned: '#dc4a4a',
};

/** A Profile's standing on one platform at a glance: a green or red dot, named on hover. */
export function PlatformDot({ status, size = 10 }: { status: PlatformRegistration; size?: number }) {
  return (
    <Tooltip title={PLATFORM_REGISTRATION_LABELS[status]}>
      <Box
        component="span"
        aria-label={PLATFORM_REGISTRATION_LABELS[status]}
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          flexShrink: 0,
          display: 'inline-block',
          boxSizing: 'border-box',
          ...(status === 'banned'
            ? { border: 2, borderColor: PLATFORM_REGISTRATION_COLORS.banned, bgcolor: 'transparent' }
            : { bgcolor: PLATFORM_REGISTRATION_COLORS[status] }),
        }}
      />
    </Tooltip>
  );
}

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

/**
 * Inline editor for one profile × platform status: the Founder, the Associate
 * looking after the Profile and their Manager (`profile.canEditPlatforms`).
 */
export function PlatformStatusSelect({
  profile,
  platformId,
  status,
}: {
  profile: Pick<ProfileDTO, 'id' | 'name'>;
  platformId: string;
  status: PlatformRegistration;
}) {
  const mutation = useSetPlatform(profile.id, platformId);
  const value = mutation.isPending && mutation.variables?.status ? mutation.variables.status : status;
  return (
    <Select
      size="small"
      variant="standard"
      disableUnderline
      value={value}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate({ status: e.target.value as PlatformRegistration })}
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
}: {
  profile: Pick<ProfileDTO, 'id' | 'name'>;
  platformId: string;
  rate: number | null;
}) {
  const mutation = useSetPlatform(profile.id, platformId);
  const text = (r: number | null) => (r === null ? '' : String(r));
  const [draft, setDraft] = useState(text(rate));
  useEffect(() => setDraft(text(rate)), [rate]);
  const empty = draft.trim() === '';
  const value = Number(draft);
  const valid = empty || (Number.isFinite(value) && value >= 0 && value <= MAX_PLATFORM_RATE);

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

export const PROFILE_STATUS_META: Record<ProfileStatus, { label: string; color: string }> = {
  pending: { label: 'Pending review', color: '#e0913a' },
  approved: { label: 'Approved', color: '#3fb68b' },
  rejected: { label: 'Rejected', color: '#dc4a4a' },
};

export function ProfileStatusChip({ status }: { status: ProfileStatus }) {
  const meta = PROFILE_STATUS_META[status];
  return <DotPill color={meta.color}>{meta.label}</DotPill>;
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

/**
 * One platform: its dot and name, folded. Unfolded it says where the Profile
 * stands and at what rate, and the Founder changes either there.
 */
function PlatformRow({
  profile,
  entry: { platform, status, rate },
}: {
  profile: ProfileDTO;
  entry: NonNullable<ProfileDTO['platformStatuses']>[number];
}) {
  const role = useMe().role;
  const [open, setOpen] = useState(false);
  return (
    <Box>
      <Stack
        component="button"
        type="button"
        direction="row"
        spacing={1}
        alignItems="center"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        sx={{
          width: '100%',
          border: 0,
          bgcolor: 'transparent',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
          py: 1,
          px: 0.5,
          borderRadius: 1,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <PlatformDot status={status} />
        <Typography variant="body2" fontWeight={status === 'registered' ? 600 : 400} noWrap sx={{ flex: 1 }}>
          {platform.name}
        </Typography>
        <ExpandMoreRounded sx={{ fontSize: 18, color: 'text.secondary', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
      </Stack>
      {open && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center', pl: 3.5, pr: 0.5, pb: 1.25 }}>
          <Field label="Status">
            {profile.canEditPlatforms ? (
              <PlatformStatusSelect profile={profile} platformId={platform.id} status={status} />
            ) : (
              <PlatformStatusChip status={status} />
            )}
          </Field>
          {/* The rate is the Founder's to set; Associates never see what a Profile earns. */}
          {role !== 'associate' && (
            <Field label="Rate">
              {role === 'founder' ? (
                <PlatformRateField profile={profile} platformId={platform.id} rate={rate} />
              ) : (
                <Typography variant="body2" color={rate === null ? 'text.disabled' : 'text.primary'}>
                  {rate === null ? 'No rate' : formatRate(rate)}
                </Typography>
              )}
            </Field>
          )}
        </Box>
      )}
    </Box>
  );
}

export function ProfileDetailsBody({ profile: p }: { profile: ProfileDTO }) {
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
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Expert network platforms
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
              Green: registered · red: not registered. Click a platform for its status
              {p.canEditPlatforms ? ', which you can change' : ''}.
            </Typography>
            {p.platformStatuses.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No platforms yet.
              </Typography>
            ) : (
              <Stack divider={<Divider flexItem />}>
                {p.platformStatuses.map((s) => (
                  <PlatformRow key={s.platform.id} profile={p} entry={s} />
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
