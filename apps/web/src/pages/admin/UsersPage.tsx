import EditRounded from '@mui/icons-material/EditRounded';
import ManageAccountsRounded from '@mui/icons-material/ManageAccountsRounded';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import SearchOffRounded from '@mui/icons-material/SearchOffRounded';
import {
  Box,
  Button,
  Card,
  IconButton,
  Paper,
  Skeleton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { ROLES, ROLE_LABELS, type Role, type UserDTO } from '@god/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo, useState } from 'react';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader } from '@/components/common';
import { RoleBadge, UserAvatar, UserChip } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { formatDate, formatUsd, zoneCity } from '@/lib/time';
import { FilterChips, SR_ONLY, SearchField, TableSurface, useIsPhone, useNow } from './adminShared';
import { CreateUserDialog, EditUserDialog } from './UserDialogs';

type RoleFilter = 'all' | Role;

function ExpertZone({ zone }: { zone: string }) {
  useNow(60_000);
  const now = DateTime.now().setZone(zone);
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" noWrap title={zone}>
        {zoneCity(zone)}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap component="div">
        {now.isValid ? `${now.toFormat('h:mm a')} ${now.toFormat('ZZZZ')}` : zone}
      </Typography>
    </Box>
  );
}

function ActiveSwitch({ user, isSelf, onToggle }: { user: UserDTO; isSelf: boolean; onToggle: (u: UserDTO) => void }) {
  const control = (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Switch
        size="small"
        checked={user.isActive}
        disabled={isSelf}
        onChange={() => onToggle(user)}
        slotProps={{ input: { 'aria-label': `${user.isActive ? 'Deactivate' : 'Reactivate'} ${user.nickname}` } }}
      />
      <Typography variant="body2" color={user.isActive ? 'text.primary' : 'text.secondary'}>
        {user.isActive ? 'Active' : 'Inactive'}
      </Typography>
    </Stack>
  );
  return isSelf ? (
    <Tooltip title="You cannot deactivate yourself">
      <span>{control}</span>
    </Tooltip>
  ) : (
    control
  );
}

export default function UsersPage() {
  const me = useMe();
  const { zone } = useAuth();
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<RoleFilter>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDTO | null>(null);
  const [toggling, setToggling] = useState<UserDTO | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const query = useQuery({ queryKey: qk.users.list({}), queryFn: () => api.users.list() });

  const counts = useMemo(() => {
    const c = { all: 0, founder: 0, manager: 0, associate: 0, expert: 0 } as Record<RoleFilter, number>;
    for (const u of query.data ?? []) {
      c.all++;
      c[u.role]++;
    }
    return c;
  }, [query.data]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? [])
      .filter((u) => (tab === 'all' || u.role === tab) && (!term || u.nickname.toLowerCase().includes(term)))
      .sort(
        (a, b) =>
          Number(b.isActive) - Number(a.isActive) ||
          ROLES.indexOf(a.role) - ROLES.indexOf(b.role) ||
          a.nickname.localeCompare(b.nickname),
      );
  }, [query.data, tab, search]);

  const setActive = async (user: UserDTO, isActive: boolean) => {
    const saved = await api.users.update(user.id, { isActive });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.users.all }),
      queryClient.invalidateQueries({ queryKey: qk.dashboard }),
    ]);
    toast.success(isActive ? `${saved.nickname} reactivated` : `${saved.nickname} deactivated and signed out`);
  };

  const onToggle = (user: UserDTO) => {
    if (user.isActive) {
      setToggling(user);
      setConfirmOpen(true);
    } else {
      // Reactivation is harmless, so no confirmation.
      setActive(user, true).catch((err) => toast.error(errorMessage(err)));
    }
  };

  const tabs: RoleFilter[] = ['all', 'founder', 'manager', 'associate', 'expert'];

  return (
    <Box>
      <PageHeader
        title="Users"
        subtitle="Everyone with access. Teammates only see nicknames and roles."
        actions={
          <Button variant="contained" startIcon={<PersonAddAlt1Rounded />} onClick={() => setCreating(true)}>
            Create user
          </Button>
        }
      />

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <FilterChips
          ariaLabel="Filter by role"
          value={tab}
          onChange={setTab}
          options={tabs.map((t) => ({
            value: t,
            label: t === 'all' ? 'All' : `${ROLE_LABELS[t]}s`,
            count: query.isLoading ? undefined : counts[t],
          }))}
        />
        <SearchField value={search} onChange={setSearch} placeholder="Search nickname" />
      </Stack>

      {query.isLoading ? (
        <Paper variant="outlined" sx={{ borderRadius: '14px', p: 2 }}>
          <Stack spacing={1.75}>
            {Array.from({ length: 6 }, (_, i) => (
              <Stack key={i} direction="row" spacing={2} alignItems="center">
                <Skeleton variant="circular" width={32} height={32} />
                <Skeleton width="20%" />
                <Skeleton variant="rounded" width={80} height={22} />
                <Box sx={{ flex: 1 }} />
                <Skeleton width={90} />
              </Stack>
            ))}
          </Stack>
        </Paper>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <Card>
          {search ? (
            <EmptyState
              icon={<SearchOffRounded />}
              title={`No users match “${search.trim()}”`}
              action={
                <Button size="small" onClick={() => setSearch('')}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<ManageAccountsRounded />}
              title={tab === 'all' ? 'No users yet' : `No ${ROLE_LABELS[tab].toLowerCase()}s yet`}
              action={
                tab !== 'founder' && (
                  <Button variant="contained" startIcon={<PersonAddAlt1Rounded />} onClick={() => setCreating(true)}>
                    Create user
                  </Button>
                )
              }
            />
          )}
        </Card>
      ) : phone ? (
        <Stack spacing={1.25}>
          {rows.map((u) => (
            <Paper key={u.id} variant="outlined" sx={{ p: 2, borderRadius: '14px', opacity: u.isActive ? 1 : 0.7 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <UserAvatar avatarId={u.avatarId} photoId={u.photoId} label={u.nickname} size={40} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={550} noWrap sx={{ mb: 0.5 }}>
                    {u.nickname}
                    {u.id === me.id && (
                      <Typography component="span" variant="caption" color="text.secondary">
                        {' '}
                        (you)
                      </Typography>
                    )}
                  </Typography>
                  <RoleBadge role={u.role} />
                </Box>
                <IconButton aria-label={`Edit ${u.nickname}`} onClick={() => setEditing(u)}>
                  <EditRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
                </IconButton>
              </Stack>
              <Stack direction="row" spacing={2} justifyContent="space-between" alignItems="center" sx={{ mt: 1.25 }}>
                <Box sx={{ minWidth: 0 }}>
                  {u.role === 'associate' && <UserChip user={u.manager} size={20} subtitle="Manager" />}
                  {u.role === 'expert' && <ExpertZone zone={u.timeZone} />}
                  {(u.role === 'founder' || u.role === 'manager') && (
                    <Typography variant="caption" color="text.secondary">
                      Joined {formatDate(u.createdAt, zone)}
                    </Typography>
                  )}
                </Box>
                <ActiveSwitch user={u} isSelf={u.id === me.id} onToggle={onToggle} />
              </Stack>
            </Paper>
          ))}
        </Stack>
      ) : (
        <TableSurface minWidth={860}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Manager</TableCell>
                <TableCell>Pay</TableCell>
                <TableCell>Time zone</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Joined</TableCell>
                <TableCell align="right" width={64}>
                  <Box component="span" sx={SR_ONLY}>
                    Actions
                  </Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((u) => (
                <TableRow key={u.id} hover sx={{ '&:last-child td': { borderBottom: 0 }, '& td': { py: 1.25 } }}>
                  <TableCell>
                    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ opacity: u.isActive ? 1 : 0.6 }}>
                      <UserAvatar avatarId={u.avatarId} photoId={u.photoId} label={u.nickname} size={32} />
                      <Typography variant="body2" fontWeight={550} noWrap>
                        {u.nickname}
                      </Typography>
                      {u.id === me.id && (
                        <Typography variant="caption" color="text.secondary">
                          (you)
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ opacity: u.isActive ? 1 : 0.6 }}>
                    <RoleBadge role={u.role} />
                  </TableCell>
                  <TableCell>
                    {u.role === 'associate' ? (
                      <UserChip user={u.manager} size={24} showRole={false} />
                    ) : (
                      <Typography variant="body2" color="text.disabled">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <UserPay user={u} />
                  </TableCell>
                  <TableCell>
                    {u.role === 'expert' ? (
                      <ExpertZone zone={u.timeZone} />
                    ) : (
                      <Tooltip title="Works on team time">
                        <Typography variant="body2" color="text.disabled">
                          Team time
                        </Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <ActiveSwitch user={u} isSelf={u.id === me.id} onToggle={onToggle} />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {formatDate(u.createdAt, zone)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" aria-label={`Edit ${u.nickname}`} onClick={() => setEditing(u)}>
                        <EditRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableSurface>
      )}

      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        roles={['manager', 'associate', 'expert']}
        initialRole={tab === 'manager' || tab === 'associate' || tab === 'expert' ? tab : undefined}
      />
      <EditUserDialog user={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={confirmOpen}
        title={`Deactivate ${toggling?.nickname ?? ''}?`}
        description="They will be signed out on every device immediately and cannot sign in until reactivated. Their calls and history stay intact."
        confirmLabel="Deactivate"
        destructive
        onConfirm={() => (toggling ? setActive(toggling, false) : undefined)}
        onClose={() => setConfirmOpen(false)}
      />
    </Box>
  );
}

/** What someone is paid: an Expert per hour, an Associate a share of each call (§3.1). */
function UserPay({ user: u }: { user: UserDTO }) {
  const text =
    u.role === 'expert'
      ? u.hourlyRate === null
        ? null
        : `${formatUsd(u.hourlyRate)}/h`
      : u.role === 'associate'
        ? u.sharePercent === null
          ? null
          : `${u.sharePercent}% of calls`
        : undefined;
  if (text === undefined) {
    return (
      <Typography variant="body2" color="text.disabled">
        —
      </Typography>
    );
  }
  return text === null ? (
    <Typography variant="body2" sx={{ color: 'warning.main', fontWeight: 600 }}>
      Not set
    </Typography>
  ) : (
    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </Typography>
  );
}
