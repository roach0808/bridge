import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { ApplicationBoard, ApplicationCell } from '@god/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorState } from '@/components/common';
import { UserAvatar } from '@/components/identity';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { FilterChips, TableSurface } from '@/pages/admin/adminShared';

type Platform = ApplicationBoard['platforms'][number];

const boardKey = (date: string | undefined) => ['applications', date ?? 'today'] as const;

/** The dashed outline of a cell nobody has filled in. */
const WAITING = { border: 1, borderStyle: 'dashed', borderColor: 'var(--waiting)' } as const;

/** A green ring: not registered on the platform. */
function Ring() {
  return <Box component="span" sx={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', border: 2, borderColor: 'success.main', boxSizing: 'border-box', verticalAlign: 'middle' }} />;
}
/** A red disc: banned from the platform. */
function Disc() {
  return <Box component="span" sx={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', bgcolor: 'error.main', verticalAlign: 'middle' }} />;
}

/** The meaning of each kind of cell, in one line. */
function Legend() {
  const item = { display: 'inline-flex', alignItems: 'center', gap: 0.75 } as const;
  return (
    <Stack direction="row" spacing={2.5} useFlexGap flexWrap="wrap" sx={{ color: 'text.secondary', typography: 'caption' }}>
      <Box sx={item}>
        <Box component="span" sx={{ color: 'success.main', fontWeight: 700, fontSize: 13 }}>
          3
        </Box>
        Projects applied (0 = none that day)
      </Box>
      <Box sx={item}>
        <Box component="span" sx={{ width: 22, height: 16, borderRadius: 1, ...WAITING }} />
        Not updated (N/A)
      </Box>
      <Box sx={item}>
        <Ring /> Not registered
      </Box>
      <Box sx={item}>
        <Disc /> Banned
      </Box>
    </Stack>
  );
}

/**
 * Chooses the day, above and below the table alike: the day before and after,
 * a calendar, and back to today. Days to come cannot be chosen.
 */
function DayBar({ board, onChange, position }: { board: ApplicationBoard; onChange: (date: string | null) => void; position: 'top' | 'bottom' }) {
  const day = DateTime.fromISO(board.date);
  const isToday = board.date >= board.today;
  const go = (d: DateTime) => onChange(d.toISODate()! >= board.today ? null : d.toISODate()!);
  const registered = board.rows.reduce((t, r) => t + r.cells.filter((c) => c.status === 'registered').length, 0);
  const updated = board.rows.reduce((t, r) => t + r.cells.filter((c) => c.status === 'registered' && c.applied !== null).length, 0);
  return (
    <Stack direction="row" alignItems="center" spacing={1} useFlexGap flexWrap="wrap" aria-label={position === 'top' ? 'Choose the day' : 'Choose the day (again, below the table)'} role="group">
      <Tooltip title="The day before">
        <IconButton size="small" aria-label="The day before" onClick={() => go(day.minus({ days: 1 }))}>
          <ChevronLeftRounded />
        </IconButton>
      </Tooltip>
      <TextField
        type="date"
        size="small"
        value={board.date}
        onChange={(e) => e.target.value && go(DateTime.fromISO(e.target.value) > DateTime.fromISO(board.today) ? DateTime.fromISO(board.today) : DateTime.fromISO(e.target.value))}
        slotProps={{ htmlInput: { max: board.today, 'aria-label': 'Day' } }}
        sx={{ width: 170 }}
      />
      <Tooltip title={isToday ? '' : 'The day after'}>
        <span>
          <IconButton size="small" aria-label="The day after" disabled={isToday} onClick={() => go(day.plus({ days: 1 }))}>
            <ChevronRightRounded />
          </IconButton>
        </span>
      </Tooltip>
      <Typography variant="body2" fontWeight={600} sx={{ mx: 0.5 }}>
        {isToday ? 'Today' : day.toFormat('cccc, LLLL d')}
      </Typography>
      {!isToday && (
        <Button size="small" onClick={() => onChange(null)}>
          Back to today
        </Button>
      )}
      <Box sx={{ flex: 1 }} />
      {registered > 0 && (
        <Typography variant="body2" sx={{ color: updated === registered ? 'success.main' : 'text.secondary', fontWeight: updated === registered ? 600 : 400 }}>
          {updated === registered ? `All ${registered} updated` : `Updated ${updated} of ${registered} · ${registered - updated} to go`}
        </Typography>
      )}
    </Stack>
  );
}

/**
 * One registered Profile × platform for the day: type the number of projects
 * applied for, and it saves on Enter (which moves down a row), Tab or leaving
 * the cell. Emptying it puts it back to "not updated"; Escape undoes the typing.
 */
function AppliedInput({
  board,
  profileId,
  platform,
  cell,
  row,
  col,
  canEdit,
}: {
  board: ApplicationBoard;
  profileId: string;
  platform: Platform;
  cell: ApplicationCell;
  row: number;
  col: number;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const key = boardKey(board.date === board.today ? undefined : board.date);
  const save = useMutation({
    mutationFn: (applied: number | null) => api.profiles.setApplied(profileId, platform.id, board.date, applied),
    onSuccess: (saved) => {
      queryClient.setQueryData<ApplicationBoard>(key, (old) =>
        old && {
          ...old,
          rows: old.rows.map((r) => (r.profile.id !== profileId ? r : { ...r, cells: r.cells.map((c, i) => (old.platforms[i]?.id === platform.id ? saved : c)) })),
        },
      );
      // The Profiles page adds every day up.
      void queryClient.invalidateQueries({ queryKey: qk.profiles.all });
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () => setDraft(null),
  });

  const shown = draft ?? (save.isPending ? (save.variables === null ? '' : String(save.variables)) : cell.applied === null ? '' : String(cell.applied));
  const who = cell.updatedBy && cell.updatedAt ? `Updated by ${cell.updatedBy.nickname}, ${DateTime.fromISO(cell.updatedAt).setZone(board.zone).toFormat('LLL d, h:mm a')}` : 'Not updated yet';
  const title = `${platform.name}: ${cell.applied === null ? 'not updated (N/A)' : `${cell.applied} project${cell.applied === 1 ? '' : 's'} applied`}. ${cell.applied === null ? '' : who}`;

  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    const next = text === '' ? null : Number(text);
    if (next !== null && (!Number.isInteger(next) || next < 0 || next > 999)) {
      toast.error('Enter a whole number from 0 to 999, or leave it empty for not updated');
      setDraft(null);
      return;
    }
    if (next === cell.applied) {
      setDraft(null);
      return;
    }
    save.mutate(next);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setDraft(null);
      e.currentTarget.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const below = document.querySelector<HTMLInputElement>(`input[data-cell="${row + 1}:${col}"]`);
      if (below) below.focus();
      else e.currentTarget.blur();
    }
  };

  if (!canEdit) {
    return (
      <Tooltip title={title}>
        <Box component="span" sx={{ color: 'success.main', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
          {shown}
        </Box>
      </Tooltip>
    );
  }
  return (
    <Box
      component="input"
      inputMode="numeric"
      autoComplete="off"
      data-cell={`${row}:${col}`}
      aria-label={title}
      title={title}
      value={shown}
      onFocus={(e) => {
        setDraft(shown);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
      onBlur={commit}
      onKeyDown={onKey}
      sx={{
        width: 44,
        height: 28,
        textAlign: 'center',
        font: 'inherit',
        fontSize: 14,
        fontWeight: 700,
        fontVariantNumeric: 'tabular-nums',
        color: 'success.main',
        bgcolor: 'transparent',
        border: 1,
        borderRadius: 1,
        // An empty cell waits to be filled in: a faint dashed box.
        borderStyle: shown === '' ? 'dashed' : 'solid',
        borderColor: shown === '' ? 'var(--waiting)' : 'transparent',
        opacity: save.isPending ? 0.5 : 1,
        outline: 'none',
        '&:hover': { borderColor: 'text.secondary' },
        '&:focus': { borderColor: 'primary.main', borderStyle: 'solid', bgcolor: 'action.hover' },
      }}
    />
  );
}

/** A platform's column heading, its name on its side as on the Profiles page. */
function PlatformHeading({ platform, all }: { platform: Platform; all: boolean }) {
  return (
    <TableCell sx={{ width: 60, minWidth: 60, px: 0.5, verticalAlign: 'bottom', bgcolor: 'background.paper' }}>
      <Tooltip title={`${platform.name} — priority ${platform.priority}`}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
          <Typography
            variant="caption"
            fontWeight={600}
            sx={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {platform.name}
          </Typography>
          {all && (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
              {platform.priority}
            </Typography>
          )}
        </Box>
      </Tooltip>
    </TableCell>
  );
}

const sum = (cells: ApplicationCell[]) => {
  const filled = cells.filter((c) => c.applied !== null);
  return filled.length ? filled.reduce((t, c) => t + (c.applied ?? 0), 0) : null;
};

/**
 * The project applications board on a Manager's and an Associate's dashboard
 * (§9.1): every approved Profile of the team against every platform, for one
 * day. Each registered cell holds how many projects the Profile applied for
 * that day, filled in by the team every day; a cell nobody filled in stays
 * empty ("not updated"), which is not zero.
 */
export function ApplicationsBoard() {
  const [params, setParams] = useSearchParams();
  const date = params.get('day') ?? undefined;
  const setDate = (d: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (d) next.set('day', d);
        else next.delete('day');
        return next;
      },
      { replace: true },
    );
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: boardKey(date),
    queryFn: () => api.applications.board(date),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const priorities = useMemo(() => [...new Set((data?.platforms ?? []).map((p) => p.priority))].sort((a, b) => a - b), [data?.platforms]);
  const [priority, setPriority] = useState<string>('all');

  return (
    <Card sx={(t) => ({ '--waiting': `rgba(${t.vars!.palette.text.primaryChannel} / 0.24)` })}>
      <CardContent sx={{ p: { xs: 2, md: 2.5 }, '&:last-child': { pb: { xs: 2, md: 2.5 } } }}>
        <Typography variant="h6" component="h2">
          Project applications
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          How many projects each Profile applied for on each platform. Fill in every day; a cell left empty shows as not updated.
        </Typography>

        {error ? (
          <ErrorState error={error} onRetry={refetch} />
        ) : !data ? (
          <Skeleton variant="rounded" height={260} />
        ) : (
          (() => {
            const all = priority === 'all' || !priorities.includes(Number(priority));
            const columns = data.platforms.map((p, i) => ({ p, i })).filter(({ p }) => all || p.priority === Number(priority));
            return (
              <Stack spacing={2} sx={{ opacity: isFetching && data.date !== (date ?? data.today) ? 0.55 : 1, transition: 'opacity 150ms' }}>
                <DayBar board={data} onChange={setDate} position="top" />
                <Stack spacing={1.5}>
                  <Legend />
                  {priorities.length > 1 && (
                    <FilterChips
                      ariaLabel="Show platforms of one priority"
                      value={all ? 'all' : priority}
                      onChange={setPriority}
                      options={[{ value: 'all', label: 'All platforms', count: data.platforms.length }, ...priorities.map((n) => ({ value: String(n), label: `Priority ${n}`, count: data.platforms.filter((p) => p.priority === n).length }))]}
                    />
                  )}
                </Stack>

                {data.rows.length === 0 ? (
                  <Box sx={{ py: 6, textAlign: 'center', color: 'text.secondary', border: 1, borderColor: 'divider', borderStyle: 'dashed', borderRadius: 2 }}>
                    <Typography variant="body2">No approved Profiles in your team yet.</Typography>
                  </Box>
                ) : (
                  <TableSurface minWidth={220 + columns.length * 60 + 80}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ minWidth: 220, position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper', verticalAlign: 'bottom' }}>Profile</TableCell>
                          {columns.map(({ p }) => (
                            <PlatformHeading key={p.id} platform={p} all={all} />
                          ))}
                          <TableCell align="right" sx={{ width: 72, minWidth: 72, verticalAlign: 'bottom', bgcolor: 'background.paper' }}>
                            Total
                          </TableCell>
                          {/* Takes up the rest of the width, so the figures sit next to the names. */}
                          <TableCell sx={{ width: '100%', bgcolor: 'background.paper' }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.rows.map((r, row) => {
                          const total = sum(columns.map(({ i }) => r.cells[i]!));
                          return (
                            <TableRow key={r.profile.id}>
                              <TableCell sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper' }}>
                                <Stack direction="row" spacing={1.25} alignItems="center">
                                  <UserAvatar avatarId={r.profile.avatarId} photoId={r.profile.photoId} label={r.profile.name} size={26} />
                                  <Typography variant="body2" fontWeight={550} noWrap>
                                    {r.profile.name}
                                  </Typography>
                                </Stack>
                              </TableCell>
                              {columns.map(({ p, i }, col) => {
                                const cell = r.cells[i]!;
                                return (
                                  <TableCell key={p.id} align="center" sx={{ px: 0.5, py: 0.5 }}>
                                    {cell.status === 'registered' ? (
                                      <AppliedInput board={data} profileId={r.profile.id} platform={p} cell={cell} row={row} col={col} canEdit={data.canEdit} />
                                    ) : (
                                      <Tooltip title={`${p.name}: ${cell.status === 'banned' ? 'banned' : 'not registered'}`}>
                                        <Box component="span" aria-label={`${p.name}: ${cell.status === 'banned' ? 'banned' : 'not registered'}`} sx={{ display: 'inline-flex', p: 0.5 }}>
                                          {cell.status === 'banned' ? <Disc /> : <Ring />}
                                        </Box>
                                      </Tooltip>
                                    )}
                                  </TableCell>
                                );
                              })}
                              <TableCell align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: total === null ? 'text.disabled' : 'text.primary' }}>
                                {total ?? '—'}
                              </TableCell>
                              <TableCell />
                            </TableRow>
                          );
                        })}
                      </TableBody>
                      <TableFooter>
                        <TableRow sx={{ '& td': { fontWeight: 600, color: 'text.primary', fontVariantNumeric: 'tabular-nums' } }}>
                          <TableCell sx={{ position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper' }}>Total</TableCell>
                          {columns.map(({ p, i }) => {
                            const t = sum(data.rows.map((r) => r.cells[i]!));
                            return (
                              <TableCell key={p.id} align="center" sx={{ px: 0.5, color: t === null ? 'text.disabled !important' : undefined }}>
                                {t ?? '—'}
                              </TableCell>
                            );
                          })}
                          <TableCell align="right">{sum(data.rows.flatMap((r) => columns.map(({ i }) => r.cells[i]!))) ?? '—'}</TableCell>
                          <TableCell />
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </TableSurface>
                )}

                <DayBar board={data} onChange={setDate} position="bottom" />
              </Stack>
            );
          })()
        )}
      </CardContent>
    </Card>
  );
}
