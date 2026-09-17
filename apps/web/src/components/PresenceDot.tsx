import { Box, Tooltip } from '@mui/material';
import { PRESENCE_LABELS, type PresenceStatus } from '@god/shared';
import { usePresence } from '@/realtime/PresenceProvider';
import { relativeTime } from '@/lib/time';

/** On the platform: blue. Away from it: grey, with the last-seen time. */
export const PRESENCE_COLORS: Record<PresenceStatus, string> = {
  online: '#3f8fd6',
  away: '#3f8fd6',
  offline: '#9aa0a6',
};

/** "Online", "Away", or "Last seen 10 minutes ago". */
export function presenceLabel({ status, lastSeenAt }: { status: PresenceStatus; lastSeenAt: string | null }): string {
  if (status !== 'offline') return PRESENCE_LABELS[status];
  return lastSeenAt ? `Last seen ${relativeTime(lastSeenAt)}` : 'Offline';
}

/** A small status dot, sized to sit on the corner of an avatar. */
export function PresenceDot({ userId, size = 10, ring = true }: { userId: string; size?: number; ring?: boolean }) {
  const presence = usePresence(userId);
  const label = presenceLabel(presence);
  return (
    <Tooltip title={label}>
      <Box
        component="span"
        aria-label={label}
        sx={{
          width: size,
          height: size,
          borderRadius: '50%',
          bgcolor: PRESENCE_COLORS[presence.status],
          ...(ring ? { border: 2, borderColor: 'background.paper' } : {}),
          flexShrink: 0,
        }}
      />
    </Tooltip>
  );
}

/** An avatar with the presence dot on its bottom-right corner. */
export function PresenceBadge({ userId, children, size = 10 }: { userId: string; children: React.ReactNode; size?: number }) {
  return (
    <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      {children}
      <Box sx={{ position: 'absolute', right: -1, bottom: -1, display: 'flex' }}>
        <PresenceDot userId={userId} size={size} />
      </Box>
    </Box>
  );
}
