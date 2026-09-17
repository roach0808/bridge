import AddRounded from '@mui/icons-material/AddRounded';
import ClearRounded from '@mui/icons-material/ClearRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import {
  Autocomplete,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  InputAdornment,
  LinearProgress,
  ListItemText,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import {
  CALL_STATUSES,
  STAGE_LABELS,
  STAGE_STATUSES,
  STATUS_LABELS,
  stagesForRole,
  type CallStatus,
  type UserRef,
} from '@god/shared';
import type { ListCallsParams } from '@god/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, LoadingRows, PageHeader } from '@/components/common';
import { UserAvatar, UserChip } from '@/components/identity';
import { STATUS_COLORS, StatusChip } from '@/components/StatusChip';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatRange, inZone, relativeTime, zoneAbbr } from '@/lib/time';
import { CallCard } from './CallCard';

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function UserFilter({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: UserRef[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const selected = options.find((o) => o.id === value) ?? null;
  return (
    <Autocomplete
      size="small"
      sx={{ minWidth: 160 }}
      options={options}
      value={selected}
      onChange={(_, v) => onChange(v?.id ?? null)}
      getOptionLabel={(o) => o.nickname}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      renderOption={({ key, ...props }, o) => (
        <li key={key} {...props}>
          <Stack direction="row" spacing={1} alignItems="center">
            <UserAvatar avatarId={o.avatarId} photoId={o.photoId} size={22} label={o.nickname} />
            <span>{o.nickname}</span>
          </Stack>
        </li>
      )}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}

export default function CallsListPage() {
  const me = useMe();
  const { zone } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('md'));
  const [params, setParams] = useSearchParams();

  // Experts never see the invoicing stage.
  const stages = stagesForRole(me.role);
  const statuses = params.getAll('status').filter((s): s is CallStatus => (CALL_STATUSES as readonly string[]).includes(s));
  const associateId = params.get('associateId');
  const expertId = params.get('expertId');
  const from = params.get('from');
  const to = params.get('to');
  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '25');
  const sort = params.get('sort') ?? '-scheduledAt';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search);

  const update = (patch: Record<string, string | string[] | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      next.delete(k);
      if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
      else if (v) next.set(k, v);
    }
    if (resetPage) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if ((params.get('q') ?? '') !== q) update({ q: q || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query: ListCallsParams = {
    status: statuses.length ? statuses : undefined,
    associateId: associateId ?? undefined,
    expertId: expertId ?? undefined,
    from: from ? DateTime.fromISO(from, { zone }).startOf('day').toUTC().toISO()! : undefined,
    to: to ? DateTime.fromISO(to, { zone }).endOf('day').toUTC().toISO()! : undefined,
    q: q || undefined,
    sort,
    page,
    pageSize,
  };

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: qk.calls.list(query),
    queryFn: () => api.calls.list(query),
    placeholderData: keepPreviousData,
  });

  const canFilterPeople = me.role === 'founder' || me.role === 'manager';
  const { data: users } = useQuery({
    queryKey: qk.users.list({ scope: 'call-filters' }),
    queryFn: () => api.users.list(),
    enabled: canFilterPeople,
    staleTime: 5 * 60_000,
  });
  // Managers run calls too.
  const associates = useMemo(() => (users ?? []).filter((u) => u.role === 'associate' || u.role === 'manager'), [users]);
  const experts = useMemo(() => (users ?? []).filter((u) => u.role === 'expert'), [users]);

  const activeFilters = statuses.length + (associateId ? 1 : 0) + (expertId ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0) + (q ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Calls"
        subtitle={
          <>
            {data ? `${data.total} call${data.total === 1 ? '' : 's'}` : 'Loading…'} · times in {zoneAbbr(zone)}
          </>
        }
        actions={
          me.role !== 'expert' && (
            <Button variant="contained" startIcon={<AddRounded />} component={RouterLink} to="/calls/new">
              New call
            </Button>
          )
        }
      />

      <Box sx={{ mb: 2, '& .MuiOutlinedInput-root': { bgcolor: 'background.paper' } }}>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap" sx={{ '& > *': { flexGrow: { xs: 1, md: 0 } } }}>
            <TextField
              placeholder="Search profile, platform, project…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ flex: '1 1 220px', minWidth: 200, flexGrow: '1 !important' }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchRounded fontSize="small" />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <TextField
              select
              label="Status"
              fullWidth={false}
              sx={{ minWidth: 160 }}
              value={statuses}
              onChange={(e) => update({ status: e.target.value as unknown as string[] })}
              slotProps={{
                select: {
                  multiple: true,
                  renderValue: (v) => {
                    const arr = v as CallStatus[];
                    return arr.length === 1 ? STATUS_LABELS[arr[0]!] : `${arr.length} statuses`;
                  },
                },
              }}
            >
              {stages.flatMap((stage) => [
                <MenuItem key={stage} disabled dense sx={{ opacity: '1 !important' }}>
                  <Typography variant="caption" color="text.secondary">
                    {STAGE_LABELS[stage]}
                  </Typography>
                </MenuItem>,
                ...STAGE_STATUSES[stage].map((s) => (
                  <MenuItem key={s} value={s} dense>
                    <Checkbox size="small" checked={statuses.includes(s)} sx={{ py: 0 }} />
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: STATUS_COLORS[s], mr: 1 }} />
                    <ListItemText primary={STATUS_LABELS[s]} />
                  </MenuItem>
                )),
              ])}
            </TextField>
            {canFilterPeople && (
              <>
                <UserFilter label="Associate" options={associates} value={associateId} onChange={(id) => update({ associateId: id })} />
                <UserFilter label="Expert" options={experts} value={expertId} onChange={(id) => update({ expertId: id })} />
              </>
            )}
            <DatePicker
              label={`From (${zoneAbbr(zone)})`}
              value={from ? DateTime.fromISO(from) : null}
              onChange={(v) => update({ from: v?.isValid ? v.toISODate() : null })}
              slotProps={{ textField: { size: 'small', fullWidth: false, sx: { width: { xs: 'calc(50% - 6px)', md: 150 } } }, field: { clearable: true } }}
            />
            <DatePicker
              label={`To (${zoneAbbr(zone)})`}
              value={to ? DateTime.fromISO(to) : null}
              onChange={(v) => update({ to: v?.isValid ? v.toISODate() : null })}
              slotProps={{ textField: { size: 'small', fullWidth: false, sx: { width: { xs: 'calc(50% - 6px)', md: 150 } } }, field: { clearable: true } }}
            />
          </Stack>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap alignItems="center" sx={{ rowGap: 1.5 }}>
            {stages.map((stage) => {
              const active = STAGE_STATUSES[stage].every((s) => statuses.includes(s)) && statuses.length === STAGE_STATUSES[stage].length;
              return (
                <Chip
                  key={stage}
                  label={STAGE_LABELS[stage]}
                  aria-pressed={active}
                  onClick={() => update({ status: active ? [] : STAGE_STATUSES[stage] })}
                  sx={{
                    height: 30,
                    bgcolor: active ? 'action.selected' : 'transparent',
                    color: active ? 'text.primary' : 'text.secondary',
                    '&:hover': { bgcolor: 'action.hover' },
                    ...(active ? { '&&:hover': { bgcolor: 'action.selected' } } : {}),
                  }}
                />
              );
            })}
            {activeFilters > 0 && (
              <Button
                size="small"
                color="inherit"
                startIcon={<ClearRounded />}
                sx={{ color: 'text.secondary' }}
                onClick={() => {
                  setSearch('');
                  setParams(new URLSearchParams(), { replace: true });
                }}
              >
                Clear filters
              </Button>
            )}
            <TextField select label="Sort" fullWidth={false} value={sort} onChange={(e) => update({ sort: e.target.value }, false)} sx={{ minWidth: 170, ml: { sm: 'auto' } }}>
              <MenuItem value="-scheduledAt">Latest time first</MenuItem>
              <MenuItem value="scheduledAt">Earliest time first</MenuItem>
              <MenuItem value="-updatedAt">Recently updated</MenuItem>
              <MenuItem value="-createdAt">Recently created</MenuItem>
            </TextField>
          </Stack>
        </Stack>
      </Box>

      {error ? (
        <ErrorState error={error} onRetry={refetch} />
      ) : isLoading || !data ? (
        <LoadingRows rows={8} />
      ) : data.items.length === 0 ? (
        <Card>
          <EmptyState
            title={activeFilters ? 'No calls match these filters' : 'No calls yet'}
            description={activeFilters ? 'Try widening the date range or clearing filters.' : me.role === 'expert' ? 'Calls assigned to you will show up here.' : 'Create the first call to get started.'}
            action={
              !activeFilters && me.role !== 'expert' ? (
                <Button variant="contained" component={RouterLink} to="/calls/new" startIcon={<AddRounded />}>
                  New call
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : mobile ? (
        <Stack spacing={1.5}>
          {data.items.map((c) => (
            <CallCard key={c.id} call={c} zone={zone} />
          ))}
        </Stack>
      ) : (
        <Card sx={{ position: 'relative' }}>
          {isFetching && <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2 }} />}
          <TableContainer>
            <Table size="medium">
              <TableHead>
                <TableRow>
                  <TableCell>Profile</TableCell>
                  <TableCell>When</TableCell>
                  <TableCell>Associate</TableCell>
                  <TableCell>Expert</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Updated</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.items.map((c) => {
                  const start = inZone(c.scheduledAt, zone);
                  return (
                    <TableRow
                      key={c.id}
                      hover
                      tabIndex={0}
                      onClick={() => navigate(`/calls/${c.id}`)}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/calls/${c.id}`)}
                      sx={{ cursor: 'pointer', '& td': { py: 1.25 } }}
                    >
                      <TableCell>
                        <Stack direction="row" spacing={1.5} alignItems="center">
                          <UserAvatar avatarId={c.profile.avatarId} photoId={c.profile.photoId} label={c.profile.name} size={32} />
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={550} noWrap>
                              {c.profile.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" noWrap component="div">
                              {c.platform.name}
                            </Typography>
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {start.toFormat('ccc, LLL d')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatRange(c.scheduledAt, c.endsAt, zone)} · {c.durationMinutes}m
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <UserChip user={c.associate} size={24} showRole={false} />
                      </TableCell>
                      <TableCell>
                        <UserChip user={c.expert} size={24} showRole={false} />
                      </TableCell>
                      <TableCell>
                        <StatusChip status={c.status} />
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="caption" color="text.secondary">
                          {relativeTime(c.updatedAt)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={data.total}
            page={page - 1}
            rowsPerPage={pageSize}
            rowsPerPageOptions={[10, 25, 50, 100]}
            onPageChange={(_, p) => update({ page: String(p + 1) }, false)}
            onRowsPerPageChange={(e) => update({ pageSize: e.target.value })}
          />
        </Card>
      )}
      {mobile && data && data.total > pageSize && (
        <TablePagination
          component="div"
          count={data.total}
          page={page - 1}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[]}
          onPageChange={(_, p) => update({ page: String(p + 1) }, false)}
        />
      )}
    </>
  );
}
