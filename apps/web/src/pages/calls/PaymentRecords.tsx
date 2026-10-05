import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import {
  Box,
  Card,
  Collapse,
  Grid,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  useColorScheme,
} from '@mui/material';
import { PAYEE_LABELS, TEAM_TIME_ZONE, type PayLine, type PaymentFigures, type PaymentPeriodKind, type PaymentStatsDTO } from '@god/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatUsd } from '@/lib/time';
import { FilterChips, StatTile, TableSurface } from '../admin/adminShared';

/** How far back each kind of period looks. */
const COUNT: Record<PaymentPeriodKind, number> = { week: 12, month: 12, year: 5 };
const SPAN: Record<PaymentPeriodKind, string> = { week: 'last 12 weeks', month: 'last 12 months', year: 'last 5 years' };

/**
 * The Payment records tab (§6.5a): what came in and went out, week by week,
 * month by month or year by year, in team time. The Founder sees the income,
 * what was paid to Experts and Managers and the balance, and who was paid
 * what; everyone else sees what they were paid themselves.
 */
export function PaymentRecords() {
  const me = useMe();
  const founder = me.role === 'founder';
  const [params, setParams] = useSearchParams();
  const period = (['week', 'year'].includes(params.get('period') ?? '') ? params.get('period') : 'month') as PaymentPeriodKind;
  const query = { period, count: COUNT[period] };
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: qk.calls.records(query),
    queryFn: () => api.finance.records(query),
    placeholderData: keepPreviousData,
  });

  const setPeriod = (p: PaymentPeriodKind) => {
    const next = new URLSearchParams(params);
    if (p === 'month') next.delete('period');
    else next.set('period', p);
    setParams(next, { replace: true });
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 2 }}>
        <FilterChips
          ariaLabel="Period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'week', label: 'Weekly' },
            { value: 'month', label: 'Monthly' },
            { value: 'year', label: 'Yearly' },
          ]}
        />
        <Typography variant="body2" color="text.secondary">
          {SPAN[period]} · New York time
        </Typography>
      </Stack>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading || !data ? (
        <LoadingRows rows={4} height={72} />
      ) : (
        <Records data={data} founder={founder} />
      )}
    </Box>
  );
}

function Records({ data, founder }: { data: PaymentStatsDTO; founder: boolean }) {
  const t = data.total;
  const paidOut = (f: PaymentFigures) => f.paidExperts + f.paidManagers;
  const mine = (f: PaymentFigures) => f.paidExperts + f.paidManagers + f.paidAssociates;
  const empty = founder ? data.periods.every((p) => !p.income && !paidOut(p)) : data.periods.every((p) => !mine(p));

  const tiles = founder
    ? [
        { label: 'Income received', value: t.income ?? 0 },
        { label: 'Paid to Experts', value: t.paidExperts },
        { label: 'Paid to Managers', value: t.paidManagers },
        { label: 'Balance', value: t.balance ?? 0 },
      ]
    : [{ label: 'You were paid', value: mine(t) }];

  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2}>
        {tiles.map((tile) => (
          <Grid key={tile.label} size={{ xs: 12, sm: 6, lg: founder ? 3 : 4 }}>
            <StatTile label={tile.label} value={formatUsd(tile.value)} />
          </Grid>
        ))}
      </Grid>

      {empty ? (
        <Card>
          <EmptyState icon={<ReceiptLongRounded />} title="No payments in this stretch" description="Every payment marked on the Finance tab counts here, in the period it was made." />
        </Card>
      ) : (
        <>
          <Card variant="outlined" sx={{ p: 2, borderRadius: '14px' }}>
            <PeriodChart data={data} founder={founder} />
          </Card>
          <PeriodTable data={data} founder={founder} />
          {founder && t.people.length > 0 && (
            <Box>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Who was paid · {SPAN[data.period]}
              </Typography>
              <PeopleTable people={t.people} />
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}

// --- Labels --------------------------------------------------------------------

const start = (iso: string) => DateTime.fromISO(iso, { zone: TEAM_TIME_ZONE });

/** "Sep 28 – Oct 4", "October 2026", "2026". */
function periodLabel(kind: PaymentPeriodKind, startIso: string, endIso: string) {
  const s = start(startIso);
  if (kind === 'year') return s.toFormat('yyyy');
  if (kind === 'month') return s.toFormat('LLLL yyyy');
  return `${s.toFormat('LLL d')} – ${start(endIso).minus({ days: 1 }).toFormat('LLL d')}`;
}

/** Axis labels: short, with the year where it turns. */
function axisLabel(kind: PaymentPeriodKind, startIso: string, i: number) {
  const s = start(startIso);
  if (kind === 'year') return s.toFormat('yyyy');
  if (kind === 'month') return i === 0 || s.month === 1 ? s.toFormat("LLL ''yy") : s.toFormat('LLL');
  return s.toFormat('LLL d');
}

// --- Chart ---------------------------------------------------------------------

/** Categorical slots 1 and 2 (blue, orange), stepped for each surface and checked for colour-blind separation. */
const SERIES = { light: ['#2a78d6', '#eb6834'], dark: ['#3987e5', '#d95926'] } as const;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** $1.2k, $15k, $0. */
const compactUsd = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : `$${Math.round(n)}`);

/** A round step for about four gridlines. */
function niceMax(max: number) {
  if (max <= 0) return { top: 100, step: 25 };
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { top: step * Math.ceil(max / step), step };
}

/** A column with a 4px rounded top, square on the baseline. */
function column(x: number, y: number, w: number, h: number) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

/**
 * Columns per period. The Founder: money in (income received) beside money out
 * (paid to Experts and Managers). Anyone else: what they were paid. One axis,
 * a tooltip per period with every figure.
 */
function PeriodChart({ data, founder }: { data: PaymentStatsDTO; founder: boolean }) {
  const { mode, systemMode } = useColorScheme();
  const dark = (mode === 'system' ? systemMode : mode) === 'dark';
  const colors = dark ? SERIES.dark : SERIES.light;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const series = founder
    ? [
        { label: 'Income received', value: (p: PaymentFigures) => p.income ?? 0 },
        { label: 'Paid out', value: (p: PaymentFigures) => p.paidExperts + p.paidManagers },
      ]
    : [{ label: 'You were paid', value: (p: PaymentFigures) => p.paidExperts + p.paidManagers + p.paidAssociates }];

  const height = 220;
  const pad = { top: 8, right: 4, bottom: 24, left: 44 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(0, ...data.periods.flatMap((p) => series.map((s) => s.value(p))));
  const { top, step } = niceMax(max);
  const slot = data.periods.length ? plotW / data.periods.length : 0;
  const gap = 2;
  const barW = Math.max(2, Math.min(24, (slot * 0.7 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  // Thin the axis labels so they never collide.
  const every = Math.max(1, Math.ceil(56 / Math.max(1, slot)));

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2">{founder ? 'Money in and out' : 'What you were paid'}</Typography>
        {series.length > 1 && (
          <Stack direction="row" spacing={2} component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }} aria-label="Legend">
            {series.map((s, i) => (
              <Stack key={s.label} component="li" direction="row" spacing={0.75} alignItems="center">
                <Box sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: colors[i] }} />
                <Typography variant="caption" color="text.secondary">
                  {s.label}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Stack>
      <Box ref={ref} sx={{ width: '100%' }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`${founder ? 'Income and payments' : 'Your pay'} by ${data.period}; the table below has every figure`}>
            {Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).map((v) => (
              <g key={v}>
                <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.25 : 0.08} />
                <text x={pad.left - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="currentColor" fillOpacity={0.6}>
                  {compactUsd(v)}
                </text>
              </g>
            ))}
            {data.periods.map((p, i) => {
              const x0 = pad.left + i * slot + (slot - groupW) / 2;
              return (
                <Tooltip
                  key={p.start}
                  followCursor
                  title={<PeriodTip kind={data.period} period={p} founder={founder} />}
                  onOpen={() => setHover(i)}
                  onClose={() => setHover(null)}
                >
                  <g>
                    <rect x={pad.left + i * slot} y={pad.top} width={slot} height={plotH} fill="currentColor" fillOpacity={hover === i ? 0.05 : 0} />
                    {series.map((s, k) => {
                      const v = s.value(p);
                      return <path key={s.label} d={column(x0 + k * (barW + gap), y(v), barW, y(0) - y(v))} fill={colors[k]} />;
                    })}
                    {i % every === 0 && (
                      <text x={pad.left + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.6}>
                        {axisLabel(data.period, p.start, i)}
                      </text>
                    )}
                  </g>
                </Tooltip>
              );
            })}
          </svg>
        )}
      </Box>
    </Box>
  );
}

function PeriodTip({ kind, period: p, founder }: { kind: PaymentPeriodKind; period: PaymentStatsDTO['periods'][number]; founder: boolean }) {
  const line = (label: string, value: number, strong?: boolean) => (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <span>{label}</span>
      <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 700 : 500 }}>
        {formatUsd(value)}
      </Box>
    </Stack>
  );
  return (
    <Box sx={{ minWidth: 180, py: 0.25 }}>
      <Box sx={{ fontWeight: 600, mb: 0.5 }}>{periodLabel(kind, p.start, p.end)}</Box>
      {founder ? (
        <>
          {line('Income received', p.income ?? 0)}
          {line('Paid to Experts', p.paidExperts)}
          {line('Paid to Managers', p.paidManagers)}
          {line('Balance', p.balance ?? 0, true)}
        </>
      ) : (
        line('You were paid', p.paidExperts + p.paidManagers + p.paidAssociates, true)
      )}
    </Box>
  );
}

// --- Tables --------------------------------------------------------------------

/** Every period, newest first; a row opens who was paid in it. */
function PeriodTable({ data, founder }: { data: PaymentStatsDTO; founder: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = [...data.periods].reverse();
  const cols = founder ? 6 : 3;
  const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;

  return (
    <TableSurface minWidth={founder ? 720 : 360}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Period</TableCell>
            {founder ? (
              <>
                <TableCell align="right">Income received</TableCell>
                <TableCell align="right">Paid to Experts</TableCell>
                <TableCell align="right">Paid to Managers</TableCell>
                <TableCell align="right">Balance</TableCell>
              </>
            ) : (
              <TableCell align="right">You were paid</TableCell>
            )}
            <TableCell padding="checkbox" />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((p) => {
            const isOpen = open === p.start;
            const quiet = !p.people.length && !p.income;
            return (
              <Fragment key={p.start}>
                <TableRow hover={!quiet} sx={{ cursor: quiet ? 'default' : 'pointer', '& > td': { borderBottom: isOpen ? 0 : undefined } }} onClick={() => !quiet && setOpen(isOpen ? null : p.start)}>
                  <TableCell sx={{ color: quiet ? 'text.secondary' : undefined }}>{periodLabel(data.period, p.start, p.end)}</TableCell>
                  {founder ? (
                    <>
                      <TableCell align="right" sx={num}>{formatUsd(p.income ?? 0)}</TableCell>
                      <TableCell align="right" sx={num}>{formatUsd(p.paidExperts)}</TableCell>
                      <TableCell align="right" sx={num}>{formatUsd(p.paidManagers)}</TableCell>
                      <TableCell align="right" sx={{ ...num, fontWeight: 600 }}>{formatUsd(p.balance ?? 0)}</TableCell>
                    </>
                  ) : (
                    <TableCell align="right" sx={{ ...num, fontWeight: 600 }}>{formatUsd(p.paidExperts + p.paidManagers + p.paidAssociates)}</TableCell>
                  )}
                  <TableCell padding="checkbox">
                    {!quiet && (
                      <IconButton size="small" aria-label={isOpen ? 'Hide who was paid' : 'Show who was paid'} sx={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>
                        <ExpandMoreRounded fontSize="small" />
                      </IconButton>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={cols} sx={{ py: 0, borderBottom: isOpen ? undefined : 0 }}>
                    <Collapse in={isOpen} unmountOnExit>
                      <Box sx={{ py: 1.5 }}>
                        {p.people.length ? (
                          <PeopleTable people={p.people} />
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            Income came in; nobody was paid.
                          </Typography>
                        )}
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </TableSurface>
  );
}

function PeopleTable({ people }: { people: PayLine[] }) {
  return (
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
          {people.map((l) => (
            <TableRow key={`${l.kind}:${l.user.id}`}>
              <TableCell>{l.user.nickname}</TableCell>
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
  );
}
