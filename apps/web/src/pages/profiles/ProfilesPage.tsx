import AccountTreeRounded from '@mui/icons-material/AccountTreeRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  IconButton,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import { type ProfileDTO, type ProfileStatus } from '@god/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useMe } from '@/auth/AuthProvider';
import { DeactivatedPill, PROFILE_STATUS_META, ProfileStatusChip } from '@/components/ProfileDetails';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { UserAvatar, UserChip } from '@/components/identity';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { FilterChips, Hint, SearchField, TableSurface, useDebouncedValue } from '../admin/adminShared';
import { ProfileDialog } from '../admin/ProfileDialogs';
import { PlatformStatusTable } from './PlatformStatusTable';
import { AllPlatformStatuses, TopPlatformStatus, pendingItems } from './profileShared';

type Filter = 'all' | 'mine' | ProfileStatus | 'needs_bank' | 'deactivated';
const STATUS_ORDER: Record<ProfileStatus, number> = { pending: 0, rejected: 1, approved: 2 };

/** One table of every profile: what each still needs, and where they stand on each platform. */
export default function ProfilesPage() {
  const me = useMe();
  const navigate = useNavigate();
  const isFounder = me.role === 'founder';
  const isExpert = me.role === 'expert';
  const canAdd = isFounder || me.role === 'associate' || me.role === 'manager';
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const [filter, setFilter] = useState<Filter>('all');
  // Two views of the same profiles: the list, and one table of every platform status.
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'platforms' && !isExpert ? 'platforms' : 'profiles';
  const [adding, setAdding] = useState(false);

  const query = useQuery({
    queryKey: qk.profiles.list({ q }),
    queryFn: () => api.profiles.list(q ? { q } : undefined),
    placeholderData: keepPreviousData,
  });

  // An Associate's own Profiles; for a Manager, those their team looks after.
  const isMine = (p: ProfileDTO) =>
    me.role === 'manager' ? p.associate !== null && p.canAssign : p.associate?.id === me.id;
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, mine: 0, pending: 0, approved: 0, rejected: 0, needs_bank: 0, deactivated: 0 };
    for (const p of query.data ?? []) {
      c.all++;
      if (isMine(p)) c.mine++;
      c[p.status]++;
      if (p.needsBank) c.needs_bank++;
      if (!p.isActive) c.deactivated++;
    }
    return c;
  }, [query.data]);

  const visible = useMemo(
    () =>
      (query.data ?? [])
        .filter((p) =>
          filter === 'all'
            ? true
            : filter === 'mine'
              ? isMine(p)
              : filter === 'needs_bank'
              ? p.needsBank
              : filter === 'deactivated'
                ? !p.isActive
                : p.status === filter,
        )
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data, filter],
  );

  // Non-founders only see the statuses they actually have (their own submissions).
  const filterOptions = (['all', 'mine', 'pending', 'approved', 'rejected', 'needs_bank', 'deactivated'] as const)
    .filter((f) =>
      f === 'mine'
        ? me.role === 'associate' || me.role === 'manager'
        : f === 'needs_bank' || f === 'deactivated'
          ? isFounder
          : isFounder || f === 'all' || (!isExpert && (f === 'approved' || counts[f] > 0)),
    )
    .map((f) => ({
      value: f,
      label:
        f === 'all'
          ? 'All'
          : f === 'mine'
            ? me.role === 'manager'
              ? 'My team'
              : 'Mine'
            : f === 'needs_bank'
            ? 'Needs bank'
            : f === 'deactivated'
              ? 'Deactivated'
              : PROFILE_STATUS_META[f].label,
      count: query.data ? counts[f] : undefined,
    }));

  const searching = search.trim() !== q || (query.isFetching && !query.isLoading);

  return (
    <Box>
      <PageHeader
        title="Profiles"
        subtitle={isExpert ? 'The profiles of your calls.' : 'The people calls are booked with.'}
        actions={
          canAdd && (
            <Button variant="contained" startIcon={<AddRounded />} onClick={() => setAdding(true)}>
              {isFounder ? 'Add profile' : 'Submit profile'}
            </Button>
          )
        }
      />

      {!isExpert && (
        <Tabs
          value={view}
          onChange={(_, v: string) => setParams(v === 'platforms' ? { view: 'platforms' } : {}, { replace: true })}
          sx={{ mb: 2.5, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="profiles" label="Profiles" />
          <Tab value="platforms" label="Platform status" />
        </Tabs>
      )}

      {isFounder && counts.pending > 0 && filter !== 'pending' && (
        <Alert
          severity="info"
          variant="outlined"
          icon={false}
          sx={{ mb: 2, bgcolor: 'background.paper', borderColor: 'divider', color: 'text.primary' }}
          action={
            <Button color="inherit" size="small" onClick={() => setFilter('pending')}>
              Review
            </Button>
          }
        >
          {counts.pending} profile{counts.pending === 1 ? '' : 's'} waiting for your review.
        </Alert>
      )}

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }} justifyContent="space-between" sx={{ mb: 2.5 }}>
        <FilterChips ariaLabel="Filter by status" options={filterOptions} value={filter} onChange={setFilter} />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: { md: '0 1 340px' } }}>
          <SearchField value={search} onChange={setSearch} placeholder="Search name or experience" sx={{ maxWidth: 'none' }} />
          <Box sx={{ width: 20, display: 'grid', placeItems: 'center' }}>{searching && <CircularProgress size={16} />}</Box>
        </Stack>
      </Stack>

      {!isFounder && (
        <Box sx={{ mb: 2 }}>
          <Hint icon={<InfoOutlined sx={{ fontSize: 17 }} />}>
            {isExpert
              ? 'Open a profile to read its personal details and history.'
              : 'Profiles you submit are reviewed by a Founder before they can be used for calls.'}
          </Hint>
        </Box>
      )}

      {query.isLoading ? (
        <LoadingRows rows={6} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : view === 'platforms' ? (
        <PlatformStatusTable profiles={visible} />
      ) : visible.length === 0 ? (
        <Card>
          {q ? (
            <EmptyState
              icon={<SearchOffRounded />}
              title={`No profiles match “${q}”`}
              description="Try a different name or keyword from their experience."
              action={
                <Button onClick={() => setSearch('')} size="small">
                  Clear search
                </Button>
              }
            />
          ) : filter !== 'all' ? (
            <EmptyState
              icon={<AccountTreeRounded />}
              title="Nothing here"
              action={
                <Button onClick={() => setFilter('all')} size="small">
                  Show all
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<AccountTreeRounded />}
              title="No profiles yet"
              description={isFounder ? 'Add the first profile to start booking calls.' : 'Profiles appear here once they are approved.'}
              action={
                canAdd && (
                  <Button variant="contained" startIcon={<AddRounded />} onClick={() => setAdding(true)}>
                    {isFounder ? 'Add profile' : 'Submit profile'}
                  </Button>
                )
              }
            />
          )}
        </Card>
      ) : (
        <TableSurface minWidth={880}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 200 }}>Profile</TableCell>
                <TableCell>Status</TableCell>
                {!isExpert && <TableCell sx={{ minWidth: 130 }}>Associate</TableCell>}
                <TableCell sx={{ minWidth: 190 }}>Pending</TableCell>
                {!isExpert && <TableCell sx={{ minWidth: 230 }}>Platforms</TableCell>}
                <TableCell align="right" width={96}>
                  Open
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((p) => (
                <ProfileRow key={p.id} profile={p} isExpert={isExpert} onOpen={(edit) => navigate(`/profiles/${p.id}${edit ? '?edit=1' : ''}`)} />
              ))}
            </TableBody>
          </Table>
        </TableSurface>
      )}

      <ProfileDialog open={adding} profile={null} onClose={() => setAdding(false)} />
    </Box>
  );
}

function ProfileRow({ profile: p, isExpert, onOpen }: { profile: ProfileDTO; isExpert: boolean; onOpen: (edit: boolean) => void }) {
  const me = useMe();
  const pending = pendingItems(p);
  const mayEdit = me.role === 'founder' || (p.createdBy?.id === me.id && p.status !== 'approved');
  // The row shows the first platform; the rest unfold underneath it.
  const [platformsOpen, setPlatformsOpen] = useState(false);
  return (
    <Fragment>
      <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => onOpen(false)}>
        <TableCell>
          <Stack direction="row" spacing={1.25} alignItems="center">
            <UserAvatar avatarId={p.avatarId} photoId={p.photoId} label={p.name} size={30} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={550} noWrap>
                {p.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 260 }}>
                {p.briefExperience || '—'}
              </Typography>
            </Box>
          </Stack>
        </TableCell>
        <TableCell>
          <Stack spacing={0.5} alignItems="flex-start">
            <ProfileStatusChip status={p.status} />
            {!p.isActive && <DeactivatedPill />}
          </Stack>
        </TableCell>
        {!isExpert && (
          <TableCell>
            {p.associate ? (
              <UserChip user={p.associate} size={22} showRole={false} />
            ) : (
              <Typography variant="body2" color="text.disabled">
                —
              </Typography>
            )}
          </TableCell>
        )}
        <TableCell>
          {pending.length === 0 ? (
            <Typography variant="body2" color="text.disabled">
              Nothing
            </Typography>
          ) : (
            <Stack spacing={0.25}>
              {pending.map((item) => (
                <Typography key={item} variant="caption" sx={{ color: 'warning.main', fontWeight: 600, lineHeight: 1.4 }}>
                  {item}
                </Typography>
              ))}
            </Stack>
          )}
        </TableCell>
        {!isExpert && (
          <TableCell>
            <TopPlatformStatus profile={p} expanded={platformsOpen} onToggle={() => setPlatformsOpen((o) => !o)} />
          </TableCell>
        )}
        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
            <Tooltip title="Open details">
              <IconButton size="small" aria-label={`Open ${p.name}`} onClick={() => onOpen(false)}>
                <OpenInNewRounded sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            {mayEdit && (
              <Tooltip title="Edit">
                <IconButton size="small" aria-label={`Edit ${p.name}`} onClick={() => onOpen(true)}>
                  <EditOutlined sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </TableCell>
      </TableRow>
      {platformsOpen && !isExpert && (
        <TableRow>
          <TableCell colSpan={6} sx={{ bgcolor: 'action.hover', py: 1 }}>
            <AllPlatformStatuses profile={p} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
