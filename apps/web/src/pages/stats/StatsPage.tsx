import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  IconButton,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import type { ProfilePeriodRow, ProfilePeriodStats, ProfilePeriodTotals } from '@god/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '@/auth/AuthProvider';
import { ErrorState, PageHeader } from '@/components/common';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/time';
import { StatTile, TableSurface } from '../admin/adminShared';

type Period = ProfilePeriodStats['period'];
type Measure = 'calls' | 'money';
type View = 'chart' | 'table';

const MONEY_LABEL: Record<ProfilePeriodStats['money'], string> = { invoice: 'Invoice amount', part: 'Your part', pay: 'Your pay' };
const MONEY_HINT: Record<ProfilePeriodStats['money'], string> = {
  invoice: 'Rate × how long each call ran.',
  part: 'Your part of each call you ran.',
  pay: 'Your rate × how long each call ran.',
};
const PERIOD_WORD: Record<Period, string> = { day: 'day', week: 'week', month: 'month' };

/** The bars' one colour, checked for contrast and saturation on each surface. */
const BAR = { light: '#0B8F86', dark: '#12A89A' };

const hoursOf = (minutes: number) => `${(minutes / 60).toLocaleString('en-US', { maximumFractionDigits: 1 })} h`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function periodLabel(start: string, period: Period, zone: string) {
  const d = DateTime.fromISO(start, { zone });
  if (period === 'day') return d.toFormat('cccc, LLLL d, yyyy');
  if (period === 'month') return d.toFormat('LLLL yyyy');
  const end = d.plus({ days: 6 });
  return d.month === end.month ? `${d.toFormat('LLL d')} – ${end.toFormat('d, yyyy')}` : `${d.toFormat('LLL d')} – ${end.toFormat('LLL d, yyyy')}`;
}

/** Round axis steps: 1, 2, 2.5 or 5 times a power of ten; whole numbers for counts. */
function niceTicks(max: number, whole: boolean): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  if (whole) step = Math.max(1, Math.ceil(step));
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

const compactUsd = (v: number) => (v >= 10000 ? `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K` : formatUsd(v).replace(/\.00$/, ''));

/** "+3 (+20%) vs last week", or nothing to compare. */
function Change({ now, before, period, money }: { now: number; before: number; period: Period; money?: boolean }) {
  if (now === 0 && before === 0) return <Typography variant="caption" color="text.secondary">None in this or the last {PERIOD_WORD[period]}</Typography>;
  const diff = Math.round((now - before) * 100) / 100;
  if (diff === 0) return <Typography variant="caption" color="text.secondary">Same as the {PERIOD_WORD[period]} before</Typography>;
  const pct = before ? Math.round((Math.abs(diff) / before) * 100) : null;
  const up = diff > 0;
  return (
    <Typography variant="caption" sx={{ color: up ? 'success.main' : 'error.main' }}>
      {up ? '▲' : '▼'} {money ? formatUsd(Math.abs(diff)) : Math.abs(diff)}
      {pct !== null ? ` (${pct}%)` : ''} vs the {PERIOD_WORD[period]} before
    </Typography>
  );
}

const PLOT_HEIGHT = 300;
const AXIS_BAND = 92;
const Y_AXIS = 56;
const SLOT_MIN = 44;
const BAR_WIDTH = 24;

/**
 * One column per Profile, tallest first. The bar is the hit target: hover or
 * keyboard focus shows the Profile's figures, which the table view also lists.
 */
function ProfileColumns({ rows, measure, money, label }: { rows: ProfilePeriodRow[]; measure: Measure; money: ProfilePeriodStats['money']; label: string }) {
  // The scrolling box sets the width: the chart fills it, and scrolls inside it when crowded.
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const value = (r: ProfilePeriodRow) => (measure === 'calls' ? r.calls : r.money);
  const sorted = [...rows].sort((a, b) => value(b) - value(a) || a.profile.name.localeCompare(b.profile.name));
  const ticks = niceTicks(Math.max(0, ...sorted.map(value)), measure === 'calls');
  const top = ticks.at(-1)!;
  const plotWidth = Math.max(width - Y_AXIS, sorted.length * SLOT_MIN);
  const slot = plotWidth / Math.max(1, sorted.length);
  const svgWidth = plotWidth + Y_AXIS;
  const y = (v: number) => PLOT_HEIGHT - (v / top) * PLOT_HEIGHT;
  const fmt = (v: number) => (measure === 'calls' ? String(v) : compactUsd(v));
  const best = sorted[0] ? value(sorted[0]) : 0;

  return (
    <Box sx={{ position: 'relative' }}>
      <Box ref={scroller} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)} sx={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <Box
          component="svg"
          role="img"
          aria-label={label}
          width={svgWidth}
          height={PLOT_HEIGHT + AXIS_BAND + 16}
          viewBox={`0 -16 ${svgWidth} ${PLOT_HEIGHT + AXIS_BAND + 16}`}
          sx={(t) => ({
            display: 'block',
            // Theme colours as CSS variables, so the dark scheme gets its own.
            '& .grid': { stroke: (t.vars ?? t).palette.divider, strokeWidth: 1, shapeRendering: 'crispEdges' },
            '& .tick, & .name': { fill: (t.vars ?? t).palette.text.secondary, fontSize: 12, fontFamily: 'inherit' },
            '& .cap': { fill: (t.vars ?? t).palette.text.primary, fontSize: 12, fontWeight: 600, fontFamily: 'inherit' },
            '& .bar': { fill: BAR.light, transition: 'opacity 120ms' },
            '& .hit:hover .bar, & .hit:focus-visible .bar': { opacity: 0.78 },
            '& .hit:focus-visible': { outline: 'none' },
            '& .hit:focus-visible .focus': { stroke: (t.vars ?? t).palette.text.primary, strokeWidth: 1.5 },
            ...t.applyStyles('dark', { '& .bar': { fill: BAR.dark } }),
          })}
        >
          {/* Recessive hairline grid, with round ticks. */}
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={Y_AXIS} x2={svgWidth} y1={y(t) + 0.5} y2={y(t) + 0.5} />
              <text className="tick" x={Y_AXIS - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmt(t)}
              </text>
            </g>
          ))}
          {sorted.map((r, i) => {
            const v = value(r);
            const cx = Y_AXIS + slot * i + slot / 2;
            const h = Math.max(v > 0 ? 2 : 0, (v / top) * PLOT_HEIGHT);
            const w = Math.min(BAR_WIDTH, slot - 8);
            const r4 = Math.min(4, h, w / 2);
            const name = r.profile.name.length > 18 ? `${r.profile.name.slice(0, 17)}…` : r.profile.name;
            return (
              <g
                key={r.profile.id}
                className="hit"
                tabIndex={0}
                role="graphics-symbol"
                aria-label={`${r.profile.name}: ${plural(r.calls, 'call')}, ${hoursOf(r.minutes)}, ${MONEY_LABEL[money]} ${formatUsd(r.money)}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                style={{ cursor: 'default' }}
              >
                {/* The whole slot answers the pointer, not only the painted bar. */}
                <rect x={cx - slot / 2} y={0} width={slot} height={PLOT_HEIGHT} fill="transparent" />
                {h > 0 && (
                  <path
                    className="bar"
                    d={`M${cx - w / 2},${PLOT_HEIGHT} V${PLOT_HEIGHT - h + r4} Q${cx - w / 2},${PLOT_HEIGHT - h} ${cx - w / 2 + r4},${PLOT_HEIGHT - h} H${cx + w / 2 - r4} Q${cx + w / 2},${PLOT_HEIGHT - h} ${cx + w / 2},${PLOT_HEIGHT - h + r4} V${PLOT_HEIGHT} Z`}
                  />
                )}
                <rect className="focus" x={cx - slot / 2 + 2} y={1} width={slot - 4} height={PLOT_HEIGHT - 1} fill="none" rx={4} />
                {/* The leader's figure on its cap; the rest are on the axis, in the tooltip and the table. */}
                {v === best && v > 0 && (
                  <text className="cap" x={cx} y={PLOT_HEIGHT - h - 6} textAnchor="middle">
                    {measure === 'calls' ? v : compactUsd(v)}
                  </text>
                )}
                <text className="name" transform={`translate(${cx + 4}, ${PLOT_HEIGHT + 12}) rotate(-40)`} textAnchor="end">
                  {name}
                </text>
              </g>
            );
          })}
          <line className="grid" x1={Y_AXIS} x2={svgWidth} y1={PLOT_HEIGHT + 0.5} y2={PLOT_HEIGHT + 0.5} />
        </Box>
      </Box>
      {active !== null && sorted[active] && (
        <Box
          role="tooltip"
          sx={{
            position: 'absolute',
            top: 4,
            left: Math.min(Math.max(0, Y_AXIS + slot * active + slot / 2 - 90 - scrollLeft), Math.max(0, width - 190)),
            width: 180,
            pointerEvents: 'none',
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            boxShadow: 3,
            px: 1.5,
            py: 1,
            zIndex: 2,
          }}
        >
          <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {measure === 'calls' ? plural(sorted[active].calls, 'call') : formatUsd(sorted[active].money)}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: 'break-word' }}>
            {sorted[active].profile.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {measure === 'calls' ? `${MONEY_LABEL[money]} ${formatUsd(sorted[active].money)}` : plural(sorted[active].calls, 'call')} · {hoursOf(sorted[active].minutes)}
            {sorted[active].unpriced > 0 && ` · ${sorted[active].unpriced} without a rate`}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

function ProfileTable({ rows, total, money }: { rows: ProfilePeriodRow[]; total: ProfilePeriodTotals; money: ProfilePeriodStats['money'] }) {
  const sorted = [...rows].sort((a, b) => b.calls - a.calls || b.money - a.money);
  const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
  return (
    <TableSurface minWidth={520}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Profile</TableCell>
            <TableCell align="right">Calls</TableCell>
            <TableCell align="right">Hours</TableCell>
            <TableCell align="right">{MONEY_LABEL[money]}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.profile.id}>
              <TableCell>{r.profile.name}</TableCell>
              <TableCell align="right" sx={num}>{r.calls}</TableCell>
              <TableCell align="right" sx={num}>{hoursOf(r.minutes)}</TableCell>
              <TableCell align="right" sx={num}>
                {formatUsd(r.money)}
                {r.unpriced > 0 && (
                  <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.75 }}>
                    {r.unpriced} without a rate
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow sx={{ '& td': { fontWeight: 600, color: 'text.primary' } }}>
            <TableCell>Total</TableCell>
            <TableCell align="right" sx={num}>{total.calls}</TableCell>
            <TableCell align="right" sx={num}>{hoursOf(total.minutes)}</TableCell>
            <TableCell align="right" sx={num}>{formatUsd(total.money)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </TableSurface>
  );
}

/**
 * Statistics, as one page: pick what the bars show (calls, or money), the
 * period (a day, a week or a month) and step back through earlier ones; each
 * Profile is a column. Everyone sees their own scope: the Founder the whole
 * company and a Manager their team, at the invoice amount; an Associate their
 * own calls and part; an Expert their own calls and pay.
 */
export default function StatsPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const period: Period = params.get('period') === 'day' || params.get('period') === 'month' ? (params.get('period') as Period) : 'week';
  const measure: Measure = params.get('show') === 'money' ? 'money' : 'calls';
  const view: View = params.get('view') === 'table' ? 'table' : 'chart';
  const date = params.get('date') ?? undefined;
  const set = (changes: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['stats', 'by-profile', period, date ?? 'today'],
    queryFn: () => api.stats.byProfile({ period, date }),
    placeholderData: keepPreviousData,
  });

  const zone = data?.zone ?? 'America/New_York';
  const moneyLabel = data ? MONEY_LABEL[data.money] : me.role === 'expert' ? 'Your pay' : me.role === 'associate' ? 'Your part' : 'Invoice amount';
  const current = useMemo(() => DateTime.now().setZone(zone).startOf(period).toISODate()!, [zone, period]);
  const isCurrent = !data || data.start >= current;
  const step = (n: number) => {
    if (!data) return;
    const next = DateTime.fromISO(data.start, { zone }).plus({ [`${period}s`]: n }).toISODate()!;
    set({ date: next >= current ? null : next });
  };

  return (
    <Box>
      <PageHeader
        title="Statistics"
        subtitle={
          me.role === 'founder'
            ? 'Calls delivered and invoice amount, Profile by Profile.'
            : me.role === 'manager'
              ? 'Your team’s calls delivered and invoice amount, Profile by Profile.'
              : me.role === 'expert'
                ? 'Your calls delivered and your pay, Profile by Profile.'
                : 'Your calls delivered and your part, Profile by Profile.'
        }
      />

      {/* One row of controls, above everything they change. */}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <ToggleButtonGroup size="small" exclusive value={measure} onChange={(_, v: Measure | null) => v && set({ show: v === 'calls' ? null : v })} aria-label="Bars show">
          <ToggleButton value="calls">Calls</ToggleButton>
          <ToggleButton value="money">{moneyLabel}</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButtonGroup size="small" exclusive value={period} onChange={(_, v: Period | null) => v && set({ period: v === 'week' ? null : v, date: null })} aria-label="Period">
          <ToggleButton value="day">Day</ToggleButton>
          <ToggleButton value="week">Week</ToggleButton>
          <ToggleButton value="month">Month</ToggleButton>
        </ToggleButtonGroup>
        <Stack direction="row" alignItems="center" spacing={0.25}>
          <Tooltip title={`The ${PERIOD_WORD[period]} before`}>
            <IconButton size="small" onClick={() => step(-1)} aria-label={`The ${PERIOD_WORD[period]} before`} disabled={!data}>
              <ChevronLeftRounded />
            </IconButton>
          </Tooltip>
          <Typography variant="body2" fontWeight={600} sx={{ minWidth: { sm: 190 }, textAlign: 'center' }} aria-live="polite">
            {data ? periodLabel(data.start, period, zone) : ' '}
          </Typography>
          <Tooltip title={isCurrent ? '' : `The ${PERIOD_WORD[period]} after`}>
            <span>
              <IconButton size="small" onClick={() => step(1)} aria-label={`The ${PERIOD_WORD[period]} after`} disabled={isCurrent}>
                <ChevronRightRounded />
              </IconButton>
            </span>
          </Tooltip>
          {!isCurrent && (
            <Button size="small" onClick={() => set({ date: null })}>
              This {PERIOD_WORD[period]}
            </Button>
          )}
        </Stack>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: View | null) => v && set({ view: v === 'chart' ? null : v })} aria-label="View">
          <ToggleButton value="chart">Chart</ToggleButton>
          <ToggleButton value="table">Table</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading || !data ? (
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={96} />
          <Skeleton variant="rounded" height={420} />
        </Stack>
      ) : (
        // Reloading keeps the last picture on screen, a little faded.
        <Box sx={{ opacity: isFetching ? 0.55 : 1, transition: 'opacity 150ms' }}>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatTile label="Calls delivered" value={data.total.calls} footer={<Change now={data.total.calls} before={data.previous.calls} period={period} />} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatTile label="Hours" value={hoursOf(data.total.minutes)} footer={<Typography variant="caption" color="text.secondary">{hoursOf(data.previous.minutes)} the {PERIOD_WORD[period]} before</Typography>} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatTile label={moneyLabel} value={formatUsd(data.total.money)} footer={<Change now={data.total.money} before={data.previous.money} period={period} money />} />
            </Grid>
          </Grid>

          <Card>
            <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
              <Typography variant="h6" component="h2">
                {measure === 'calls' ? 'Calls delivered' : moneyLabel} by Profile
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {periodLabel(data.start, period, zone)} · {plural(data.rows.length, 'Profile')}
                {measure === 'money' && ` · ${MONEY_HINT[data.money]}`}
              </Typography>
              {data.rows.length === 0 ? (
                <Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary', border: 1, borderColor: 'divider', borderStyle: 'dashed', borderRadius: 2 }}>
                  <Typography variant="body2">No calls were delivered in this {PERIOD_WORD[period]}.</Typography>
                </Box>
              ) : view === 'chart' ? (
                <ProfileColumns
                  rows={data.rows}
                  measure={measure}
                  money={data.money}
                  label={`${measure === 'calls' ? 'Calls delivered' : moneyLabel} by Profile, ${periodLabel(data.start, period, zone)}. ${data.rows.length} Profiles; the table view lists every figure.`}
                />
              ) : (
                <ProfileTable rows={data.rows} total={data.total} money={data.money} />
              )}
              {data.total.unpriced > 0 && (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
                  {plural(data.total.unpriced, 'call')} without a rate {data.total.unpriced === 1 ? 'is' : 'are'} counted in calls, not yet in the money.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Box>
      )}
    </Box>
  );
}
