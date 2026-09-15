import LockRounded from '@mui/icons-material/LockRounded';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  Link,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useColorScheme,
} from '@mui/material';
import { AVATAR_CREDITS, ROLE_LABELS, TEAM_TIME_ZONE, avatarAudienceForRole, password as passwordSchema } from '@god/shared';
import { BrowserNotificationsSettings } from '@/components/BrowserNotifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { AvatarPicker } from '@/components/AvatarPicker';
import { PhotoUpload } from '@/components/PhotoUpload';
import { PageHeader } from '@/components/common';
import { RoleBadge, UserAvatar } from '@/components/identity';
import { TimeZoneSelect } from '@/components/TimeZoneSelect';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { zoneCity } from '@/lib/time';
import { PasswordField, useNow } from './adminShared';

function SectionCard({
  title,
  description,
  children,
  id,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  id: string;
}) {
  return (
    <Card component="section" aria-labelledby={id} sx={{ height: '100%' }}>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
        <Typography variant="subtitle1" component="h2" id={id} sx={{ mb: description ? 0.25 : 2 }}>
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            {description}
          </Typography>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

function ProfileSection() {
  const me = useMe();
  return (
    <SectionCard id="settings-profile" title="Profile">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
        <UserAvatar avatarId={me.avatarId} photoId={me.photoId} label={me.nickname} size={72} />
        <Stack spacing={1.5} sx={{ minWidth: 0, flex: 1 }}>
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="h6" component="p" sx={{ wordBreak: 'break-word' }}>
                {me.nickname}
              </Typography>
              <RoleBadge role={me.role} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              Nickname changes are approved by the Founder.
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" component="div">
              Email
            </Typography>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                {me.email}
              </Typography>
              <Tooltip title="Only you can see your email">
                <LockRounded sx={{ fontSize: 15, color: 'text.secondary' }} />
              </Tooltip>
            </Stack>
          </Box>
        </Stack>
      </Stack>
    </SectionCard>
  );
}

function AvatarSection() {
  const me = useMe();
  const { setUser } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [avatarId, setAvatarId] = useState(me.avatarId);
  useEffect(() => setAvatarId(me.avatarId), [me.avatarId]);

  const mutation = useMutation({
    mutationFn: (id: string) => api.auth.setAvatar(id),
    onSuccess: (updated) => {
      setUser(updated);
      queryClient.setQueryData(qk.me, updated);
      // Avatars appear across users, calls and messages.
      void queryClient.invalidateQueries({ queryKey: qk.users.all });
      toast.success('Avatar updated');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not update your avatar')),
  });

  const dirty = avatarId !== me.avatarId;

  return (
    <SectionCard
      id="settings-avatar"
      title="Avatar"
      description={`Upload a photo, or pick an illustration from the ${ROLE_LABELS[me.role]} set.`}
    >
      <Box sx={{ mb: 2.5 }}>
        <PhotoUpload
          avatarId={me.avatarId}
          photoId={me.photoId}
          label={me.nickname}
          onUpload={async (dataUrl) => {
            const updated = await api.auth.setPhoto(dataUrl);
            setUser(updated);
            void queryClient.invalidateQueries();
          }}
          onRemove={async () => {
            const updated = await api.auth.removePhoto();
            setUser(updated);
            void queryClient.invalidateQueries();
          }}
        />
      </Box>
      <AvatarPicker audience={avatarAudienceForRole(me.role)} value={avatarId} onChange={setAvatarId} size={52} />
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2.5 }}>
        <Button color="inherit" disabled={!dirty || mutation.isPending} onClick={() => setAvatarId(me.avatarId)}>
          Reset
        </Button>
        <Button variant="contained" disabled={!dirty || mutation.isPending} onClick={() => mutation.mutate(avatarId)} sx={{ minWidth: 120 }}>
          {mutation.isPending ? <CircularProgress size={18} color="inherit" /> : 'Save avatar'}
        </Button>
      </Stack>
    </SectionCard>
  );
}

function PasswordSection() {
  const me = useMe();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [general, setGeneral] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.auth.changePassword(current, next),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setErrors({});
      setGeneral(null);
      toast.success('Password changed');
    },
    onError: (err) => {
      const f = fieldErrors(err);
      if (f.current || f.next) {
        setErrors({ current: f.current, next: f.next });
        setGeneral(null);
      } else {
        setGeneral(errorMessage(err));
      }
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!current) errs.current = 'Enter your current password';
    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success) errs.next = parsed.error.issues[0]?.message;
    else if (next === current) errs.next = 'Choose a different password';
    if (confirm !== next) errs.confirm = 'Passwords don’t match';
    setErrors(errs);
    setGeneral(null);
    if (Object.keys(errs).length === 0) mutation.mutate();
  };

  const strength = next.length === 0 ? null : next.length < 10 ? 'short' : next.length < 14 ? 'ok' : 'strong';

  return (
    <SectionCard id="settings-password" title="Password" description="Use at least 10 characters.">
      <Box component="form" noValidate onSubmit={submit}>
        {/* Hidden username helps password managers associate the change. */}
        <input type="text" name="username" autoComplete="username" value={me.email} readOnly hidden />
        <Stack spacing={2}>
          <PasswordField
            label="Current password"
            value={current}
            onChange={(v) => {
              setCurrent(v);
              setErrors((e) => ({ ...e, current: undefined }));
            }}
            error={errors.current}
            autoComplete="current-password"
          />
          <PasswordField
            label="New password"
            value={next}
            onChange={(v) => {
              setNext(v);
              setErrors((e) => ({ ...e, next: undefined }));
            }}
            error={errors.next}
            helperText={
              strength === 'short'
                ? `${10 - next.length} more character${10 - next.length === 1 ? '' : 's'} needed`
                : strength === 'ok'
                  ? 'Good — longer is even better'
                  : strength === 'strong'
                    ? 'Strong password'
                    : 'At least 10 characters'
            }
          />
          <PasswordField
            label="Confirm new password"
            value={confirm}
            onChange={(v) => {
              setConfirm(v);
              setErrors((e) => ({ ...e, confirm: undefined }));
            }}
            error={errors.confirm}
          />
          {general && (
            <Typography variant="body2" color="error" role="alert">
              {general}
            </Typography>
          )}
          <Stack direction="row" justifyContent="flex-end">
            <Button
              type="submit"
              variant="contained"
              disabled={mutation.isPending || !current || !next || !confirm}
              sx={{ minWidth: 150 }}
            >
              {mutation.isPending ? <CircularProgress size={18} color="inherit" /> : 'Change password'}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </SectionCard>
  );
}

function TimeZoneSection() {
  const me = useMe();
  const { setUser } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [zone, setZone] = useState<string | null>(me.timeZone);
  useEffect(() => setZone(me.timeZone), [me.timeZone]);
  useNow(30_000);

  const mutation = useMutation({
    mutationFn: (z: string) => api.auth.setTimeZone(z),
    onSuccess: (updated) => {
      setUser(updated);
      queryClient.setQueryData(qk.me, updated);
      // Times across the app are rendered in this zone.
      void queryClient.invalidateQueries({ queryKey: qk.calendar.all });
      toast.success(`Time zone set to ${zoneCity(updated.timeZone)}`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not update your time zone')),
  });

  if (me.role !== 'expert') {
    const now = DateTime.now().setZone(TEAM_TIME_ZONE);
    return (
      <SectionCard id="settings-tz" title="Time zone">
        <Typography variant="body2">You work on team time (New York).</Typography>
        <Typography variant="caption" color="text.secondary">
          It’s {now.toFormat('ccc h:mm a ZZZZ')} there now. Only Experts set their own time zone.
        </Typography>
      </SectionCard>
    );
  }

  const preview = zone ? DateTime.now().setZone(zone) : null;
  const dirty = zone !== null && zone !== me.timeZone;

  return (
    <SectionCard
      id="settings-tz"
      title="Time zone"
      description="Your calendar and call times are shown in this zone."
    >
      <TimeZoneSelect value={zone} onChange={setZone} />
      {preview?.isValid && (
        <Box
          sx={{ mt: 2, p: 1.75, borderRadius: '10px', bgcolor: 'background.subtle' }}
          aria-live="polite"
        >
          <Typography variant="caption" color="text.secondary">
            Local time in {zoneCity(zone!)}
          </Typography>
          <Typography variant="h5" component="div" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {preview.toFormat('h:mm a')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {preview.toFormat('cccc, LLL d')} · {preview.toFormat('ZZZZ')} (UTC{preview.toFormat('ZZ')})
          </Typography>
        </Box>
      )}
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2.5 }}>
        <Button color="inherit" disabled={!dirty || mutation.isPending} onClick={() => setZone(me.timeZone)}>
          Reset
        </Button>
        <Button variant="contained" disabled={!dirty || mutation.isPending} onClick={() => zone && mutation.mutate(zone)} sx={{ minWidth: 140 }}>
          {mutation.isPending ? <CircularProgress size={18} color="inherit" /> : 'Save time zone'}
        </Button>
      </Stack>
    </SectionCard>
  );
}

function AppearanceSection() {
  const { mode, setMode } = useColorScheme();
  const options = [
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
    { value: 'dark', label: 'Dark' },
  ] as const;
  return (
    <SectionCard id="settings-appearance" title="Appearance" description="Saved on this device.">
      <ToggleButtonGroup
        exclusive
        fullWidth
        value={mode ?? 'system'}
        onChange={(_, v: 'light' | 'dark' | 'system' | null) => v && setMode(v)}
        aria-label="Colour mode"
      >
        {options.map((o) => (
          <ToggleButton key={o.value} value={o.value} sx={{ py: 0.75 }}>
            {o.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </SectionCard>
  );
}

function AboutSection() {
  return (
    <SectionCard id="settings-about" title="About">
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          God System is anonymous by design: teammates only see nicknames, roles and avatars. Emails stay private to
          each person.
        </Typography>
        <Box>
          <Typography variant="body2" fontWeight={500} gutterBottom>
            Avatar art
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
            Generated with{' '}
            <Link href="https://www.dicebear.com" target="_blank" rel="noopener noreferrer">
              DiceBear
            </Link>
            , using these styles:
          </Typography>
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.75 }}>
            {AVATAR_CREDITS.map((c) => (
              <Stack
                component="li"
                key={c.style}
                direction="row"
                spacing={1}
                justifyContent="space-between"
                alignItems="baseline"
                sx={{ typography: 'body2' }}
              >
                <span>
                  <Box component="span" sx={{ fontWeight: 500 }}>
                    {c.style}
                  </Box>{' '}
                  <Typography component="span" variant="body2" color="text.secondary">
                    by {c.author}
                  </Typography>
                </span>
                <Typography component="span" variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  {c.license}
                </Typography>
              </Stack>
            ))}
          </Box>
        </Box>
      </Stack>
    </SectionCard>
  );
}

export default function SettingsPage() {
  return (
    <Box>
      <PageHeader title="Settings" />
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Stack spacing={2.5}>
            <ProfileSection />
            <AvatarSection />
          </Stack>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Stack spacing={2.5}>
            <PasswordSection />
            <TimeZoneSection />
            <SectionCard id="settings-notifications" title="Browser notifications">
              <BrowserNotificationsSettings />
            </SectionCard>
            <AppearanceSection />
            <AboutSection />
          </Stack>
        </Grid>
      </Grid>
    </Box>
  );
}
