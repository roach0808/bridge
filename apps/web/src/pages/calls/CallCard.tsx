import { Box, Card, CardActionArea, Stack, Typography } from '@mui/material';
import type { CallDTO } from '@god/shared';
import { Link as RouterLink } from 'react-router';
import { UserAvatar, UserChip } from '@/components/identity';
import { StatusChip } from '@/components/StatusChip';
import { dayLabel, formatRange } from '@/lib/time';

/** Compact call summary used by the dashboard and mobile lists. */
export function CallCard({ call, zone, showExpert = true }: { call: CallDTO; zone: string; showExpert?: boolean }) {
  return (
    <Card>
      <CardActionArea component={RouterLink} to={`/calls/${call.id}`} sx={{ p: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <UserAvatar avatarId={call.profile.avatarId} photoId={call.profile.photoId} label={call.profile.name} size={36} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={550} noWrap>
                  {call.profile.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {call.platform.name}
                </Typography>
              </Box>
              <StatusChip status={call.status} />
            </Stack>
            <Typography variant="body2" sx={{ mt: 1, fontVariantNumeric: 'tabular-nums' }}>
              {dayLabel(call.scheduledAt, zone)} · {formatRange(call.scheduledAt, call.endsAt, zone)}
            </Typography>
            {showExpert && (
              <Stack direction="row" spacing={2} sx={{ mt: 1.25 }} flexWrap="wrap" useFlexGap>
                <UserChip user={call.associate} size={20} />
                <UserChip user={call.expert} size={20} />
              </Stack>
            )}
          </Box>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
