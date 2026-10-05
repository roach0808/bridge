import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined';
import AddRounded from '@mui/icons-material/AddRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DoNotDisturbOnOutlined from '@mui/icons-material/DoNotDisturbOnOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import RestartAltRounded from '@mui/icons-material/RestartAltRounded';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { bankLabel, type BankDTO, type BankInput, type ProfileDTO } from '@god/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useMe } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { ConfirmDialog } from './common';
import { UserAvatar } from './identity';
import { useToast } from './ToastProvider';

type ProfileLike = Pick<ProfileDTO, 'id' | 'name' | 'avatarId' | 'photoId'>;

/** Everything that shows a bank: the Profile's list, the Founder's bank page, invoices, the dashboard. */
export function refreshBanks(queryClient: QueryClient, profileId: string) {
  for (const queryKey of [qk.banks(profileId), qk.allBanks, qk.bankTypes, qk.dashboard, qk.profiles.all, qk.calls.all]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

interface FormState {
  nickname: string;
  bankType: string;
  bankName: string;
  bankAddress: string;
  routingNumber: string;
  accountNumber: string;
  swiftCode: string;
  email: string;
  /** Empty on an edit keeps the saved password, unless `clearPassword`. */
  password: string;
  clearPassword: boolean;
  signInLocation: string;
}

const emptyForm: FormState = {
  nickname: '',
  bankType: '',
  bankName: '',
  bankAddress: '',
  routingNumber: '',
  accountNumber: '',
  swiftCode: '',
  email: '',
  password: '',
  clearPassword: false,
  signInLocation: '',
};

const fromBank = (b: BankDTO): FormState => ({
  nickname: b.nickname ?? '',
  bankType: b.bankType === 'Unknown' ? '' : b.bankType,
  bankName: b.bankName,
  bankAddress: b.bankAddress ?? '',
  routingNumber: b.routingNumber === 'Unknown' ? '' : b.routingNumber,
  accountNumber: b.accountNumber,
  swiftCode: b.swiftCode ?? '',
  email: b.email ?? '',
  password: '',
  clearPassword: false,
  signInLocation: b.signInLocation ?? '',
});

const mask = (value: string) => (value.length <= 4 ? value : `•••• ${value.slice(-4)}`);

/**
 * Founder: add or edit one bank. Type, bank name, routing and account numbers
 * are required. The type is free text, with the types already in use offered.
 */
export function BankForm({ profileId, bank, onDone }: { profileId: string; bank: BankDTO | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => (bank ? fromBank(bank) : emptyForm));
  const types = useQuery({ queryKey: qk.bankTypes, queryFn: api.banks.types, staleTime: 60_000 });
  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const { password, clearPassword, ...fields } = form;
      const body: Partial<BankInput> = { ...fields };
      // On an edit, an empty field keeps the saved password.
      if (password) body.password = password;
      else if (clearPassword) body.password = null;
      return bank ? api.banks.update(bank.id, body) : api.banks.create(profileId, body as BankInput);
    },
    onSuccess: () => {
      refreshBanks(queryClient, profileId);
      toast.success(bank ? 'Bank updated' : 'Bank added');
      onDone();
    },
  });
  const errors = fieldErrors(save.error);
  const ready = form.bankType.trim() && form.bankName.trim() && form.routingNumber.trim() && form.accountNumber.trim();

  const field = (key: keyof FormState, label: string, extra: object = {}) => (
    <TextField label={label} value={form[key] as string} onChange={set(key)} error={Boolean(errors[key])} helperText={errors[key]} {...extra} />
  );

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) save.mutate();
      }}
      sx={{ p: 2, borderRadius: 3, bgcolor: 'background.subtle' }}
    >
      <Typography variant="subtitle2" sx={{ mb: 2 }}>
        {bank ? `Edit ${bankLabel(bank)}` : 'New bank'}
      </Typography>
      {save.error && !Object.keys(errors).length ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(save.error)}
        </Alert>
      ) : null}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        {field('nickname', 'Nickname', { autoFocus: true, helperText: errors.nickname ?? 'Chosen by this name when submitting an invoice' })}
        <Autocomplete
          freeSolo
          options={types.data ?? []}
          inputValue={form.bankType}
          onInputChange={(_, v) => setForm((f) => ({ ...f, bankType: v }))}
          renderInput={(p) => <TextField {...p} label="Bank type" required error={Boolean(errors.bankType)} helperText={errors.bankType ?? 'Checking, savings, Wise…'} />}
        />
        {field('bankName', 'Bank name', { required: true })}
        {field('swiftCode', 'SWIFT code')}
        {field('routingNumber', 'Routing number', { required: true })}
        {field('accountNumber', 'Account number', { required: true })}
        <Box sx={{ gridColumn: '1 / -1' }}>{field('bankAddress', 'Bank address', { multiline: true, minRows: 1 })}</Box>
        {field('email', 'Bank email', { type: 'email', autoComplete: 'off' })}
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value, clearPassword: false }))}
          error={Boolean(errors.password)}
          helperText={
            errors.password ??
            (bank?.hasPassword ? (
              form.clearPassword ? (
                <>
                  Will be removed.{' '}
                  <Box component="button" type="button" onClick={() => setForm((f) => ({ ...f, clearPassword: false }))} sx={linkButton}>
                    Keep it
                  </Box>
                </>
              ) : (
                <>
                  Leave empty to keep the saved one.{' '}
                  <Box component="button" type="button" onClick={() => setForm((f) => ({ ...f, password: '', clearPassword: true }))} sx={linkButton}>
                    Remove it
                  </Box>
                </>
              )
            ) : (
              'Stored encrypted'
            ))
          }
        />
        <Box sx={{ gridColumn: '1 / -1' }}>{field('signInLocation', 'Where signed in', { helperText: errors.signInLocation ?? 'A browser profile, a device…' })}</Box>
      </Box>
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
        <Button color="inherit" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={!ready || save.isPending}>
          {save.isPending ? <CircularProgress size={18} color="inherit" /> : bank ? 'Save' : 'Add bank'}
        </Button>
      </Stack>
    </Box>
  );
}

const linkButton = {
  p: 0,
  border: 0,
  bgcolor: 'transparent',
  color: 'primary.main',
  font: 'inherit',
  cursor: 'pointer',
  textDecoration: 'underline',
} as const;

/** Founder: the saved password, fetched only when asked for (and recorded in the audit trail). */
export function PasswordReveal({ bank }: { bank: Pick<BankDTO, 'id' | 'hasPassword'> }) {
  const toast = useToast();
  const [shown, setShown] = useState<string | null>(null);
  const reveal = useMutation({
    mutationFn: () => api.banks.password(bank.id),
    onSuccess: (r) => setShown(r.password ?? ''),
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (!bank.hasPassword) return <Muted>None</Muted>;
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box component="span" sx={{ fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
        {shown ?? '••••••••'}
      </Box>
      <Tooltip title={shown !== null ? 'Hide' : 'Show (recorded in the audit trail)'}>
        <IconButton
          size="small"
          disabled={reveal.isPending}
          onClick={(e) => {
            e.stopPropagation();
            if (shown !== null) setShown(null);
            else reveal.mutate();
          }}
          aria-label={shown !== null ? 'Hide password' : 'Show password'}
        >
          {reveal.isPending ? <CircularProgress size={14} /> : shown !== null ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return (
    <Typography component="span" variant="body2" color="text.secondary">
      {children}
    </Typography>
  );
}

/** One bank, every field the viewer may see. The Founder also gets the secrets and the actions. */
export function BankCard({ bank, onEdit, onDelete }: { bank: BankDTO; onEdit?: () => void; onDelete?: () => void }) {
  const me = useMe();
  const founder = me.role === 'founder';
  const queryClient = useQueryClient();
  const toast = useToast();
  const [showAccount, setShowAccount] = useState(false);
  // A deactivated bank stays on file for past invoices, but can no longer be chosen for a new one.
  const setActive = useMutation({
    mutationFn: (isActive: boolean) => api.banks.update(bank.id, { isActive }),
    onSuccess: (saved) => {
      refreshBanks(queryClient, bank.profileId);
      toast.success(saved.isActive ? 'Bank activated' : 'Bank deactivated');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const unknown = (v: string) => (v === 'Unknown' ? <Muted>Not entered yet</Muted> : v);

  const rows: Array<[string, ReactNode]> = [
    ['Bank name', bank.bankName],
    ['Bank address', bank.bankAddress ?? <Muted>—</Muted>],
    ['Routing number', <Mono key="r">{unknown(bank.routingNumber)}</Mono>],
    [
      'Account number',
      <Stack key="a" direction="row" spacing={0.5} alignItems="center">
        <Mono>{showAccount ? bank.accountNumber : mask(bank.accountNumber)}</Mono>
        <IconButton size="small" onClick={() => setShowAccount((s) => !s)} aria-label={showAccount ? 'Hide account number' : 'Show account number'}>
          {showAccount ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
        </IconButton>
      </Stack>,
    ],
    ['SWIFT code', bank.swiftCode ? <Mono key="s">{bank.swiftCode}</Mono> : <Muted>—</Muted>],
    ['Bank email', bank.email ?? <Muted>—</Muted>],
  ];
  if (founder) {
    rows.push(['Password', <PasswordReveal key="p" bank={bank} />]);
    rows.push(['Where signed in', bank.signInLocation ?? <Muted>—</Muted>]);
  }

  return (
    <Box sx={{ py: 1.75, opacity: bank.isActive ? 1 : 0.65 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.25 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'background.subtle', color: 'text.secondary', flexShrink: 0 }}>
          <AccountBalanceOutlined fontSize="small" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" fontWeight={650} noWrap>
              {bankLabel(bank)}
            </Typography>
            {!bank.isActive && (
              <Typography variant="caption" color="text.secondary" fontWeight={600}>
                Deactivated
              </Typography>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {bank.bankType === 'Unknown' ? 'Type not entered yet' : bank.bankType}
          </Typography>
        </Box>
        {founder && (
          <Stack direction="row">
            <Tooltip title={bank.isActive ? 'Deactivate' : 'Activate'}>
              <span>
                <IconButton size="small" disabled={setActive.isPending} onClick={() => setActive.mutate(!bank.isActive)} aria-label={bank.isActive ? 'Deactivate bank' : 'Activate bank'}>
                  {bank.isActive ? <DoNotDisturbOnOutlined fontSize="small" /> : <RestartAltRounded fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
            {onEdit && (
              <Tooltip title="Edit">
                <IconButton size="small" onClick={onEdit} aria-label="Edit bank">
                  <EditOutlined fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {onDelete && (
              <Tooltip title="Delete">
                <IconButton size="small" onClick={onDelete} aria-label="Delete bank">
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        )}
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '140px 1fr' }, columnGap: 2, rowGap: { xs: 0.25, sm: 0.5 }, pl: { sm: 6.5 } }}>
        {rows.map(([label, value]) => (
          <Box key={label} sx={{ display: 'contents' }}>
            <Typography variant="caption" color="text.secondary" sx={{ pt: { sm: 0.25 }, mt: { xs: 0.75, sm: 0 } }}>
              {label}
            </Typography>
            <Box sx={{ typography: 'body2', minWidth: 0, wordBreak: 'break-word' }}>{value}</Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <Box component="span" sx={{ fontFamily: 'ui-monospace, monospace' }}>
      {children}
    </Box>
  );
}

/** Asks before deleting; a bank with invoices cannot be deleted (the server says so). */
export function DeleteBankDialog({ bank, onClose }: { bank: BankDTO | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return (
    <ConfirmDialog
      open={Boolean(bank)}
      title="Delete this bank?"
      description={bank ? `${bankLabel(bank)} · ${mask(bank.accountNumber)}. A bank with invoices can only be deactivated.` : undefined}
      confirmLabel="Delete"
      destructive
      onClose={onClose}
      onConfirm={async () => {
        try {
          await api.banks.remove(bank!.id);
          refreshBanks(queryClient, bank!.profileId);
        } catch (err) {
          toast.error(errorMessage(err));
        }
      }}
    />
  );
}

/**
 * A Profile's banks, in its details. The Founder adds, edits, activates and
 * deletes them; Managers and Associates read them without the login secrets.
 */
export function ProfileBanks({ profileId, startAdding = false }: { profileId: string; startAdding?: boolean }) {
  const me = useMe();
  const founder = me.role === 'founder';
  const [editing, setEditing] = useState<BankDTO | 'new' | null>(startAdding && founder ? 'new' : null);
  const [deleting, setDeleting] = useState<BankDTO | null>(null);
  const banks = useQuery({ queryKey: qk.banks(profileId), queryFn: () => api.banks.list(profileId), enabled: me.role !== 'expert' });

  if (me.role === 'expert') return null;
  if (banks.isLoading) {
    return (
      <Stack spacing={1}>
        <Skeleton variant="rounded" height={56} />
        <Skeleton variant="rounded" height={56} />
      </Stack>
    );
  }
  if (banks.error) return <Alert severity="error">{errorMessage(banks.error)}</Alert>;

  return (
    <Box>
      {banks.data?.length ? (
        <Box sx={{ '& > * + *': { borderTop: 1, borderColor: 'divider' }, mb: founder ? 1.5 : 0 }}>
          {banks.data.map((b) =>
            editing !== 'new' && editing?.id === b.id ? (
              <Box key={b.id} sx={{ py: 1.5 }}>
                <BankForm profileId={profileId} bank={b} onDone={() => setEditing(null)} />
              </Box>
            ) : (
              <BankCard key={b.id} bank={b} onEdit={founder ? () => setEditing(b) : undefined} onDelete={founder ? () => setDeleting(b) : undefined} />
            ),
          )}
        </Box>
      ) : editing !== 'new' ? (
        <Typography color="text.secondary" variant="body2" sx={{ py: 1 }}>
          No bank yet.
        </Typography>
      ) : null}
      {founder &&
        (editing === 'new' ? (
          <BankForm profileId={profileId} bank={null} onDone={() => setEditing(null)} />
        ) : (
          <Button startIcon={<AddRounded />} onClick={() => setEditing('new')} disabled={editing !== null}>
            Add bank
          </Button>
        ))}
      <DeleteBankDialog bank={deleting} onClose={() => setDeleting(null)} />
    </Box>
  );
}

/** A Profile's banks in a dialog: from the dashboard's "Add bank" task, and the invoice step. */
export function BanksDialog({
  profile,
  open,
  onClose,
  startAdding = false,
}: {
  profile: ProfileLike | null;
  open: boolean;
  onClose: () => void;
  startAdding?: boolean;
}) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      {profile && (
        <>
          <DialogTitle sx={{ pr: 6 }}>
            <Stack direction="row" spacing={1.5} alignItems="center">
              <UserAvatar avatarId={profile.avatarId} photoId={profile.photoId} label={profile.name} size={36} />
              <Box>
                <Typography variant="h6">Banks</Typography>
                <Typography variant="body2" color="text.secondary">
                  {profile.name}
                </Typography>
              </Box>
            </Stack>
            <IconButton onClick={onClose} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 12 }}>
              <CloseRounded />
            </IconButton>
          </DialogTitle>
          <DialogContent>
            {/* Remounted on each opening, so "start adding" applies every time. */}
            {open && <ProfileBanks profileId={profile.id} startAdding={startAdding} />}
          </DialogContent>
        </>
      )}
    </Dialog>
  );
}
