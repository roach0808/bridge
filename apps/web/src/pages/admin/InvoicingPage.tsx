import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { STATUS_LABELS, type CallDTO, type CallStatus } from '@god/shared';
import type { ListCallsParams } from '@god/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader } from '@/components/common';
import { UserAvatar, UserChip } from '@/components/identity';
import { STATUS_COLORS, StatusChip } from '@/components/StatusChip';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { formatDateTime, formatMoney } from '@/lib/time';
import { SR_ONLY, SearchField, StatTile, runWithConcurrency } from './adminShared';
import { InvoiceAmountCell } from './InvoiceAmountCell';

type InvoiceStatus = Extract<CallStatus, 'finished' | 'invoice_submit' | 'invoice_approve' | 'process_to_bank'>;

const STAGES: Array<{ status: InvoiceStatus; label: string; next: InvoiceStatus | null; hint: string }> = [
  { status: 'finished', label: 'Ready to invoice', next: 'invoice_submit', hint: 'Finished calls waiting for an invoice' },
  { status: 'invoice_submit', label: 'Submitted', next: 'invoice_approve', hint: 'Invoices sent to the platform' },
  { status: 'invoice_approve', label: 'Approved', next: 'process_to_bank', hint: 'Approved, waiting for payment' },
  { status: 'process_to_bank', label: 'Paid', next: null, hint: 'Processed to the bank' },
];

const LIST_PARAMS: ListCallsParams = {
  status: STAGES.map((s) => s.status),
  pageSize: 200,
  sort: '-scheduledAt',
};

function totalsByCurrency(calls: CallDTO[]) {
  const totals = new Map<string, number>();
  let missing = 0;
  for (const c of calls) {
    if (c.invoiceAmount == null) {
      missing++;
      continue;
    }
    const cur = c.invoiceCurrency ?? 'USD';
    totals.set(cur, (totals.get(cur) ?? 0) + Number(c.invoiceAmount));
  }
  return { totals: [...totals.entries()].sort((a, b) => b[1] - a[1]), missing };
}

export default function InvoicingPage() {
  const { zone } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<InvoiceStatus>('finished');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState<{ done: number; total: number } | null>(null);
  const [confirmMissing, setConfirmMissing] = useState(false);

  const query = useQuery({ queryKey: qk.calls.list(LIST_PARAMS), queryFn: () => api.calls.list(LIST_PARAMS) });
  const calls = useMemo(() => query.data?.items ?? [], [query.data]);

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s.status, [] as CallDTO[]])) as Record<InvoiceStatus, CallDTO[]>;
    for (const c of calls) if (c.status in map) map[c.status as InvoiceStatus].push(c);
    return map;
  }, [calls]);

  const stage = STAGES.find((s) => s.status === tab)!;
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return byStatus[tab].filter(
      (c) =>
        !term ||
        c.profile.name.toLowerCase().includes(term) ||
        c.platform.name.toLowerCase().includes(term) ||
        c.associate.nickname.toLowerCase().includes(term) ||
        (c.expert?.nickname.toLowerCase().includes(term) ?? false),
    );
  }, [byStatus, tab, search]);

  const selectedRows = rows.filter((c) => selected.has(c.id));
  const next = stage.next;
  const eligible = next ? selectedRows.filter((c) => c.allowedTransitions.includes(next)) : [];
  const withoutAmount = next === 'invoice_submit' ? eligible.filter((c) => c.invoiceAmount == null) : [];

  const changeTab = (status: InvoiceStatus) => {
    setTab(status);
    setSelected(new Set());
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const allChecked = rows.length > 0 && selectedRows.length === rows.length;
  const someChecked = selectedRows.length > 0 && !allChecked;

  const runMove = async () => {
    if (!next || eligible.length === 0) return;
    const targets = eligible;
    const skipped = selectedRows.length - targets.length;
    setMoving({ done: 0, total: targets.length });
    try {
      let done = 0;
      const results = await runWithConcurrency(targets, 3, async (c) => {
        try {
          return await api.calls.transition(c.id, next);
        } finally {
          done++;
          setMoving({ done, total: targets.length });
        }
      });
      const failures = results
        .map((r, i) => ({ r, call: targets[i]! }))
        .filter((x): x is { r: PromiseRejectedResult; call: CallDTO } => x.r.status === 'rejected');
      const ok = targets.length - failures.length;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.calls.all }),
        queryClient.invalidateQueries({ queryKey: qk.dashboard }),
      ]);
      // Keep failed rows selected so they can be retried.
      setSelected(new Set(failures.map((f) => f.call.id)));

      const label = STATUS_LABELS[next];
      const skippedNote = skipped ? ` ${skipped} skipped (not allowed from their current status).` : '';
      if (failures.length === 0) {
        toast.success(`Moved ${ok} call${ok === 1 ? '' : 's'} to ${label}.${skippedNote}`);
      } else {
        const first = failures[0]!;
        const more = failures.length > 1 ? ' (and more)' : '';
        toast.show(
          `Moved ${ok} of ${targets.length} to ${label}. ${failures.length} failed — ${first.call.profile.name}: ${errorMessage(first.r.reason)}${more}.${skippedNote}`,
          ok === 0 ? 'error' : 'warning',
        );
      }
    } finally {
      setMoving(null);
    }
  };

  const requestMove = () => {
    if (withoutAmount.length > 0) setConfirmMissing(true);
    else void runMove();
  };

  return (
    <Box>
      <PageHeader title="Invoicing" subtitle="Record amounts and move finished calls through to payment." />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {STAGES.map((s) => {
          const list = byStatus[s.status];
          const { totals, missing } = totalsByCurrency(list);
          const color = STATUS_COLORS[s.status];
          return (
            <Grid key={s.status} size={{ xs: 6, lg: 3 }}>
              <StatTile
                label={s.label}
                color={color}
                selected={tab === s.status}
                onClick={() => changeTab(s.status)}
                value={
                  query.isLoading ? (
                    <Skeleton width={48} />
                  ) : (
                    <Stack direction="row" spacing={0.75} alignItems="baseline">
                      <span>{list.length}</span>
                      <Typography variant="body2" color="text.secondary">
                        call{list.length === 1 ? '' : 's'}
                      </Typography>
                    </Stack>
                  )
                }
                footer={
                  query.isLoading ? (
                    <Skeleton width="70%" />
                  ) : (
                    <Stack spacing={0.25}>
                      {totals.length === 0 ? (
                        <Typography variant="body2" color="text.disabled">
                          No amounts yet
                        </Typography>
                      ) : (
                        <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
                          {totals.map(([cur, sum]) => (
                            <Typography key={cur} variant="body2" fontWeight={500} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                              {formatMoney(sum.toFixed(2), cur)}
                            </Typography>
                          ))}
                        </Stack>
                      )}
                      {missing > 0 && (
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0 }} />
                          <Typography variant="caption" color="text.secondary">
                            {missing} without amount
                          </Typography>
                        </Stack>
                      )}
                    </Stack>
                  )
                }
              />
            </Grid>
          );
        })}
      </Grid>

      <Paper variant="outlined" sx={{ borderRadius: '14px', overflow: 'hidden', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.03)' }}>
        {/* Toolbar: search, or batch actions when rows are selected. */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          sx={{
            px: 2,
            py: 1.25,
            minHeight: 60,
            transition: 'background-color .15s ease',
            bgcolor: selectedRows.length ? 'action.hover' : 'transparent',
          }}
        >
          {selectedRows.length > 0 ? (
            <>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Typography variant="body2" fontWeight={500}>
                  {selectedRows.length} selected
                </Typography>
                <Button size="small" color="inherit" onClick={() => setSelected(new Set())} disabled={Boolean(moving)}>
                  Clear
                </Button>
              </Stack>
              {next ? (
                <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="flex-end" useFlexGap flexWrap="wrap">
                  {withoutAmount.length > 0 && (
                    <Tooltip title="These calls have no invoice amount yet">
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main' }} />
                        <Typography variant="caption" color="text.secondary">
                          {withoutAmount.length} without amount
                        </Typography>
                      </Stack>
                    </Tooltip>
                  )}
                  {eligible.length < selectedRows.length && (
                    <Typography variant="caption" color="text.secondary">
                      {selectedRows.length - eligible.length} can’t move
                    </Typography>
                  )}
                  <Button
                    variant="contained"
                    endIcon={moving ? undefined : <ArrowForwardRounded />}
                    disabled={eligible.length === 0 || Boolean(moving)}
                    onClick={requestMove}
                  >
                    {moving ? (
                      <Stack direction="row" spacing={1} alignItems="center">
                        <CircularProgress size={16} color="inherit" />
                        <span>
                          Moving {moving.done}/{moving.total}…
                        </span>
                      </Stack>
                    ) : (
                      `Move ${eligible.length} to ${STATUS_LABELS[next]}`
                    )}
                  </Button>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Paid is the final stage.
                </Typography>
              )}
            </>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
                  {stage.label}
                </Box>
                {' · '}
                {stage.hint}
              </Typography>
              <SearchField value={search} onChange={setSearch} placeholder="Search profile, platform, people" />
            </>
          )}
        </Stack>

        {query.isLoading ? (
          <Box sx={{ p: 2 }}>
            <Stack spacing={1.25}>
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} variant="rounded" height={48} />
              ))}
            </Stack>
          </Box>
        ) : query.isError ? (
          <Box sx={{ p: 2 }}>
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          </Box>
        ) : rows.length === 0 ? (
          search ? (
            <EmptyState
              icon={<SearchOffRounded />}
              title="No calls match your search"
              action={
                <Button size="small" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ReceiptLongRounded />}
              title={`Nothing in “${stage.label}”`}
              description={
                tab === 'finished'
                  ? 'Calls appear here once an Expert marks them finished.'
                  : 'Move calls here from the previous stage.'
              }
              action={
                tab !== 'finished' && (
                  <Button size="small" onClick={() => changeTab(STAGES[STAGES.findIndex((s) => s.status === tab) - 1]!.status)}>
                    Go to previous stage
                  </Button>
                )
              }
            />
          )
        ) : (
          <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
            <InvoiceTable
              rows={rows}
              zone={zone}
              selected={selected}
              toggle={toggle}
              allChecked={allChecked}
              someChecked={someChecked}
              toggleAll={() => setSelected(allChecked ? new Set() : new Set(rows.map((c) => c.id)))}
              disabled={Boolean(moving)}
            />
          </Box>
        )}
      </Paper>

      {query.data && query.data.total > query.data.items.length && (
        <Alert severity="info" sx={{ mt: 2 }}>
          Showing the latest {query.data.items.length} of {query.data.total} invoicing calls.
        </Alert>
      )}

      <ConfirmDialog
        open={confirmMissing}
        title="Submit invoices without amounts?"
        description={
          <>
            {withoutAmount.length} of the {eligible.length} selected call{eligible.length === 1 ? ' has' : 's have'} no invoice
            amount. You can still submit and add amounts later.
          </>
        }
        confirmLabel={`Move ${eligible.length} anyway`}
        onConfirm={() => {
          void runMove();
        }}
        onClose={() => setConfirmMissing(false)}
      />
    </Box>
  );
}

function InvoiceTable({
  rows,
  zone,
  selected,
  toggle,
  allChecked,
  someChecked,
  toggleAll,
  disabled,
}: {
  rows: CallDTO[];
  zone: string;
  selected: Set<string>;
  toggle: (id: string) => void;
  allChecked: boolean;
  someChecked: boolean;
  toggleAll: () => void;
  disabled: boolean;
}) {
  return (
    <TableSurfaceInner>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                checked={allChecked}
                indeterminate={someChecked}
                onChange={toggleAll}
                disabled={disabled}
                slotProps={{ input: { 'aria-label': 'Select all calls' } }}
              />
            </TableCell>
            <TableCell>Profile · Platform</TableCell>
            <TableCell>Expert</TableCell>
            <TableCell>Associate</TableCell>
            <TableCell>Scheduled</TableCell>
            <TableCell>Amount</TableCell>
            <TableCell>Status</TableCell>
            <TableCell width={48}>
              <Box component="span" sx={SR_ONLY}>
                Open
              </Box>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((c) => {
            const isSelected = selected.has(c.id);
            return (
              <TableRow
                key={c.id}
                hover
                selected={isSelected}
                sx={{
                  '&:last-child td': { borderBottom: 0 },
                  '& td': { py: 1 },
                  '&.Mui-selected, &.Mui-selected:hover': { bgcolor: 'action.selected' },
                }}
              >
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={isSelected}
                    onChange={() => toggle(c.id)}
                    disabled={disabled}
                    slotProps={{ input: { 'aria-label': `Select call with ${c.profile.name}` } }}
                  />
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
                    <UserAvatar avatarId={c.profile.avatarId} photoId={c.profile.photoId} label={c.profile.name} size={30} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={550} noWrap sx={{ maxWidth: 200 }} title={c.profile.name}>
                        {c.profile.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap component="div" sx={{ maxWidth: 200 }} title={c.platform.name}>
                        {c.platform.name}
                      </Typography>
                    </Box>
                  </Stack>
                </TableCell>
                <TableCell>
                  <UserChip user={c.expert} size={24} showRole={false} />
                </TableCell>
                <TableCell>
                  <UserChip user={c.associate} size={24} showRole={false} />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" noWrap>
                    {formatDateTime(c.scheduledAt, zone)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {c.durationMinutes} min
                  </Typography>
                </TableCell>
                <TableCell>
                  <InvoiceAmountCell call={c} />
                </TableCell>
                <TableCell>
                  <StatusChip status={c.status} />
                </TableCell>
                <TableCell>
                  <Tooltip title="Open call">
                    <IconButton size="small" component={RouterLink} to={`/calls/${c.id}`} aria-label={`Open call with ${c.profile.name}`}>
                      <OpenInNewRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableSurfaceInner>
  );
}

/** Horizontal scroll container without an extra border (the Paper provides it). */
function TableSurfaceInner({ children }: { children: ReactNode }) {
  return <Box sx={{ overflowX: 'auto', '& table': { minWidth: 980 } }}>{children}</Box>;
}
