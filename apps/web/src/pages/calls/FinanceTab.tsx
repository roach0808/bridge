import FilterListRounded from '@mui/icons-material/FilterListRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import PaidOutlined from '@mui/icons-material/PaidOutlined';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  Checkbox,
  CircularProgress,
  Collapse,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { CALL_STATUSES, PAYEE_LABELS, STATUS_LABELS, bankLabel, type CallDTO, type FinanceCallsPage, type FinanceCallsQuery, type Payee, type Role, type UpdateCallInput } from '@god/shared';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { ConfirmDialog, EmptyState, ErrorState, LoadingRows } from '@/components/common';
import { STATUS_COLORS, StatusSince } from '@/components/StatusChip';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { formatUsd, inZone } from '@/lib/time';
import { ColumnFilter } from '@/components/ColumnFilter';
import { TableSurface, useIsPhone } from '../admin/adminShared';
import { PaidMark } from './money';

/** Every call with something still to pay; paid ones are on the Payment records tab. */
const QUERY: FinanceCallsQuery = { paid: 'unpaid', page: 1, pageSize: 1000 };

/**
 * What is still to pay on the calls that took place (§9.1): the second tab of the
 * Calls page, and the main table of the Founder's dashboard — this one component
 * and one query in both places. The Founder and Managers see each call's rate, invoice and
 * real income with the Expert and the Manager; an Associate their part; an
 * Expert their pay. Every column filters, several values at a time, and the
 * top row totals every row the filters leave, on all pages. Rows can be selected and marked paid by
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

  // The same page controls above and below the table.
  const pager = (
    <TablePagination
      component="div"
      sx={{ '& .MuiTablePagination-toolbar': { px: 0, minHeight: 40 }, '& .MuiTablePagination-selectLabel': { display: { xs: 'none', sm: 'block' } } }}
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
  );
  const firstSerial = page * pageSize + 1;
  // Each column's share of the table's width, so every row fits on the screen.
  const widthOf = (weight: number) => `${(weight / (columns.reduce((t, col) => t + (col.width ?? 80), 0) + SERIAL_WIDTH + (canSelect ? CHECK_WIDTH : 0))) * 100}%`;

  return (
    <Box>
      <Unpriced rows={rows} role={me.role} />

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
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 1, minHeight: 32 }}>
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
            {rows.length > 0 && <Box sx={{ ml: 'auto' }}>{pager}</Box>}
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
                <TotalsCard rows={rows} columns={columns} />
                {shown.map((c, i) => (
                  <FinanceCard key={c.id} call={c} serial={firstSerial + i} columns={columns} selectable={canSelect} selected={selected.has(c.id)} onToggle={() => toggle(c.id)} />
                ))}
              </Stack>
            ) : (
              <TableSurface minWidth={me.role === 'founder' ? 960 : me.role === 'manager' ? 860 : 700}>
                <Table size="small" sx={FIT_TABLE}>
                  <colgroup>
                    {canSelect && <col style={{ width: widthOf(CHECK_WIDTH) }} />}
                    <col style={{ width: widthOf(SERIAL_WIDTH) }} />
                    {columns.map((col) => (
                      <col key={col.key} style={{ width: widthOf(col.width ?? 80) }} />
                    ))}
                  </colgroup>
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
                      <TableCell align="right">#</TableCell>
                      {columns.map((col) => (
                        <TableCell key={col.key} align={col.align} data-col={col.key}>
                          <Stack direction="row" alignItems="center" flexWrap="wrap" justifyContent={col.align === 'right' ? 'flex-end' : 'flex-start'}>
                            <span>{col.label}</span>
                            <ColumnFilter label={col.label} options={optionsFor(col)} selected={filters[col.key] ?? []} onChange={(v) => setFilter(col.key, v)} />
                          </Stack>
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {/* The totals of every row the filters leave, on all pages. */}
                    <TableRow sx={{ '& td': { bgcolor: 'action.hover', fontWeight: 600, verticalAlign: 'top' } }}>
                      {canSelect && <TableCell />}
                      <TableCell />
                      {columns.map((col, i) => (
                        <TableCell key={col.key} align={col.align} data-col={col.key}>
                          {i === 0 ? (
                            <>
                              Total
                              <Typography variant="caption" color="text.secondary" component="div">
                                {plural(rows.length, 'call')}
                              </Typography>
                            </>
                          ) : (
                            col.total?.(rows)
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                    {shown.map((c, i) => (
                      <FinanceRow key={c.id} call={c} serial={firstSerial + i} columns={columns} selectable={canSelect} selected={selected.has(c.id)} onToggle={() => toggle(c.id)} />
                    ))}
                  </TableBody>
                </Table>
              </TableSurface>
            )}
            {rows.length > 0 && pager}
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
  /** Its share of the table's width, against the other columns'. */
  width?: number;
  /** What the top row says for every row the filters leave, on all pages. */
  total?: (rows: CallDTO[]) => ReactNode;
  /** What the column's filter matches: the cell as text. */
  value: (c: CallDTO) => string;
  /** How the filter lists its values (defaults to the text). */
  sort?: (c: CallDTO) => number | string;
  render: (c: CallDTO) => ReactNode;
}

const CHECK_WIDTH = 30;
const SERIAL_WIDTH = 26;

/** Tight, and wrapping rather than scrolling: a whole row is in view at once. */
const FIT_TABLE = {
  tableLayout: 'fixed',
  '& th, & td': { px: 0.625, fontSize: 12.5 },
  '& td': { overflowWrap: 'anywhere' },
  '& th': { fontSize: 11.5, lineHeight: 1.2 },
  '& td .MuiTypography-body2': { fontSize: 12.5, lineHeight: 1.3 },
  '& td .MuiTypography-caption': { fontSize: 11 },
  '& th:first-of-type, & td:first-of-type': { pl: 0.75 },
  '& .MuiCheckbox-root': { p: 0.25 },
  '& th .MuiIconButton-root': { p: 0.125 },
  // Keeps it clear of the right-aligned money beside it.
  '& [data-col="bank"]': { pl: 1.5 },
} as const;

const money = (n: number | null | undefined) => (n == null ? NONE : formatUsd(n));

/** A call's rate: the special rate for this call, or the Profile's rate on the platform. */
const rateOf = (c: CallDTO) => c.rateOverride ?? c.platformRate;

function Num({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <Typography variant="body2" component="span" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: muted ? 'text.secondary' : undefined }}>
      {children}
    </Typography>
  );
}

/** A number in the top row, with what it needs explaining underneath. */
function Total({ value, notes = [] }: { value: string; notes?: string[] }) {
  return (
    <>
      <Typography variant="body2" component="div" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {value}
      </Typography>
      {notes.map((note) => (
        <Typography key={note} variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>
          {note}
        </Typography>
      ))}
    </>
  );
}

/**
 * What a column of pay adds up to, known or expected. Someone already paid on a
 * call stays in its row while another is still waiting, so what is left to pay
 * is said underneath when it is not the whole sum.
 */
function PayTotal({ rows, line, word }: { rows: CallDTO[]; line: (c: CallDTO) => { amount: number | null; expected?: number | null; paidAt: string | null } | null | undefined; word: string }) {
  const lines = rows.map(line).filter((l) => l != null);
  const known = lines.reduce((t, l) => t + (l.amount ?? 0), 0);
  const expected = lines.reduce((t, l) => t + (l.amount === null ? (l.expected ?? 0) : 0), 0);
  const left = lines.reduce((t, l) => t + (l.paidAt ? 0 : (l.amount ?? 0)), 0);
  const notes = [...(left !== known ? [`${formatUsd(left)} ${word}`] : []), ...(expected > 0 ? [`${formatUsd(expected)} exp.`] : [])];
  return <Total value={formatUsd(known + expected)} notes={notes} />;
}

const hoursAndMinutes = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  return h ? `${h}h ${minutes % 60}m` : `${minutes} min`;
};

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
      <Typography variant="body2">
        {name ?? <Typography component="span" variant="caption" color="text.secondary">None</Typography>}
      </Typography>
      {children}
    </Stack>
  );
}

/** Saves a change made right in a table row. */
function useSaveInRow(callId: string, onSaved: () => void) {
  const toast = useToast();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCallInput) => api.calls.update(callId, body),
    onSuccess: (saved) => {
      // Straight into the list, so the row never flashes the old value while it refreshes.
      queryClient.setQueriesData<FinanceCallsPage>({ queryKey: ['calls', 'finance'] }, (page) =>
        page && { ...page, items: page.items.map((row) => (row.id === saved.id ? saved : row)) },
      );
      void queryClient.invalidateQueries({ queryKey: qk.calls.all });
      onSaved();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** When a call's money should arrive: click to pick a date, or to clear it. */
function EtaCell({ call: c }: { call: CallDTO }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const save = useSaveInRow(c.id, () => setAnchor(null));
  const when = c.paymentEta ? DateTime.fromISO(c.paymentEta) : null;
  return (
    <Box onClick={(e) => e.stopPropagation()}>
      <Tooltip title={when ? when.toFormat('cccc, LLLL d, yyyy') : ''} placement="top" disableInteractive>
        <ButtonBase
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label={when ? `Change the ETA of the call with ${c.profile.name}, ${when.toFormat('LLLL d, yyyy')}` : `Set an ETA for the call with ${c.profile.name}`}
          sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 1, px: 0.5, py: 0.25, mx: -0.5, '&:hover': { bgcolor: 'action.selected' } }}
        >
          {when ? (
            <Num>{when.toFormat(when.hasSame(DateTime.now(), 'year') ? 'MM/dd' : 'MM/dd/yy')}</Num>
          ) : (
            <Typography variant="caption" color="text.disabled">
              Set
            </Typography>
          )}
        </ButtonBase>
      </Tooltip>
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <DateCalendar
          value={when}
          disabled={save.isPending}
          onChange={(v, state) => {
            if (v?.isValid && state === 'finish') save.mutate({ paymentEta: v.toISODate()! });
          }}
        />
        {when && (
          <Box sx={{ px: 2, pb: 1.5, textAlign: 'right' }}>
            <Button size="small" color="inherit" disabled={save.isPending} onClick={() => save.mutate({ paymentEta: null })}>
              Clear ETA
            </Button>
          </Box>
        )}
      </Popover>
    </Box>
  );
}

/**
 * A call's note, written right in its row: click it (or "Add note") to type.
 * Enter or leaving the field saves, Shift+Enter starts a new line, Esc cancels.
 */
function NoteCell({ call: c }: { call: CallDTO }) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = useSaveInRow(c.id, () => setDraft(null));
  // Saving disables the field, and the blur that follows must not save it again.
  const finish = (text: string) => {
    if (save.isPending || save.isSuccess) return;
    if (text.trim() === (c.notes ?? '').trim()) setDraft(null);
    else save.mutate({ notes: text });
  };

  if (draft !== null) {
    return (
      <Box onClick={(e) => e.stopPropagation()}>
        <TextField
          autoFocus
          multiline
          fullWidth
          size="small"
          maxRows={5}
          value={draft}
          disabled={save.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
          onBlur={() => finish(draft)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(null);
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              finish(draft);
            }
          }}
          placeholder="Add a note"
          slotProps={{ htmlInput: { 'aria-label': `Note on the call with ${c.profile.name}`, maxLength: 10000, sx: { fontSize: 13 } } }}
        />
      </Box>
    );
  }
  const open = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    save.reset();
    setDraft(c.notes ?? '');
  };
  return (
    <Tooltip title={c.notes ? <Box sx={{ whiteSpace: 'pre-wrap' }}>{c.notes}</Box> : ''} placement="top" disableInteractive>
      <ButtonBase
        onClick={open}
        aria-label={c.notes ? `Edit the note on the call with ${c.profile.name}` : `Add a note to the call with ${c.profile.name}`}
        sx={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 1, px: 0.5, py: 0.25, mx: -0.5, '&:hover': { bgcolor: 'action.selected' } }}
      >
        {c.notes ? (
          <Typography
            variant="body2"
            sx={{ fontSize: 13, lineHeight: 1.35, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {c.notes}
          </Typography>
        ) : (
          <Typography variant="caption" color="text.disabled">
            Add note
          </Typography>
        )}
      </ButtonBase>
    </Tooltip>
  );
}

function columnsFor(role: Role, zone: string): Column[] {
  const when = (c: CallDTO) => inZone(c.scheduledAt, zone);
  const base: Column[] = [
    { key: 'profile', label: 'Profile', width: 100, value: (c) => c.profile.name, render: (c) => <Typography variant="body2" fontWeight={550}>{c.profile.name}</Typography> },
    { key: 'platform', label: 'Platform', width: 78, value: (c) => c.platform.name, render: (c) => c.platform.name },
    {
      key: 'time',
      label: 'Time',
      width: 54,
      // Filtered by day; shown to the minute.
      value: (c) => when(c).toFormat('MM/dd/yyyy'),
      sort: (c) => -when(c).startOf('day').toMillis(),
      render: (c) => (
        <Stack>
          <Num>{when(c).toFormat('MM/dd')}</Num>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
            {when(c).toFormat('h:mm a')}
          </Typography>
        </Stack>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      width: 95,
      value: (c) => STATUS_LABELS[c.status],
      sort: (c) => CALL_STATUSES.indexOf(c.status),
      // A dot and words that may wrap: a pill would push the money columns off the page.
      render: (c) => (
        <Stack direction="row" spacing={0.75} alignItems="baseline">
          <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: STATUS_COLORS[c.status], flexShrink: 0, position: 'relative', top: -1 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2">{STATUS_LABELS[c.status]}</Typography>
            <StatusSince at={c.statusSince} zone={zone} />
          </Box>
        </Stack>
      ),
    },
  ];
  // The bank the invoice was submitted to: chosen at "Invoice submitted", so empty before (§6.9a).
  const bank: Column = {
    key: 'bank',
    label: 'Bank',
    width: 62,
    value: (c) => (c.bank ? bankLabel(c.bank) : NONE),
    render: (c) =>
      c.bank ? (
        <Stack spacing={0.25}>
          <Typography variant="body2">{bankLabel(c.bank)}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>
            {c.bank.nickname ? `${c.bank.bankType} ··${c.bank.accountLast4}` : c.bank.bankType}
            {!c.bank.isActive && ' · deactivated'}
          </Typography>
        </Stack>
      ) : (
        <Num muted>{NONE}</Num>
      ),
  };
  const duration: Column = {
    key: 'duration',
    label: 'Duration',
    align: 'right',
    width: 60,
    value: (c) => (c.actualDurationMinutes === null ? NONE : `${c.actualDurationMinutes} min`),
    sort: (c) => c.actualDurationMinutes ?? 0,
    total: (rows) => <Total value={hoursAndMinutes(sumOf(rows, (c) => c.actualDurationMinutes))} />,
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
        width: 62,
        value: (c) => (rateOf(c) === null ? NONE : `${formatUsd(rateOf(c))}/h`),
        sort: (c) => rateOf(c) ?? 0,
        render: (c) =>
          rateOf(c) === null ? (
            <Typography variant="caption" color="warning.main">No rate</Typography>
          ) : (
            <Stack alignItems="flex-end">
              <Num>{formatUsd(rateOf(c))}/h</Num>
              {c.rateOverride !== null && <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.2 }}>special rate</Typography>}
            </Stack>
          ),
      },
      duration,
      {
        key: 'invoice',
        label: 'Invoice amount',
        align: 'right',
        width: 76,
        value: (c) => money(c.expectedPrice),
        sort: (c) => c.expectedPrice ?? 0,
        total: (rows) => <Total value={formatUsd(sumOf(rows, (c) => c.expectedPrice))} />,
        render: (c) => <Num>{money(c.expectedPrice)}</Num>,
      },
      {
        key: 'real',
        label: 'Real income',
        align: 'right',
        width: 68,
        value: (c) => money(c.realIncome),
        sort: (c) => c.realIncome ?? 0,
        total: (rows) => <Total value={formatUsd(sumOf(rows, (c) => c.realIncome))} />,
        render: (c) => <Num muted={c.realIncome === null}>{money(c.realIncome)}</Num>,
      },
      bank,
      {
        key: 'expert',
        label: 'Expert',
        width: 78,
        value: (c) => c.expert?.nickname ?? NONE,
        // What Managers see of the Expert has no money in it.
        total: founder ? (rows) => <PayTotal rows={rows} line={(c) => c.payouts.expert} word="to pay" /> : undefined,
        // Managers see who the Expert is, never what they are paid.
        render: (c) => <PersonPay name={c.expert?.nickname ?? null}>{founder && c.payouts.expert && <Pay line={c.payouts.expert} zone={zone} />}</PersonPay>,
      },
      {
        key: 'manager',
        label: 'Manager',
        width: 80,
        value: (c) => c.payouts.manager?.user?.nickname ?? c.manager?.nickname ?? NONE,
        total: (rows) => <PayTotal rows={rows} line={(c) => (c.payouts.manager?.user ? c.payouts.manager : null)} word="to pay" />,
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
      // Once a call has taken place its ETA and note are the Founder's alone (§6.8).
      ...(founder
        ? [
            {
              key: 'eta',
              label: 'ETA',
              width: 50,
              value: (c: CallDTO) => (c.paymentEta ? DateTime.fromISO(c.paymentEta).toFormat('MM/dd/yyyy') : NONE),
              sort: (c: CallDTO) => c.paymentEta ?? '',
              render: (c: CallDTO) => <EtaCell call={c} />,
            },
            {
              key: 'note',
              label: 'Note',
              width: 84,
              value: (c: CallDTO) => (c.notes ? 'Has a note' : 'No note'),
              render: (c: CallDTO) => <NoteCell call={c} />,
            },
          ]
        : []),
    ];
  }

  if (role === 'associate') {
    return [
      ...base,
      duration,
      bank,
      {
        key: 'managerShare',
        label: 'Manager’s share',
        align: 'right',
        width: 100,
        value: (c) => money(c.payouts.manager?.amount ?? c.payouts.manager?.expected),
        sort: (c) => c.payouts.manager?.amount ?? c.payouts.manager?.expected ?? 0,
        total: (rows) => <Total value={formatUsd(sumOf(rows, (c) => c.payouts.manager?.amount ?? c.payouts.manager?.expected))} />,
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
        width: 100,
        value: (c) => money(c.payouts.associate?.amount ?? c.payouts.associate?.expected),
        sort: (c) => c.payouts.associate?.amount ?? c.payouts.associate?.expected ?? 0,
        total: (rows) => <PayTotal rows={rows} line={(c) => c.payouts.associate} word="to come" />,
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
      width: 80,
      value: (c) => (c.payouts.expert?.rate == null ? NONE : `${formatUsd(c.payouts.expert.rate)}/h`),
      sort: (c) => c.payouts.expert?.rate ?? 0,
      render: (c) =>
        c.payouts.expert?.rate == null ? <Typography variant="caption" color="warning.main">Not set</Typography> : <Num>{formatUsd(c.payouts.expert.rate)}/h</Num>,
    },
    {
      key: 'pay',
      label: 'Your pay',
      align: 'right',
      width: 90,
      value: (c) => money(c.payouts.expert?.amount),
      sort: (c) => c.payouts.expert?.amount ?? 0,
      total: (rows) => <PayTotal rows={rows} line={(c) => c.payouts.expert} word="to come" />,
      render: (c) => (c.payouts.expert ? <Stack alignItems="flex-end"><Pay line={c.payouts.expert} zone={zone} /></Stack> : NONE),
    },
  ];
}

// --- Totals --------------------------------------------------------------------

const sumOf = (rows: CallDTO[], pick: (c: CallDTO) => number | null | undefined) => rows.reduce((t, c) => t + (pick(c) ?? 0), 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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
      sx={{ mb: 2, '& .MuiAlert-message': { width: '100%' } }}
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
  /** Its place in the list, counting across pages. */
  serial: number;
  columns: Column[];
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
}

function FinanceRow({ call: c, serial, columns, selectable, selected, onToggle }: RowProps) {
  const navigate = useNavigate();
  return (
    <TableRow hover selected={selected} sx={{ cursor: 'pointer', '& td': { py: 1 } }} onClick={() => navigate(`/calls/${c.id}`)}>
      {selectable && (
        <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
          <Checkbox size="small" checked={selected} onChange={onToggle} inputProps={{ 'aria-label': `Select the call with ${c.profile.name}` }} />
        </TableCell>
      )}
      <TableCell align="right" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
        {serial}
      </TableCell>
      {columns.map((col) => (
        <TableCell key={col.key} align={col.align} data-col={col.key}>
          {col.render(c)}
        </TableCell>
      ))}
    </TableRow>
  );
}

/** Phones: the top row of the table, as a card above the others. */
function TotalsCard({ rows, columns }: { rows: CallDTO[]; columns: Column[] }) {
  return (
    <Card variant="outlined" sx={{ p: 1.5, bgcolor: 'action.hover' }}>
      <Typography variant="body2" fontWeight={600}>
        Total · {plural(rows.length, 'call')}
      </Typography>
      <Stack spacing={0.75} sx={{ mt: 1 }}>
        {columns
          .filter((col) => col.total)
          .map((col) => (
            <Stack key={col.key} direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
              <Typography variant="caption" color="text.secondary" sx={{ pt: 0.25 }}>
                {col.label}
              </Typography>
              <Box sx={{ textAlign: 'right' }}>{col.total!(rows)}</Box>
            </Stack>
          ))}
      </Stack>
    </Card>
  );
}

/** Phones: the same fields as a card, one per line. */
function FinanceCard({ call: c, serial, columns, selectable, selected, onToggle }: RowProps) {
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
            #{serial} · {c.platform.name}
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
