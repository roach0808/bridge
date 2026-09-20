import AccountBalanceRounded from '@mui/icons-material/AccountBalanceRounded';
import CancelRounded from '@mui/icons-material/CancelRounded';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import HowToRegRounded from '@mui/icons-material/HowToRegRounded';
import PendingActionsRounded from '@mui/icons-material/PendingActionsRounded';
import PlayCircleRounded from '@mui/icons-material/PlayCircleRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import { Box, type SvgIconProps } from '@mui/material';
import { SHORT_STATUS_LABELS, STATUS_LABELS, STATUS_STAGE, type CallStatus } from '@god/shared';
import type { ComponentType } from 'react';
import { STAGE_COLORS } from '@/theme/theme';

export const STATUS_ICONS: Record<CallStatus, ComponentType<SvgIconProps>> = {
  on_scheduling: PendingActionsRounded,
  scheduled: EventAvailableRounded,
  confirmed: HowToRegRounded,
  on_rescheduling: EventRepeatRounded,
  ongoing: PlayCircleRounded,
  finished: TaskAltRounded,
  invoice_submit: ReceiptLongRounded,
  invoice_approve: VerifiedRounded,
  process_to_bank: AccountBalanceRounded,
  cancelled: CancelRounded,
};

export const STATUS_COLORS: Record<CallStatus, string> = {
  on_scheduling: '#a1a1aa',
  scheduled: '#4a8cf0',
  confirmed: '#3b6fd8',
  on_rescheduling: '#e0913a',
  ongoing: '#2fb37a',
  finished: '#8d6cf0',
  invoice_submit: '#2ea3b8',
  invoice_approve: '#35a38a',
  process_to_bank: '#6aa84f',
  cancelled: '#9aa0a6',
};

/** A tiny status badge for calendar blocks: the status icon, and its short name when there is room. */
export function StatusBadge({ status, compact }: { status: CallStatus; compact?: boolean }) {
  const Icon = STATUS_ICONS[status];
  const color = STATUS_COLORS[status];
  return (
    <Box
      component="span"
      aria-label={STATUS_LABELS[status]}
      data-status={status}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        flexShrink: 0,
        maxWidth: '100%',
        height: 15,
        px: compact ? 0.25 : 0.5,
        borderRadius: 99,
        bgcolor: `${color}26`,
        color,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '.02em',
        textTransform: 'uppercase',
        lineHeight: 1,
      }}
    >
      <Icon sx={{ fontSize: 11 }} />
      {!compact && <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{SHORT_STATUS_LABELS[status]}</Box>}
    </Box>
  );
}

export const statusColor = (s: CallStatus) => STATUS_COLORS[s];
export const stageColor = (s: CallStatus) => STAGE_COLORS[STATUS_STAGE[s]];

/** A quiet pill: neutral background, one coloured dot. */
export function StatusChip({
  status,
  size = 'small',
  testId,
}: {
  status: CallStatus;
  size?: 'small' | 'medium';
  testId?: string;
}) {
  const color = STATUS_COLORS[status];
  return (
    <Box
      component="span"
      data-testid={testId}
      data-status={status}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        height: size === 'small' ? 24 : 28,
        px: size === 'small' ? 1 : 1.25,
        borderRadius: 999,
        bgcolor: 'action.selected',
        color: 'text.primary',
        fontSize: size === 'small' ? '0.75rem' : '0.8125rem',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
    >
      <Box
        component="span"
        sx={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          bgcolor: color,
          flexShrink: 0,
          ...(status === 'ongoing' ? { boxShadow: `0 0 0 3px ${color}33` } : {}),
        }}
      />
      {STATUS_LABELS[status]}
    </Box>
  );
}
