import InsightsRounded from '@mui/icons-material/InsightsRounded';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import {
  Box,
  Grid,
  MenuItem,
  Skeleton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { AssociateStatsCell, FinanceCell, ProfileStatsRow, StatsPeriodKind } from '@god/shared';
import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { useMe } from '@/auth/AuthProvider';
import { DeactivatedPill, ProfileStatusChip } from '@/components/ProfileDetails';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { UserAvatar, UserChip } from '@/components/identity';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatUsd, relativeTime } from '@/lib/time';
import { FilterChips, SearchField, StatTile, TableSurface } from '../admin/adminShared';

type TabKey = 'associates' | 'profiles' | 'finance';

const PERIODS: Array<{ value: StatsPeriodKind; label: string; count: number; current: string }> = [
  { value: 'week', label: 'Weekly', count: 8, current: 'This week' },
  { value: 'biweek', label: 'Bi-weekly', count: 6, current: 'These two weeks' },
  { value: 'month', label: 'Monthly', count: 6, current: 'This month' },
];

const NUM = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const;
const EXPECTED_COLOR = '#3f8fd6';
const REAL_COLOR = '#3fb68b';
const GAP_COLOR = '#e0913a';

export default function StatsPage() {
  const me = useMe();
  const isFounder = me.role === 'founder';
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab') as TabKey | null;
  const tab: TabKey = isFounder && (requested === 'profiles' || requested === 'finance') ? requested : 'associates';
  const period = (PERIODS.find((p) => p.value === params.get('period')) ?? PERIODS[0])!;
  const set = (key: string, value: string) => setParams((p) => ({ ...Object.fromEntries(p), [key]: value }), { replace: true });

  return (
    <Box>
      <PageHeader
        title="Statistics"
        subtitle={
          me.role === 'founder'
            ? 'Calls and money by Associate and by Profile, and expected against real income.'
            : me.role === 'manager'
              ? 'Scheduled calls and potential money for your team.'
              : 'Your scheduled calls and the money they can bring in.'
        }
      />

      {isFounder && (
        <Tabs value={tab} onChange={(_, v: TabKey) => set('tab', v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }} variant="scrollable" allowScrollButtonsMobile>
          <Tab value="associates" label="By associate" />
          <Tab value="profiles" label="By profile" />
          <Tab value="finance" label="Finance" />
        </Tabs>
      )}

      {tab !== 'profiles' && (
        <Box sx={{ mb: 2 }}>
          <FilterChips
            ariaLabel="Period"
            value={period.value}
            onChange={(v) => set('period', v)}
            options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          />
        </Box>
      )}

      {tab === 'associates' && <AssociatesTab period={period} />}
      {tab === 'profiles' && <ProfilesTab />}
      {tab === 'finance' && <FinanceTab period={period} />}
    </Box>
  );
}

function Loading() {
  return (
    <Stack spacing={2}>
      <Grid container spacing={1.5}>
        {Array.from({ length: 4 }, (_, i) => (
          <Grid key={i} size={{ xs: 6, md: 3 }}>
            <Skeleton variant="rounded" height={92} />
          </Grid>
        ))}
      </Grid>
      <Skeleton variant="rounded" height={320} />
    </Stack>
  );
}

function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <Box sx={{ mt: 3, mb: 1.25 }}>
      <Typography variant="h6">{children}</Typography>
      {hint && (
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

const periodTooltip = (p: { start: string; end: string }) =>
  `${DateTime.fromISO(p.start).toFormat('LLL d, yyyy')} – ${DateTime.fromISO(p.end).minus({ days: 1 }).toFormat('LLL d, yyyy')} (New York time)`;

// --- By associate --------------------------------------------------------------------

function AssociateCell({ cell, strong }: { cell: AssociateStatsCell; strong?: boolean }) {
  if (cell.calls === 0) {
    return (
      <Typography variant="body2" color="text.disabled">
        —
      </Typography>
    );
  }
  return (
    <Tooltip
      title={`${cell.calls} call${cell.calls === 1 ? '' : 's'}, ${cell.finishedCalls} finished${cell.unpriced ? `, ${cell.unpriced} without a rate` : ''}`}
    >
      <Box sx={NUM}>
        <Typography variant="body2" fontWeight={strong ? 650 : 550}>
          {formatUsd(cell.potential)}
          {cell.unpriced > 0 && (
            <Box component="span" sx={{ color: GAP_COLOR }}>
              {' *'}
            </Box>
          )}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {cell.calls} call{cell.calls === 1 ? '' : 's'}
        </Typography>
      </Box>
    </Tooltip>
  );
}

function AssociatesTab({ period }: { period: (typeof PERIODS)[number] }) {
  const me = useMe();
  const query = useQuery({
    queryKey: qk.stats.associates(period.value, period.count),
    queryFn: () => api.stats.associates({ period: period.value, count: period.count }),
  });
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const { periods, rows, totals, total } = query.data;
  const current = totals.at(-1)!;
  const previous = totals.at(-2);
  const unpriced = total.unpriced;
  // Newest period first, so the current one is always in view.
  const order = periods.map((_, i) => periods.length - 1 - i);

  return (
    <>
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label={`${period.current}: calls`} value={current.calls} footer={previous && <Trend now={current.calls} before={previous.calls} />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label={`${period.current}: potential`}
            color={EXPECTED_COLOR}
            value={formatUsd(current.potential)}
            footer={previous && <Trend now={current.potential} before={previous.potential} money />}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label={`Last ${periods.length} periods: calls`} value={total.calls} footer={<Muted>{total.finishedCalls} finished</Muted>} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label={`Last ${periods.length} periods: potential`} color={EXPECTED_COLOR} value={formatUsd(total.potential)} />
        </Grid>
      </Grid>

      <SectionTitle hint="Calls by their scheduled time. Potential money is rate × duration: the real duration once finished, the booked one before.">
        {me.role === 'associate' ? 'Your calls' : me.role === 'manager' ? 'Your team' : 'Associates'}
      </SectionTitle>

      {rows.length === 0 ? (
        <TableSurface>
          <EmptyState icon={<InsightsRounded />} title="No Associates yet" />
        </TableSurface>
      ) : (
        <TableSurface minWidth={260 + periods.length * 110}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>Associate</TableCell>
                <TableCell align="right">Total</TableCell>
                {order.map((i) => (
                  <TableCell key={periods[i]!.start} align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title={periodTooltip(periods[i]!)}>
                      <span>{i === periods.length - 1 ? period.current : periods[i]!.label}</span>
                    </Tooltip>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.associate.id} hover>
                  <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <UserChip user={r.associate} size={26} subtitle={r.manager ? `Team ${r.manager.nickname}` : 'No manager'} />
                      {!r.associate.isActive && <DeactivatedPill />}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <AssociateCell cell={r.total} strong />
                  </TableCell>
                  {order.map((i) => (
                    <TableCell key={i} align="right">
                      <AssociateCell cell={r.periods[i]!} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
            {rows.length > 1 && (
              <TableFooter>
                <TableRow>
                  <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1, fontWeight: 650, color: 'text.primary' }}>All</TableCell>
                  <TableCell align="right">
                    <AssociateCell cell={total} strong />
                  </TableCell>
                  {order.map((i) => (
                    <TableCell key={i} align="right">
                      <AssociateCell cell={totals[i]!} strong />
                    </TableCell>
                  ))}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </TableSurface>
      )}
      {unpriced > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          <Box component="span" sx={{ color: GAP_COLOR }}>
            *
          </Box>{' '}
          {unpriced} call{unpriced === 1 ? ' has' : 's have'} no rate for its Profile on that platform, so {unpriced === 1 ? 'it is' : 'they are'} not in the money.
        </Typography>
      )}
    </>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary">
      {children}
    </Typography>
  );
}

function Trend({ now, before, money }: { now: number; before: number; money?: boolean }) {
  const diff = Math.round((now - before) * 100) / 100;
  if (diff === 0) return <Muted>Same as previous</Muted>;
  return (
    <Typography variant="caption" sx={{ color: diff > 0 ? REAL_COLOR : 'text.secondary', fontWeight: 550 }}>
      {diff > 0 ? '▲' : '▼'} {money ? formatUsd(Math.abs(diff)) : Math.abs(diff)} vs previous
    </Typography>
  );
}

// --- By profile ------------------------------------------------------------------------

type ProfileFilter = 'all' | 'active' | 'deactivated' | 'pending' | 'rejected';
type ProfileSort = 'name' | 'income' | 'onboarded';

const profileMatches = (r: ProfileStatsRow, f: ProfileFilter) =>
  f === 'all'
    ? true
    : f === 'active'
      ? r.isActive && r.status === 'approved'
      : f === 'deactivated'
        ? !r.isActive
        : r.status === f;

function ProfilesTab() {
  const [filter, setFilter] = useState<ProfileFilter>('all');
  const [sort, setSort] = useState<ProfileSort>('income');
  const [search, setSearch] = useState('');
  const query = useQuery({ queryKey: qk.stats.profiles, queryFn: api.stats.profiles });
  const all = query.data ?? [];

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = all.filter(
      (r) => profileMatches(r, filter) && (!needle || r.profile.name.toLowerCase().includes(needle) || (r.email ?? '').includes(needle)),
    );
    return [...rows].sort((a, b) =>
      sort === 'income'
        ? b.totalIncome - a.totalIncome || a.profile.name.localeCompare(b.profile.name)
        : sort === 'onboarded'
          ? (b.onboardedAt ?? '').localeCompare(a.onboardedAt ?? '')
          : a.profile.name.localeCompare(b.profile.name),
    );
  }, [all, filter, sort, search]);

  if (query.isLoading) return <Loading />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const income = visible.reduce((n, r) => Math.round((n + r.totalIncome) * 100) / 100, 0);
  const expected = visible.reduce((n, r) => Math.round((n + r.expectedIncome) * 100) / 100, 0);

  return (
    <>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Profiles" value={all.length} footer={<Muted>{all.filter((r) => r.isActive && r.status === 'approved').length} active</Muted>} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Deactivated" color="#9aa0a6" value={all.filter((r) => !r.isActive).length} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Without bank details" color={GAP_COLOR} value={all.filter((r) => !r.bank && r.status === 'approved').length} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Total income, all time" color={REAL_COLOR} value={formatUsd(all.reduce((n, r) => Math.round((n + r.totalIncome) * 100) / 100, 0))} />
        </Grid>
      </Grid>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
        <FilterChips
          ariaLabel="Filter profiles"
          value={filter}
          onChange={setFilter}
          options={(['all', 'active', 'deactivated', 'pending', 'rejected'] as const).map((f) => ({
            value: f,
            label: { all: 'All', active: 'Active', deactivated: 'Deactivated', pending: 'Pending', rejected: 'Rejected' }[f],
            count: all.filter((r) => profileMatches(r, f)).length,
          }))}
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
          <TextField select size="small" label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as ProfileSort)} sx={{ minWidth: 150 }}>
            <MenuItem value="income">Total income</MenuItem>
            <MenuItem value="onboarded">Newest onboarded</MenuItem>
            <MenuItem value="name">Name</MenuItem>
          </TextField>
          <SearchField value={search} onChange={setSearch} placeholder="Search name or email" sx={{ minWidth: { md: 220 } }} />
        </Stack>
      </Stack>

      {visible.length === 0 ? (
        <TableSurface>
          <EmptyState icon={<SearchOffRounded />} title="No profiles match" />
        </TableSurface>
      ) : (
        <TableSurface minWidth={1080}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Profile</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Onboarded</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Bank</TableCell>
                <TableCell align="right">Calls</TableCell>
                <TableCell align="right">Expected</TableCell>
                <TableCell align="right">Total income</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.profile.id} hover sx={{ opacity: r.isActive ? 1 : 0.75 }}>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <UserAvatar avatarId={r.profile.avatarId} photoId={r.profile.photoId} label={r.profile.name} size={28} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={550} noWrap>
                          {r.profile.name}
                        </Typography>
                        {r.lastCallAt && <Muted>Last call {relativeTime(r.lastCallAt)}</Muted>}
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                      <ProfileStatusChip status={r.status} />
                      {!r.isActive && <DeactivatedPill />}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.onboardedAt ? DateTime.fromISO(r.onboardedAt).toFormat('LLL d, yyyy') : <Muted>—</Muted>}</TableCell>
                  <TableCell sx={{ maxWidth: 220 }}>
                    {r.email ? (
                      <Typography variant="body2" noWrap title={r.email}>
                        {r.email}
                      </Typography>
                    ) : (
                      <Muted>—</Muted>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.bank ? (
                      <Box>
                        <Typography variant="body2" noWrap>
                          {r.bank.bankName}
                        </Typography>
                        <Muted>
                          {[r.bank.country, r.bank.currency].filter(Boolean).join(' · ')}
                          {r.bank.count > 1 ? ` · ${r.bank.count} accounts` : ''}
                        </Muted>
                      </Box>
                    ) : (
                      <Typography variant="body2" sx={{ color: r.status === 'approved' ? GAP_COLOR : 'text.disabled' }}>
                        {r.status === 'approved' ? 'Missing' : '—'}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={NUM}>
                    {r.calls}
                    {r.paidCalls > 0 && <Muted> · {r.paidCalls} paid</Muted>}
                  </TableCell>
                  <TableCell align="right" sx={NUM}>
                    {r.expectedIncome ? formatUsd(r.expectedIncome) : <Muted>—</Muted>}
                  </TableCell>
                  <TableCell align="right" sx={{ ...NUM, fontWeight: 650 }}>
                    {r.totalIncome ? formatUsd(r.totalIncome) : <Muted>—</Muted>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={6} sx={{ fontWeight: 650, color: 'text.primary' }}>
                  {visible.length} profile{visible.length === 1 ? '' : 's'}
                </TableCell>
                <TableCell align="right" sx={{ ...NUM, fontWeight: 650, color: 'text.primary' }}>
                  {formatUsd(expected)}
                </TableCell>
                <TableCell align="right" sx={{ ...NUM, fontWeight: 650, color: 'text.primary' }}>
                  {formatUsd(income)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </TableSurface>
      )}
    </>
  );
}

// --- Finance -------------------------------------------------------------------------------

const gapPercent = (c: FinanceCell) => (c.paidExpected > 0 ? Math.round((c.gap / c.paidExpected) * 1000) / 10 : null);

function GapText({ cell }: { cell: FinanceCell }) {
  if (cell.paidCalls === 0) return <Muted>—</Muted>;
  const pct = gapPercent(cell);
  return (
    <Box component="span" sx={{ color: cell.gap > 0 ? GAP_COLOR : cell.gap < 0 ? REAL_COLOR : 'text.secondary', fontWeight: 550 }}>
      {cell.gap < 0 ? '+' : cell.gap > 0 ? '−' : ''}
      {formatUsd(Math.abs(cell.gap))}
      {pct !== null && pct !== 0 && <Muted> ({Math.abs(pct)}%)</Muted>}
    </Box>
  );
}

/** Expected (blue) and real (green) income side by side, scaled to the largest value. */
function Bars({ cell, max }: { cell: FinanceCell; max: number }) {
  const width = (v: number) => `${max > 0 ? Math.max((v / max) * 100, v > 0 ? 2 : 0) : 0}%`;
  return (
    <Stack spacing={0.4} sx={{ minWidth: 120 }} aria-hidden>
      <Box sx={{ height: 7, borderRadius: 4, bgcolor: EXPECTED_COLOR, width: width(cell.expected) }} />
      <Box sx={{ height: 7, borderRadius: 4, bgcolor: REAL_COLOR, width: width(cell.real) }} />
    </Stack>
  );
}

function FinanceRows({ rows, max }: { rows: Array<{ key: string; label: ReactNode; cell: FinanceCell }>; max: number }) {
  return (
    <>
      {rows.map((r) => (
        <TableRow key={r.key} hover>
          <TableCell>{r.label}</TableCell>
          <TableCell align="right" sx={NUM}>
            {r.cell.finishedCalls}
            {r.cell.paidCalls > 0 && <Muted> · {r.cell.paidCalls} paid</Muted>}
          </TableCell>
          <TableCell align="right" sx={NUM}>
            {r.cell.expected ? formatUsd(r.cell.expected) : <Muted>—</Muted>}
            {r.cell.unpriced > 0 && (
              <Tooltip title={`${r.cell.unpriced} finished call${r.cell.unpriced === 1 ? '' : 's'} without a rate`}>
                <Box component="span" sx={{ color: GAP_COLOR }}>
                  {' *'}
                </Box>
              </Tooltip>
            )}
          </TableCell>
          <TableCell align="right" sx={{ ...NUM, fontWeight: 600 }}>
            {r.cell.real ? formatUsd(r.cell.real) : <Muted>—</Muted>}
          </TableCell>
          <TableCell align="right" sx={NUM}>
            <GapText cell={r.cell} />
          </TableCell>
          <TableCell sx={{ width: '22%' }}>
            <Bars cell={r.cell} max={max} />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function FinanceTable({ first, rows }: { first: string; rows: Array<{ key: string; label: ReactNode; cell: FinanceCell }> }) {
  const max = Math.max(0, ...rows.flatMap((r) => [r.cell.expected, r.cell.real]));
  return (
    <TableSurface minWidth={820}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{first}</TableCell>
            <TableCell align="right">Finished calls</TableCell>
            <TableCell align="right">Expected</TableCell>
            <TableCell align="right">Real income</TableCell>
            <TableCell align="right">
              <Tooltip title="Expected price of the paid calls minus what reached the bank">
                <span>Gap</span>
              </Tooltip>
            </TableCell>
            <TableCell>
              <Stack direction="row" spacing={1.5}>
                <Legend color={EXPECTED_COLOR}>Expected</Legend>
                <Legend color={REAL_COLOR}>Real</Legend>
              </Stack>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <FinanceRows rows={rows} max={max} />
        </TableBody>
      </Table>
    </TableSurface>
  );
}

function Legend({ color, children }: { color: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box sx={{ width: 8, height: 8, borderRadius: 2, bgcolor: color }} />
      <span>{children}</span>
    </Stack>
  );
}

function FinanceTab({ period }: { period: (typeof PERIODS)[number] }) {
  const query = useQuery({
    queryKey: qk.stats.finance(period.value, period.count),
    queryFn: () => api.stats.finance({ period: period.value, count: period.count }),
  });
  if (query.isLoading) return <Loading />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const { periods, byPeriod, total, byPlatform, byProfile } = query.data;
  const pct = gapPercent(total);
  const awaiting = Math.round((total.expected - total.paidExpected) * 100) / 100;

  return (
    <>
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Expected" color={EXPECTED_COLOR} value={formatUsd(total.expected)} footer={<Muted>{total.finishedCalls} finished call{total.finishedCalls === 1 ? '' : 's'}</Muted>} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Real income" color={REAL_COLOR} value={formatUsd(total.real)} footer={<Muted>{total.paidCalls} call{total.paidCalls === 1 ? '' : 's'} paid to bank</Muted>} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Gap on paid calls"
            color={GAP_COLOR}
            value={total.paidCalls ? `${total.gap > 0 ? '−' : total.gap < 0 ? '+' : ''}${formatUsd(Math.abs(total.gap))}` : '—'}
            footer={<Muted>{pct !== null ? `${pct}% of their expected ${formatUsd(total.paidExpected)}` : 'Nothing paid yet'}</Muted>}
          />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Not paid yet" value={formatUsd(awaiting)} footer={<Muted>Expected price of finished, unpaid calls</Muted>} />
        </Grid>
      </Grid>

      <SectionTitle hint={`Calls by their scheduled time over the last ${periods.length} periods. The gap compares only calls that were processed to bank.`}>
        By period
      </SectionTitle>
      <FinanceTable
        first="Period"
        rows={periods
          .map((p, i) => ({
            key: p.start,
            label: (
              <Tooltip title={periodTooltip(p)}>
                <span>{i === periods.length - 1 ? period.current : p.label}</span>
              </Tooltip>
            ),
            cell: byPeriod[i]!,
          }))
          .reverse()}
      />

      <SectionTitle>By platform</SectionTitle>
      {byPlatform.length === 0 ? (
        <Muted>No calls in these periods.</Muted>
      ) : (
        <FinanceTable first="Platform" rows={byPlatform.map((r) => ({ key: r.platform.id, label: r.platform.name, cell: r.cell }))} />
      )}

      <SectionTitle>By profile</SectionTitle>
      {byProfile.length === 0 ? (
        <Muted>No calls in these periods.</Muted>
      ) : (
        <FinanceTable
          first="Profile"
          rows={byProfile.map((r) => ({
            key: r.profile.id,
            label: (
              <Stack direction="row" spacing={1} alignItems="center">
                <span>{r.profile.name}</span>
                {!r.profile.isActive && <DeactivatedPill />}
              </Stack>
            ),
            cell: r.cell,
          }))}
        />
      )}
    </>
  );
}
