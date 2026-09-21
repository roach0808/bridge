import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import { Box, Tooltip } from '@mui/material';
import { INVOICING_STATUSES, type CallDTO, type PayoutLine, type Role } from '@god/shared';
import { formatDateTime, formatUsd } from '@/lib/time';

export interface CallMoney {
  label: string;
  value: string;
  hint: string;
  color: string;
}

/**
 * What the call is worth, as soon as that means anything: the expected income
 * once it is finished (rate × real duration), and what really arrived once the
 * bank has paid. Experts never see the call's income, only their own pay.
 */
export function callMoney(call: CallDTO, role: Role): CallMoney | null {
  if (role === 'expert') return null;
  if (call.status === 'cancelled') {
    return { label: 'Income', value: 'None — cancelled', hint: 'A cancelled call earns nothing', color: 'text.secondary' };
  }
  const done = call.status === 'finished' || INVOICING_STATUSES.includes(call.status);
  if (!done) return null;
  if (call.realIncome !== null) {
    return { label: 'Real income', value: formatUsd(call.realIncome), hint: 'What reached the bank', color: 'success.main' };
  }
  if (call.expectedPrice !== null) {
    return {
      label: 'Expected income',
      value: formatUsd(call.expectedPrice),
      hint: `Rate × the call’s real duration (${call.actualDurationMinutes ?? call.durationMinutes} min)`,
      color: 'primary.main',
    };
  }
  return { label: 'Expected income', value: 'No rate yet', hint: 'Set the Profile’s rate on this platform', color: 'warning.main' };
}

/** A pill for the money of a call, used on its panel in lists and on its page. */
export function MoneyPill({ money, size = 'medium' }: { money: CallMoney; size?: 'small' | 'medium' }) {
  return (
    <Tooltip title={money.hint}>
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
          color: money.color,
          fontWeight: 700,
          fontSize: size === 'small' ? '0.78rem' : '0.875rem',
          whiteSpace: 'nowrap',
        }}
      >
        <Box component="span" sx={{ fontSize: size === 'small' ? '0.68rem' : '0.75rem', fontWeight: 600, opacity: 0.85 }}>
          {money.label}
        </Box>
        {money.value}
      </Box>
    </Tooltip>
  );
}

/** Paid (green, with the date on hover) or not paid yet (quiet). */
export function PaidMark({ line, zone, compact }: { line: PayoutLine; zone: string; compact?: boolean }) {
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
