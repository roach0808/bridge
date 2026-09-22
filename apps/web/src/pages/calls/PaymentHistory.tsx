import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import { Box, Card, Collapse, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { PAYEE_LABELS, type PayCycleDTO } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common';
import { UserChip } from '@/components/identity';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatUsd } from '@/lib/time';
import { TableSurface } from '../admin/adminShared';

/**
 * The monthly payment records (§6.5a): every cycle the Founder closed, newest
 * first. The Founder sees each month's income, what was paid out and the
 * balance, and who was paid what; everyone else sees what they were paid.
 */
export function PaymentHistory() {
  const me = useMe();
  const query = useQuery({ queryKey: qk.calls.cycles, queryFn: api.finance.cycles });

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !query.data) return <LoadingRows rows={4} height={72} />;
  if (query.data.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ReceiptLongRounded />}
          title="No payment records yet"
          description={
            me.role === 'founder'
              ? 'Each time you pay everyone and close the month on the Finance tab, the month is kept here.'
              : 'Each month you are paid in shows up here once the Founder closes it.'
          }
        />
      </Card>
    );
  }
  return (
    <Stack spacing={1.5}>
      {query.data.map((cycle) => (
        <CycleCard key={cycle.id} cycle={cycle} />
      ))}
    </Stack>
  );
}

function CycleCard({ cycle }: { cycle: PayCycleDTO }) {
  const { zone } = useAuth();
  const me = useMe();
  const [open, setOpen] = useState(false);
  const t = cycle.totals;
  const mine = cycle.lines.reduce((sum, l) => sum + l.amount, 0);
  const figure = (label: string, value: number, strong?: boolean) => (
    <Box sx={{ minWidth: 110 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant={strong ? 'subtitle1' : 'body2'} fontWeight={strong ? 700 : 600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatUsd(value)}
      </Typography>
    </Box>
  );

  return (
    <Card>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ md: 'center' }}
        sx={{ p: 2, cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-expanded={open}
      >
        <Box sx={{ minWidth: 200, flex: { md: '0 0 220px' } }}>
          <Typography variant="subtitle1">{cycle.label}</Typography>
          <Typography variant="caption" color="text.secondary">
            {cycle.startedAt ? `${formatDate(cycle.startedAt, zone)} – ` : 'Until '}
            {formatDate(cycle.closedAt, zone)} · paid by {cycle.closedBy.nickname}
          </Typography>
        </Box>
        {t ? (
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ flex: 1 }}>
            {figure('Income', t.income)}
            {figure('Paid to Experts', t.paidExperts)}
            {figure('Paid to Managers', t.paidManagers)}
            {figure('Balance', t.balance, true)}
            {t.paidAssociates > 0 && figure('Managers paid Associates', t.paidAssociates)}
          </Stack>
        ) : (
          <Stack direction="row" spacing={3} sx={{ flex: 1 }}>
            {figure(me.role === 'expert' ? 'Your pay' : 'You were paid', mine, true)}
          </Stack>
        )}
        <IconButton size="small" aria-label={open ? 'Hide who was paid' : 'Show who was paid'} sx={{ alignSelf: { xs: 'flex-end', md: 'center' }, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
          <ExpandMoreRounded />
        </IconButton>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2, pb: 2 }}>
          {cycle.lines.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nobody was paid in this cycle.
            </Typography>
          ) : (
            <TableSurface minWidth={420}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Person</TableCell>
                    <TableCell>For</TableCell>
                    <TableCell align="right">Calls</TableCell>
                    <TableCell align="right">Amount</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {cycle.lines.map((l) => (
                    <TableRow key={`${l.kind}:${l.user.id}`}>
                      <TableCell>
                        <UserChip user={l.user} size={22} showRole={false} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {l.kind === 'associate' ? 'Associate’s part (paid by their Manager)' : `${PAYEE_LABELS[l.kind]} ${l.kind === 'expert' ? 'pay' : 'share'}`}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{l.calls}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {formatUsd(l.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableSurface>
          )}
        </Box>
      </Collapse>
    </Card>
  );
}
