import AddRounded from '@mui/icons-material/AddRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import StorageOutlined from '@mui/icons-material/StorageOutlined';
import {
  Box,
  Button,
  ButtonBase,
  Card,
  CircularProgress,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { STAGE_LABELS, STAGE_STATUSES, TRACK_STAGES, type CallDTO, type CallStatus, type DashboardSummary, type ProfileNeedingBank, type ProfileNeedingRate } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { BanksDialog } from '@/components/BanksDialog';
import { ErrorState } from '@/components/common';
import { useToast } from '@/components/ToastProvider';
import { UserAvatar, UserChip } from '@/components/identity';
import { STATUS_COLORS } from '@/components/StatusChip';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { dayLabel, formatDateTime, inZone, relativeTime, zoneAbbr } from '@/lib/time';
import { errorMessage } from '@/lib/errors';

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
};

/** "Today", "Tomorrow", "Yesterday" or "Sep 12" — short enough for one line. */
function shortDay(iso: string, zone: string) {
  const label = dayLabel(iso, zone);
  return ['Today', 'Tomorrow', 'Yesterday'].includes(label) ? label : inZone(iso, zone).toFormat('LLL d');
}

function Panel({ title, count, action, children }: { title: string; count?: number; action?: ReactNode; children: ReactNode }) {
  return (
    <Card sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, pt: 1.75, pb: 1 }}>
        <Typography variant="subtitle2">{title}</Typography>
        {count !== undefined && (
          <Typography variant="body2" color="text.secondary">
            {count}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        {action}
      </Stack>
      <Box sx={{ px: 1, pb: 1 }}>{children}</Box>
    </Card>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body2" color="text.disabled" sx={{ px: 1, py: 2 }}>
      {children}
    </Typography>
  );
}

/** One call in a line: time, profile, platform, expert. */
function CallLine({ call, zone, showDay = false }: { call: CallDTO; zone: string; showDay?: boolean }) {
  const start = inZone(call.scheduledAt, zone);
  return (
    <ButtonBase
      component={RouterLink}
      to={`/calls/${call.id}`}
      sx={{
        display: 'flex',
        width: '100%',
        textAlign: 'left',
        alignItems: 'center',
        gap: 1.5,
        px: 1,
        py: 1,
        borderRadius: 2,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box sx={{ width: showDay ? 88 : 62, flexShrink: 0 }}>
        <Typography variant="body2" fontWeight={600} noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {showDay ? shortDay(call.scheduledAt, zone) : start.toFormat('h:mm a')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {showDay ? start.toFormat('h:mm a') : `${call.durationMinutes} min`}
        </Typography>
      </Box>
      <UserAvatar avatarId={call.profile.avatarId} photoId={call.profile.photoId} label={call.profile.name} size={32} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={550} noWrap>
          {call.profile.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {call.platform.name}
        </Typography>
      </Box>
      <Box sx={{ flexShrink: 0, maxWidth: '38%', display: { xs: 'none', sm: 'block' } }}>
        <UserChip user={call.expert} size={22} showRole={false} />
      </Box>
    </ButtonBase>
  );
}

function TodayBoard({ today }: { today: DashboardSummary['today'] }) {
  const zone = today.zone;
  const nowMs = Date.now();
  const columns: Array<{ key: string; title: string; calls: CallDTO[]; empty: string; dot: string }> = [
    { key: 'ongoing', title: 'Ongoing', calls: today.ongoing, empty: 'Nothing in progress', dot: STATUS_COLORS.ongoing },
    { key: 'upcoming', title: 'Coming up', calls: today.upcoming, empty: 'No more calls today', dot: STATUS_COLORS.scheduled },
    { key: 'finished', title: 'Finished', calls: today.finished, empty: 'None finished yet', dot: STATUS_COLORS.finished },
  ];
  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' } }}>
      {columns.map((col) => (
        <Panel
          key={col.key}
          title={col.title}
          count={col.calls.length}
          action={<Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: col.dot }} />}
        >
          {col.calls.length === 0 ? (
            <Empty>{col.empty}</Empty>
          ) : (
            col.calls.map((c) => (
              <Box key={c.id} sx={{ position: 'relative' }}>
                <CallLine call={c} zone={zone} showDay={col.key === 'ongoing' && inZone(c.scheduledAt, zone).toISODate() !== today.date} />
                {col.key === 'upcoming' && Date.parse(c.scheduledAt) < nowMs && (
                  <Tooltip title="Start time has passed">
                    <Box sx={{ position: 'absolute', left: 2, top: '50%', mt: '-3px', width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main' }} />
                  </Tooltip>
                )}
              </Box>
            ))
          )}
        </Panel>
      ))}
    </Box>
  );
}

function BankTaskLine({ item, zone, onAdd }: { item: ProfileNeedingBank; zone: string; onAdd: () => void }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 1, py: 1, borderRadius: 2, '&:hover': { bgcolor: 'action.hover' } }}>
      <UserAvatar avatarId={item.profile.avatarId} photoId={item.profile.photoId} label={item.profile.name} size={32} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={550} noWrap>
          {item.profile.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {item.bookedCalls} booked call{item.bookedCalls === 1 ? '' : 's'}
          {item.nextCallAt && ` · next ${shortDay(item.nextCallAt, zone).replace(/^(Today|Tomorrow|Yesterday)$/, (w) => w.toLowerCase())}, ${inZone(item.nextCallAt, zone).toFormat('h:mm a')}`}
        </Typography>
      </Box>
      <Button size="small" variant="outlined" color="inherit" onClick={onAdd}>
        Add bank
      </Button>
    </Stack>
  );
}

/** A finished call cannot be invoiced until the Profile has a rate on its platform. */
function RateTaskLine({ item }: { item: ProfileNeedingRate }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.75, borderRadius: 2, '&:hover': { bgcolor: 'action.hover' } }}>
      <UserAvatar avatarId={item.profile.avatarId} photoId={item.profile.photoId} label={item.profile.name} size={26} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {item.profile.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {item.platform.name} · {item.finishedCalls} finished call{item.finishedCalls === 1 ? '' : 's'} waiting
        </Typography>
      </Box>
    </Stack>
  );
}

function PendingTasks({ tasks, zone }: { tasks: NonNullable<DashboardSummary['tasks']>; zone: string }) {
  const [bankFor, setBankFor] = useState<ProfileNeedingBank['profile'] | null>(null);
  const total = tasks.invoicesToSubmit.length + tasks.profilesNeedingBank.length + tasks.profilesNeedingRate.length;
  return (
    <>
      <Panel title="Pending tasks" count={total}>
        {total === 0 ? (
          <Empty>All clear. Nothing waiting on you.</Empty>
        ) : (
          <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" alignItems="center" sx={{ px: 1, py: 0.5 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ flex: 1 }}>
                  Submit invoice · {tasks.invoicesToSubmit.length}
                </Typography>
                {tasks.invoicesToSubmit.length > 0 && (
                  <Button size="small" component={RouterLink} to="/invoicing" endIcon={<ChevronRightRounded />} sx={{ minHeight: 26 }}>
                    Invoicing
                  </Button>
                )}
              </Stack>
              {tasks.invoicesToSubmit.length === 0 ? (
                <Empty>Every finished call is invoiced.</Empty>
              ) : (
                tasks.invoicesToSubmit.slice(0, 8).map((c) => <CallLine key={c.id} call={c} zone={zone} showDay />)
              )}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ px: 1, py: 0.5, minHeight: 34, display: 'flex', alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Add bank · {tasks.profilesNeedingBank.length}
                </Typography>
              </Box>
              {tasks.profilesNeedingBank.length === 0 ? (
                <Empty>Every booked profile has a bank.</Empty>
              ) : (
                tasks.profilesNeedingBank.slice(0, 8).map((p) => (
                  <BankTaskLine key={p.profile.id} item={p} zone={zone} onAdd={() => setBankFor(p.profile)} />
                ))
              )}
              {tasks.profilesNeedingRate.length > 0 && (
                <>
                  <Stack direction="row" alignItems="center" sx={{ px: 1, py: 0.5, mt: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ flex: 1 }}>
                      Set hourly rate · {tasks.profilesNeedingRate.length}
                    </Typography>
                    <Button size="small" component={RouterLink} to="/profiles" endIcon={<ChevronRightRounded />} sx={{ minHeight: 26 }}>
                      Profiles
                    </Button>
                  </Stack>
                  {tasks.profilesNeedingRate.slice(0, 8).map((r) => (
                    <RateTaskLine key={`${r.profile.id}-${r.platform.id}`} item={r} />
                  ))}
                </>
              )}
            </Box>
          </Box>
        )}
      </Panel>
      <BanksDialog profile={bankFor} open={Boolean(bankFor)} onClose={() => setBankFor(null)} startAdding />
    </>
  );
}

/** Nightly database dumps: when the last one ran, and download or run one now. */
function BackupsCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { zone } = useAuth();
  const dumps = useQuery({ queryKey: qk.dbDumps, queryFn: api.dbDumps.list });
  const [downloading, setDownloading] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => api.dbDumps.run(),
    onSuccess: (dump) => {
      void queryClient.invalidateQueries({ queryKey: qk.dbDumps });
      if (dump.succeeded) toast.success(`Backup taken · ${formatBytes(dump.byteSize)}`);
      else toast.error(dump.error ?? 'The backup failed');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const download = async (id: string) => {
    setDownloading(id);
    try {
      const { blob, filename } = await api.dbDumps.download(id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? 'god-dump.json.gz';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not download the backup'));
    } finally {
      setDownloading(null);
    }
  };

  const rows = dumps.data ?? [];
  const latest = rows[0];
  const rowCount = latest ? Object.values(latest.tableCounts).reduce((n, c) => n + c, 0) : 0;

  return (
    <Panel
      title="Backups"
      action={
        <Button size="small" onClick={() => run.mutate()} disabled={run.isPending}>
          {run.isPending ? <CircularProgress size={14} /> : 'Run now'}
        </Button>
      }
    >
      <Box sx={{ px: 1, pb: 1 }}>
        {dumps.isLoading ? (
          <Skeleton height={80} />
        ) : !latest ? (
          <Empty>The first nightly backup has not run yet.</Empty>
        ) : (
          <>
            <Typography variant="h4" component="div" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {latest.succeeded ? formatBytes(latest.byteSize) : 'Failed'}
            </Typography>
            <Typography variant="caption" color={latest.succeeded ? 'text.secondary' : 'error.main'}>
              {latest.succeeded
                ? `${relativeTime(latest.createdAt)} · ${rowCount.toLocaleString()} rows`
                : (latest.error ?? 'The last backup failed')}
            </Typography>
            <Stack spacing={0.5} sx={{ mt: 2 }}>
              {rows.map((d) => (
                <Stack key={d.id} direction="row" alignItems="center" spacing={1}>
                  <Tooltip title={formatDateTime(d.createdAt, zone)}>
                    <Typography variant="caption" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {relativeTime(d.createdAt)}
                      {d.trigger === 'manual' ? ' · manual' : ''}
                    </Typography>
                  </Tooltip>
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {d.succeeded ? formatBytes(d.byteSize) : 'failed'}
                  </Typography>
                  {d.succeeded && (
                    <Button size="small" onClick={() => void download(d.id)} disabled={downloading === d.id} sx={{ minWidth: 0 }}>
                      {downloading === d.id ? <CircularProgress size={12} /> : 'Download'}
                    </Button>
                  )}
                </Stack>
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1.5 }}>
              Runs every night (3:00 team time); the last {rows.length === 1 ? 'backup is' : `${rows.length} backups are`} kept.
            </Typography>
          </>
        )}
      </Box>
    </Panel>
  );
}

function DatabaseCard({ database }: { database: NonNullable<DashboardSummary['database']> }) {
  const top = database.tables.slice(0, 5);
  const max = Math.max(1, ...top.map((t) => t.bytes));
  return (
    <Panel title="Database" action={<StorageOutlined sx={{ fontSize: 18, color: 'text.secondary' }} />}>
      <Box sx={{ px: 1, pb: 1 }}>
        <Typography variant="h4" component="div" sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatBytes(database.sizeBytes)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          current size
        </Typography>
        <Stack spacing={1} sx={{ mt: 2 }}>
          {top.map((t) => (
            <Box key={t.name}>
              <Stack direction="row" justifyContent="space-between">
                <Typography variant="caption">{t.name}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatBytes(t.bytes)}
                </Typography>
              </Stack>
              <Box sx={{ height: 4, borderRadius: 99, bgcolor: 'action.selected', mt: 0.5, overflow: 'hidden' }}>
                <Box sx={{ height: '100%', width: `${(t.bytes / max) * 100}%`, bgcolor: 'primary.main', opacity: 0.7, borderRadius: 99 }} />
              </Box>
            </Box>
          ))}
        </Stack>
      </Box>
    </Panel>
  );
}

function TeamPanel({ team }: { team: NonNullable<DashboardSummary['team']> }) {
  const sum = (counts: Record<CallStatus, number>, statuses: CallStatus[]) => statuses.reduce((n, s) => n + (counts[s] ?? 0), 0);
  return (
    <Panel title="Team" count={team.length}>
      {team.length === 0 ? (
        <Empty>No Associates yet.</Empty>
      ) : (
        team.map((row) => (
          <ButtonBase
            key={row.associate.id}
            component={RouterLink}
            to={`/calls?associateId=${row.associate.id}`}
            sx={{ display: 'flex', width: '100%', alignItems: 'center', gap: 2, px: 1, py: 1, borderRadius: 2, '&:hover': { bgcolor: 'action.hover' } }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <UserChip user={row.associate} showRole={false} />
            </Box>
            {TRACK_STAGES.map((stage) => (
              <Box key={stage} sx={{ width: 76, textAlign: 'right' }}>
                <Typography variant="body2" fontWeight={600}>
                  {sum(row.byStatus, STAGE_STATUSES[stage])}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {STAGE_LABELS[stage]}
                </Typography>
              </Box>
            ))}
          </ButtonBase>
        ))
      )}
    </Panel>
  );
}

export default function DashboardPage() {
  const me = useMe();
  const { zone } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: qk.dashboard, queryFn: api.dashboard.get, refetchInterval: 60_000 });

  const header = (
    <Stack direction="row" alignItems="flex-end" justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
      <Box>
        <Typography variant="h4" component="h1">
          Today
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {DateTime.now().setZone(zone).toFormat('cccc, LLLL d')} · {zoneAbbr(zone)}
        </Typography>
      </Box>
      {me.role !== 'expert' && (
        <Button variant="contained" startIcon={<AddRounded />} component={RouterLink} to="/calls/new">
          New call
        </Button>
      )}
    </Stack>
  );

  if (error) {
    return (
      <>
        {header}
        <ErrorState error={error} onRetry={refetch} />
      </>
    );
  }
  if (isLoading || !data) {
    return (
      <>
        {header}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, 1fr)' }, mb: 2 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rounded" height={180} sx={{ borderRadius: 3.5 }} />
          ))}
        </Box>
        <Skeleton variant="rounded" height={220} sx={{ borderRadius: 3.5 }} />
      </>
    );
  }

  return (
    <>
      {header}
      <Stack spacing={2}>
        <TodayBoard today={data.today} />
        {(data.tasks || data.database) && (
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 2fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
            {data.tasks && <PendingTasks tasks={data.tasks} zone={zone} />}
            {data.database && (
              <Stack spacing={2}>
                <DatabaseCard database={data.database} />
                <BackupsCard />
              </Stack>
            )}
          </Box>
        )}
        {data.team && <TeamPanel team={data.team} />}
      </Stack>
    </>
  );
}
