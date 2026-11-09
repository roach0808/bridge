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
import { STATS_START, type ProfilePeriodStats, type ProfilePeriodTotals, type TrendPoint, type TrendStats } from '@god/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '@/auth/AuthProvider';
import { ErrorState, PageHeader } from '@/components/common';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/time';
import { StatTile, TableSurface } from '../admin/adminShared';

type Period = ProfilePeriodStats['period'];
type Metric = 'calls' | 'hours' | 'money';
type View = 'chart' | 'table';
type MoneyKind = ProfilePeriodStats['money'];

const MONEY_LABEL: Record<MoneyKind, string> = { invoice: 'Invoice amount', part: 'Your part', pay: 'Your pay' };
const MONEY_HINT: Record<MoneyKind, string> = {
  invoice: 'Rate × how long each call ran.',
  part: 'Your part of each call you ran.',
  pay: 'Your rate × how long each call ran.',
};
const PERIOD_WORD: Record<Period, string> = { day: 'day', week: 'week', month: 'month' };
/** How far back the trend reaches. */
const TREND_SPAN: Record<Period, string> = { day: 'last 30 days', week: 'last 12 weeks', month: 'last 12 months' };

/** The bars' one colour, checked for contrast and saturation on each surface. */
const BAR = { light: '#0B8F86', dark: '#12A89A' };

const hoursOf = (minutes: number) => `${(minutes / 60).toLocaleString('en-US', { maximumFractionDigits: 1 })} h`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const compactUsd = (v: number) => (v >= 10000 ? `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}K` : formatUsd(v).replace(/\.00$/, ''));
const oneDecimal = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** A metric's value on a period or a Profile, and how to write it. */
const valueOf = (t: ProfilePeriodTotals, m: Metric) => (m === 'calls' ? t.calls : m === 'hours' ? Math.round((t.minutes / 60) * 100) / 100 : t.money);
const writeOf = (v: number, m: Metric) => (m === 'calls' ? oneDecimal(v) : m === 'hours' ? `${oneDecimal(v)} h` : formatUsd(v));
/** A value with its unit, short: on a column's top and on the average line. */
const withUnit = (v: number, m: Metric) => (m === 'calls' ? `${oneDecimal(v)} ${v === 1 ? 'call' : 'calls'}` : m === 'hours' ? `${oneDecimal(v)} h` : compactUsd(v));
const tickOf = (v: number, m: Metric) => (m === 'money' ? compactUsd(v) : m === 'hours' ? `${oneDecimal(v)}` : String(v));

function periodLabel(start: string, period: Period, zone: string) {
  const d = DateTime.fromISO(start, { zone });
  if (period === 'day') return d.toFormat('cccc, LLLL d, yyyy');
  if (period === 'month') return d.toFormat('LLLL yyyy');
  const end = d.plus({ days: 6 });
  return d.month === end.month ? `${d.toFormat('LLL d')} – ${end.toFormat('d, yyyy')}` : `${d.toFormat('LLL d')} – ${end.toFormat('LLL d, yyyy')}`;
}

/** The short name of a period on the time axis. */
function axisLabel(start: string, period: Period, zone: string, previous?: string) {
  const d = DateTime.fromISO(start, { zone });
  if (period === 'month') return !previous || DateTime.fromISO(previous, { zone }).year !== d.year ? d.toFormat('LLL yyyy') : d.toFormat('LLL');
  return d.toFormat('LLL d');
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

/** "▲ 3 (20%) vs the week before", or nothing to compare. */
function Change({ now, before, period, metric }: { now: number; before: number; period: Period; metric: Metric }) {
  if (now === 0 && before === 0) return <Typography variant="caption" color="text.secondary">None in this or the last {PERIOD_WORD[period]}</Typography>;
  const diff = Math.round((now - before) * 100) / 100;
  if (diff === 0) return <Typography variant="caption" color="text.secondary">Same as the {PERIOD_WORD[period]} before</Typography>;
  const pct = before ? Math.round((Math.abs(diff) / before) * 100) : null;
  const up = diff > 0;
  return (
    <Typography variant="caption" sx={{ color: up ? 'success.main' : 'error.main' }}>
      {up ? '▲' : '▼'} {writeOf(Math.abs(diff), metric)}
      {pct !== null ? ` (${pct}%)` : ''} vs the {PERIOD_WORD[period]} before
    </Typography>
  );
}

// --- One column chart, for time and for Profiles ------------------------------------------

interface Column {
  key: string;
  /** Under the column. */
  axis: string;
  value: number;
  /** Shown in full on hover, focus and in the accessible name. */
  title: string;
  /** Full colour; the others are a lighter shade of the same hue. */
  emphasis?: boolean;
}

const PLOT_HEIGHT = 280;
const Y_AXIS = 56;
const SLOT_MIN = 44;
const BAR_WIDTH = 24;

/**
 * Columns from one baseline, at most 24px wide with rounded tops, on a hairline
 * grid with round ticks. Each column's whole slot answers hover and keyboard
 * focus with `tooltip`. Optional: an average line, the axis labels set on a
 * slant (for names) and only every so often (for dates), a value on the tallest.
 */
function Columns({
  columns,
  metric,
  label,
  tooltip,
  average,
  slanted = false,
}: {
  columns: Column[];
  metric: Metric;
  label: string;
  tooltip: (index: number) => ReactNode;
  average?: number;
  slanted?: boolean;
}) {
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

  const axisBand = slanted ? 92 : 30;
  const ticks = niceTicks(Math.max(0, ...columns.map((c) => c.value), average ?? 0), metric === 'calls');
  const top = ticks.at(-1)!;
  // Names need room and scroll when they do not fit; time always fits the width, with thinner bars.
  const plotWidth = slanted ? Math.max(width - Y_AXIS, columns.length * SLOT_MIN) : width - Y_AXIS;
  const slot = plotWidth / Math.max(1, columns.length);
  const svgWidth = plotWidth + Y_AXIS;
  const y = (v: number) => PLOT_HEIGHT - (v / top) * PLOT_HEIGHT;
  const best = Math.max(0, ...columns.map((c) => c.value));
  const bestIndex = columns.findIndex((c) => c.value === best && best > 0);
  // Dates along the bottom only every so often, so they never collide.
  const every = slanted ? 1 : Math.max(1, Math.ceil(60 / slot));

  return (
    <Box sx={{ position: 'relative' }}>
      <Box ref={scroller} onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)} sx={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <Box
          component="svg"
          role="img"
          aria-label={label}
          width={svgWidth}
          height={PLOT_HEIGHT + axisBand + 18}
          viewBox={`0 -18 ${svgWidth} ${PLOT_HEIGHT + axisBand + 18}`}
          sx={(t) => ({
            display: 'block',
            // Theme colours as CSS variables, so the dark scheme gets its own.
            '& .grid': { stroke: (t.vars ?? t).palette.divider, strokeWidth: 1, shapeRendering: 'crispEdges' },
            '& .avg': { stroke: (t.vars ?? t).palette.text.secondary, strokeWidth: 1, shapeRendering: 'crispEdges' },
            '& .tick, & .name': { fill: (t.vars ?? t).palette.text.secondary, fontSize: 12, fontFamily: 'inherit' },
            '& .cap, & .avg-label': { fill: (t.vars ?? t).palette.text.primary, fontSize: 12, fontWeight: 600, fontFamily: 'inherit' },
            // A halo of the card's colour, so the label reads across a bar.
            '& .avg-label': { paintOrder: 'stroke', stroke: (t.vars ?? t).palette.background.paper, strokeWidth: 4, strokeLinejoin: 'round' },
            '& .name.now': { fill: (t.vars ?? t).palette.text.primary, fontWeight: 700 },
            '& .bar': { fill: BAR.light, transition: 'opacity 120ms' },
            '& .bar.context': { opacity: 0.45 },
            '& .hit:hover .bar, & .hit:focus-visible .bar': { opacity: 0.8 },
            '& .hit:focus-visible': { outline: 'none' },
            '& .hit:focus-visible .focus': { stroke: (t.vars ?? t).palette.text.primary, strokeWidth: 1.5 },
            ...t.applyStyles('dark', { '& .bar': { fill: BAR.dark } }),
          })}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid" x1={Y_AXIS} x2={svgWidth} y1={y(t) + 0.5} y2={y(t) + 0.5} />
              <text className="tick" x={Y_AXIS - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {tickOf(t, metric)}
              </text>
            </g>
          ))}
          {columns.map((c, i) => {
            const cx = Y_AXIS + slot * i + slot / 2;
            const h = Math.max(c.value > 0 ? 2 : 0, (c.value / top) * PLOT_HEIGHT);
            const w = Math.max(4, Math.min(BAR_WIDTH, slot - (slot > 20 ? 8 : 3)));
            const r4 = Math.min(4, h, w / 2);
            const emphasised = columns.some((x) => x.emphasis);
            const axis = slanted && c.axis.length > 18 ? `${c.axis.slice(0, 17)}…` : c.axis;
            return (
              <g
                key={c.key}
                className="hit"
                tabIndex={0}
                role="graphics-symbol"
                aria-label={`${c.title}: ${writeOf(c.value, metric)}`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive((a) => (a === i ? null : a))}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
              >
                {/* The whole slot answers the pointer, not only the painted bar. */}
                <rect x={cx - slot / 2} y={0} width={slot} height={PLOT_HEIGHT} fill="transparent" />
                {h > 0 && (
                  <path
                    className={`bar${emphasised && !c.emphasis ? ' context' : ''}`}
                    d={`M${cx - w / 2},${PLOT_HEIGHT} V${PLOT_HEIGHT - h + r4} Q${cx - w / 2},${PLOT_HEIGHT - h} ${cx - w / 2 + r4},${PLOT_HEIGHT - h} H${cx + w / 2 - r4} Q${cx + w / 2},${PLOT_HEIGHT - h} ${cx + w / 2},${PLOT_HEIGHT - h + r4} V${PLOT_HEIGHT} Z`}
                  />
                )}
                <rect className="focus" x={cx - slot / 2 + 1} y={1} width={Math.max(2, slot - 2)} height={PLOT_HEIGHT - 1} fill="none" rx={3} />
                {i === bestIndex && (
                  <text className="cap" x={cx} y={PLOT_HEIGHT - h - 6} textAnchor="middle">
                    {withUnit(Math.round(c.value * 100) / 100, metric)}
                  </text>
                )}
                {/* Every so often, and always the chosen one, never crowding it. */}
                {(slanted || c.emphasis || i === columns.length - 1 || (i % every === 0 && !columns.slice(i + 1, i + every).some((x) => x.emphasis) && columns.length - 1 - i >= every)) &&
                  (slanted ? (
                    <text className="name" transform={`translate(${cx + 4}, ${PLOT_HEIGHT + 12}) rotate(-40)`} textAnchor="end">
                      {axis}
                    </text>
                  ) : (
                    <text className={`name${c.emphasis ? ' now' : ''}`} x={Math.min(cx, svgWidth - 22)} y={PLOT_HEIGHT + 18} textAnchor="middle">
                      {axis}
                    </text>
                  ))}
              </g>
            );
          })}
          {average !== undefined && average > 0 && (
            <g aria-hidden>
              <line className="avg" x1={Y_AXIS} x2={svgWidth} y1={y(average) + 0.5} y2={y(average) + 0.5} />
              <text className="avg-label" x={Y_AXIS + 6} y={y(average) - 6} textAnchor="start">
                Average {withUnit(Math.round(average * 100) / 100, metric)}
              </text>
            </g>
          )}
          <line className="grid" x1={Y_AXIS} x2={svgWidth} y1={PLOT_HEIGHT + 0.5} y2={PLOT_HEIGHT + 0.5} />
        </Box>
      </Box>
      {active !== null && columns[active] && (
        <Box
          role="tooltip"
          sx={{
            position: 'absolute',
            top: 4,
            left: Math.min(Math.max(0, Y_AXIS + slot * active + slot / 2 - 95 - scrollLeft), Math.max(0, width - 200)),
            width: 190,
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
          {tooltip(active)}
        </Box>
      )}
    </Box>
  );
}

/** What a tooltip says about a period or a Profile: the chosen figure first, the others after. */
function Readout({ totals, metric, money, title }: { totals: ProfilePeriodTotals; metric: Metric; money: MoneyKind; title: string }) {
  const others = (['calls', 'hours', 'money'] as const)
    .filter((m) => m !== metric)
    .map((m) => (m === 'calls' ? plural(totals.calls, 'call') : m === 'hours' ? hoursOf(totals.minutes) : `${MONEY_LABEL[money]} ${formatUsd(totals.money)}`));
  return (
    <>
      <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {metric === 'calls' ? plural(totals.calls, 'call') : writeOf(valueOf(totals, metric), metric)}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ wordBreak: 'break-word' }}>
        {title}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {others.join(' · ')}
        {totals.unpriced > 0 && ` · ${totals.unpriced} without a rate`}
      </Typography>
    </>
  );
}

// --- The trend: the chosen figure over time, and what it adds up to --------------------

interface TrendSummary {
  total: number;
  average: number;
  best: { value: number; start: string } | null;
  lowest: { value: number; start: string } | null;
  /** Percent change from the earlier half of the span to the recent half; null when the earlier half is empty. */
  trend: number | null;
  /** The chosen (last) period against the average, in percent. */
  againstAverage: number | null;
  /** Periods with at least one delivered call. */
  active: number;
}

function summarise(points: TrendPoint[], metric: Metric): TrendSummary {
  const values = points.map((p) => valueOf(p, metric));
  const total = Math.round(values.reduce((t, v) => t + v, 0) * 100) / 100;
  const average = values.length ? total / values.length : 0;
  let best: TrendSummary['best'] = null;
  let lowest: TrendSummary['lowest'] = null;
  points.forEach((p, i) => {
    if (!best || values[i]! > best.value) best = { value: values[i]!, start: p.start };
    if (!lowest || values[i]! < lowest.value) lowest = { value: values[i]!, start: p.start };
  });
  const half = Math.floor(values.length / 2);
  const earlier = values.slice(0, half).reduce((t, v) => t + v, 0);
  const recent = values.slice(values.length - half).reduce((t, v) => t + v, 0);
  const last = values.at(-1) ?? 0;
  return {
    total,
    average,
    best: best && (best as { value: number }).value > 0 ? best : null,
    lowest,
    trend: earlier > 0 ? Math.round(((recent - earlier) / earlier) * 100) : null,
    againstAverage: average > 0 ? Math.round(((last - average) / average) * 100) : null,
    active: points.filter((p) => p.calls > 0).length,
  };
}

/** One figure of the trend's summary. */
function Figure({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'up' | 'down' }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant="subtitle1" fontWeight={700} sx={{ color: tone === 'up' ? 'success.main' : tone === 'down' ? 'error.main' : 'text.primary', lineHeight: 1.3 }}>
        {value}
      </Typography>
      {note && (
        <Typography variant="caption" color="text.secondary" component="div" noWrap>
          {note}
        </Typography>
      )}
    </Box>
  );
}

const signed = (pct: number) => `${pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : ''}${Math.abs(pct)}%`;

function TrendCard({ trend, metric, metricLabel, view, isCurrent }: { trend: TrendStats; metric: Metric; metricLabel: string; view: View; isCurrent: boolean }) {
  const { period, zone, money, points } = trend;
  const s = useMemo(() => summarise(points, metric), [points, metric]);
  const last = points.at(-1);
  const word = PERIOD_WORD[period];
  // Statistics start on STATS_START, so early on the span is shorter than usual.
  const since = DateTime.fromISO(STATS_START, { zone });
  const span = points[0] && DateTime.fromISO(points[0].start, { zone }) <= since ? `from ${since.toFormat('LLL d, yyyy')}` : TREND_SPAN[period];
  const columns: Column[] = points.map((p, i) => ({
    key: p.start,
    axis: axisLabel(p.start, period, zone, points[i - 1]?.start),
    value: valueOf(p, metric),
    title: periodLabel(p.start, period, zone),
    emphasis: i === points.length - 1,
  }));
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
        <Typography variant="h6" component="h2">
          {metricLabel} over time
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          By {word}, {span} to {last ? periodLabel(last.start, period, zone) : ''}
          {metric === 'money' && ` · ${MONEY_HINT[money]}`}
        </Typography>

        {/* What the span adds up to. */}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(6, minmax(0, 1fr))' }, mb: 2.5, pb: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Figure label="Total" value={writeOf(s.total, metric)} note={`over ${plural(points.length, word)}`} />
          <Figure label={`Average per ${word}`} value={writeOf(Math.round(s.average * 100) / 100, metric)} note={`${s.active} of ${points.length} with calls`} />
          <Figure label={`Best ${word}`} value={s.best ? writeOf(s.best.value, metric) : '—'} note={s.best ? periodLabel(s.best.start, period, zone) : 'No calls yet'} />
          <Figure label={`Lowest ${word}`} value={s.lowest ? writeOf(s.lowest.value, metric) : '—'} note={!s.lowest ? '' : s.lowest.value === 0 ? `${points.length - s.active} without calls` : periodLabel(s.lowest.start, period, zone)} />
          <Figure
            label="Trend"
            value={s.trend === null ? '—' : signed(s.trend)}
            tone={s.trend === null || s.trend === 0 ? undefined : s.trend > 0 ? 'up' : 'down'}
            note={s.trend === null ? 'Nothing earlier to compare' : `last ${Math.floor(points.length / 2)} vs the ${Math.floor(points.length / 2)} before`}
          />
          <Figure
            label={`${isCurrent ? (period === 'day' ? 'Today' : `This ${word}`) : last ? DateTime.fromISO(last.start, { zone }).toFormat(period === 'month' ? 'LLLL yyyy' : 'LLL d') : ''} vs average`}
            value={s.againstAverage === null ? '—' : signed(s.againstAverage)}
            tone={s.againstAverage === null || s.againstAverage === 0 ? undefined : s.againstAverage > 0 ? 'up' : 'down'}
            note={last ? `${writeOf(valueOf(last, metric), metric)}${metric === 'calls' ? ` ${valueOf(last, metric) === 1 ? 'call' : 'calls'}` : ''}, average ${writeOf(Math.round(s.average * 100) / 100, metric)}` : ''}
          />
        </Box>

        {points.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary', border: 1, borderColor: 'divider', borderStyle: 'dashed', borderRadius: 2 }}>
            <Typography variant="body2">Statistics start on {DateTime.fromISO(STATS_START).toFormat('LLLL d, yyyy')}.</Typography>
          </Box>
        ) : view === 'chart' ? (
          <Columns
            columns={columns}
            metric={metric}
            average={s.average}
            label={`${metricLabel} by ${word}, ${span}. Total ${writeOf(s.total, metric)}, average ${writeOf(Math.round(s.average * 100) / 100, metric)} per ${word}. The table view lists every ${word}.`}
            tooltip={(i) => <Readout totals={points[i]!} metric={metric} money={money} title={periodLabel(points[i]!.start, period, zone)} />}
          />
        ) : (
          <FiguresTable
            first={word.charAt(0).toUpperCase() + word.slice(1)}
            rows={[...points].reverse().map((p) => ({ key: p.start, label: periodLabel(p.start, period, zone), totals: p }))}
            total={points.reduce((t, p) => ({ calls: t.calls + p.calls, minutes: t.minutes + p.minutes, money: Math.round((t.money + p.money) * 100) / 100, unpriced: t.unpriced + p.unpriced }), { calls: 0, minutes: 0, money: 0, unpriced: 0 })}
            money={money}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** The table view: every figure the charts draw. */
function FiguresTable({ first, rows, total, money }: { first: string; rows: Array<{ key: string; label: string; totals: ProfilePeriodTotals }>; total: ProfilePeriodTotals; money: MoneyKind }) {
  const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
  return (
    <TableSurface minWidth={520}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{first}</TableCell>
            <TableCell align="right">Calls</TableCell>
            <TableCell align="right">Hours</TableCell>
            <TableCell align="right">{MONEY_LABEL[money]}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell>{r.label}</TableCell>
              <TableCell align="right" sx={num}>{r.totals.calls}</TableCell>
              <TableCell align="right" sx={num}>{hoursOf(r.totals.minutes)}</TableCell>
              <TableCell align="right" sx={num}>
                {formatUsd(r.totals.money)}
                {r.totals.unpriced > 0 && (
                  <Typography component="span" variant="caption" color="warning.main" sx={{ ml: 0.75 }}>
                    {r.totals.unpriced} without a rate
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
 * Statistics, as one page: three figures for the chosen day, week or month (calls
 * delivered, hours, money), each against the period before. Clicking one draws
 * it over time, with what that adds up to, and Profile by Profile below. Arrows
 * step through earlier periods. Everyone sees their own scope: the Founder the
 * whole company and a Manager their team, at the invoice amount; an Associate
 * their own calls and part; an Expert their own calls and pay.
 */
export default function StatsPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const period: Period = params.get('period') === 'day' || params.get('period') === 'month' ? (params.get('period') as Period) : 'week';
  const metric: Metric = params.get('show') === 'money' || params.get('show') === 'hours' ? (params.get('show') as Metric) : 'calls';
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

  const byProfile = useQuery({
    queryKey: ['stats', 'by-profile', period, date ?? 'today'],
    queryFn: () => api.stats.byProfile({ period, date }),
    placeholderData: keepPreviousData,
  });
  const trend = useQuery({
    queryKey: ['stats', 'trend', period, date ?? 'today'],
    queryFn: () => api.stats.trend({ period, date }),
    placeholderData: keepPreviousData,
  });
  const data = byProfile.data;

  const zone = data?.zone ?? 'America/New_York';
  const moneyLabel = data ? MONEY_LABEL[data.money] : me.role === 'expert' ? 'Your pay' : me.role === 'associate' ? 'Your part' : 'Invoice amount';
  const metricLabel = metric === 'calls' ? 'Calls delivered' : metric === 'hours' ? 'Hours' : moneyLabel;
  const current = useMemo(() => DateTime.now().setZone(zone).startOf(period).toISODate()!, [zone, period]);
  const isCurrent = !data || data.start >= current;
  const isFirst = !data || data.start <= DateTime.fromISO(STATS_START, { zone }).startOf(period).toISODate()!;
  const step = (n: number) => {
    if (!data) return;
    const next = DateTime.fromISO(data.start, { zone }).plus({ [`${period}s`]: n }).toISODate()!;
    set({ date: next >= current ? null : next });
  };
  const choose = (m: Metric) => set({ show: m === 'calls' ? null : m });
  const fading = byProfile.isFetching || trend.isFetching;
  const error = byProfile.error ?? trend.error;

  return (
    <Box>
      <PageHeader
        title="Statistics"
        subtitle={
          me.role === 'founder'
            ? 'Calls delivered, hours and invoice amount: over time, and Profile by Profile.'
            : me.role === 'manager'
              ? 'Your team’s calls delivered, hours and invoice amount: over time, and Profile by Profile.'
              : me.role === 'expert'
                ? 'Your calls delivered, hours and pay: over time, and Profile by Profile.'
                : 'Your calls delivered, hours and part: over time, and Profile by Profile.'
        }
      />

      {/* One row of controls, above everything they change. */}
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <ToggleButtonGroup size="small" exclusive value={period} onChange={(_, v: Period | null) => v && set({ period: v === 'week' ? null : v, date: null })} aria-label="Period">
          <ToggleButton value="day">Day</ToggleButton>
          <ToggleButton value="week">Week</ToggleButton>
          <ToggleButton value="month">Month</ToggleButton>
        </ToggleButtonGroup>
        <Stack direction="row" alignItems="center" spacing={0.25}>
          <Tooltip title={isFirst ? `Statistics start on ${DateTime.fromISO(STATS_START).toFormat('LLLL d, yyyy')}` : `The ${PERIOD_WORD[period]} before`}>
            <span>
              <IconButton size="small" onClick={() => step(-1)} aria-label={`The ${PERIOD_WORD[period]} before`} disabled={isFirst}>
                <ChevronLeftRounded />
              </IconButton>
            </span>
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
        <ErrorState
          error={error}
          onRetry={() => {
            void byProfile.refetch();
            void trend.refetch();
          }}
        />
      ) : !data || !trend.data ? (
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={96} />
          <Skeleton variant="rounded" height={460} />
        </Stack>
      ) : (
        // Reloading keeps the last picture on screen, a little faded.
        <Box sx={{ opacity: fading ? 0.55 : 1, transition: 'opacity 150ms' }}>
          {/* The three figures choose what the charts below show. */}
          <Grid container spacing={2} sx={{ mb: 2 }} role="group" aria-label="Choose what the charts show">
            {(
              [
                { m: 'calls', label: 'Calls delivered', value: data.total.calls },
                { m: 'hours', label: 'Hours', value: hoursOf(data.total.minutes) },
                { m: 'money', label: moneyLabel, value: formatUsd(data.total.money) },
              ] as const
            ).map((t) => (
              <Grid key={t.m} size={{ xs: 12, sm: 4 }}>
                <StatTile
                  label={t.label}
                  value={t.value}
                  selected={metric === t.m}
                  onClick={() => choose(t.m)}
                  footer={<Change now={valueOf(data.total, t.m)} before={valueOf(data.previous, t.m)} period={period} metric={t.m} />}
                />
              </Grid>
            ))}
          </Grid>

          <TrendCard trend={trend.data} metric={metric} metricLabel={metricLabel} view={view} isCurrent={isCurrent} />

          <Card>
            <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
              <Typography variant="h6" component="h2">
                {metricLabel} by Profile
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {periodLabel(data.start, period, zone)} · {plural(data.rows.length, 'Profile')}
              </Typography>
              {data.rows.length === 0 ? (
                <Box sx={{ py: 8, textAlign: 'center', color: 'text.secondary', border: 1, borderColor: 'divider', borderStyle: 'dashed', borderRadius: 2 }}>
                  <Typography variant="body2">No calls were delivered in this {PERIOD_WORD[period]}.</Typography>
                </Box>
              ) : view === 'chart' ? (
                (() => {
                  const rows = [...data.rows].sort((a, b) => valueOf(b, metric) - valueOf(a, metric) || a.profile.name.localeCompare(b.profile.name));
                  return (
                    <Columns
                      slanted
                      metric={metric}
                      columns={rows.map((r) => ({ key: r.profile.id, axis: r.profile.name, value: valueOf(r, metric), title: r.profile.name }))}
                      label={`${metricLabel} by Profile, ${periodLabel(data.start, period, zone)}. ${rows.length} Profiles; the table view lists every figure.`}
                      tooltip={(i) => <Readout totals={rows[i]!} metric={metric} money={data.money} title={rows[i]!.profile.name} />}
                    />
                  );
                })()
              ) : (
                <FiguresTable
                  first="Profile"
                  rows={[...data.rows].sort((a, b) => valueOf(b, metric) - valueOf(a, metric)).map((r) => ({ key: r.profile.id, label: r.profile.name, totals: r }))}
                  total={data.total}
                  money={data.money}
                />
              )}
              {data.total.unpriced > 0 && (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
                  {plural(data.total.unpriced, 'call')} without a rate {data.total.unpriced === 1 ? 'is' : 'are'} counted in calls and hours, not yet in the money.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Box>
      )}
    </Box>
  );
}
