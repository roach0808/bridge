import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import { Box, Tooltip, Typography } from '@mui/material';
import { INVOICING_STATUSES, type CallDTO, type PayoutLine, type Role } from '@god/shared';
import { formatDateTime, formatUsd } from '@/lib/time';

/**
 * What a call brings in, once it has taken place: the expected income (the
 * rate × the minutes it really took) and the real income once the bank has
 * paid. Null for Experts and Associates, who never see it, and before the call
 * took place.
 */
export interface CallIncome {
  rate: number | null;
  minutes: number | null;
  expected: number | null;
  real: number | null;
  cancelled: boolean;
}

export function callIncome(call: CallDTO, role: Role): CallIncome | null {
  if (role === 'expert' || role === 'associate') return null;
  const cancelled = call.status === 'cancelled';
  if (!cancelled && call.status !== 'finished' && !INVOICING_STATUSES.includes(call.status)) return null;
  return {
    rate: call.rateOverride ?? call.platformRate,
    minutes: call.actualDurationMinutes,
    expected: call.expectedPrice,
    real: call.realIncome,
    cancelled,
  };
}

/** "$1,000/h × 33 min = $550", or why there is no figure yet. */
export function expectedFormula(income: CallIncome): string {
  if (income.cancelled) return 'None — cancelled';
  if (income.rate === null) return 'No rate yet';
  const sum = `${formatUsd(income.rate)}/h × ${income.minutes ?? '—'} min`;
  return income.expected === null ? sum : `${sum} = ${formatUsd(income.expected)}`;
}

/** The two income figures side by side, as a pill (header, lists) or as lines (details). */
export function IncomeFigures({ income, variant = 'pill' }: { income: CallIncome; variant?: 'pill' | 'lines' | 'cell' }) {
  if (income.cancelled) {
    return (
      <Typography variant="body2" color="text.secondary" component="span">
        None — cancelled
      </Typography>
    );
  }
  const real = income.real === null ? 'waiting for bank' : formatUsd(income.real);
  const gap = income.real !== null && income.expected !== null && income.real !== income.expected ? income.real - income.expected : null;

  if (variant === 'lines') {
    return (
      <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.25, rowGap: 0.25, alignItems: 'baseline' }}>
        <Typography variant="caption" color="text.secondary">
          Expected
        </Typography>
        <Typography variant="body2" fontWeight={600} sx={{ color: income.rate === null ? 'warning.main' : 'primary.main', fontVariantNumeric: 'tabular-nums' }}>
          {expectedFormula(income)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Real
        </Typography>
        <Typography variant="body2" fontWeight={600} sx={{ color: income.real === null ? 'text.disabled' : 'success.main', fontVariantNumeric: 'tabular-nums' }}>
          {real}
          {gap !== null && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.75 }}>
              ({gap > 0 ? '+' : ''}
              {formatUsd(gap)})
            </Typography>
          )}
        </Typography>
      </Box>
    );
  }

  if (variant === 'cell') {
    return (
      <Tooltip title={`Expected: ${expectedFormula(income)}`}>
        <Box sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
          <Typography variant="body2" fontWeight={600} sx={{ color: income.rate === null ? 'warning.main' : 'primary.main' }}>
            {income.expected === null ? (income.rate === null ? 'No rate' : '—') : formatUsd(income.expected)}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
              exp.
            </Typography>
          </Typography>
          <Typography variant="body2" fontWeight={600} sx={{ color: income.real === null ? 'text.disabled' : 'success.main' }}>
            {income.real === null ? '—' : formatUsd(income.real)}
            <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
              real
            </Typography>
          </Typography>
        </Box>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={`Expected: ${expectedFormula(income)} · Real: ${real}`}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 0.75,
          px: 1,
          py: 0.25,
          borderRadius: 999,
          bgcolor: 'action.selected',
          fontWeight: 700,
          fontSize: '0.8rem',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <Box component="span" sx={{ fontSize: '0.7rem', fontWeight: 600, opacity: 0.8 }}>
          Expected
        </Box>
        <Box component="span" sx={{ color: income.rate === null ? 'warning.main' : 'primary.main' }}>
          {income.expected === null ? (income.rate === null ? 'no rate' : '—') : formatUsd(income.expected)}
        </Box>
        <Box component="span" sx={{ fontSize: '0.7rem', fontWeight: 600, opacity: 0.8 }}>
          · Real
        </Box>
        <Box component="span" sx={{ color: income.real === null ? 'text.disabled' : 'success.main' }}>
          {income.real === null ? '—' : formatUsd(income.real)}
        </Box>
      </Box>
    </Tooltip>
  );
}

/** Paid (green, with the date on hover) or not paid yet (quiet). */
export function PaidMark({ line, zone, compact }: { line: Pick<PayoutLine, 'paidAt'>; zone: string; compact?: boolean }) {
  const paid = Boolean(line.paidAt);
  return (
    <Tooltip title={paid ? `Paid ${formatDateTime(line.paidAt!, zone)}` : 'Not paid yet'}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.4,
          fontSize: '0.75rem',
          fontWeight: 600,
          color: paid ? 'success.main' : 'text.secondary',
          whiteSpace: 'nowrap',
        }}
      >
        {paid ? <CheckCircleRounded sx={{ fontSize: 15 }} /> : <ScheduleRounded sx={{ fontSize: 15 }} />}
        {!compact && (paid ? 'Paid' : 'Not paid')}
      </Box>
    </Tooltip>
  );
}

/** "15%" or "12.5%". */
export const formatPercent = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(2).replace(/0$/, '')}%`;
