import AddRounded from '@mui/icons-material/AddRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import KeyRounded from '@mui/icons-material/KeyRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import {
  Alert,
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
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { CredentialDTO, CredentialInput, UpdateCredentialInput } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { ConfirmDialog } from './common';
import { useToast } from './ToastProvider';

/** Whose password manager (§6.17): a Profile's, or a team's (named by its Manager). */
export type CredentialOwner = { kind: 'profile'; id: string } | { kind: 'team'; id: string };

const keyOf = (owner: CredentialOwner) => (owner.kind === 'profile' ? qk.credentials.profile(owner.id) : qk.credentials.team(owner.id));

/** A search box once the list is long enough to need one. */
const SEARCH_FROM = 6;

/**
 * A password manager: saved logins, each with a nickname, the platform it signs
 * in to, the email or username and a password. Passwords are fetched only when
 * shown or copied, and each time is recorded in the audit trail.
 */
export function CredentialList({ owner, emptyText }: { owner: CredentialOwner; emptyText: string }) {
  const [editing, setEditing] = useState<CredentialDTO | 'new' | null>(null);
  const [deleting, setDeleting] = useState<CredentialDTO | null>(null);
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({
    queryKey: keyOf(owner),
    queryFn: () => (owner.kind === 'profile' ? api.credentials.forProfile(owner.id) : api.credentials.forTeam(owner.id)),
  });

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = query.data ?? [];
    return q ? all.filter((c) => [c.nickname, c.platform, c.login ?? ''].some((v) => v.toLowerCase().includes(q))) : all;
  }, [query.data, search]);

  if (query.isLoading) {
    return (
      <Stack spacing={1}>
        <Skeleton variant="rounded" height={56} />
        <Skeleton variant="rounded" height={56} />
      </Stack>
    );
  }
  if (query.error) return <Alert severity="error">{errorMessage(query.error)}</Alert>;
  const count = query.data?.length ?? 0;

  return (
    <Box>
      {count >= SEARCH_FROM && (
        <TextField
          size="small"
          fullWidth
          placeholder="Search nickname, platform or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 1.5 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRounded fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      )}
      {count === 0 ? (
        <Typography color="text.secondary" variant="body2" sx={{ py: 1 }}>
          {emptyText}
        </Typography>
      ) : shown.length === 0 ? (
        <Typography color="text.secondary" variant="body2" sx={{ py: 1 }}>
          No saved login matches “{search.trim()}”.
        </Typography>
      ) : (
        <Box sx={{ '& > * + *': { borderTop: 1, borderColor: 'divider' }, mb: 1.5 }}>
          {shown.map((c) => (
            <CredentialRow key={c.id} credential={c} onEdit={() => setEditing(c)} onDelete={() => setDeleting(c)} />
          ))}
        </Box>
      )}
      <Button startIcon={<AddRounded />} onClick={() => setEditing('new')}>
        Add login
      </Button>

      {editing && <CredentialDialog owner={owner} credential={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.nickname ?? ''}”?`}
        description="The login and its password are removed for everyone. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await api.credentials.remove(deleting.id);
          void queryClient.invalidateQueries({ queryKey: keyOf(owner) });
          toast.success('Login deleted');
        }}
      />
    </Box>
  );
}

function CredentialRow({ credential: c, onEdit, onDelete }: { credential: CredentialDTO; onEdit: () => void; onDelete: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState<string | null>(null);
  const reveal = useMutation({ mutationFn: () => api.credentials.password(c.id) });

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error('Could not copy; select it and copy by hand');
    }
  };
  const fetchPassword = async () => (await reveal.mutateAsync()).password ?? '';
  const onShow = async () => {
    if (password !== null) return setPassword(null);
    try {
      setPassword(await fetchPassword());
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const onCopyPassword = async () => {
    try {
      await copy(password ?? (await fetchPassword()), 'Password');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }} alignItems={{ sm: 'center' }} sx={{ py: 1.25 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
        <Box
          aria-hidden
          sx={{
            width: 36,
            height: 36,
            borderRadius: '10px',
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'action.selected',
            fontWeight: 700,
            fontSize: 15,
            color: 'text.secondary',
          }}
        >
          {c.platform.trim().charAt(0).toUpperCase() || <KeyRounded fontSize="small" />}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {c.nickname}
          </Typography>
          <Tooltip
            title={`Last changed by ${c.updatedBy.nickname} ${DateTime.fromISO(c.updatedAt).toRelative() ?? ''}`}
            placement="bottom-start"
          >
            <Typography variant="caption" color="text.secondary" component="div" noWrap>
              {c.platform}
            </Typography>
          </Tooltip>
        </Box>
      </Stack>

      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0, flex: { sm: 1 } }}>
        <Typography variant="body2" noWrap sx={{ minWidth: 0, color: c.login ? 'text.primary' : 'text.disabled' }}>
          {c.login ?? 'No email or username'}
        </Typography>
        {c.login && (
          <Tooltip title="Copy email or username">
            <IconButton size="small" onClick={() => void copy(c.login!, 'Email or username')} aria-label={`Copy the email or username of ${c.nickname}`}>
              <ContentCopyRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Stack>

      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: { sm: 170 } }}>
        {c.hasPassword ? (
          <>
            <Box component="span" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 14, wordBreak: 'break-all', minWidth: 0 }}>
              {password ?? '••••••••'}
            </Box>
            <Tooltip title={password !== null ? 'Hide' : 'Show (recorded in the audit trail)'}>
              <IconButton size="small" onClick={() => void onShow()} disabled={reveal.isPending} aria-label={password !== null ? `Hide the password of ${c.nickname}` : `Show the password of ${c.nickname}`}>
                {reveal.isPending ? <CircularProgress size={14} /> : password !== null ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Copy password (recorded in the audit trail)">
              <IconButton size="small" onClick={() => void onCopyPassword()} disabled={reveal.isPending} aria-label={`Copy the password of ${c.nickname}`}>
                <ContentCopyRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <Typography variant="body2" color="text.disabled">
            No password saved
          </Typography>
        )}
      </Stack>

      <Stack direction="row" spacing={0.25} sx={{ alignSelf: { xs: 'flex-end', sm: 'center' } }}>
        <Tooltip title="Edit">
          <IconButton size="small" onClick={onEdit} aria-label={`Edit ${c.nickname}`}>
            <EditOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton size="small" onClick={onDelete} aria-label={`Delete ${c.nickname}`}>
            <DeleteOutlineRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

function CredentialDialog({ owner, credential, onClose }: { owner: CredentialOwner; credential: CredentialDTO | null; onClose: () => void }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    nickname: credential?.nickname ?? '',
    platform: credential?.platform ?? '',
    login: credential?.login ?? '',
    password: '',
    clearPassword: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Suggestions: the expert networks, and the platforms already used in this list.
  const platforms = useQuery({ queryKey: qk.platforms, queryFn: () => api.platforms.list(), staleTime: 5 * 60_000 });
  const existing = queryClient.getQueryData<CredentialDTO[]>(keyOf(owner)) ?? [];
  const suggestions = useMemo(
    () => [...new Set([...existing.map((c) => c.platform), ...(platforms.data ?? []).map((p) => p.name)])].sort((a, b) => a.localeCompare(b)),
    [existing, platforms.data],
  );

  const save = useMutation({
    mutationFn: () => {
      const fields = { nickname: form.nickname, platform: form.platform, login: form.login.trim() || null };
      if (!credential) {
        const body: CredentialInput = { ...fields, ...(form.password ? { password: form.password } : {}) };
        return owner.kind === 'profile' ? api.credentials.createForProfile(owner.id, body) : api.credentials.createForTeam(owner.id, body);
      }
      // On an edit, an empty field keeps the saved password.
      const body: UpdateCredentialInput = { ...fields };
      if (form.password) body.password = form.password;
      else if (form.clearPassword) body.password = null;
      return api.credentials.update(credential.id, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keyOf(owner) });
      toast.success(credential ? 'Login saved' : 'Login added');
      onClose();
    },
    onError: (err) => {
      setErrors(fieldErrors(err));
      if (!Object.keys(fieldErrors(err)).length) toast.error(errorMessage(err));
    },
  });

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setErrors({});
  };
  const missing = !form.nickname.trim() || !form.platform.trim();

  return (
    <Dialog open onClose={save.isPending ? undefined : onClose} maxWidth="xs" fullWidth fullScreen={fullScreen}>
      <DialogTitle>{credential ? 'Edit login' : 'Add login'}</DialogTitle>
      <DialogContent>
        <Stack
          component="form"
          id="credential-form"
          spacing={2}
          sx={{ pt: 1 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!missing) save.mutate();
          }}
        >
          <TextField
            label="Nickname"
            required
            autoFocus
            value={form.nickname}
            onChange={(e) => set({ nickname: e.target.value })}
            error={Boolean(errors.nickname)}
            helperText={errors.nickname ?? 'What the team calls it, e.g. “Main GLG login”'}
            slotProps={{ htmlInput: { maxLength: 80 } }}
          />
          <Autocomplete
            freeSolo
            options={suggestions}
            value={form.platform}
            onInputChange={(_, v) => set({ platform: v })}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Platform"
                required
                error={Boolean(errors.platform)}
                helperText={errors.platform ?? 'Where it signs in: GLG, Gmail, LinkedIn…'}
                slotProps={{ htmlInput: { ...params.inputProps, maxLength: 120 } }}
              />
            )}
          />
          <TextField
            label="Email or username"
            value={form.login}
            onChange={(e) => set({ login: e.target.value })}
            error={Boolean(errors.login)}
            helperText={errors.login}
            autoComplete="off"
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />
          <TextField
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => set({ password: e.target.value, clearPassword: false })}
            error={Boolean(errors.password)}
            helperText={
              errors.password ??
              (credential?.hasPassword
                ? form.clearPassword
                  ? 'The saved password will be removed.'
                  : 'Leave empty to keep the saved password.'
                : undefined)
            }
            slotProps={{
              htmlInput: { maxLength: 500 },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} edge="end">
                      {showPassword ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          {credential?.hasPassword && !form.password && (
            <Box>
              <Button size="small" color={form.clearPassword ? 'inherit' : 'error'} onClick={() => set({ clearPassword: !form.clearPassword })}>
                {form.clearPassword ? 'Keep the saved password' : 'Remove the saved password'}
              </Button>
            </Box>
          )}
          <Typography variant="caption" color="text.secondary">
            Only Founders and this team can see it. Passwords are stored encrypted, and every time one is shown or copied it is
            recorded in the audit trail.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" form="credential-form" variant="contained" disabled={save.isPending || missing}>
          {save.isPending ? <CircularProgress size={18} color="inherit" /> : credential ? 'Save' : 'Add login'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
