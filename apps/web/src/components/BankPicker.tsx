import AddRounded from '@mui/icons-material/AddRounded';
import { Alert, Button, MenuItem, Skeleton, TextField } from '@mui/material';
import { bankLabel, type ProfileDTO } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { BanksDialog } from './BanksDialog';

/**
 * Founder, submitting an invoice: which of the Profile's active banks it is paid
 * into, by nickname. One bank is chosen for you; none offers to add one.
 */
export function BankPicker({
  profile,
  value,
  onChange,
  error,
  label = 'Bank',
}: {
  profile: Pick<ProfileDTO, 'id' | 'name' | 'avatarId' | 'photoId'>;
  value: string;
  onChange: (bankId: string) => void;
  error?: string;
  label?: string;
}) {
  const [adding, setAdding] = useState(false);
  const banks = useQuery({ queryKey: qk.banks(profile.id), queryFn: () => api.banks.list(profile.id) });
  const active = (banks.data ?? []).filter((b) => b.isActive);

  // The only bank is the obvious choice; a bank that went away is no choice at all.
  useEffect(() => {
    if (!banks.data) return;
    if (value && !active.some((b) => b.id === value)) onChange('');
    else if (!value && active.length === 1) onChange(active[0]!.id);
  }, [banks.data, value]); // eslint-disable-line react-hooks/exhaustive-deps

  if (banks.isLoading) return <Skeleton variant="rounded" height={40} />;

  return (
    <>
      {active.length === 0 ? (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" startIcon={<AddRounded />} onClick={() => setAdding(true)} sx={{ whiteSpace: 'nowrap' }}>
              Add bank
            </Button>
          }
        >
          <strong>{profile.name} has no active bank.</strong> Add one to submit the invoice.
        </Alert>
      ) : (
        <TextField
          select
          size="small"
          fullWidth
          required
          label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          error={Boolean(error)}
          helperText={error ?? `Which of ${profile.name}’s banks this invoice is paid into`}
        >
          {active.map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {bankLabel(b)}
              <span style={{ opacity: 0.6, marginLeft: 8 }}>
                {b.bankType} · {b.bankName} ··{b.accountNumber.slice(-4)}
              </span>
            </MenuItem>
          ))}
        </TextField>
      )}
      <BanksDialog profile={profile} open={adding} onClose={() => setAdding(false)} startAdding />
    </>
  );
}
