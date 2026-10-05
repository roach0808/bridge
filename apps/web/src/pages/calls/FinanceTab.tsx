import FilterListRounded from '@mui/icons-material/FilterListRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PaidOutlined from '@mui/icons-material/PaidOutlined';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Grid,
  IconButton,
  LinearProgress,
  Link,
  Menu,
  MenuItem,
  Popover,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { PAYEE_LABELS, type CallDTO, type FinanceCallsQuery, type Payee, type Role } from '@god/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows } from '@/components/common';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { formatUsd, inZone } from '@/lib/time';
import { StatTile, TableSurface, useIsPhone } from '../admin/adminShared';
import { PaidMark } from './money';

/** Every call with something still to pay; paid ones are on the Payment records tab. */
const QUERY: FinanceCallsQuery = { paid: 'unpaid', page: 1, pageSize: 1000 };

/**
 * The second tab of the Calls page: what is still to pay on the calls that
 * took place (§9.1). The Founder and Managers see each call's rate, invoice and
 * real income with the Expert and the Manager; an Associate their part; an
 * Expert their pay. Every column filters, several values at a time, and the
 * totals above follow the filters. Rows can be selected and marked paid by
 * whoever pays.
 */
export function FinanceTab() {
  const me = useMe();
  const { zone } = useAuth();
  const phone = useIsPhone();
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: qk.calls.finance(QUERY),
    queryFn: () => api.finance.calls(QUERY),
    placeholderData: keepPreviousData,
  });

  const columns = useMemo(() => columnsFor(me.role, zone), [me.role, zone]);
  const all = data?.items ?? [];
  const passes = (c: CallDTO, except?: string) =>
    columns.every((col) => col.key === except || !filters[col.key]?.length || filters[col.key]!.includes(col.value(c)));
  const rows = all.filter((c) => passes(c));
  const shown = rows.slice(page * pageSize, (page + 1) * pageSize);
  const filtering = Object.values(filters).some((v) => v.length);

  const setFilter = (key: string, values: string[]) => {
    setFilters((f) => ({ ...f, [key]: values }));
    setPage(0);
    setSelected(new Set());
  };
  /** Excel-like: a column offers the values left by the other columns' filters (and keeps its own). */
  const optionsFor = (col: Column) => {
    const counts = new Map<string, { count: number; sort: number | string }>();
    for (const c of all) {
      if (!passes(c, col.key)) continue;
      const v = col.value(c);
      const entry = counts.get(v) ?? { count: 0, sort: col.sort?.(c) ?? v };
      entry.count++;
      counts.set(v, entry);
    }
    for (const v of filters[col.key] ?? []) if (!counts.has(v)) counts.set(v, { count: 0, sort: v });
    return [...counts.entries()]
      .sort(([a, x], [b, y]) => (a === NONE ? 1 : b === NONE ? -1 : x.sort < y.sort ? -1 : x.sort > y.sort ? 1 : 0))
      .map(([value, { count }]) => ({ value, count }));
  };

  const selectedRows = rows.filter((c) => selected.has(c.id));
  // Only the Founder and Managers pay anyone, so only they select rows.
  const canSelect = me.role === 'founder' || me.role === 'manager';
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (isLoading || !data) return <LoadingRows rows={8} />;

  return (
    <Box>
      <Totals rows={rows} role={me.role} />

      {all.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PaidOutlined />}
            title="Nothing to pay"
            description="A call shows up here once it is finished, until everyone on it has been paid. Payments made are on the Payment records tab."
          />
        </Card>
      ) : (
        <>
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 1.5, minHeight: 32 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {filtering ? `${rows.length} of ${all.length} calls` : `${all.length} call${all.length === 1 ? '' : 's'}`}
            </Typography>
            {phone &&
              columns.map((col) => (
                <ColumnFilter key={col.key} label={col.label} chip options={optionsFor(col)} selected={filters[col.key] ?? []} onChange={(v) => setFilter(col.key, v)} />
              ))}
            {filtering && (
              <Button size="small" color="inherit" onClick={() => { setFilters({}); setPage(0); }}>
                Clear filters
              </Button>
            )}
          </Stack>

          {canSelect && selectedRows.length > 0 && (
            <PayBar rows={selectedRows} onDone={() => setSelected(new Set())} onClear={() => setSelected(new Set())} />
          )}

          <Box sx={{ position: 'relative' }}>
            {isFetching && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 1 }} />}
            {rows.length === 0 ? (
              <Card>
                <EmptyState icon={<FilterListRounded />} title="No calls match these filters" description="Clear a filter to see more." />
              </Card>
            ) : phone ? (
              <Stack spacing={1.25}>
                {shown.map((c) => (
                  <FinanceCard key={c.id} call={c} columns={columns} selectable={canSelect} selected={selected.has(c.id)} onToggle={() => toggle(c.id)} />
                ))}
              </Stack>
            ) : (
              <TableSurface minWidth={me.role === 'founder' || me.role === 'manager' ? 1040 : 720}>
                <Table size="small" sx={{ '& th, & td': { px: 1.25 }, '& th:first-of-type, & td:first-of-type': { pl: 2 } }}>
                  <TableHead>
                    <TableRow>
                      {canSelect && (
                        <TableCell padding="checkbox">
                          <Checkbox
                            size="small"
                            checked={shown.length > 0 && shown.every((c) => selected.has(c.id))}
                            indeterminate={shown.some((c) => selected.has(c.id)) && !shown.every((c) => selected.has(c.id))}
                            onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((c) => c.id)) : new Set())}
                            inputProps={{ 'aria-label': 'Select every call on this page' }}
                          />
                        </TableCell>
                      )}
                      {columns.map((col) => (
                        <TableCell key={col.key} align={col.align} sx={{ minWidth: col.width, whiteSpace: 'nowrap' }}>
                          <Stack direction="row" alignItems="center" spacing={0.25} justifyContent={col.align === 'right' ? 'flex-end' : 'flex-start'}>
                            <span>{col.label}</span>
                            <ColumnFilter label={col.label} options={optionsFor(col)} selected={filters[col.key] ?? []} onChange={(v) => setFilter(col.key, v)} />
                          </Stack>
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {shown.map((c) => (
                      <FinanceRow key={c.id} call={c} columns={columns} selectable={canSelect} selected={selected.has(c.id)} onToggle={() => toggle(c.id)} />
                    ))}
                  </TableBody>
                </Table>
              </TableSurface>
            )}
            {rows.length > 0 && (
              <TablePagination
                component="div"
                count={rows.length}
                page={Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1))}
                rowsPerPage={pageSize}
                rowsPerPageOptions={[25, 50, 100, 200]}
                onPageChange={(_, p) => setPage(p)}
                onRowsPerPageChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
              />
            )}
          </Box>
        </>
      )}
    </Box>
  );
}

// --- Columns -------------------------------------------------------------------

/** The filter value of an empty cell. */
const NONE = '—';

interface Column {
  key: string;
  label: string;
  align?: 'right';
  width?: number;
  /** What the column's filter matches: the cell as text. */
  value: (c: CallDTO) => string;
  /** How the filter lists its values (defaults to the text). */
  sort?: (c: CallDTO) => number | string;
  render: (c: CallDTO) => ReactNode;
}

const money = (n: number | null | undefined) => (n == null ? NONE : formatUsd(n));
const unpaid = (line: { amount: number | null; paidAt: string | null } | null | undefined): line is { amount: number; paidAt: null } =>
  Boolean(line && line.amount !== null && !line.paidAt);

/** A call's rate: the special rate for this call, or the Profile's rate on the platform. */
const rateOf = (c: CallDTO) => c.rateOverride ?? c.platformRate;

function Num({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <Typography variant="body2" component="span" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: muted ? 'text.secondary' : undefined }}>
      {children}
    </Typography>
  );
}

/** An amount someone is paid, with whether it was: "$180.00 ✓". Expected shares say so. */
function Pay({ line, zone }: { line: { amount: number | null; expected?: number | null; paidAt: string | null }; zone: string }) {
  const value = line.amount ?? line.expected ?? null;
  if (value === null) return <Typography variant="caption" color="warning.main">No rate</Typography>;
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ whiteSpace: 'nowrap' }}>
      <Num muted={line.amount === null}>
        {formatUsd(value)}
        {line.amount === null && (
          <Typography component="span" variant="caption" sx={{ ml: 0.5 }}>
            exp.
          </Typography>
        )}
      </Num>
      {line.amount !== null && <PaidMark line={line} zone={zone} compact />}
    </Stack>
  );
}

/** A person, then what they are paid underneath. */
function PersonPay({ name, children }: { name: string | null; children?: ReactNode }) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="body2" noWrap>
        {name ?? <Typography component="span" variant="caption" color="text.secondary">None</Typography>}
      </Typography>
      {children}
    </Stack>
  );
}

function columnsFor(role: Role, zone: string): Column[] {
  const when = (c: CallDTO) => inZone(c.scheduledAt, zone);
  const base: Column[] = [
    { key: 'profile', label: 'Profile', width: 130, value: (c) => c.profile.name, render: (c) => <Typography variant="body2" fontWeight={550} noWrap>{c.profile.name}</Typography> },
    { key: 'platform', label: 'Platform', width: 130, value: (c) => c.platform.name, render: (c) => c.platform.name },
    {
      key: 'time',
      label: 'Time',
      width: 120,
      // Filtered by day; shown to the minute.
      value: (c) => when(c).toFormat('MM/dd/yyyy'),
      sort: (c) => -when(c).startOf('day').toMillis(),
      render: (c) => <Num>{when(c).toFormat('MM/dd hh:mm a')}</Num>,
    },
  ];
  const duration: Column = {
    key: 'duration',
    label: 'Duration',
    align: 'right',
    width: 80,
    value: (c) => (c.actualDurationMinutes === null ? NONE : `${c.actualDurationMinutes} min`),
    sort: (c) => c.actualDurationMinutes ?? 0,
    render: (c) => <Num>{c.actualDurationMinutes === null ? NONE : `${c.actualDurationMinutes} min`}</Num>,
  };

  if (role === 'founder' || role === 'manager') {
    const founder = role === 'founder';
    return [
      ...base,
      {
        key: 'rate',
        label: 'Rate',
        align: 'right',
        width: 80,
        value: (c) => (rateOf(c) === null ? NONE : `${formatUsd(rateOf(c))}/h`),
        sort: (c) => rateOf(c) ?? 0,
        render: (c) =>
          rateOf(c) === null ? (
            <Typography variant="caption" color="warning.main">No rate</Typography>
          ) : (
            <Stack alignItems="flex-end">
              <Num>{formatUsd(rateOf(c))}/h</Num>
              {c.rateOverride !== null && <Typography variant="caption" color="text.secondary" noWrap>special rate</Typography>}
            </Stack>
          ),
      },
      duration,
      {
        key: 'invoice',
        label: 'Invoice amount',
        align: 'right',
        width: 110,
        value: (c) => money(c.expectedPrice),
        sort: (c) => c.expectedPrice ?? 0,
        render: (c) => <Num>{money(c.expectedPrice)}</Num>,
      },
      {
        key: 'real',
        label: 'Real income',
        align: 'right',
        width: 100,
        value: (c) => money(c.realIncome),
        sort: (c) => c.realIncome ?? 0,
        render: (c) => <Num muted={c.realIncome === null}>{money(c.realIncome)}</Num>,
      },
      {
        key: 'expert',
        label: 'Expert',
        width: 100,
        value: (c) => c.expert?.nickname ?? NONE,
        // Managers see who the Expert is, never what they are paid.
        render: (c) => <PersonPay name={c.expert?.nickname ?? null}>{founder && c.payouts.expert && <Pay line={c.payouts.expert} zone={zone} />}</PersonPay>,
      },
      {
        key: 'manager',
        label: 'Manager',
        width: 110,
        value: (c) => c.payouts.manager?.user?.nickname ?? c.manager?.nickname ?? NONE,
        render: (c) => {
          const m = c.payouts.manager;
          const a = c.payouts.associate;
          return (
            <PersonPay name={m?.user?.nickname ?? c.manager?.nickname ?? null}>
              {m?.user && <Pay line={m} zone={zone} />}
              {/* A Manager still passes the Associate's part on, out of their share. */}
              {!founder && a && !a.paidAt && (a.amount ?? a.expected) !== null && (
                <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.3 }}>
                  {a.user.nickname}’s part: {formatUsd(a.amount ?? a.expected)}
                  {a.amount === null ? ' exp.' : ''}
                </Typography>
              )}
            </PersonPay>
          );
        },
      },
    ];
  }

  if (role === 'associate') {
    return [
      ...base,
      duration,
      {
        key: 'managerShare',
        label: 'Manager’s share',
        align: 'right',
        width: 140,
        value: (c) => money(c.payouts.manager?.amount ?? c.payouts.manager?.expected),
        sort: (c) => c.payouts.manager?.amount ?? c.payouts.manager?.expected ?? 0,
        // Their Manager's share, not whether it was paid: that is between the Manager and the Founder.
        render: (c) => {
          const m = c.payouts.manager;
          return <Num muted={!m || m.amount === null}>{m ? `${money(m.amount ?? m.expected)}${m.amount === null && m.expected !== null ? ' exp.' : ''}` : NONE}</Num>;
        },
      },
      {
        key: 'mine',
        label: 'Your part',
        align: 'right',
        width: 140,
        value: (c) => money(c.payouts.associate?.amount ?? c.payouts.associate?.expected),
        sort: (c) => c.payouts.associate?.amount ?? c.payouts.associate?.expected ?? 0,
        render: (c) => (c.payouts.associate ? <Stack alignItems="flex-end"><Pay line={c.payouts.associate} zone={zone} /></Stack> : NONE),
      },
    ];
  }

  return [
    ...base,
    duration,
    {
      key: 'rate',
      label: 'Your rate',
      align: 'right',
      width: 110,
      value: (c) => (c.payouts.expert?.rate == null ? NONE : `${formatUsd(c.payouts.expert.rate)}/h`),
      sort: (c) => c.payouts.expert?.rate ?? 0,
      render: (c) =>
        c.payouts.expert?.rate == null ? <Typography variant="caption" color="warning.main">Not set</Typography> : <Num>{formatUsd(c.payouts.expert.rate)}/h</Num>,
    },
    {
      key: 'pay',
      label: 'Your pay',
      align: 'right',
      width: 130,
      value: (c) => money(c.payouts.expert?.amount),
      sort: (c) => c.payouts.expert?.amount ?? 0,
      render: (c) => (c.payouts.expert ? <Stack alignItems="flex-end"><Pay line={c.payouts.expert} zone={zone} /></Stack> : NONE),
    },
  ];
}

// --- Filters -------------------------------------------------------------------

/** A column's filter: tick any number of its values. Nothing ticked shows everything. */
function ColumnFilter({
  label,
  options,
  selected,
  onChange,
  chip,
}: {
  label: string;
  options: Array<{ value: string; count: number }>;
  selected: string[];
  onChange: (values: string[]) => void;
  /** Phones: a chip in the row above the cards, since there are no headers. */
  chip?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const active = selected.length > 0;
  const visible = options.filter((o) => o.value.toLowerCase().includes(search.trim().toLowerCase()));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);

  return (
    <>
      {chip ? (
        <Chip
          size="small"
          clickable
          icon={<FilterListRounded />}
          label={active ? `${label} (${selected.length})` : label}
          color={active ? 'primary' : 'default'}
          variant={active ? 'filled' : 'outlined'}
          onClick={(e) => setAnchor(e.currentTarget)}
        />
      ) : (
        <IconButton
          size="small"
          aria-label={`Filter ${label}`}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ p: 0.25, color: active ? 'primary.main' : 'text.disabled', '&:hover': { color: active ? 'primary.main' : 'text.secondary' } }}
        >
          <Badge badgeContent={selected.length} color="primary" invisible={!active} sx={{ '& .MuiBadge-badge': { fontSize: 10, height: 14, minWidth: 14, px: 0.4 } }}>
            <FilterListRounded sx={{ fontSize: 17 }} />
          </Badge>
        </IconButton>
      )}
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => {
          setAnchor(null);
          setSearch('');
        }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { width: 260, p: 1.25 } } }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          {label}
        </Typography>
        {options.length > 6 && (
          <TextField size="small" fullWidth autoFocus placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 0.75 }} />
        )}
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
          <Button size="small" onClick={() => onChange([...new Set([...selected, ...visible.map((o) => o.value)])])}>
            Select all
          </Button>
          <Button size="small" color="inherit" disabled={!active} onClick={() => onChange([])}>
            Clear
          </Button>
        </Stack>
        <Box sx={{ maxHeight: 300, overflowY: 'auto', mx: -0.5 }}>
          {visible.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1, py: 1 }}>
              Nothing matches.
            </Typography>
          )}
          {visible.map((o) => (
            <Stack
              key={o.value}
              component="label"
              direction="row"
              alignItems="center"
              sx={{ px: 0.5, borderRadius: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
            >
              <Checkbox size="small" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} sx={{ p: 0.5 }} />
              <Typography variant="body2" noWrap sx={{ flex: 1, ml: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                {o.value}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1, fontVariantNumeric: 'tabular-nums' }}>
                {o.count}
              </Typography>
            </Stack>
          ))}
        </Box>
      </Popover>
    </>
  );
}

// --- Totals --------------------------------------------------------------------

/** Statuses whose invoice is out and not paid yet. */
const ON_INVOICE = new Set(['invoice_submit', 'invoice_approve']);

const sumOf = (rows: CallDTO[], pick: (c: CallDTO) => number | null | undefined) => rows.reduce((t, c) => t + (pick(c) ?? 0), 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What is still to pay on the calls shown, and the calls that cannot be priced yet. */
function Totals({ rows, role }: { rows: CallDTO[]; role: Role }) {
  const tiles: Array<{ label: string; value: string; footer: string }> = [];

  if (role === 'founder' || role === 'manager') {
    const invoiced = rows.filter((c) => ON_INVOICE.has(c.status));
    const banked = rows.filter((c) => c.realIncome !== null);
    tiles.push({ label: 'Total income on invoice', value: formatUsd(sumOf(invoiced, (c) => c.expectedPrice)), footer: `${plural(invoiced.length, 'invoice')} waiting for the bank` });
    tiles.push({ label: 'Real income', value: formatUsd(sumOf(banked, (c) => c.realIncome)), footer: `from ${plural(banked.length, 'call')} paid to bank` });
  }
  if (role === 'founder') {
    const experts = rows.filter((c) => unpaid(c.payouts.expert));
    const managers = rows.filter((c) => c.payouts.manager?.user && c.payouts.manager.settled && unpaid(c.payouts.manager));
    const coming = rows.filter((c) => c.payouts.manager?.user && !c.payouts.manager.settled);
    tiles.push({ label: 'To pay Experts', value: formatUsd(sumOf(experts, (c) => c.payouts.expert?.amount)), footer: `for ${plural(experts.length, 'call')}` });
    tiles.push({
      label: 'To pay Managers',
      value: formatUsd(sumOf(managers, (c) => c.payouts.manager?.amount)),
      footer: `for ${plural(managers.length, 'call')} · ${formatUsd(sumOf(coming, (c) => c.payouts.manager?.expected))} more once the bank pays`,
    });
  }
  if (role === 'manager') {
    const mine = rows.filter((c) => c.payouts.manager?.settled && unpaid(c.payouts.manager));
    const coming = rows.filter((c) => c.payouts.manager && !c.payouts.manager.settled);
    tiles.push({
      label: 'Your share to receive',
      value: formatUsd(sumOf(mine, (c) => c.payouts.manager?.amount)),
      footer: `${formatUsd(sumOf(coming, (c) => c.payouts.manager?.expected))} more once the bank pays`,
    });
  }
  if (role === 'associate') {
    const parts = rows.filter((c) => c.payouts.associate && !c.payouts.associate.paidAt);
    tiles.push({
      label: 'Your part to come',
      value: formatUsd(sumOf(parts, (c) => c.payouts.associate?.amount ?? c.payouts.associate?.expected)),
      footer: `on ${plural(parts.length, 'call')}, paid by your Manager`,
    });
  }
  if (role === 'expert') {
    const pay = rows.filter((c) => unpaid(c.payouts.expert));
    tiles.push({ label: 'Your pay to come', value: formatUsd(sumOf(pay, (c) => c.payouts.expert?.amount)), footer: `for ${plural(pay.length, 'call')}` });
  }

  return (
    <Box sx={{ mb: 2.5 }}>
      <Grid container spacing={2}>
        {tiles.map((t) => (
          <Grid key={t.label} size={{ xs: 12, sm: 6, lg: tiles.length > 3 ? 3 : 12 / tiles.length }}>
            <StatTile label={t.label} value={t.value} footer={<Typography variant="body2" color="text.secondary">{t.footer}</Typography>} />
          </Grid>
        ))}
      </Grid>
      <Unpriced rows={rows} role={role} />
    </Box>
  );
}

/** Calls that cannot be invoiced or paid until someone sets a rate: which Profile, which platform, what is missing. */
function Unpriced({ rows, role }: { rows: CallDTO[]; role: Role }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const missing = rows.flatMap((c) => {
    const why: string[] = [];
    if ((role === 'founder' || role === 'manager') && c.expectedPrice === null && c.actualDurationMinutes !== null && rateOf(c) === null) {
      why.push(`no rate for ${c.profile.name} on ${c.platform.name}`);
    }
    if ((role === 'founder' || role === 'expert') && c.payouts.expert && c.payouts.expert.amount === null) {
      why.push(role === 'expert' ? 'your rate is not set yet' : `no rate for ${c.payouts.expert.user.nickname}`);
    }
    return why.length ? [{ call: c, why }] : [];
  });
  if (!missing.length) return null;

  return (
    <Alert
      severity="warning"
      sx={{ mt: 2, '& .MuiAlert-message': { width: '100%' } }}
      action={
        <Button color="inherit" size="small" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      }
    >
      {plural(missing.length, 'call')} without a rate: no invoice amount or pay until one is set.
      <Collapse in={open} unmountOnExit>
        <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
          {missing.map(({ call: c, why }) => (
            <li key={c.id}>
              <Link component="button" type="button" color="inherit" underline="hover" onClick={() => navigate(`/calls/${c.id}`)} sx={{ fontWeight: 600, verticalAlign: 'baseline' }}>
                {c.profile.name} · {c.platform.name}
              </Link>{' '}
              — {why.join('; ')}
            </li>
          ))}
        </Box>
      </Collapse>
    </Alert>
  );
}

// --- Rows ----------------------------------------------------------------------

interface RowProps {
  call: CallDTO;
  columns: Column[];
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}

function FinanceRow({ call: c, columns, selectable, selected, onToggle }: RowProps) {
  const navigate = useNavigate();
  return (
    <TableRow hover selected={selected} sx={{ cursor: 'pointer', '& td': { py: 1 } }} onClick={() => navigate(`/calls/${c.id}`)}>
      {selectable && (
        <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
          <Checkbox size="small" checked={selected} onChange={onToggle} inputProps={{ 'aria-label': `Select the call with ${c.profile.name}` }} />
        </TableCell>
      )}
      {columns.map((col) => (
        <TableCell key={col.key} align={col.align} sx={{ maxWidth: 200 }}>
          {col.render(c)}
        </TableCell>
      ))}
    </TableRow>
  );
}

/** Phones: the same fields as a card, one per line. */
function FinanceCard({ call: c, columns, selectable, selected, onToggle }: RowProps) {
  const navigate = useNavigate();
  const [title, , ...rest] = columns;
  return (
    <Card variant="outlined" sx={{ p: 1.5, cursor: 'pointer', borderColor: selected ? 'primary.main' : 'divider' }} onClick={() => navigate(`/calls/${c.id}`)}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        {selectable && (
          <Box onClick={(e) => e.stopPropagation()} sx={{ ml: -0.75, mt: -0.5 }}>
            <Checkbox size="small" checked={selected} onChange={onToggle} inputProps={{ 'aria-label': `Select the call with ${c.profile.name}` }} />
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {title!.render(c)}
          <Typography variant="caption" color="text.secondary" component="div">
            {c.platform.name}
          </Typography>
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            {rest.map((col) => (
              <Stack key={col.key} direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                <Typography variant="caption" color="text.secondary" sx={{ pt: 0.25 }}>
                  {col.label}
                </Typography>
                <Box sx={{ textAlign: 'right', '& > *': { alignItems: 'flex-end', justifyContent: 'flex-end' } }}>{col.render(c)}</Box>
              </Stack>
            ))}
          </Stack>
        </Box>
      </Stack>
    </Card>
  );
}

// --- Paying --------------------------------------------------------------------

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
      toast.success(`${PAYEE_LABELS[v.payee]} marked ${v.paid ? 'paid' : 'not paid'} on ${res.updated} call${res.updated === 1 ? '' : 's'}`);
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
