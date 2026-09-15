import AccountTreeRounded from '@mui/icons-material/AccountTreeRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import TableRowsRounded from '@mui/icons-material/TableRowsRounded';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import LinkedIn from '@mui/icons-material/LinkedIn';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  Skeleton,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import type { ProfileDTO, ProfileStatus } from '@god/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useMe } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { BanksDialog } from '@/components/BanksDialog';
import { DotPill, PlatformStatusSelect, ProfileDetailsDialog } from '@/components/ProfileDetails';
import { UserAvatar, UserChip } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { relativeTime } from '@/lib/time';
import { FilterChips, Hint, SearchField, TableSurface, useDebouncedValue, useIsPhone } from './adminShared';
import { ProfileDialog, RejectProfileDialog } from './ProfileDialogs';

const PROFILE_STATUS_META: Record<ProfileStatus, { label: string; color: string }> = {
  pending: { label: 'Pending review', color: '#e0913a' },
  approved: { label: 'Approved', color: '#3fb68b' },
  rejected: { label: 'Rejected', color: '#dc4a4a' },
};

const STATUS_ORDER: Record<ProfileStatus, number> = { pending: 0, rejected: 1, approved: 2 };

export function ProfileStatusChip({ status }: { status: ProfileStatus }) {
  const meta = PROFILE_STATUS_META[status];
  return <DotPill color={meta.color}>{meta.label}</DotPill>;
}

type Filter = 'all' | ProfileStatus | 'needs_bank';
type View = 'cards' | 'table';
const VIEW_KEY = 'god.profiles.view';

/** The Founder's table is the default; the choice is remembered per browser. */
function useProfilesView(isFounder: boolean): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      return (localStorage.getItem(VIEW_KEY) as View | null) ?? (isFounder ? 'table' : 'cards');
    } catch {
      return isFounder ? 'table' : 'cards';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Storage unavailable: the choice just isn't remembered.
    }
  }, [view]);
  return [isFounder ? view : 'cards', setView];
}

export default function ProfilesPage() {
  const me = useMe();
  const isFounder = me.role === 'founder';
  const isExpert = me.role === 'expert';
  const canAdd = isFounder || me.role === 'associate';
  const phone = useIsPhone();
  const [view, setView] = useProfilesView(isFounder);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<{ profile: ProfileDTO | null; resubmit: boolean } | null>(null);
  const [rejecting, setRejecting] = useState<ProfileDTO | null>(null);

  const query = useQuery({
    queryKey: qk.profiles.list({ q }),
    queryFn: () => api.profiles.list(q ? { q } : undefined),
    placeholderData: keepPreviousData,
  });

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, pending: 0, approved: 0, rejected: 0, needs_bank: 0 };
    for (const p of query.data ?? []) {
      c.all++;
      c[p.status]++;
      if (p.needsBank) c.needs_bank++;
    }
    return c;
  }, [query.data]);

  const visible = useMemo(
    () =>
      (query.data ?? [])
        .filter((p) => filter === 'all' || (filter === 'needs_bank' ? p.needsBank : p.status === filter))
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name)),
    [query.data, filter],
  );

  // Non-founders only see statuses they actually have (their own submissions).
  const filterOptions = (['all', 'pending', 'approved', 'rejected', 'needs_bank'] as const)
    .filter((f) => (f === 'needs_bank' ? isFounder : isFounder || f === 'all' || (!isExpert && (f === 'approved' || counts[f] > 0))))
    .map((f) => ({
      value: f,
      label: f === 'all' ? 'All' : f === 'pending' ? 'Pending' : f === 'needs_bank' ? 'Needs bank' : PROFILE_STATUS_META[f].label,
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
            <Stack direction="row" spacing={1} alignItems="center">
              {isFounder && !phone && (
                <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v: View | null) => v && setView(v)} aria-label="Layout">
                  <ToggleButton value="table" aria-label="Table">
                    <Tooltip title="Table: all profiles and platform statuses">
                      <TableRowsRounded fontSize="small" />
                    </Tooltip>
                  </ToggleButton>
                  <ToggleButton value="cards" aria-label="Cards">
                    <Tooltip title="Cards">
                      <GridViewRounded fontSize="small" />
                    </Tooltip>
                  </ToggleButton>
                </ToggleButtonGroup>
              )}
              <Button variant="contained" startIcon={<AddRounded />} onClick={() => setEditing({ profile: null, resubmit: false })}>
                {isFounder ? 'Add profile' : 'Submit profile'}
              </Button>
            </Stack>
          )
        }
      />

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

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2.5 }}
      >
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
              : me.role === 'associate'
                ? 'Profiles you submit are reviewed by a Founder before they can be used for calls. Open a profile to see its details and platform statuses.'
                : 'Associates submit profiles and a Founder approves them. Open a profile to see its details and platform statuses.'}
          </Hint>
        </Box>
      )}

      {query.isLoading ? (
        <Grid container spacing={2}>
          {Array.from({ length: 6 }, (_, i) => (
            <Grid key={i} size={{ xs: 12, sm: 6, lg: 4 }}>
              <Card>
                <CardContent>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Skeleton variant="circular" width={52} height={52} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton width="60%" />
                      <Skeleton width="35%" />
                    </Box>
                  </Stack>
                  <Skeleton sx={{ mt: 2 }} />
                  <Skeleton width="80%" />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
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
              title={`No ${filter} profiles`}
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
              description={
                isFounder
                  ? 'Add the first profile to start booking calls.'
                  : isExpert
                    ? 'Profiles appear here once you are assigned a call.'
                    : 'No approved profiles yet.'
              }
              action={
                canAdd && (
                  <Button variant="contained" startIcon={<AddRounded />} onClick={() => setEditing({ profile: null, resubmit: false })}>
                    {isFounder ? 'Add profile' : 'Submit profile'}
                  </Button>
                )
              }
            />
          )}
        </Card>
      ) : view === 'table' && !phone ? (
        <ProfilesTable profiles={visible} onOpen={(p) => setDetailsId(p.id)} />
      ) : (
        <Grid container spacing={2}>
          {visible.map((p) => (
            <Grid key={p.id} size={{ xs: 12, sm: 6, lg: 4 }}>
              <ProfileCard
                profile={p}
                meId={me.id}
                isFounder={isFounder}
                onEdit={(resubmit) => setEditing({ profile: p, resubmit })}
                onReject={() => setRejecting(p)}
                onOpen={() => setDetailsId(p.id)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      <ProfileDialog
        open={Boolean(editing)}
        profile={editing?.profile ?? null}
        resubmit={editing?.resubmit}
        onClose={() => setEditing(null)}
      />
      <RejectProfileDialog profile={rejecting} onClose={() => setRejecting(null)} />
      <ProfileDetailsDialog
        profileId={detailsId}
        onClose={() => setDetailsId(null)}
        onEdit={
          isFounder
            ? (p) => {
                setDetailsId(null);
                setEditing({ profile: p, resubmit: false });
              }
            : undefined
        }
      />
    </Box>
  );
}

function ProfileCard({
  profile: p,
  meId,
  isFounder,
  onEdit,
  onReject,
  onOpen,
}: {
  profile: ProfileDTO;
  meId: string;
  isFounder: boolean;
  onEdit: (resubmit: boolean) => void;
  onReject: () => void;
  onOpen: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const approve = useMutation({
    mutationFn: () => api.profiles.approve(p.id),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
      toast.success(`Approved “${saved.name}”`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const [banksOpen, setBanksOpen] = useState(false);
  const isAuthor = p.createdBy.id === meId;
  const authorCanEdit = !isFounder && isAuthor && p.status !== 'approved';
  const canEdit = isFounder || authorCanEdit;
  const reviewable = isFounder && p.status === 'pending';

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'box-shadow .15s ease',
        '&:hover': { boxShadow: '0 6px 20px -12px rgba(0 0 0 / 0.18)' },
      }}
    >
      <CardContent sx={{ flex: 1, pb: 1.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <UserAvatar avatarId={p.avatarId} photoId={p.photoId} label={p.name} size={52} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Link
                component="button"
                variant="subtitle1"
                color="text.primary"
                underline="hover"
                noWrap
                title={`View ${p.name}`}
                onClick={onOpen}
                sx={{ lineHeight: 1.3, textAlign: 'left', fontWeight: 600 }}
              >
                {p.name}
              </Link>
              {p.linkedinUrl && (
                <Tooltip title="Open LinkedIn">
                  <IconButton
                    size="small"
                    component="a"
                    href={p.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${p.name} on LinkedIn (opens in a new tab)`}
                    sx={{ color: 'text.secondary', p: 0.5 }}
                  >
                    <LinkedIn sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            <Box sx={{ mt: 0.5 }}>
              <ProfileStatusChip status={p.status} />
            </Box>
          </Box>
          {canEdit && (
            <Tooltip title={authorCanEdit ? 'Edit and resubmit' : 'Edit'}>
              <IconButton size="small" onClick={() => onEdit(authorCanEdit)} aria-label={`Edit ${p.name}`}>
                <EditOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>

        <Typography
          variant="body2"
          color={p.briefExperience ? 'text.secondary' : 'text.disabled'}
          sx={{
            mt: 1.75,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            fontStyle: p.briefExperience ? 'normal' : 'italic',
          }}
          title={p.briefExperience || undefined}
        >
          {p.briefExperience || 'No experience summary'}
        </Typography>

        {p.status === 'rejected' && p.rejectionReason && (
          <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 2, bgcolor: 'background.subtle' }}>
            <Typography variant="caption" color="text.secondary" component="div">
              Rejection reason
            </Typography>
            <Typography variant="body2">{p.rejectionReason}</Typography>
          </Box>
        )}
        {authorCanEdit && (
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            Your submission — editing sends it back for review.
          </Typography>
        )}
      </CardContent>

      <Divider />
      <CardActions sx={{ px: 2, py: 1.25, justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <UserChip user={p.createdBy} size={22} subtitle={`Added ${relativeTime(p.createdAt)}`} />
        <Button size="small" color="inherit" onClick={onOpen} sx={{ color: 'text.secondary' }}>
          Details
        </Button>
        {isFounder && p.status === 'approved' && (
          <Button size="small" color="inherit" onClick={() => setBanksOpen(true)} sx={{ gap: 0.75, color: 'text.secondary' }}>
            {p.needsBank && <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main' }} />}
            {p.needsBank ? 'Add bank' : p.bankCount ? `${p.bankCount} bank${p.bankCount === 1 ? '' : 's'}` : 'Banks'}
          </Button>
        )}
        {reviewable && (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              color="inherit"
              onClick={onReject}
              disabled={approve.isPending}
            >
              Reject
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={approve.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
              onClick={() => approve.mutate()}
              disabled={approve.isPending}
            >
              Approve
            </Button>
          </Stack>
        )}
      </CardActions>
      {isFounder && (
        <BanksDialog profile={p} open={banksOpen} onClose={() => setBanksOpen(false)} startAdding={Boolean(p.needsBank)} />
      )}
    </Card>
  );
}

/** Founder overview: every profile against every platform, editable in place. */
function ProfilesTable({ profiles, onOpen }: { profiles: ProfileDTO[]; onOpen: (p: ProfileDTO) => void }) {
  const platforms = profiles[0]?.platformStatuses?.map((s) => s.platform) ?? [];
  return (
    <TableSurface minWidth={420 + platforms.length * 150}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper', minWidth: 220 }}>Profile</TableCell>
            <TableCell>Review</TableCell>
            {platforms.map((pl) => (
              <TableCell key={pl.id} sx={{ whiteSpace: 'nowrap' }}>
                {pl.name}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {profiles.map((p) => (
            <TableRow key={p.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
              <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper' }}>
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <UserAvatar avatarId={p.avatarId} photoId={p.photoId} label={p.name} size={30} />
                  <Link component="button" variant="body2" color="text.primary" underline="hover" onClick={() => onOpen(p)} sx={{ fontWeight: 550, textAlign: 'left' }}>
                    {p.name}
                  </Link>
                </Stack>
              </TableCell>
              <TableCell>
                <ProfileStatusChip status={p.status} />
              </TableCell>
              {platforms.map((pl) => (
                <TableCell key={pl.id}>
                  <PlatformStatusSelect
                    profile={p}
                    platformId={pl.id}
                    status={p.platformStatuses?.find((s) => s.platform.id === pl.id)?.status ?? 'not_registered'}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableSurface>
  );
}
