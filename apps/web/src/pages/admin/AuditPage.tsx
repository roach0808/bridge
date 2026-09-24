import HistoryRounded from '@mui/icons-material/HistoryRounded';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import type { AuditEntryDTO, UserDTO } from '@god/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { UserChip } from '@/components/identity';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { formatDateTime, relativeTime } from '@/lib/time';
import { countryName, flagEmoji, SearchField, TableSurface, useDebouncedValue } from './adminShared';

const PAGE_SIZE = 50;

/** Colour by outcome: refused attempts should stand out. */
const outcomeColor = (e: AuditEntryDTO) => (e.statusCode >= 400 ? 'error.main' : 'text.secondary');

export default function AuditPage() {
  const { zone } = useAuth();
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState<DateTime | null>(null);
  const [to, setTo] = useState<DateTime | null>(null);
  const [page, setPage] = useState(1);

  const params = {
    ...(q ? { q } : {}),
    ...(action ? { action } : {}),
    ...(userId ? { userId } : {}),
    ...(from?.isValid ? { from: from.startOf('day').toUTC().toISO()! } : {}),
    ...(to?.isValid ? { to: to.plus({ days: 1 }).startOf('day').toUTC().toISO()! } : {}),
    page,
    pageSize: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: qk.audit.list(params),
    queryFn: () => api.audit.list(params),
    placeholderData: keepPreviousData,
  });
  const actions = useQuery({ queryKey: qk.audit.actions, queryFn: api.audit.actions });
  const users = useQuery({ queryKey: qk.users.list({}), queryFn: () => api.users.list() });

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    setPage(1);
    set(v);
  };
  const rows = query.data?.items ?? [];
  // Which browser an action came from is the owner's to see; nobody else is sent it.
  const showDevice = rows.some((e) => e.device);
  const total = query.data?.total ?? 0;

  return (
    <Box>
      <PageHeader title="Audit" subtitle="Every change, and every look at bank details or a database dump." />

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
        <SearchField value={search} onChange={reset(setSearch)} placeholder="Search person or action" />
        <TextField select size="small" label="Action" value={action} onChange={(e) => reset(setAction)(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">All actions</MenuItem>
          {(actions.data ?? []).map((a) => (
            <MenuItem key={a} value={a}>
              {a}
            </MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Person" value={userId} onChange={(e) => reset(setUserId)(e.target.value)} sx={{ minWidth: 180 }}>
          <MenuItem value="">Everyone</MenuItem>
          {(users.data ?? []).map((u: UserDTO) => (
            <MenuItem key={u.id} value={u.id}>
              {u.nickname}
            </MenuItem>
          ))}
        </TextField>
        <DatePicker label="From" value={from} onChange={reset(setFrom)} slotProps={{ textField: { size: 'small', sx: { width: 150 } }, field: { clearable: true } }} />
        <DatePicker label="To" value={to} onChange={reset(setTo)} slotProps={{ textField: { size: 'small', sx: { width: 150 } }, field: { clearable: true } }} />
      </Stack>

      {query.isLoading ? (
        <Stack spacing={1}>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={44} />
          ))}
        </Stack>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<HistoryRounded />} title="Nothing recorded yet" description="Changes appear here as people work." />
      ) : (
        <>
          <TableSurface minWidth={showDevice ? 1030 : 900}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell width={170}>When</TableCell>
                  <TableCell width={190}>Who</TableCell>
                  <TableCell width={180}>Action</TableCell>
                  <TableCell>What</TableCell>
                  <TableCell width={190}>From</TableCell>
                  {showDevice && <TableCell width={130}>Device</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id} hover sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>
                      <Tooltip title={formatDateTime(e.createdAt, zone)}>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {relativeTime(e.createdAt)}
                        </Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      {e.actorName ? (
                        <UserChip
                          user={e.userId && e.actorRole ? { id: e.userId, nickname: e.actorName, role: e.actorRole, avatarId: `${e.actorRole}-01`, photoId: null } : null}
                          size={22}
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          Signed out
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={e.action}
                        sx={{ height: 22, fontSize: 11, bgcolor: 'action.selected', color: outcomeColor(e) }}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Typography variant="body2" noWrap title={`${e.method} ${e.path}`} color={outcomeColor(e)}>
                        {e.summary}
                      </Typography>
                      {e.meta?.email ? (
                        <Typography variant="caption" color="text.secondary">
                          tried {String(e.meta.email)}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {e.country ? `${flagEmoji(e.country)} ${countryName(e.country) ?? e.country} · ` : ''}
                        {e.deviceType ?? 'unknown'}
                        {e.ip ? ` · ${e.ip}` : ''}
                      </Typography>
                    </TableCell>
                    {showDevice && (
                      <TableCell>
                        {e.device ? (
                          <Chip size="small" variant="outlined" label={e.device} sx={{ height: 22, fontSize: 11 }} />
                        ) : (
                          <Typography variant="caption" color="text.disabled">
                            —
                          </Typography>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableSurface>

          <Stack direction="row" spacing={2} alignItems="center" justifyContent="flex-end" sx={{ mt: 2 }}>
            {query.isFetching && <CircularProgress size={16} />}
            <Typography variant="caption" color="text.secondary">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </Typography>
            <Button size="small" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="small" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </Stack>
        </>
      )}
    </Box>
  );
}
