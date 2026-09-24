import { Box, Card, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import { PLATFORM_REGISTRATION_LABELS, type ProfileDTO, type UserRef } from '@god/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { PlatformDot, PlatformStatusSelect } from '@/components/ProfileDetails';
import { EmptyState } from '@/components/common';
import { UserAvatar, UserChip } from '@/components/identity';
import { FilterChips, TableSurface } from '../admin/adminShared';

type Platform = NonNullable<ProfileDTO['platformStatuses']>[number]['platform'];

/**
 * Every Profile's standing on the platforms of one priority (§9.1 Profiles):
 * one row per Profile, one narrow column per platform. Every Profile is here —
 * no status filter — narrowed by Manager and by how important the platforms
 * are, because the company works with dozens of them and no screen is that
 * wide. The Founder, and the Associate looking after a Profile with their
 * Manager, change a status right in its cell; everyone else sees the dots.
 */
export function PlatformStatusTable({ profiles }: { profiles: ProfileDTO[] }) {
  const navigate = useNavigate();
  const platforms = profiles.find((p) => p.platformStatuses)?.platformStatuses?.map((s) => s.platform) ?? [];

  // The priorities in use, lowest (most important) first: one button each.
  const priorities = useMemo(() => [...new Set(platforms.map((p) => p.priority))].sort((a, b) => a - b), [platforms]);
  const [priority, setPriority] = useState<number | 'all'>(() => priorities[0] ?? 'all');
  const managers = useMemo(() => managersOf(profiles), [profiles]);
  const [managerId, setManagerId] = useState<string>('all');

  // Until the platforms arrive there is no priority to show, so fall back to the first.
  const shown = priority === 'all' || priorities.includes(priority) ? priority : (priorities[0] ?? 'all');
  const columns = shown === 'all' ? platforms : platforms.filter((p) => p.priority === shown);
  const rows = profiles.filter((p) => managerId === 'all' || (managerId === 'none' ? !p.manager : p.manager?.id === managerId));

  if (!profiles.length || !platforms.length) {
    return (
      <Card>
        <EmptyState title={platforms.length ? 'No profiles to show' : 'No platforms yet'} />
      </Card>
    );
  }
  const registeredOn = (platformId: string) =>
    rows.filter((p) => p.platformStatuses?.some((s) => s.platform.id === platformId && s.status === 'registered')).length;

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} justifyContent="space-between" useFlexGap>
        <Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.75 }}>
            Platform priority
          </Typography>
          <FilterChips
            ariaLabel="Show platforms of one priority"
            value={String(shown)}
            onChange={(v) => setPriority(v === 'all' ? 'all' : Number(v))}
            options={[
              ...priorities.map((n) => ({ value: String(n), label: String(n), count: platforms.filter((p) => p.priority === n).length })),
              { value: 'all', label: 'All', count: platforms.length },
            ]}
          />
        </Box>
        {managers.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.75 }}>
              Manager
            </Typography>
            <FilterChips
              ariaLabel="Filter by manager"
              value={managerId}
              onChange={setManagerId}
              options={[
                { value: 'all', label: 'All', count: profiles.length },
                ...managers.map((m) => ({
                  value: m.id,
                  label: m.nickname,
                  count: profiles.filter((p) => p.manager?.id === m.id).length,
                })),
                ...(profiles.some((p) => !p.manager) ? [{ value: 'none', label: 'Nobody', count: profiles.filter((p) => !p.manager).length }] : []),
              ]}
            />
          </Box>
        )}
      </Stack>

      {rows.length === 0 ?
        <Card>
          <EmptyState title="No profiles under this Manager" />
        </Card>
      : <TableSurface minWidth={320 + columns.length * 84}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 200, position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper' }}>Profile</TableCell>
                <TableCell sx={{ minWidth: 120 }}>Manager</TableCell>
                {columns.map((platform) => (
                  <PlatformHeader key={platform.id} platform={platform} registered={registeredOn(platform.id)} of={rows.length} all={shown === 'all'} />
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell
                    onClick={() => navigate(`/profiles/${p.id}`)}
                    sx={{ cursor: 'pointer', position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper' }}
                  >
                    <Stack direction="row" spacing={1.25} alignItems="center">
                      <UserAvatar avatarId={p.avatarId} photoId={p.photoId} label={p.name} size={26} />
                      <Typography variant="body2" fontWeight={550} noWrap>
                        {p.name}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {p.manager ? (
                      <UserChip user={p.manager} size={20} showRole={false} />
                    ) : (
                      <Typography variant="body2" color="text.disabled">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  {columns.map((platform) => {
                    const s = p.platformStatuses?.find((row) => row.platform.id === platform.id);
                    if (!s) return <TableCell key={platform.id} />;
                    return (
                      <TableCell key={platform.id} align="center" sx={{ px: 0.5 }}>
                        {p.canEditPlatforms ? (
                          <PlatformStatusSelect profile={p} platformId={platform.id} status={s.status} compact />
                        ) : (
                          <Tooltip title={`${platform.name}: ${PLATFORM_REGISTRATION_LABELS[s.status]}`}>
                            <Box sx={{ display: 'inline-flex' }}>
                              <PlatformDot status={s.status} />
                            </Box>
                          </Tooltip>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableSurface>
      }
    </Stack>
  );
}

/**
 * A narrow column heading. The name is turned on its side: a platform's name is
 * far wider than the dot underneath it, and upright names would make the table
 * three times as wide as it needs to be.
 */
function PlatformHeader({ platform, registered, of, all }: { platform: Platform; registered: number; of: number; all: boolean }) {
  return (
    <TableCell sx={{ width: 84, minWidth: 84, px: 0.5, verticalAlign: 'bottom' }}>
      <Tooltip title={`${platform.name} — priority ${platform.priority} · ${registered} of ${of} registered`}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
          <Typography
            variant="caption"
            fontWeight={600}
            sx={{
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
              maxHeight: 132,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {platform.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
            {all ? `${platform.priority} · ${registered}` : registered}
          </Typography>
        </Box>
      </Tooltip>
    </TableCell>
  );
}

/** The Managers with a Profile under them, in name order. */
function managersOf(profiles: ProfileDTO[]): UserRef[] {
  const seen = new Map<string, UserRef>();
  for (const p of profiles) if (p.manager) seen.set(p.manager.id, p.manager);
  return [...seen.values()].sort((a, b) => a.nickname.localeCompare(b.nickname));
}
