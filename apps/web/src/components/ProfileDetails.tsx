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
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  PLATFORM_REGISTRATIONS,
  PLATFORM_REGISTRATION_LABELS,
  type PlatformRegistration,
  type ProfileDTO,
} from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
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

/** Founder-only inline editor for one profile × platform cell. */
export function PlatformStatusSelect({
  profile,
  platformId,
  status,
}: {
  profile: Pick<ProfileDTO, 'id' | 'name'>;
  platformId: string;
  status: PlatformRegistration;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (next: PlatformRegistration) => api.profiles.setPlatformStatus(profile.id, platformId, next),
    onSuccess: (saved) => {
      queryClient.setQueryData(qk.profiles.detail(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const value = mutation.isPending && mutation.variables ? mutation.variables : status;
  return (
    <Select
      size="small"
      variant="standard"
      disableUnderline
      value={value}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as PlatformRegistration)}
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
            <TextBlock label="Current address" text={p.currentAddress} />
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
            {p.platformStatuses.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No platforms yet.
              </Typography>
            ) : (
              <Stack divider={<Divider flexItem />}>
                {p.platformStatuses.map(({ platform, status }) => (
                  <Stack key={platform.id} direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 0.75, minHeight: 40 }}>
                    <Typography variant="body2">{platform.name}</Typography>
                    {isFounder ? (
                      <PlatformStatusSelect profile={p} platformId={platform.id} status={status} />
                    ) : (
                      <PlatformStatusChip status={status} />
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
          <Typography variant="body2" color="text.secondary">
            Profile details
          </Typography>
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
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button startIcon={<EditOutlined />} onClick={() => onEdit(p)}>
            Edit profile
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}
