import { Box, Card, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import { PLATFORM_REGISTRATION_LABELS, type ProfileDTO } from '@god/shared';
import { useNavigate } from 'react-router';
import { PlatformDot, PlatformStatusSelect } from '@/components/ProfileDetails';
import { EmptyState } from '@/components/common';
import { UserAvatar, UserChip } from '@/components/identity';
import { TableSurface } from '../admin/adminShared';

/**
 * Every Profile's standing on every platform at a glance (§9.1 Profiles): one row
 * per Profile, one column per platform in priority order. The Founder, and the
 * Associate looking after a Profile with their Manager, change a status right in
 * its cell; everyone else sees the dots.
 */
export function PlatformStatusTable({ profiles }: { profiles: ProfileDTO[] }) {
  const navigate = useNavigate();
  const platforms = profiles.find((p) => p.platformStatuses)?.platformStatuses?.map((s) => s.platform) ?? [];
  if (!profiles.length || !platforms.length) {
    return (
      <Card>
        <EmptyState title={platforms.length ? 'No profiles to show' : 'No platforms yet'} />
      </Card>
    );
  }
  const registeredOn = (platformId: string) =>
    profiles.filter((p) => p.platformStatuses?.some((s) => s.platform.id === platformId && s.status === 'registered')).length;

  return (
    <TableSurface minWidth={260 + platforms.length * 170}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell sx={{ minWidth: 220, position: 'sticky', left: 0, zIndex: 3, bgcolor: 'background.paper' }}>Profile</TableCell>
            <TableCell sx={{ minWidth: 120 }}>Associate</TableCell>
            {platforms.map((platform) => (
              <TableCell key={platform.id} sx={{ minWidth: 160 }}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {platform.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {registeredOn(platform.id)} of {profiles.length} registered
                </Typography>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {profiles.map((p) => (
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
                {p.associate ? (
                  <UserChip user={p.associate} size={20} showRole={false} />
                ) : (
                  <Typography variant="body2" color="text.disabled">
                    —
                  </Typography>
                )}
              </TableCell>
              {(p.platformStatuses ?? []).map((s) => (
                <TableCell key={s.platform.id}>
                  {p.canEditPlatforms ? (
                    <PlatformStatusSelect profile={p} platformId={s.platform.id} status={s.status} />
                  ) : (
                    <Tooltip title={PLATFORM_REGISTRATION_LABELS[s.status]}>
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                        <PlatformDot status={s.status} />
                        <Typography variant="caption" color="text.secondary">
                          {PLATFORM_REGISTRATION_LABELS[s.status]}
                        </Typography>
                      </Box>
                    </Tooltip>
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableSurface>
  );
}
