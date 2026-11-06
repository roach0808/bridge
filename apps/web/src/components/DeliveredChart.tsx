import { Box, Card, CardContent, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import type { DeliveredDay } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BRAND } from '@/components/brand';
import { ErrorState } from '@/components/common';
import { api } from '@/lib/api';

/**
 * An Expert's delivered calls over time, drawn as on a trading platform: total
 * hours delivered as a rising line, and the minutes of each day, week or month
 * as bars beneath it, like volume under a price. Scroll or pinch to zoom, drag
 * to move through time, hover to read any moment.
 */

type Interval = 'day' | 'week' | 'month';
type Range = '1W' | '1M' | '3M' | '1Y' | 'All';

const RANGE_DAYS: Record<Exclude<Range, 'All'>, number> = { '1W': 7, '1M': 31, '3M': 92, '1Y': 366 };

interface Bucket {
  /** yyyy-mm-dd: the day, or the first day of the week or month. */
  date: string;
  minutes: number;
  calls: number;
  /** Every hour delivered up to and including this bucket. */
  totalHours: number;
}

/**
 * Days, weeks or months in a row, from the first delivered call to today, with
 * the quiet ones at zero: the chart spaces bars evenly, so a missing day would
 * squeeze time.
 */
function bucketsOf(days: DeliveredDay[], interval: Interval, zone: string): Bucket[] {
  if (!days.length) return [];
  const startOf = (d: DateTime) => (interval === 'day' ? d.startOf('day') : interval === 'week' ? d.startOf('week') : d.startOf('month'));
  const byStart = new Map<string, { minutes: number; calls: number }>();
  for (const d of days) {
    const key = startOf(DateTime.fromISO(d.date, { zone })).toISODate()!;
    const b = byStart.get(key) ?? { minutes: 0, calls: 0 };
    b.minutes += d.minutes;
    b.calls += d.calls;
    byStart.set(key, b);
  }
  const out: Bucket[] = [];
  let total = 0;
  const end = startOf(DateTime.now().setZone(zone));
  for (let at = startOf(DateTime.fromISO(days[0]!.date, { zone })); at <= end; at = at.plus({ [interval === 'day' ? 'days' : interval === 'week' ? 'weeks' : 'months']: 1 })) {
    const key = at.toISODate()!;
    const b = byStart.get(key) ?? { minutes: 0, calls: 0 };
    total += b.minutes / 60;
    out.push({ date: key, minutes: b.minutes, calls: b.calls, totalHours: Math.round(total * 100) / 100 });
  }
  return out;
}

const hours = (h: number) => `${h.toLocaleString('en-US', { maximumFractionDigits: 1 })} h`;
const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`);

function labelFor(date: string, interval: Interval, zone: string) {
  const d = DateTime.fromISO(date, { zone });
  if (interval === 'month') return d.toFormat('LLLL yyyy');
  if (interval === 'week') return `Week of ${d.toFormat('LLL d, yyyy')}`;
  return d.toFormat('ccc, LLL d, yyyy');
}

export function DeliveredChart() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard', 'delivered'], queryFn: api.dashboard.delivered, staleTime: 60_000 });
  const { mode, systemMode } = useColorScheme();
  const dark = (mode === 'system' ? systemMode : mode) === 'dark';
  const [interval, setBarSize] = useState<Interval>('day');
  const [range, setRange] = useState<Range>('3M');
  const zone = data?.zone ?? 'UTC';
  const buckets = useMemo(() => bucketsOf(data?.days ?? [], interval, zone), [data, interval, zone]);
  const [hovered, setHovered] = useState<Bucket | null>(null);

  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const total = useRef<ISeriesApi<'Area'> | null>(null);
  const bars = useRef<ISeriesApi<'Histogram'> | null>(null);
  const byDate = useRef(new Map<string, Bucket>());

  const colors = useMemo(
    () =>
      dark
        ? { bg: '#121417', text: '#9AA3B2', grid: 'rgba(192, 196, 204, 0.08)', line: BRAND.tealLight, fillTop: 'rgba(143, 193, 189, 0.32)', fillBottom: 'rgba(143, 193, 189, 0.02)', bar: 'rgba(143, 193, 189, 0.55)', barQuiet: 'rgba(143, 193, 189, 0.15)', cross: '#6B7486' }
        : { bg: '#FFFFFF', text: BRAND.muted, grid: 'rgba(11, 22, 48, 0.06)', line: BRAND.tealDeep, fillTop: 'rgba(94, 143, 140, 0.28)', fillBottom: 'rgba(94, 143, 140, 0.02)', bar: 'rgba(11, 22, 48, 0.55)', barQuiet: 'rgba(11, 22, 48, 0.12)', cross: '#8F98AA' },
    [dark],
  );

  // The chart is made once, and only restyled when the theme changes.
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text, fontFamily: 'Inter Variable, Inter, system-ui, sans-serif', fontSize: 12, panes: { separatorColor: colors.grid, enableResize: true } },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 3, minBarSpacing: 2, fixLeftEdge: true },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: colors.cross, labelBackgroundColor: BRAND.navy }, horzLine: { color: colors.cross, labelBackgroundColor: BRAND.navy } },
      // Zoom with the wheel or a pinch, drag to move; a finger moving up and down still scrolls the page.
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });
    const area = c.addSeries(
      AreaSeries,
      { lineColor: colors.line, topColor: colors.fillTop, bottomColor: colors.fillBottom, lineWidth: 2, priceFormat: { type: 'custom', formatter: (v: number) => hours(v), minMove: 0.01 }, priceLineVisible: false },
      0,
    );
    const hist = c.addSeries(HistogramSeries, { priceFormat: { type: 'custom', formatter: (v: number) => `${Math.round(v)} min`, minMove: 1 }, priceLineVisible: false, lastValueVisible: false }, 1);
    // The volume pane: a quarter of the height.
    c.panes()[0]?.setStretchFactor(3);
    c.panes()[1]?.setStretchFactor(1);
    const move = (p: MouseEventParams<Time>) => setHovered(typeof p.time === 'string' ? (byDate.current.get(p.time) ?? null) : null);
    c.subscribeCrosshairMove(move);
    chart.current = c;
    total.current = area;
    bars.current = hist;
    return () => {
      c.unsubscribeCrosshairMove(move);
      c.remove();
      chart.current = null;
    };
    // Colours are applied by the next effect; making the chart again would lose the zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(data && data.days.length)]);

  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    c.applyOptions({
      layout: { background: { type: ColorType.Solid, color: colors.bg }, textColor: colors.text, panes: { separatorColor: colors.grid } },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      crosshair: { vertLine: { color: colors.cross }, horzLine: { color: colors.cross } },
    });
    total.current?.applyOptions({ lineColor: colors.line, topColor: colors.fillTop, bottomColor: colors.fillBottom });
  }, [colors]);

  useEffect(() => {
    byDate.current = new Map(buckets.map((b) => [b.date, b]));
    total.current?.setData(buckets.map((b) => ({ time: b.date, value: b.totalHours })));
    bars.current?.setData(buckets.map((b) => ({ time: b.date, value: b.minutes, color: b.minutes ? colors.bar : colors.barQuiet })));
  }, [buckets, colors]);

  // The range buttons move the view; zooming by hand is then the visitor's own.
  useEffect(() => {
    const c = chart.current;
    if (!c || !buckets.length) return;
    if (range === 'All') {
      c.timeScale().fitContent();
      return;
    }
    const to = DateTime.now().setZone(zone);
    const from = to.minus({ days: RANGE_DAYS[range] });
    const first = buckets[0]!.date;
    c.timeScale().setVisibleRange({ from: (from.toISODate()! < first ? first : from.toISODate()!) as Time, to: to.toISODate()! as Time });
  }, [range, buckets, zone]);

  const totals = useMemo(() => {
    const days = data?.days ?? [];
    const monthStart = DateTime.now().setZone(zone).startOf('month').toISODate()!;
    return {
      hours: days.reduce((t, d) => t + d.minutes, 0) / 60,
      calls: days.reduce((t, d) => t + d.calls, 0),
      monthHours: days.filter((d) => d.date >= monthStart).reduce((t, d) => t + d.minutes, 0) / 60,
    };
  }, [data, zone]);

  const shown = hovered ?? buckets.at(-1) ?? null;

  return (
    <Card>
      <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'flex-end' }} spacing={1.5} sx={{ mb: 1.5 }}>
          <Box>
            <Typography variant="h6" component="h2">
              Delivered calls
            </Typography>
            <Stack direction="row" spacing={2.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
              <Typography variant="body2" color="text.secondary">
                <Box component="strong" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{hours(totals.hours)}</Box> delivered
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <Box component="strong" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{totals.calls}</Box> calls
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <Box component="strong" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{hours(totals.monthHours)}</Box> this month
              </Typography>
            </Stack>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <ToggleButtonGroup size="small" exclusive value={interval} onChange={(_, v: Interval | null) => v && setBarSize(v)} aria-label="Bar size">
              <ToggleButton value="day">Day</ToggleButton>
              <ToggleButton value="week">Week</ToggleButton>
              <ToggleButton value="month">Month</ToggleButton>
            </ToggleButtonGroup>
            <ToggleButtonGroup size="small" exclusive value={range} onChange={(_, v: Range | null) => v && setRange(v)} aria-label="Time range">
              {(['1W', '1M', '3M', '1Y', 'All'] as const).map((r) => (
                <ToggleButton key={r} value={r}>
                  {r}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
        </Stack>

        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : isLoading ? (
          <Skeleton variant="rounded" height={360} />
        ) : !data?.days.length ? (
          <Box sx={{ height: 200, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'text.secondary', border: 1, borderColor: 'divider', borderRadius: 2, borderStyle: 'dashed' }}>
            <Typography variant="body2">Your delivered calls will show here, once your first call has finished.</Typography>
          </Box>
        ) : (
          <Box sx={{ position: 'relative' }}>
            {/* What is under the cursor, or the latest bar: as a trading chart's legend. */}
            <Box aria-live="polite" sx={{ position: 'absolute', top: 6, left: 8, zIndex: 3, pointerEvents: 'none', bgcolor: dark ? 'rgba(18,20,23,0.8)' : 'rgba(255,255,255,0.85)', borderRadius: 1, px: 1, py: 0.5 }}>
              {shown && (
                <>
                  <Typography variant="caption" color="text.secondary" component="div">
                    {labelFor(shown.date, interval, zone)}
                  </Typography>
                  <Typography variant="body2" component="div" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    <strong>{minutes(shown.minutes)}</strong> · {shown.calls} call{shown.calls === 1 ? '' : 's'} · total {hours(shown.totalHours)}
                  </Typography>
                </>
              )}
            </Box>
            <Box
              ref={box}
              role="img"
              aria-label={`Chart of your delivered calls: ${hours(totals.hours)} over ${totals.calls} calls. Scroll or pinch to zoom, drag to move through time.`}
              sx={{ height: { xs: 300, md: 380 }, touchAction: 'pan-y' }}
            />
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
              Scroll or pinch to zoom · drag to move through time · times in {zone.replace(/_/g, ' ')}
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
