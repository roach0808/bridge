import BlockRounded from '@mui/icons-material/BlockRounded';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import EditRounded from '@mui/icons-material/EditRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import { Alert, Box, Button, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { GENDERS, profileSchema, rejectProfileSchema, type ProfileDTO } from '@god/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useMe } from '@/auth/AuthProvider';
import { AvatarPicker } from '@/components/AvatarPicker';
import { PhotoUpload } from '@/components/PhotoUpload';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { FormDialog, FormSection, issuesToErrors, splitServerError, type FieldErrors } from './adminShared';

interface ProfileForm {
  name: string;
  linkedinUrl: string;
  briefExperience: string;
  avatarId: string;
  dateOfBirth: string;
  gender: string;
  nationality: string;
  location: string;
  education: string;
  careerHistory: string;
  email: string;
  phone: string;
  onboardedAt: string;
  addresses: Array<{ label: string; address: string }>;
}

const PROFILE_FIELDS = [
  'name', 'linkedinUrl', 'briefExperience', 'avatarId',
  'dateOfBirth', 'gender', 'nationality', 'location', 'education', 'careerHistory',
  'email', 'phone', 'onboardedAt', 'addresses',
];

const emptyForm = (): ProfileForm => ({
  name: '',
  linkedinUrl: '',
  briefExperience: '',
  avatarId: 'profile-01',
  dateOfBirth: '',
  gender: '',
  nationality: '',
  location: '',
  education: '',
  careerHistory: '',
  email: '',
  phone: '',
  onboardedAt: '',
  addresses: [],
});

/**
 * The profile form, shared by the "Add profile" dialog and the profile page.
 * With `resubmit` the author is editing their own older submission, which sends it back for review.
 */
export function useProfileForm({
  open = true,
  profile,
  resubmit,
  onClose,
}: {
  open?: boolean;
  profile: ProfileDTO | null;
  resubmit?: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<ProfileForm>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const isFounder = useMe().role === 'founder';
  /** A picture chosen for a profile that doesn't exist yet; uploaded right after creating it. */
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [photoId, setPhotoId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPendingPhoto(null);
    setPhotoId(profile?.photoId ?? null);
    setForm(
      profile
        ? {
            name: profile.name,
            linkedinUrl: profile.linkedinUrl ?? '',
            briefExperience: profile.briefExperience,
            avatarId: profile.avatarId,
            dateOfBirth: profile.dateOfBirth ?? '',
            gender: profile.gender ?? '',
            nationality: profile.nationality ?? '',
            location: profile.location ?? '',
            education: profile.education ?? '',
            careerHistory: profile.careerHistory ?? '',
            email: profile.email ?? '',
            phone: profile.phone ?? '',
            onboardedAt: profile.onboardedAt ?? '',
            addresses: (profile.addresses ?? []).map((a) => ({ label: a.label, address: a.address })),
          }
        : emptyForm(),
    );
    setErrors({});
    setGeneral(null);
  }, [open, profile]);

  const mutation = useMutation({
    mutationFn: (body: ProfileForm) => {
      const blankToNull = (v: string) => v.trim() || null;
      const payload = {
        ...body,
        linkedinUrl: blankToNull(body.linkedinUrl),
        dateOfBirth: blankToNull(body.dateOfBirth),
        gender: blankToNull(body.gender),
        nationality: blankToNull(body.nationality),
        location: blankToNull(body.location),
        education: blankToNull(body.education),
        careerHistory: blankToNull(body.careerHistory),
        email: blankToNull(body.email),
        phone: blankToNull(body.phone),
        // Founder-only fields are left out for everyone else.
        onboardedAt: isFounder ? blankToNull(body.onboardedAt) : undefined,
        addresses: isFounder
          ? body.addresses.filter((a) => a.label.trim() || a.address.trim()).map((a) => ({ label: a.label.trim(), address: a.address.trim() }))
          : undefined,
      };
      if (profile) return api.profiles.update(profile.id, payload);
      return api.profiles.create(payload).then(async (created) =>
        pendingPhoto ? api.profiles.setPhoto(created.id, pendingPhoto).catch(() => created) : created,
      );
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
      toast.success(
        profile
          ? resubmit
            ? `“${saved.name}” sent back to the Founder for review`
            : `Saved “${saved.name}”`
          : saved.status === 'pending'
            ? `“${saved.name}” submitted — a Founder will review it`
            : `Added “${saved.name}”`,
      );
      onClose();
    },
    onError: (err) => {
      const { fields, general } = splitServerError(err, PROFILE_FIELDS);
      setErrors(fields);
      setGeneral(general);
    },
  });

  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  const submit = () => {
    const result = profileSchema.safeParse(form);
    const clientErrors = issuesToErrors(result);
    setErrors(clientErrors);
    setGeneral(null);
    if (Object.keys(clientErrors).length === 0) mutation.mutate(form);
  };

  const fields = (
    <>
      {resubmit && (
        <Alert severity="info" variant="outlined">
          Saving sends this profile back to the Founder for review.
        </Alert>
      )}
      <TextField
        label="Name"
        value={form.name}
        onChange={(e) => set('name', e.target.value)}
        error={Boolean(errors.name)}
        helperText={errors.name}
        required
        autoFocus
        autoComplete="off"
      />
      <TextField
        label="LinkedIn URL"
        value={form.linkedinUrl}
        onChange={(e) => set('linkedinUrl', e.target.value)}
        error={Boolean(errors.linkedinUrl)}
        helperText={errors.linkedinUrl ?? 'Optional'}
        placeholder="https://www.linkedin.com/in/…"
        type="url"
        autoComplete="off"
      />
      <TextField
        label="Brief experience"
        value={form.briefExperience}
        onChange={(e) => set('briefExperience', e.target.value)}
        error={Boolean(errors.briefExperience)}
        helperText={errors.briefExperience ?? `${form.briefExperience.length}/4000`}
        multiline
        minRows={3}
        maxRows={8}
        onKeyDown={(e) => {
          // Ctrl/Cmd+Enter submits from the multi-line field.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        <TextField
          label="Date of birth"
          type="date"
          value={form.dateOfBirth}
          onChange={(e) => set('dateOfBirth', e.target.value)}
          error={Boolean(errors.dateOfBirth)}
          helperText={errors.dateOfBirth}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField select label="Gender" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
          <MenuItem value="">
            <em>Not set</em>
          </MenuItem>
          {GENDERS.map((g) => (
            <MenuItem key={g} value={g}>
              {g}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Nationality"
          value={form.nationality}
          onChange={(e) => set('nationality', e.target.value)}
          error={Boolean(errors.nationality)}
          helperText={errors.nationality}
          autoComplete="off"
        />
        <TextField
          label="Location"
          value={form.location}
          onChange={(e) => set('location', e.target.value)}
          error={Boolean(errors.location)}
          helperText={errors.location}
          placeholder="City, country"
          autoComplete="off"
        />
      </Box>
      <TextField
        label="Career history"
        value={form.careerHistory}
        onChange={(e) => set('careerHistory', e.target.value)}
        error={Boolean(errors.careerHistory)}
        helperText={errors.careerHistory ?? 'Roles, companies and years — one per line'}
        multiline
        minRows={3}
        maxRows={10}
      />
      <TextField
        label="Education"
        value={form.education}
        onChange={(e) => set('education', e.target.value)}
        error={Boolean(errors.education)}
        helperText={errors.education}
        multiline
        minRows={2}
        maxRows={6}
      />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        <TextField
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          error={Boolean(errors.email)}
          helperText={errors.email ?? 'The profile’s own address, used on the platforms'}
          autoComplete="off"
        />
        <TextField
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          error={Boolean(errors.phone)}
          helperText={errors.phone ?? 'With country code, e.g. +44 20 7946 0958'}
          autoComplete="off"
        />
      </Box>
      {isFounder && (
        <FormSection label="Private — Founder only" hint="Not shown to Managers, Associates or Experts. Bank details are managed from the profile's details.">
          <Stack spacing={1.5}>
            <TextField
              label="Onboard date"
              type="date"
              value={form.onboardedAt}
              onChange={(e) => set('onboardedAt', e.target.value)}
              error={Boolean(errors.onboardedAt)}
              helperText={errors.onboardedAt ?? 'Set automatically on approval; change it if needed'}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ maxWidth: 240 }}
            />
            {form.addresses.map((a, i) => (
              <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
                <TextField
                  label="Label"
                  placeholder="Home"
                  value={a.label}
                  onChange={(e) => set('addresses', form.addresses.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                  sx={{ width: { sm: 150 } }}
                />
                <TextField
                  label="Address"
                  value={a.address}
                  onChange={(e) => set('addresses', form.addresses.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))}
                  multiline
                  maxRows={4}
                  fullWidth
                />
                <IconButton aria-label={`Remove ${a.label || 'address'}`} onClick={() => set('addresses', form.addresses.filter((_, j) => j !== i))} sx={{ mt: { sm: 1 } }}>
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            {errors.addresses && (
              <Typography variant="caption" color="error">
                {errors.addresses}
              </Typography>
            )}
            <Box>
              <Button
                size="small"
                startIcon={<AddRounded />}
                disabled={form.addresses.length >= 10}
                onClick={() => set('addresses', [...form.addresses, { label: form.addresses.length ? '' : 'Home', address: '' }])}
              >
                Add address
              </Button>
            </Box>
          </Stack>
        </FormSection>
      )}
      {isFounder && (
        <FormSection label="Photo" hint="Optional. Shown instead of the illustration.">
          <PhotoUpload
            avatarId={form.avatarId}
            photoId={photoId}
            previewUrl={pendingPhoto}
            label={form.name || 'Profile'}
            size={56}
            onUpload={async (dataUrl) => {
              if (!profile) return setPendingPhoto(dataUrl);
              const saved = await api.profiles.setPhoto(profile.id, dataUrl);
              setPhotoId(saved.photoId);
              void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
            }}
            onRemove={async () => {
              if (!profile) return setPendingPhoto(null);
              const saved = await api.profiles.removePhoto(profile.id);
              setPhotoId(saved.photoId);
              void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
            }}
          />
        </FormSection>
      )}
      <FormSection label="Illustration" hint="Used when there is no photo" error={errors.avatarId}>
        <AvatarPicker audience="profile" value={form.avatarId} onChange={(id) => set('avatarId', id)} size={48} />
      </FormSection>
    </>
  );

  return {
    fields,
    submit,
    pending: mutation.isPending,
    general,
    isFounder,
    title: profile ? 'Edit profile' : 'Add profile',
    subtitle: profile ? profile.name : isFounder ? 'New profiles are approved immediately.' : 'A Founder reviews it before it can be used for calls.',
    submitLabel: profile ? (resubmit ? 'Save & resubmit' : 'Save changes') : isFounder ? 'Add profile' : 'Submit for review',
  };
}

/** The same form in a dialog, for adding a profile from the list. */
export function ProfileDialog(props: { open: boolean; profile: ProfileDTO | null; resubmit?: boolean; onClose: () => void }) {
  const form = useProfileForm(props);
  return (
    <FormDialog
      open={props.open}
      onClose={props.onClose}
      title={form.title}
      subtitle={form.subtitle}
      icon={props.profile ? <EditRounded /> : <PersonAddAlt1Rounded />}
      submitLabel={form.submitLabel}
      pending={form.pending}
      onSubmit={form.submit}
      error={form.general}
    >
      {form.fields}
    </FormDialog>
  );
}

export function RejectProfileDialog({ profile, onClose }: { profile: ProfileDTO | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [general, setGeneral] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setReason('');
      setError(undefined);
      setGeneral(null);
    }
  }, [profile]);

  const mutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.profiles.reject(id, reason),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
      toast.success(`Rejected “${saved.name}”`);
      onClose();
    },
    onError: (err) => {
      const { fields, general } = splitServerError(err, ['reason']);
      setError(fields.reason);
      setGeneral(general);
    },
  });

  const submit = () => {
    if (!profile) return;
    const result = rejectProfileSchema.safeParse({ reason });
    const errs = issuesToErrors(result);
    setError(errs.reason);
    if (!errs.reason) mutation.mutate({ id: profile.id, reason: reason.trim() });
  };

  return (
    <FormDialog
      open={Boolean(profile)}
      onClose={onClose}
      title="Reject profile"
      subtitle={profile?.name}
      icon={<BlockRounded />}
      submitLabel="Reject"
      pending={mutation.isPending}
      onSubmit={submit}
      error={general}
      maxWidth="xs"
    >
      <TextField
        label="Reason"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setError(undefined);
        }}
        error={Boolean(error)}
        helperText={error ?? 'The author sees this and can edit and resubmit.'}
        required
        autoFocus
        multiline
        minRows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
    </FormDialog>
  );
}
