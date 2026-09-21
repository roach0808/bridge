import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DEFAULT_MANAGER_SHARE_PERCENT, type ProfileDTO, type UserRef } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useMe } from '@/auth/AuthProvider';
import { Field } from '@/components/common';
import { UserAvatar, UserChip } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';

function useSaveProfile() {
  const queryClient = useQueryClient();
  return (saved: ProfileDTO) => {
    queryClient.setQueryData(qk.profiles.detail(saved.id), saved);
    void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
  };
}

/**
 * Who may look after a Profile, for the person handing it on: anyone who runs
 * calls for the Founder; for a Manager, themselves and their own team.
 */
function useCandidates(enabled: boolean): { data: UserRef[]; isLoading: boolean } {
  const me = useMe();
  const founder = me.role === 'founder';
  const all = useQuery({
    queryKey: qk.users.list({ active: 'true', scope: 'profile-associates' }),
    queryFn: () => api.users.list({ active: 'true' }),
    enabled: enabled && founder,
  });
  const team = useQuery({ queryKey: qk.users.team, queryFn: api.users.team, enabled: enabled && me.role === 'manager' });
  if (founder) {
    return { data: (all.data ?? []).filter((u) => u.role === 'associate' || u.role === 'manager'), isLoading: all.isLoading };
  }
  return { data: [me, ...(team.data ?? []).filter((u) => u.isActive)], isLoading: team.isLoading };
}

/** The Associate (or Manager) who looks after the Profile, and a way to hand it on. */
export function ProfileAssociateField({ profile }: { profile: ProfileDTO }) {
  const me = useMe();
  const toast = useToast();
  const save = useSaveProfile();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(profile.associate?.id ?? null);
  useEffect(() => {
    if (open) setSelected(profile.associate?.id ?? null);
  }, [open, profile.associate?.id]);
  const candidates = useCandidates(open);
  const options = candidates.data;
  const value = options.find((o) => o.id === selected) ?? null;

  const mutation = useMutation({
    mutationFn: (associateId: string | null) => api.profiles.setAssociate(profile.id, associateId),
    onSuccess: (saved) => {
      save(saved);
      toast.success(saved.associate ? `${saved.name} is now looked after by ${saved.associate.nickname}` : `${saved.name} has nobody looking after it`);
      setOpen(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Field label="Looked after by">
      <Stack direction="row" spacing={0.5} alignItems="center">
        {profile.associate ? (
          <UserChip user={profile.associate} size={24} showRole={false} />
        ) : (
          <Typography variant="body2" color="text.disabled">
            Nobody yet
          </Typography>
        )}
        {profile.canAssign && (
          <Tooltip title={profile.associate ? 'Hand to another Associate' : 'Choose who looks after it'}>
            <IconButton size="small" onClick={() => setOpen(true)} aria-label="Change who looks after this profile">
              <SwapHorizRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <Dialog open={open} onClose={() => !mutation.isPending && setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Who looks after {profile.name}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {me.role === 'manager'
              ? 'You can hand it to yourself or to an Associate on your team.'
              : 'Any Associate or Manager can look after a profile.'}
          </Typography>
          <Autocomplete
            options={options}
            loading={candidates.isLoading}
            value={value}
            onChange={(_, v) => setSelected(v?.id ?? null)}
            getOptionLabel={(o) => (o.id === me.id ? `${o.nickname} (you)` : o.nickname)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderOption={({ key, ...props }, o) => (
              <li key={key} {...props}>
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <UserAvatar avatarId={o.avatarId} photoId={o.photoId} label={o.nickname} size={26} />
                  <span>{o.id === me.id ? `${o.nickname} (you)` : o.nickname}</span>
                </Stack>
              </li>
            )}
            renderInput={(params) => <TextField {...params} label="Associate" autoFocus />}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {me.role === 'founder' && profile.associate && (
            <Button color="inherit" onClick={() => setSelected(null)} sx={{ mr: 'auto' }}>
              Nobody
            </Button>
          )}
          <Button color="inherit" onClick={() => setOpen(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={mutation.isPending || selected === (profile.associate?.id ?? null) || (selected === null && me.role !== 'founder')}
            onClick={() => mutation.mutate(selected)}
          >
            {mutation.isPending ? <CircularProgress size={18} color="inherit" /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Field>
  );
}

/**
 * The Manager's share of this Profile's real income (§3.1): the Founder sets it
 * (15% unless changed), Managers read it. Calls already paid keep theirs.
 */
export function ManagerShareField({ profile }: { profile: ProfileDTO }) {
  const me = useMe();
  const toast = useToast();
  const save = useSaveProfile();
  const share = profile.managerSharePercent;
  const [draft, setDraft] = useState(share === null ? '' : String(share));
  useEffect(() => setDraft(share === null ? '' : String(share)), [share]);
  const mutation = useMutation({
    mutationFn: (managerSharePercent: number) => api.profiles.update(profile.id, { managerSharePercent }),
    onSuccess: (saved) => {
      save(saved);
      toast.success(`Manager share for ${saved.name} is now ${saved.managerSharePercent}%`);
    },
    onError: (err) => {
      toast.error(errorMessage(err));
      setDraft(share === null ? '' : String(share));
    },
  });
  if (share === null) return null;

  if (me.role !== 'founder') {
    return (
      <Field label="Manager share">
        <Typography variant="body2">{share}% of real income</Typography>
      </Field>
    );
  }
  const n = Number(draft);
  const valid = draft.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100;
  const commit = () => {
    if (!valid) return setDraft(String(share));
    const next = Math.round(n * 100) / 100;
    if (next !== share) mutation.mutate(next);
  };
  return (
    <Field label="Manager share">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          size="small"
          variant="standard"
          type="number"
          value={draft}
          error={!valid}
          disabled={mutation.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setDraft(String(share));
          }}
          slotProps={{
            input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
            htmlInput: { min: 0, max: 100, step: 1, style: { width: 48 }, 'aria-label': 'Manager share' },
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          of real income{share !== DEFAULT_MANAGER_SHARE_PERCENT ? ` (usually ${DEFAULT_MANAGER_SHARE_PERCENT}%)` : ''}
        </Typography>
      </Box>
    </Field>
  );
}
