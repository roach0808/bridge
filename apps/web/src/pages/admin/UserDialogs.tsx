import CheckRounded from '@mui/icons-material/CheckRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  ROLE_LABELS,
  TEAM_TIME_ZONE,
  createUserSchema,
  defaultAvatarFor,
  nickname as nicknameSchema,
  type Role,
  type UserDTO,
} from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { useMe } from '@/auth/AuthProvider';
import { AvatarPicker } from '@/components/AvatarPicker';
import { RoleDot, UserAvatar } from '@/components/identity';
import { TimeZoneSelect } from '@/components/TimeZoneSelect';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage, isApiError } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { zoneCity } from '@/lib/time';
import {
  FormDialog,
  FormSection,
  PasswordField,
  copyToClipboard,
  issuesToErrors,
  splitServerError,
  useIsPhone,
  useNow,
  type FieldErrors,
} from './adminShared';

type CreatableRole = Exclude<Role, 'founder'>;

const ROLE_BLURB: Record<CreatableRole, string> = {
  manager: 'Leads a team of Associates',
  associate: 'Books and coordinates calls',
  expert: 'Takes calls in their own time zone',
};

export function useActiveManagers(enabled: boolean) {
  const params = { role: 'manager' as const, active: 'true' as const };
  return useQuery({
    queryKey: qk.users.list(params),
    queryFn: () => api.users.list(params),
    enabled,
  });
}

export function LocalTimePreview({ zone }: { zone: string | null }) {
  useNow(30_000);
  if (!zone) return null;
  const now = DateTime.now().setZone(zone);
  if (!now.isValid) return null;
  return (
    <Typography variant="caption" color="text.secondary">
      Local time in {zoneCity(zone)}: <strong>{now.toFormat('ccc h:mm a')}</strong> ({now.toFormat('ZZZZ')})
    </Typography>
  );
}

function ManagerSelect({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (id: string) => void;
  error?: string;
  autoFocus?: boolean;
}) {
  const managers = useActiveManagers(true);
  return (
    <TextField
      select
      label="Manager"
      value={managers.data?.some((m) => m.id === value) ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      error={Boolean(error) || managers.isError}
      helperText={
        error ??
        (managers.isError
          ? errorMessage(managers.error)
          : managers.data?.length === 0
            ? 'Create an active Manager first'
            : 'Associates belong to one Manager’s team')
      }
      required
      autoFocus={autoFocus}
      disabled={managers.isLoading}
      slotProps={{ select: { renderValue: (id) => managers.data?.find((m) => m.id === id)?.nickname ?? '' } }}
    >
      {(managers.data ?? []).map((m) => (
        <MenuItem key={m.id} value={m.id}>
          <ListItemIcon sx={{ minWidth: 36 }}>
            <UserAvatar avatarId={m.avatarId} photoId={m.photoId} label={m.nickname} size={24} />
          </ListItemIcon>
          <ListItemText primary={m.nickname} />
        </MenuItem>
      ))}
    </TextField>
  );
}

interface CreateForm {
  role: CreatableRole;
  nickname: string;
  email: string;
  password: string;
  avatarId: string;
  managerId: string;
  timeZone: string | null;
}

const CREATE_FIELDS = ['role', 'nickname', 'email', 'password', 'avatarId', 'managerId', 'timeZone'];

const initialCreate = (role: CreatableRole): CreateForm => ({
  role,
  nickname: '',
  email: '',
  password: '',
  avatarId: defaultAvatarFor(role),
  managerId: '',
  timeZone: TEAM_TIME_ZONE,
});

/**
 * Create a user. The Founder picks any creatable role; a Manager only adds
 * Associates to their own team (the server sets the manager).
 */
export function CreateUserDialog({
  open,
  onClose,
  roles,
  initialRole,
}: {
  open: boolean;
  onClose: () => void;
  roles: CreatableRole[];
  initialRole?: CreatableRole;
}) {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const firstRole = initialRole && roles.includes(initialRole) ? initialRole : roles[0]!;
  const [form, setForm] = useState<CreateForm>(() => initialCreate(firstRole));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [created, setCreated] = useState<{ user: UserDTO; email: string; password: string } | null>(null);

  useEffect(() => {
    if (!open) {
      // Clear the credentials screen once the close animation has finished.
      const t = setTimeout(() => setCreated(null), 300);
      return () => clearTimeout(t);
    }
    setForm(initialCreate(firstRole));
    setErrors({});
    setGeneral(null);
    setCreated(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const needsManagerSelect = form.role === 'associate' && me.role === 'founder';

  const mutation = useMutation({
    mutationFn: (f: CreateForm) =>
      api.users.create({
        role: f.role,
        nickname: f.nickname.trim(),
        email: f.email.trim().toLowerCase(),
        password: f.password,
        avatarId: f.avatarId,
        ...(f.role === 'associate' && me.role === 'founder' ? { managerId: f.managerId } : {}),
        ...(f.role === 'expert' && f.timeZone ? { timeZone: f.timeZone } : {}),
      }),
    onSuccess: (user, f) => {
      void queryClient.invalidateQueries({ queryKey: qk.users.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      toast.success(`${ROLE_LABELS[user.role]} ${user.nickname} created`);
      setCreated({ user, email: f.email.trim().toLowerCase(), password: f.password });
    },
    onError: (err) => {
      if (isApiError(err) && err.status === 409) {
        const field = (err.details as { field?: string } | undefined)?.field === 'email' ? 'email' : 'nickname';
        setErrors({ [field]: field === 'email' ? 'That email is already in use' : 'That nickname is taken' });
        setGeneral(null);
        return;
      }
      const { fields, general } = splitServerError(err, CREATE_FIELDS);
      setErrors(fields);
      setGeneral(general);
    },
  });

  const set = <K extends keyof CreateForm>(key: K, value: CreateForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  const changeRole = (role: CreatableRole) => {
    // Avatars are per-role sets, so the choice resets with the role.
    setForm((f) => ({ ...f, role, avatarId: defaultAvatarFor(role) }));
    setErrors({});
  };

  const submit = () => {
    const payload = {
      role: form.role,
      nickname: form.nickname,
      email: form.email,
      password: form.password,
      avatarId: form.avatarId,
      managerId: needsManagerSelect && form.managerId ? form.managerId : undefined,
      timeZone: form.role === 'expert' ? (form.timeZone ?? undefined) : undefined,
    };
    const errs = issuesToErrors(createUserSchema.safeParse(payload));
    if (needsManagerSelect && !form.managerId) errs.managerId = 'Choose a Manager';
    if (form.role === 'expert' && !form.timeZone) errs.timeZone = 'Choose the Expert’s time zone';
    setErrors(errs);
    setGeneral(null);
    if (Object.keys(errs).length === 0) mutation.mutate(form);
  };

  if (created) {
    return <CreatedCredentials open={open} onClose={onClose} {...created} />;
  }

  const singleRole = roles.length === 1;

  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={singleRole ? `Add ${ROLE_LABELS[form.role].toLowerCase()}` : 'Create user'}
      subtitle={
        me.role === 'manager'
          ? 'They join your team and sign in with the details below.'
          : 'They sign in with the email and temporary password below.'
      }
      submitLabel={`Create ${ROLE_LABELS[form.role].toLowerCase()}`}
      pending={mutation.isPending}
      onSubmit={submit}
      error={general}
    >
      {!singleRole && (
        <FormSection label="Role">
          <ToggleButtonGroup
            exclusive
            fullWidth
            value={form.role}
            onChange={(_, v: CreatableRole | null) => v && changeRole(v)}
            aria-label="Role"
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${roles.length}, 1fr)` }, gap: 1 }}
          >
            {roles.map((r) => (
              <ToggleButton
                key={r}
                value={r}
                sx={{
                  justifyContent: 'flex-start',
                  alignItems: 'flex-start',
                  textAlign: 'left',
                  gap: 1,
                  px: 1.5,
                  py: 1.25,
                  border: '1px solid !important',
                  borderColor: 'divider !important',
                  borderRadius: '10px !important',
                  m: '0 !important',
                  '&.Mui-selected': {
                    borderColor: (t) => `rgba(${t.vars!.palette.text.primaryChannel} / 0.35) !important`,
                    bgcolor: 'action.selected',
                    '&:hover': { bgcolor: 'action.selected' },
                  },
                }}
              >
                <Box sx={{ pt: '6px', display: 'flex' }}>
                  <RoleDot role={r} />
                </Box>
                <Box>
                  <Typography variant="body2" fontWeight={550} color="text.primary" lineHeight={1.4}>
                    {ROLE_LABELS[r]}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" lineHeight={1.3} component="div">
                    {ROLE_BLURB[r]}
                  </Typography>
                </Box>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </FormSection>
      )}

      <TextField
        label="Nickname"
        value={form.nickname}
        onChange={(e) => set('nickname', e.target.value)}
        error={Boolean(errors.nickname)}
        helperText={errors.nickname ?? 'Letters, numbers, dot, dash, underscore'}
        required
        autoFocus
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength: 32, spellCheck: false } }}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Email"
          type="email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          error={Boolean(errors.email)}
          helperText={errors.email ?? 'Private — used only to sign in'}
          required
          autoComplete="off"
          slotProps={{ htmlInput: { spellCheck: false } }}
        />
        <PasswordField
          label="Temporary password"
          value={form.password}
          onChange={(v) => set('password', v)}
          error={errors.password}
          helperText="At least 10 characters"
          generate
        />
      </Stack>

      {needsManagerSelect && (
        <ManagerSelect value={form.managerId} onChange={(id) => set('managerId', id)} error={errors.managerId} />
      )}

      {form.role === 'expert' && (
        <Box>
          <TimeZoneSelect
            value={form.timeZone}
            onChange={(z) => set('timeZone', z)}
            helperText={errors.timeZone ?? 'Experts see times in their own zone'}
          />
          <Box sx={{ mt: 0.5, pl: 1.75 }}>
            <LocalTimePreview zone={form.timeZone} />
          </Box>
        </Box>
      )}

      <FormSection label="Avatar" hint={`${ROLE_LABELS[form.role]} set`} error={errors.avatarId}>
        <AvatarPicker key={form.role} audience={form.role} value={form.avatarId} onChange={(id) => set('avatarId', id)} size={48} />
      </FormSection>
    </FormDialog>
  );
}

/** Shown once after creation so the credentials can be handed over. */
function CreatedCredentials({
  open,
  onClose,
  user,
  email,
  password,
}: {
  open: boolean;
  onClose: () => void;
  user: UserDTO;
  email: string;
  password: string;
}) {
  const phone = useIsPhone();
  const [copied, setCopied] = useState(false);
  const copy = async () => setCopied(await copyToClipboard(`Email: ${email}\nTemporary password: ${password}`));
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth fullScreen={phone}>
      <DialogContent sx={{ pt: 4, textAlign: 'center' }}>
        <Box sx={{ display: 'inline-block', mb: 1.5 }}>
          <UserAvatar avatarId={user.avatarId} photoId={user.photoId} label={user.nickname} size={64} />
        </Box>
        <Typography variant="h6">{user.nickname} is ready</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          Share these sign-in details privately. The password will not be shown again.
        </Typography>
        <Paper variant="outlined" sx={{ p: 2, textAlign: 'left', borderRadius: '10px', bgcolor: 'background.subtle', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">
            Email
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', mb: 1, wordBreak: 'break-all' }}>
            {email}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Temporary password
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' }}>
            {password}
          </Typography>
        </Paper>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button
          onClick={copy}
          startIcon={copied ? <CheckRounded /> : <ContentCopyRounded />}
          color="inherit"
        >
          {copied ? 'Copied' : 'Copy details'}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={onClose} autoFocus>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface EditForm {
  nickname: string;
  managerId: string;
  timeZone: string | null;
  isActive: boolean;
}

/** Founder edit: nickname, manager (associates), time zone (experts), active. */
export function EditUserDialog({ user, onClose }: { user: UserDTO | null; onClose: () => void }) {
  const me = useMe();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<EditForm>({ nickname: '', managerId: '', timeZone: null, isActive: true });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  // Keep the last user so the dialog can animate out after `user` clears.
  const [target, setTarget] = useState<UserDTO | null>(user);

  useEffect(() => {
    if (!user) return;
    setTarget(user);
    setForm({ nickname: user.nickname, managerId: user.managerId ?? '', timeZone: user.timeZone, isActive: user.isActive });
    setErrors({});
    setGeneral(null);
  }, [user]);

  const mutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof api.users.update>[1] }) => api.users.update(id, body),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.users.all });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      toast.success(`Saved ${saved.nickname}`);
      onClose();
    },
    onError: (err) => {
      if (isApiError(err) && err.status === 409) {
        setErrors({ nickname: 'That nickname is taken' });
        setGeneral(null);
        return;
      }
      const { fields, general } = splitServerError(err, ['nickname', 'managerId', 'timeZone', 'isActive']);
      setErrors(fields);
      setGeneral(general);
    },
  });

  const current = user ?? target;
  if (!current) return null;
  const isSelf = current.id === me.id;
  const body: Parameters<typeof api.users.update>[1] = {};
  if (form.nickname.trim() !== current.nickname) body.nickname = form.nickname.trim();
  if (current.role === 'associate' && form.managerId && form.managerId !== current.managerId) body.managerId = form.managerId;
  if (current.role === 'expert' && form.timeZone && form.timeZone !== current.timeZone) body.timeZone = form.timeZone;
  if (form.isActive !== current.isActive) body.isActive = form.isActive;
  const dirty = Object.keys(body).length > 0;

  const submit = () => {
    const errs: FieldErrors = {};
    const nick = nicknameSchema.safeParse(form.nickname);
    if (!nick.success) errs.nickname = nick.error.issues[0]?.message ?? 'Invalid nickname';
    if (current.role === 'associate' && !form.managerId) errs.managerId = 'Choose a Manager';
    if (current.role === 'expert' && !form.timeZone) errs.timeZone = 'Choose a time zone';
    setErrors(errs);
    setGeneral(null);
    if (Object.keys(errs).length === 0 && dirty) mutation.mutate({ id: current.id, body });
  };

  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors(({ [key]: _, ...rest }) => rest);
  };

  return (
    <FormDialog
      open={Boolean(user)}
      onClose={onClose}
      title={`Edit ${current.nickname}`}
      subtitle={ROLE_LABELS[current.role]}
      submitLabel="Save changes"
      pending={mutation.isPending}
      submitDisabled={!dirty}
      onSubmit={submit}
      error={general}
      maxWidth="xs"
    >
      <TextField
        label="Nickname"
        value={form.nickname}
        onChange={(e) => set('nickname', e.target.value)}
        error={Boolean(errors.nickname)}
        helperText={errors.nickname}
        required
        autoFocus
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength: 32, spellCheck: false } }}
      />
      {current.role === 'associate' && (
        <ManagerSelect value={form.managerId} onChange={(id) => set('managerId', id)} error={errors.managerId} />
      )}
      {current.role === 'expert' && (
        <Box>
          <TimeZoneSelect value={form.timeZone} onChange={(z) => set('timeZone', z)} helperText={errors.timeZone} />
          <Box sx={{ mt: 0.5, pl: 1.75 }}>
            <LocalTimePreview zone={form.timeZone} />
          </Box>
        </Box>
      )}
      <Box>
        <FormControlLabel
          control={
            <Switch checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} disabled={isSelf} />
          }
          label={form.isActive ? 'Active' : 'Deactivated'}
        />
        {isSelf ? (
          <Typography variant="caption" color="text.secondary" component="div">
            You cannot deactivate yourself.
          </Typography>
        ) : (
          current.isActive &&
          !form.isActive && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {current.nickname} will be signed out everywhere immediately and cannot sign in until reactivated.
            </Alert>
          )
        )}
      </Box>
    </FormDialog>
  );
}
