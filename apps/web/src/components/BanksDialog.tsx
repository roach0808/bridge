import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined';
import AddRounded from '@mui/icons-material/AddRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import StarOutlineRounded from '@mui/icons-material/StarOutlineRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import VisibilityOffOutlined from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import {
  Alert,
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
import type { BankDTO, BankInput, ProfileDTO } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { ConfirmDialog } from './common';
import { UserAvatar } from './identity';
import { useToast } from './ToastProvider';

type ProfileLike = Pick<ProfileDTO, 'id' | 'name' | 'avatarId' | 'photoId'>;

interface FormState {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  swiftBic: string;
  routingNumber: string;
  country: string;
  currency: string;
  notes: string;
  isPrimary: boolean;
}

const emptyForm = (holder: string): FormState => ({
  bankName: '',
  accountHolder: holder,
  accountNumber: '',
  swiftBic: '',
  routingNumber: '',
  country: '',
  currency: '',
  notes: '',
  isPrimary: false,
});

const fromBank = (b: BankDTO): FormState => ({
  bankName: b.bankName,
  accountHolder: b.accountHolder,
  accountNumber: b.accountNumber,
  swiftBic: b.swiftBic ?? '',
  routingNumber: b.routingNumber ?? '',
  country: b.country ?? '',
  currency: b.currency ?? '',
  notes: b.notes ?? '',
  isPrimary: b.isPrimary,
});

const mask = (value: string) => (value.length <= 4 ? value : `•••• ${value.slice(-4)}`);

function BankForm({
  profile,
  bank,
  onDone,
}: {
  profile: ProfileLike;
  bank: BankDTO | null;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => (bank ? fromBank(bank) : emptyForm(profile.name)));
  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const body: BankInput = { ...form };
      return bank ? api.banks.update(bank.id, body) : api.banks.create(profile.id, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.banks(profile.id) });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
      toast.success(bank ? 'Bank updated' : 'Bank added');
      onDone();
    },
  });
  const errors = fieldErrors(save.error);
  const ready = form.bankName.trim() && form.accountHolder.trim() && form.accountNumber.trim();

  const field = (key: keyof FormState, label: string, extra: object = {}) => (
    <TextField
      label={label}
      value={form[key] as string}
      onChange={set(key)}
      error={Boolean(errors[key])}
      helperText={errors[key]}
      {...extra}
    />
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
        {bank ? 'Edit bank' : 'New bank'}
      </Typography>
      {save.error && !Object.keys(errors).length ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(save.error)}
        </Alert>
      ) : null}
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
        {field('bankName', 'Bank name', { autoFocus: true, required: true })}
        {field('accountHolder', 'Account holder', { required: true })}
        <Box sx={{ gridColumn: '1 / -1' }}>{field('accountNumber', 'Account number or IBAN', { required: true })}</Box>
        {field('swiftBic', 'SWIFT / BIC')}
        {field('routingNumber', 'Routing / sort code')}
        {field('country', 'Country (e.g. US)', { slotProps: { htmlInput: { maxLength: 2 } } })}
        {field('currency', 'Currency (e.g. USD)', { slotProps: { htmlInput: { maxLength: 3 } } })}
        <Box sx={{ gridColumn: '1 / -1' }}>{field('notes', 'Notes', { multiline: true, minRows: 2 })}</Box>
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

function BankRow({ bank, onEdit, onDelete }: { bank: BankDTO; onEdit: () => void; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reveal, setReveal] = useState(false);
  const makePrimary = useMutation({
    mutationFn: () => api.banks.update(bank.id, { isPrimary: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.banks(bank.profileId) }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const details = [bank.swiftBic && `SWIFT ${bank.swiftBic}`, bank.routingNumber && `Routing ${bank.routingNumber}`, bank.country, bank.currency]
    .filter(Boolean)
    .join(' · ');

  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ py: 1.5 }}>
      <Box sx={{ width: 36, height: 36, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'background.subtle', color: 'text.secondary', flexShrink: 0 }}>
        <AccountBalanceOutlined fontSize="small" />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" fontWeight={600} noWrap>
            {bank.bankName}
          </Typography>
          {bank.isPrimary && (
            <Typography variant="caption" color="primary.main" fontWeight={600}>
              Primary
            </Typography>
          )}
        </Stack>
        <Typography variant="body2" color="text.secondary" noWrap>
          {bank.accountHolder} · <Box component="span" sx={{ fontFamily: 'ui-monospace, monospace' }}>{reveal ? bank.accountNumber : mask(bank.accountNumber)}</Box>
        </Typography>
        {details && (
          <Typography variant="caption" color="text.secondary" component="div">
            {details}
          </Typography>
        )}
        {bank.notes && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ whiteSpace: 'pre-wrap' }}>
            {bank.notes}
          </Typography>
        )}
      </Box>
      <Stack direction="row">
        <Tooltip title={reveal ? 'Hide number' : 'Show number'}>
          <IconButton size="small" onClick={() => setReveal((r) => !r)}>
            {reveal ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title={bank.isPrimary ? 'Primary bank' : 'Make primary'}>
          <span>
            <IconButton size="small" disabled={bank.isPrimary || makePrimary.isPending} onClick={() => makePrimary.mutate()}>
              {bank.isPrimary ? <StarRounded fontSize="small" color="primary" /> : <StarOutlineRounded fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Edit">
          <IconButton size="small" onClick={onEdit}>
            <EditOutlined fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton size="small" onClick={onDelete}>
            <DeleteOutlineRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

/** Founder-only: the banks a Profile is paid into. */
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
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<BankDTO | 'new' | null>(startAdding ? 'new' : null);
  const [deleting, setDeleting] = useState<BankDTO | null>(null);
  const banks = useQuery({
    queryKey: qk.banks(profile?.id ?? ''),
    queryFn: () => api.banks.list(profile!.id),
    enabled: open && Boolean(profile),
  });

  const close = () => {
    setEditing(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      maxWidth="sm"
      fullWidth
      slotProps={{ transition: { onEnter: () => setEditing(startAdding ? 'new' : null) } }}
    >
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
            <IconButton onClick={close} aria-label="Close" sx={{ position: 'absolute', right: 12, top: 12 }}>
              <CloseRounded />
            </IconButton>
          </DialogTitle>
          <DialogContent>
            {banks.isLoading ? (
              <Stack spacing={1}>
                <Skeleton variant="rounded" height={56} />
                <Skeleton variant="rounded" height={56} />
              </Stack>
            ) : banks.error ? (
              <Alert severity="error">{errorMessage(banks.error)}</Alert>
            ) : (
              <>
                {banks.data?.length ? (
                  <Box sx={{ '& > * + *': { borderTop: 1, borderColor: 'divider' }, mb: 2 }}>
                    {banks.data.map((b) =>
                      editing !== 'new' && editing?.id === b.id ? (
                        <Box key={b.id} sx={{ py: 1.5 }}>
                          <BankForm profile={profile} bank={b} onDone={() => setEditing(null)} />
                        </Box>
                      ) : (
                        <BankRow key={b.id} bank={b} onEdit={() => setEditing(b)} onDelete={() => setDeleting(b)} />
                      ),
                    )}
                  </Box>
                ) : editing !== 'new' ? (
                  <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    No bank yet.
                  </Typography>
                ) : null}
                {editing === 'new' ? (
                  <BankForm profile={profile} bank={null} onDone={() => setEditing(null)} />
                ) : (
                  <Button startIcon={<AddRounded />} onClick={() => setEditing('new')} disabled={editing !== null}>
                    Add bank
                  </Button>
                )}
              </>
            )}
          </DialogContent>
        </>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this bank?"
        description={deleting ? `${deleting.bankName} · ${mask(deleting.accountNumber)}` : undefined}
        confirmLabel="Delete"
        destructive
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          await api.banks.remove(deleting!.id);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: qk.banks(profile!.id) }),
            queryClient.invalidateQueries({ queryKey: qk.dashboard }),
            queryClient.invalidateQueries({ queryKey: qk.profiles.all }),
          ]);
        }}
      />
    </Dialog>
  );
}
