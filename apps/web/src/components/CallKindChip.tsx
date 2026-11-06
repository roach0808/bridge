import { Chip, Tooltip } from '@mui/material';
import { CALL_KIND_SHORT, type CallKind } from '@god/shared';

/**
 * Marks an Expert's call with a network associate, which nobody is paid for.
 * Client consultations, the usual kind, carry no mark.
 */
export function CallKindChip({ kind, size = 'small' }: { kind: CallKind | undefined; size?: 'small' | 'medium' }) {
  if (kind !== 'network') return null;
  return (
    <Tooltip title="A call with the expert network’s associate. Unpaid: no invoice and no pay." disableInteractive>
      <Chip label={CALL_KIND_SHORT.network} size={size} variant="outlined" sx={{ fontWeight: 500, borderStyle: 'dashed' }} />
    </Tooltip>
  );
}
