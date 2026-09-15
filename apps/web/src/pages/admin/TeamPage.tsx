import GroupsRounded from '@mui/icons-material/GroupsRounded';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  STAGES,
  STAGE_LABELS,
  STAGE_STATUSES,
  STATUS_LABELS,
  type CallStatus,
  type Stage,
  type UserDTO,
} from '@god/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader } from '@/components/common';
import { UserAvatar } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatDate } from '@/lib/time';
import { useAuth } from '@/auth/AuthProvider';
import { STAGE_COLORS } from '@/theme/theme';
import { StatTile } from './adminShared';
import { CreateUserDialog } from './UserDialogs';

type Counts = Record<CallStatus, number>;

const stageTotal = (counts: Counts | undefined, stage: Stage) =>
  counts ? STAGE_STATUSES[stage].reduce((n, s) => n + (counts[s] ?? 0), 0) : 0;

function StageBar({ counts }: { counts: Counts | undefined }) {
  const totals = STAGES.map((s) => ({ stage: s, n: stageTotal(counts, s) }));
  const sum = totals.reduce((n, t) => n + t.n, 0);
  return (
    <Box
      aria-hidden
      sx={{ display: 'flex', height: 4, borderRadius: 99, overflow: 'hidden', bgcolor: 'action.selected', gap: sum ? '2px' : 0 }}
    >
      {sum > 0 &&
        totals.map((t) =>
          t.n ? <Box key={t.stage} sx={{ flex: t.n, bgcolor: STAGE_COLORS[t.stage], transition: 'flex .3s ease' }} /> : null,
        )}
    </Box>
  );
}

function StageCount({ stage, counts, dim }: { stage: Stage; counts: Counts | undefined; dim?: boolean }) {
  const color = STAGE_COLORS[stage];
  const total = stageTotal(counts, stage);
  const breakdown = STAGE_STATUSES[stage].map((s) => `${STATUS_LABELS[s]}: ${counts?.[s] ?? 0}`).join(' · ');
  return (
    <Tooltip title={breakdown}>
      <Box sx={{ flex: 1, minWidth: 0, opacity: dim ? 0.55 : 1 }} tabIndex={0} aria-label={`${STAGE_LABELS[stage]} ${total}. ${breakdown}`}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
          <Typography variant="caption" color="text.secondary" noWrap>
            {STAGE_LABELS[stage]}
          </Typography>
        </Stack>
        <Typography variant="h6" component="div" sx={{ fontVariantNumeric: 'tabular-nums', pl: 1.75, fontWeight: 600 }}>
          {total}
        </Typography>
      </Box>
    </Tooltip>
  );
}

export default function TeamPage() {
  const { zone } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<UserDTO | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const team = useQuery({ queryKey: qk.users.team, queryFn: api.users.team });
  const dashboard = useQuery({ queryKey: qk.dashboard, queryFn: api.dashboard.get });

  const countsById = useMemo(() => {
    const map = new Map<string, Counts>();
    for (const row of dashboard.data?.team ?? []) map.set(row.associate.id, row.byStatus);
    return map;
  }, [dashboard.data]);

  const members = team.data ?? [];
  const active = members.filter((m) => m.isActive);

  const teamTotals = useMemo(
    () =>
      Object.fromEntries(
        STAGES.map((stage) => [stage, [...countsById.values()].reduce((n, c) => n + stageTotal(c, stage), 0)]),
      ) as Record<Stage, number>,
    [countsById],
  );

  const confirmToggle = async () => {
    if (!toggling) return;
    const next = !toggling.isActive;
    const saved = await api.users.update(toggling.id, { isActive: next });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.users.all }),
      queryClient.invalidateQueries({ queryKey: qk.dashboard }),
    ]);
    toast.success(next ? `${saved.nickname} reactivated` : `${saved.nickname} deactivated and signed out`);
  };

  return (
    <Box>
      <PageHeader
        title="My team"
        subtitle="Your Associates and where their calls stand."
        actions={
          <Button variant="contained" startIcon={<PersonAddAlt1Rounded />} onClick={() => setAdding(true)}>
            Add associate
          </Button>
        }
      />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile
            label="Active associates"
            value={team.isLoading ? <Skeleton width={40} /> : active.length}
            footer={
              members.length > active.length && (
                <Typography variant="caption" color="text.secondary">
                  {members.length - active.length} deactivated
                </Typography>
              )
            }
          />
        </Grid>
        {STAGES.map((stage) => (
          <Grid key={stage} size={{ xs: 6, md: 3 }}>
            <StatTile
              label={STAGE_LABELS[stage]}
              color={STAGE_COLORS[stage]}
              value={dashboard.isLoading ? <Skeleton width={40} /> : teamTotals[stage]}
            />
          </Grid>
        ))}
      </Grid>

      {dashboard.isError && (
        <Box sx={{ mb: 2 }}>
          <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
        </Box>
      )}

      {team.isLoading ? (
        <Grid container spacing={2}>
          {Array.from({ length: 4 }, (_, i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Card>
                <CardContent>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Skeleton variant="circular" width={48} height={48} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton width="50%" />
                      <Skeleton width="30%" />
                    </Box>
                  </Stack>
                  <Skeleton variant="rounded" height={56} sx={{ mt: 2 }} />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : team.isError ? (
        <ErrorState error={team.error} onRetry={() => void team.refetch()} />
      ) : members.length === 0 ? (
        <Card>
          <EmptyState
            icon={<GroupsRounded />}
            title="Your team is empty"
            description="Add Associates so they can book and coordinate calls. You will see their progress here."
            action={
              <Button variant="contained" startIcon={<PersonAddAlt1Rounded />} onClick={() => setAdding(true)}>
                Add associate
              </Button>
            }
          />
        </Card>
      ) : (
        <Grid container spacing={2}>
          {members.map((m) => {
            const counts = countsById.get(m.id);
            return (
              <Grid key={m.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                <Card
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    ...(m.isActive ? {} : { bgcolor: 'background.subtle', boxShadow: 'none' }),
                  }}
                >
                  <CardContent sx={{ flex: 1, p: 2.5 }}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Box sx={{ filter: m.isActive ? 'none' : 'grayscale(1)', opacity: m.isActive ? 1 : 0.7 }}>
                        <UserAvatar avatarId={m.avatarId} photoId={m.photoId} label={m.nickname} size={40} />
                      </Box>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body1" fontWeight={550} noWrap>
                          {m.nickname}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Joined {formatDate(m.createdAt, zone)}
                        </Typography>
                      </Box>
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.75,
                          height: 24,
                          px: 1,
                          borderRadius: 999,
                          bgcolor: 'action.selected',
                          color: m.isActive ? 'text.primary' : 'text.secondary',
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: m.isActive ? 'success.main' : 'text.disabled' }} />
                        {m.isActive ? 'Active' : 'Deactivated'}
                      </Box>
                    </Stack>
                    <Box sx={{ mt: 2.25 }}>
                      {dashboard.isLoading ? (
                        <Skeleton variant="rounded" height={52} />
                      ) : (
                        <>
                          <Stack direction="row" spacing={1} sx={{ mb: 1.25 }}>
                            {STAGES.map((s) => (
                              <StageCount key={s} stage={s} counts={counts} dim={!m.isActive} />
                            ))}
                          </Stack>
                          <StageBar counts={counts} />
                          {!m.isActive && (
                            <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                              Call counts are tracked for active Associates.
                            </Typography>
                          )}
                        </>
                      )}
                    </Box>
                  </CardContent>
                  <Stack direction="row" justifyContent="flex-end" sx={{ px: 1.5, pb: 1.5, mt: -1 }}>
                    <Button
                      size="small"
                      color="inherit"
                      sx={{ color: 'text.secondary' }}
                      onClick={() => {
                        setToggling(m);
                        setConfirmOpen(true);
                      }}
                    >
                      {m.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </Stack>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <CreateUserDialog open={adding} onClose={() => setAdding(false)} roles={['associate']} />

      <ConfirmDialog
        open={confirmOpen}
        title={toggling?.isActive ? `Deactivate ${toggling.nickname}?` : `Reactivate ${toggling?.nickname ?? ''}?`}
        description={
          toggling?.isActive
            ? 'They will be signed out on every device immediately and cannot sign in until reactivated. Their calls and history stay intact.'
            : 'They will be able to sign in again with their existing password.'
        }
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Reactivate'}
        destructive={toggling?.isActive}
        onConfirm={confirmToggle}
        onClose={() => setConfirmOpen(false)}
      />
    </Box>
  );
}
