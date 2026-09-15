import CheckRounded from '@mui/icons-material/CheckRounded';
import ErrorRounded from '@mui/icons-material/ErrorRounded';
import { Box, CircularProgress, Fade, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import type { CallDTO, Paginated } from '@god/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { formatMoney } from '@/lib/time';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'KRW', 'JPY', 'SGD'] as const;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const normalizeAmount = (raw: string): number | null | 'invalid' => {
  const trimmed = raw.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999.99) return 'invalid';
  return Math.round(n * 100) / 100;
};

/** Inline amount + currency editor; saves on blur, Enter, or currency change. */
export function InvoiceAmountCell({ call }: { call: CallDTO }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState(call.invoiceAmount ?? '');
  const [currency, setCurrency] = useState(call.invoiceCurrency ?? 'USD');
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const seq = useRef(0);

  // Follow server/realtime changes unless the user is mid-edit.
  useEffect(() => {
    if (focused.current || state === 'saving') return;
    setAmount(call.invoiceAmount ?? '');
    setCurrency(call.invoiceCurrency ?? 'USD');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.invoiceAmount, call.invoiceCurrency]);

  useEffect(() => {
    if (state !== 'saved') return;
    const t = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(t);
  }, [state]);

  if (!call.permissions.editInvoice) {
    return (
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatMoney(call.invoiceAmount, call.invoiceCurrency)}
      </Typography>
    );
  }

  const save = async (rawAmount: string, nextCurrency: string) => {
    const parsed = normalizeAmount(rawAmount);
    if (parsed === 'invalid') {
      setError('Enter a positive number');
      setState('error');
      return;
    }
    setError(null);
    const serverAmount = call.invoiceAmount == null ? null : Number(call.invoiceAmount);
    const serverCurrency = call.invoiceCurrency;
    const currencyToSend = parsed == null && serverCurrency == null ? null : nextCurrency;
    if (parsed === serverAmount && currencyToSend === serverCurrency) {
      if (state === 'error') setState('idle');
      return;
    }
    const mine = ++seq.current;
    setState('saving');
    try {
      const saved = await api.calls.update(call.id, { invoiceAmount: parsed, invoiceCurrency: currencyToSend });
      queryClient.setQueriesData<Paginated<CallDTO>>({ queryKey: ['calls', 'list'] }, (data) =>
        data ? { ...data, items: data.items.map((c) => (c.id === saved.id ? saved : c)) } : data,
      );
      void queryClient.invalidateQueries({ queryKey: qk.calls.detail(call.id), refetchType: 'none' });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard, refetchType: 'none' });
      if (mine === seq.current) {
        setState('saved');
        if (!focused.current) setAmount(saved.invoiceAmount ?? '');
      }
    } catch (err) {
      if (mine === seq.current) {
        setState('error');
        setError(errorMessage(err));
      }
      toast.error(`Could not save the amount for ${call.profile.name}: ${errorMessage(err)}`);
    }
  };

  const currencyOptions = CURRENCIES.includes(currency as (typeof CURRENCIES)[number]) ? CURRENCIES : [currency, ...CURRENCIES];

  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 210 }}>
      <TextField
        value={amount}
        placeholder="0.00"
        error={state === 'error'}
        onChange={(e) => {
          setAmount(e.target.value);
          if (state === 'error') setState('idle');
        }}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          void save(amount, currency);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setAmount(call.invoiceAmount ?? '');
            setState('idle');
            setError(null);
          }
        }}
        sx={{ width: 104, '& .MuiInputBase-root': { height: 34 } }}
        slotProps={{
          htmlInput: {
            inputMode: 'decimal',
            'aria-label': `Invoice amount for ${call.profile.name}`,
            style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
          },
        }}
      />
      <TextField
        select
        value={currency}
        onChange={(e) => {
          setCurrency(e.target.value);
          void save(amount, e.target.value);
        }}
        sx={{ width: 80, '& .MuiInputBase-root': { height: 34 }, '& .MuiSelect-select': { fontSize: '0.8125rem' } }}
        slotProps={{ htmlInput: { 'aria-label': `Currency for ${call.profile.name}` } }}
      >
        {currencyOptions.map((c) => (
          <MenuItem key={c} value={c}>
            {c}
          </MenuItem>
        ))}
      </TextField>
      <Box sx={{ width: 20, display: 'grid', placeItems: 'center' }} aria-live="polite">
        {state === 'saving' && <CircularProgress size={14} aria-label="Saving" />}
        <Fade in={state === 'saved'} unmountOnExit>
          <Tooltip title="Saved">
            <CheckRounded color="success" sx={{ fontSize: 18 }} aria-label="Saved" />
          </Tooltip>
        </Fade>
        {state === 'error' && (
          <Tooltip title={error ?? 'Not saved'}>
            <ErrorRounded color="error" sx={{ fontSize: 18 }} aria-label={error ?? 'Not saved'} />
          </Tooltip>
        )}
      </Box>
    </Stack>
  );
}
