import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PaidOutlined from '@mui/icons-material/PaidOutlined';
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  CircularProgress,
  Grid,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { PAYEE_LABELS, type CallDTO, type FinanceCallsQuery, type FinanceSummary, type Payee, type Role } from '@god/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows } from '@/components/common';
import { UserAvatar, UserChip } from '@/components/identity';
import { StatusChip } from '@/components/StatusChip';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { durationLabel, formatUsd, whenAndLength, zoneAbbr } from '@/lib/time';
import { FilterChips, SearchField, StatTile, TableSurface, useDebouncedValue, useIsPhone } from '../admin/adminShared';
import { PaidMark, callMoney, formatPercent } from './money';

type PaidFilter = 'all' | 'unpaid' | 'paid';

/** What "settled" means depends on who is looking. */
const PAID_LABELS: Record<Role, { unpaid: string; paid: string }> = {
  founder: { unpaid: 'Still to pay', paid: 'Settled' },
  manager: { unpaid: 'Open', paid: 'Settled' },
  associate: { unpaid: 'Not paid yet', paid: 'Paid' },
  expert: { unpaid: 'Not paid yet', paid: 'Paid' },
};

/**
 * The second tab of the Calls page: one person's own financial dashboard over
 * the calls that took place (§9.1). The Founder sees what each call brings in
 * and what they owe the Expert and the Manager; a Manager their share and what
 * they pass on to the Associate; an Associate their part; an Expert their pay.
 * Rows can be selected and marked paid by whoever pays.
 */
export function FinanceTab() {
  const me = useMe();
  const { zone } = useAuth();
  const [params, setParams] = useSearchParams();
  const paid = (['unpaid', 'paid'].includes(params.get('paid') ?? '') ? params.get('paid') : 'all') as PaidFilter;
  const from = params.get('from');
  const to = params.get('to');
  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '50');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(search.trim(), 300);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const update = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
    setSelected(new Set());
  };

  const query: FinanceCallsQuery = {
    paid,
    from: from ? DateTime.fromISO(from, { zone }).startOf('day').toUTC().toISO()! : undefined,
    to: to ? DateTime.fromISO(to, { zone }).endOf('day').toUTC().toISO()! : undefined,
    q: q || undefined,
    page,
    pageSize,
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: qk.calls.finance(query),
    queryFn: () => api.finance.calls(query),
    placeholderData: keepPreviousData,
  });

  const rows = data?.items ?? [];
  const selectedRows = rows.filter((c) => selected.has(c.id));
  // Only the Founder and Managers pay anyone, so only they select rows.
  const canSelect = me.role === 'founder' || me.role === 'manager';
  const labels = PAID_LABELS[me.role];
  const phone = useIsPhone();
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Box>
      {data && <SummaryTiles summary={data.summary} role={me.role} />}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 2, '& .MuiOutlinedInput-root': { bgcolor: 'background.paper' } }}>
        <FilterChips
          ariaLabel="Filter by payment"
          value={paid}
          onChange={(v) => update({ paid: v === 'all' ? null : v })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'unpaid', label: labels.unpaid, color: '#e0913a' },
            { value: 'paid', label: labels.paid, color: '#3fb68b' },
          ]}
        />
        <Box sx={{ flex: 1 }} />
        <SearchField value={search} onChange={(v) => { setSearch(v); if (!v) update({ q: null }); }} placeholder="Search profile, platform, person" />
        <Stack direction="row" spacing={1.5}>
          <DatePicker
            label={`From (${zoneAbbr(zone)})`}
            value={from ? DateTime.fromISO(from) : null}
            onChange={(v) => update({ from: v?.isValid ? v.toISODate() : null })}
            slotProps={{ textField: { size: 'small', sx: { width: { xs: '50%', md: 150 } } }, field: { clearable: true } }}
          />
          <DatePicker
            label={`To (${zoneAbbr(zone)})`}
            value={to ? DateTime.fromISO(to) : null}
            onChange={(v) => update({ to: v?.isValid ? v.toISODate() : null })}
            slotProps={{ textField: { size: 'small', sx: { width: { xs: '50%', md: 150 } } }, field: { clearable: true } }}
          />
        </Stack>
      </Stack>

      {canSelect && selectedRows.length > 0 && (
        <PayBar rows={selectedRows} onDone={() => setSelected(new Set())} onClear={() => setSelected(new Set())} />
      )}

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading || !data ? (
        <LoadingRows rows={8} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PaidOutlined />}
            title={paid !== 'all' || q || from || to ? 'No calls match these filters' : 'No calls have taken place yet'}
            description={
              paid !== 'all' || q || from || to
                ? 'Try another filter or date range.'
                : 'A call shows up here once it is finished, with what it pays and to whom.'
            }
          />
        </Card>
      ) : (
        <Box sx={{ position: 'relative' }}>
          {isFetching && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 1 }} />}
          {phone ? (
            <Stack spacing={1.25}>
              {rows.map((c) => (
                <FinanceRow
                  key={c.id}
                  card
                  call={c}
                  role={me.role}
                  zone={zone}
                  selectable={canSelect}
                  selected={selected.has(c.id)}
                  onToggle={() => toggle(c.id)}
                />
              ))}
            </Stack>
          ) : (
          <TableSurface minWidth={me.role === 'founder' ? 940 : 820}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {canSelect && (
                    <TableCell padding="checkbox">
                      <Checkbox
                        size="small"
                        checked={selectedRows.length === rows.length}
                        indeterminate={selectedRows.length > 0 && selectedRows.length < rows.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((c) => c.id)) : new Set())}
                        inputProps={{ 'aria-label': 'Select every call on this page' }}
                      />
                    </TableCell>
                  )}
                  <TableCell sx={{ minWidth: 170 }}>Call</TableCell>
                  <TableCell>Status</TableCell>
                  {me.role !== 'expert' && <TableCell>Income</TableCell>}
                  {COLUMNS[me.role].map((c) => (
                    <TableCell key={c.key} sx={{ minWidth: c.width }}>
                      {c.label}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((c) => (
                  <FinanceRow
                    key={c.id}
                    call={c}
                    role={me.role}
                    zone={zone}
                    selectable={canSelect}
                    selected={selected.has(c.id)}
                    onToggle={() => toggle(c.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </TableSurface>
          )}
          <TablePagination
            component="div"
            count={data.total}
            page={page - 1}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[25, 50, 100, 200]}
            onPageChange={(_, p) => update({ page: String(p + 1) }, false)}
            onRowsPerPageChange={(e) => update({ pageSize: e.target.value })}
          />
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------

function SummaryTiles({ summary: s, role }: { summary: FinanceSummary; role: Role }) {
  const tiles: Array<{ label: string; value: ReactNode; footer?: ReactNode; color?: string }> = [];
  const owed = (paid: number, unpaid: number, paidWord: string, unpaidWord: string) => (
    <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      {formatUsd(paid)} {paidWord} · <Box component="span" sx={{ color: unpaid > 0 ? 'warning.main' : 'text.secondary', fontWeight: 600 }}>{formatUsd(unpaid)} {unpaidWord}</Box>
    </Typography>
  );

  if (s.income) {
    tiles.push({
      label: 'Income',
      value: formatUsd(s.income.real),
      color: '#3fb68b',
      footer: (
        <Typography variant="body2" color="text.secondary">
          received · {formatUsd(s.income.expected)} expected still to come
          {s.income.unpriced > 0 ? ` · ${s.income.unpriced} without a rate` : ''}
        </Typography>
      ),
    });
  }
  if (role === 'founder') {
    const paidSoFar = (n: number) => (
      <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatUsd(n)} paid so far
      </Typography>
    );
    if (s.expert) tiles.push({ label: 'To pay Experts', value: formatUsd(s.expert.unpaid), color: '#e0913a', footer: paidSoFar(s.expert.paid) });
    if (s.manager) tiles.push({ label: 'To pay Managers', value: formatUsd(s.manager.unpaid), color: '#e0913a', footer: paidSoFar(s.manager.paid) });
    if (s.associate)
      tiles.push({
        label: 'Associates’ part, with their Managers',
        value: formatUsd(s.associate.unpaid),
        footer: (
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            not passed on yet · {formatUsd(s.associate.paid)} passed on
          </Typography>
        ),
      });
  }
  if (role === 'manager') {
    if (s.manager) tiles.push({ label: 'Your share', value: formatUsd(s.manager.paid + s.manager.unpaid), color: '#5b8def', footer: owed(s.manager.paid, s.manager.unpaid, 'received', 'owed to you') });
    if (s.associate) tiles.push({ label: 'Your Associates’ part', value: formatUsd(s.associate.unpaid), color: '#e0913a', footer: owed(s.associate.paid, s.associate.unpaid, 'paid', 'to pay') });
    if (s.keeps !== null) tiles.push({ label: 'Yours to keep', value: formatUsd(s.keeps), footer: <Typography variant="body2" color="text.secondary">after the Associates’ part</Typography> });
  }
  if (role === 'associate' && s.associate) {
    tiles.push({ label: 'Your part', value: formatUsd(s.associate.paid + s.associate.unpaid), color: '#5b8def', footer: owed(s.associate.paid, s.associate.unpaid, 'paid', 'to come') });
  }
  if (role === 'expert' && s.expert) {
    tiles.push({
      label: 'Your pay to date',
      value: formatUsd(s.expert.paid + s.expert.unpaid),
      color: '#5b8def',
      footer: (
        <Typography variant="body2" color="text.secondary">
          {s.calls} call{s.calls === 1 ? '' : 's'} · {durationLabel(s.expert.minutes)}
          {s.expert.unpriced > 0 ? ` · ${s.expert.unpriced} without a rate yet` : ''}
        </Typography>
      ),
    });
    tiles.push({ label: 'Not paid yet', value: formatUsd(s.expert.unpaid), color: '#e0913a', footer: owed(s.expert.paid, s.expert.unpaid, 'paid', 'to come') });
  }

  return (
    <Grid container spacing={2} sx={{ mb: 2.5 }}>
      {tiles.map((t) => (
        <Grid key={t.label} size={{ xs: 12, sm: 6, lg: tiles.length > 3 ? 3 : 4 }}>
          <StatTile label={t.label} value={t.value} color={t.color} footer={t.footer} />
        </Grid>
      ))}
    </Grid>
  );
}

// ---------------------------------------------------------------------------

const COLUMNS: Record<Role, Array<{ key: string; label: string; width?: number }>> = {
  founder: [
    { key: 'expert', label: 'Expert', width: 150 },
    // The Associate's part is paid out of the Manager's share, so it sits under it.
    { key: 'manager', label: 'Manager (incl. Associate’s part)', width: 200 },
  ],
  manager: [
    { key: 'mine', label: 'Your share', width: 150 },
    { key: 'associate', label: 'Associate’s part', width: 170 },
    { key: 'keeps', label: 'You keep', width: 100 },
  ],
  associate: [{ key: 'mine', label: 'Your part', width: 150 }],
  expert: [
    { key: 'minutes', label: 'Duration', width: 90 },
    { key: 'rate', label: 'Rate', width: 90 },
    { key: 'pay', label: 'Your pay', width: 150 },
  ],
};

/** A payout that only exists once the bank has paid. */
const AfterBank = () => (
  <Tooltip title="Worked out from the real income once the call is paid to bank">
    <Typography variant="caption" color="text.disabled">
      After bank
    </Typography>
  </Tooltip>
);

function Amount({ value, percent, muted }: { value: number | null; percent?: number; muted?: boolean }) {
  return (
    <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums', color: muted ? 'text.secondary' : 'text.primary' }}>
      {value === null ? 'No rate' : formatUsd(value)}
      {percent !== undefined && (
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
          {formatPercent(percent)}
        </Typography>
      )}
    </Typography>
  );
}

function FinanceRow({
  call: c,
  role,
  zone,
  selectable,
  selected,
  onToggle,
  card,
}: {
  call: CallDTO;
  role: Role;
  zone: string;
  /** Phones: a card with the same content, one field per line. */
  card?: boolean;
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const navigate = useNavigate();
  const money = callMoney(c, role);
  const { expert, manager, associate } = c.payouts;
  const open = () => navigate(`/calls/${c.id}`);

  const cells: Record<string, ReactNode> = {
    expert: expert ? (
      <Stack spacing={0.25}>
        <UserChip user={expert.user} size={20} showRole={false} />
        <Stack direction="row" spacing={1} alignItems="center">
          <Amount value={expert.amount} />
          {expert.amount !== null && <PaidMark line={expert} zone={zone} />}
        </Stack>
      </Stack>
    ) : (
      '—'
    ),
    manager: manager ? (
      <Stack spacing={0.25}>
        {manager.user ? <UserChip user={manager.user} size={20} showRole={false} /> : <Typography variant="caption" color="text.secondary">No Manager</Typography>}
        <Stack direction="row" spacing={1} alignItems="center">
          <Amount value={manager.amount} percent={manager.percent} />
          {manager.user && <PaidMark line={manager} zone={zone} />}
        </Stack>
        {associate && (
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary' }}>
            <Typography variant="caption" noWrap>
              {associate.user.nickname} {formatUsd(associate.amount)} ({formatPercent(associate.percent)})
            </Typography>
            <PaidMark line={associate} zone={zone} compact />
          </Stack>
        )}
      </Stack>
    ) : (
      <AfterBank />
    ),
    associate: associate ? (
      <Stack spacing={0.25}>
        <UserChip user={associate.user} size={20} showRole={false} />
        <Stack direction="row" spacing={1} alignItems="center">
          <Amount value={associate.amount} percent={associate.percent} />
          <PaidMark line={associate} zone={zone} />
        </Stack>
      </Stack>
    ) : c.status === 'process_to_bank' ? (
      <Typography variant="caption" color="text.disabled">
        None
      </Typography>
    ) : (
      <AfterBank />
    ),
    mine:
      role === 'manager' ? (
        manager ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <Amount value={manager.amount} percent={manager.percent} />
            <PaidMark line={manager} zone={zone} />
          </Stack>
        ) : (
          <AfterBank />
        )
      ) : associate ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <Amount value={associate.amount} percent={associate.percent} />
          <PaidMark line={associate} zone={zone} />
        </Stack>
      ) : c.status === 'process_to_bank' ? (
        <Typography variant="caption" color="text.disabled">
          None
        </Typography>
      ) : (
        <AfterBank />
      ),
    keeps: manager?.keeps != null ? <Amount value={manager.keeps} muted /> : <AfterBank />,
    minutes: expert?.minutes != null ? durationLabel(expert.minutes) : '—',
    rate: expert?.rate != null ? `${formatUsd(expert.rate)}/h` : <Typography variant="caption" color="warning.main">Not set</Typography>,
    pay: expert ? (
      <Stack direction="row" spacing={1} alignItems="center">
        <Amount value={expert.amount} />
        {expert.amount !== null && <PaidMark line={expert} zone={zone} />}
      </Stack>
    ) : (
      '—'
    ),
  };

  if (card) {
    return (
      <Card variant="outlined" sx={{ p: 1.5, cursor: 'pointer', borderColor: selected ? 'primary.main' : 'divider' }} onClick={open}>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          {selectable && (
            <Box onClick={(e) => e.stopPropagation()} sx={{ ml: -0.75, mt: -0.5 }}>
              <Checkbox size="small" checked={selected} onChange={onToggle} inputProps={{ 'aria-label': `Select the call with ${c.profile.name}` }} />
            </Box>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={550} noWrap>
                  {c.profile.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {c.platform.name} · {whenAndLength(c.scheduledAt, zone, c.durationMinutes)}
                </Typography>
              </Box>
              <StatusChip status={c.status} />
            </Stack>
            <Stack spacing={1} sx={{ mt: 1.25 }}>
              {money && (
                <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                  <Typography variant="caption" color="text.secondary">
                    {money.label}
                  </Typography>
                  <Typography variant="body2" fontWeight={650} sx={{ color: money.color }}>
                    {money.value}
                  </Typography>
                </Stack>
              )}
              {COLUMNS[role].map((col) => (
                <Stack key={col.key} direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                  <Typography variant="caption" color="text.secondary" sx={{ pt: 0.25 }}>
                    {col.label}
                  </Typography>
                  <Box sx={{ textAlign: 'right', '& > *': { alignItems: 'flex-end', justifyContent: 'flex-end' } }}>{cells[col.key]}</Box>
                </Stack>
              ))}
            </Stack>
          </Box>
        </Stack>
      </Card>
    );
  }

  return (
    <TableRow hover selected={selected} sx={{ cursor: 'pointer', '& td': { py: 1 } }} onClick={open}>
      {selectable && (
        <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
          <Checkbox size="small" checked={selected} onChange={onToggle} inputProps={{ 'aria-label': `Select the call with ${c.profile.name}` }} />
        </TableCell>
      )}
      <TableCell>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <UserAvatar avatarId={c.profile.avatarId} photoId={c.profile.photoId} label={c.profile.name} size={28} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={550} noWrap>
              {c.profile.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.35 }}>
              {c.platform.name}
              <br />
              {whenAndLength(c.scheduledAt, zone, c.durationMinutes)}
            </Typography>
          </Box>
        </Stack>
      </TableCell>
      <TableCell>
        <StatusChip status={c.status} />
      </TableCell>
      {role !== 'expert' && (
        <TableCell>
          {money ? (
            <Tooltip title={money.hint}>
              <Box>
                <Typography variant="body2" fontWeight={650} sx={{ color: money.color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {money.value}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  {money.label === 'Real income' ? 'Real' : 'Expected'}
                </Typography>
              </Box>
            </Tooltip>
          ) : (
            '—'
          )}
        </TableCell>
      )}
      {COLUMNS[role].map((col) => (
        <TableCell key={col.key}>{cells[col.key]}</TableCell>
      ))}
    </TableRow>
  );
}

// ---------------------------------------------------------------------------

/**
 * Appears once rows are selected: one button per person the viewer pays, for
 * the selected calls where that person is still waiting. Undoing is in the menu.
 */
function PayBar({ rows, onDone, onClear }: { rows: CallDTO[]; onDone: () => void; onClear: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [confirm, setConfirm] = useState<{ payee: Payee; paid: boolean; ids: string[]; total: number } | null>(null);

  const payees = useMemo(() => {
    const out: Array<{ payee: Payee; unpaid: CallDTO[]; paid: CallDTO[] }> = [];
    for (const payee of ['expert', 'manager', 'associate'] as const) {
      const markable = rows.filter((c) => c.payouts.canMark.includes(payee));
      if (!markable.length) continue;
      out.push({
        payee,
        unpaid: markable.filter((c) => !c.payouts[payee]?.paidAt),
        paid: markable.filter((c) => Boolean(c.payouts[payee]?.paidAt)),
      });
    }
    return out;
  }, [rows]);

  const mark = useMutation({
    mutationFn: (v: { payee: Payee; paid: boolean; ids: string[] }) => api.finance.markPaid({ payee: v.payee, callIds: v.ids, paid: v.paid }),
    onSuccess: (res, v) => {
      void queryClient.invalidateQueries({ queryKey: qk.calls.all });
      toast.success(
        `${PAYEE_LABELS[v.payee]} marked ${v.paid ? 'paid' : 'not paid'} on ${res.updated} call${res.updated === 1 ? '' : 's'}`,
      );
      setConfirm(null);
      onDone();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const sum = (list: CallDTO[], payee: Payee) => list.reduce((t, c) => t + (c.payouts[payee]?.amount ?? 0), 0);

  return (
    <Alert
      severity="info"
      icon={false}
      sx={{ mb: 2, alignItems: 'center', bgcolor: 'background.paper', border: 1, borderColor: 'divider', color: 'text.primary', '& .MuiAlert-message': { width: '100%' } }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
        <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
          {rows.length} selected
        </Typography>
        {payees.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing to pay on these calls yet.
          </Typography>
        ) : (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {payees.map(({ payee, unpaid }) => (
              <Button
                key={payee}
                variant="contained"
                size="small"
                startIcon={mark.isPending && mark.variables?.payee === payee ? <CircularProgress size={14} color="inherit" /> : <PaidOutlined />}
                disabled={!unpaid.length || mark.isPending}
                onClick={() => setConfirm({ payee, paid: true, ids: unpaid.map((c) => c.id), total: sum(unpaid, payee) })}
              >
                Paid to {PAYEE_LABELS[payee].toLowerCase()}
                {unpaid.length ? ` (${unpaid.length})` : ''}
              </Button>
            ))}
          </Stack>
        )}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={0.5}>
          <Button size="small" color="inherit" onClick={onClear}>
            Clear
          </Button>
          {payees.some((p) => p.paid.length) && (
            <>
              <IconButton size="small" aria-label="More" onClick={(e) => setMenu(e.currentTarget)}>
                <MoreVertRounded fontSize="small" />
              </IconButton>
              <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
                {payees
                  .filter((p) => p.paid.length)
                  .map(({ payee, paid }) => (
                    <MenuItem
                      key={payee}
                      onClick={() => {
                        setMenu(null);
                        setConfirm({ payee, paid: false, ids: paid.map((c) => c.id), total: sum(paid, payee) });
                      }}
                    >
                      Mark {PAYEE_LABELS[payee].toLowerCase()} not paid ({paid.length})
                    </MenuItem>
                  ))}
              </Menu>
            </>
          )}
        </Stack>
      </Stack>
      <ConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm
            ? confirm.paid
              ? `Mark ${formatUsd(confirm.total)} paid to the ${PAYEE_LABELS[confirm.payee].toLowerCase()}?`
              : `Mark the ${PAYEE_LABELS[confirm.payee].toLowerCase()} not paid?`
            : ''
        }
        description={
          confirm
            ? confirm.paid
              ? `${confirm.ids.length} call${confirm.ids.length === 1 ? '' : 's'}. Each person is told they were paid, and sees it on their calls.`
              : `${confirm.ids.length} call${confirm.ids.length === 1 ? '' : 's'} go back to not paid, for a payment that did not happen.`
            : ''
        }
        confirmLabel={confirm?.paid ? 'Mark paid' : 'Mark not paid'}
        destructive={confirm ? !confirm.paid : false}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm) await mark.mutateAsync(confirm);
        }}
      />
    </Alert>
  );
}
