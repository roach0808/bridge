import AdminPanelSettingsRounded from '@mui/icons-material/AdminPanelSettingsRounded';
import PsychologyRounded from '@mui/icons-material/PsychologyRounded';
import SupervisorAccountRounded from '@mui/icons-material/SupervisorAccountRounded';
import SupportAgentRounded from '@mui/icons-material/SupportAgentRounded';
import { Avatar, Box, Stack, Typography, type SvgIconProps } from '@mui/material';
import { ROLE_LABELS, type Role, type UserRef } from '@god/shared';
import type { ComponentType } from 'react';
import { avatarUrl, photoUrl } from '@/lib/api';
import { PresenceDot } from '@/components/PresenceDot';
import { ROLE_COLORS } from '@/theme/theme';

export const ROLE_ICONS: Record<Role, ComponentType<SvgIconProps>> = {
  founder: AdminPanelSettingsRounded,
  manager: SupervisorAccountRounded,
  associate: SupportAgentRounded,
  expert: PsychologyRounded,
};

export function UserAvatar({
  avatarId,
  photoId,
  size = 32,
  label,
  ring,
  src,
  userId,
  dotSize,
}: {
  avatarId: string | null | undefined;
  /** An uploaded picture wins over the catalog avatar. */
  photoId?: string | null;
  size?: number;
  label?: string;
  /** Optional accent ring, e.g. an Expert's calendar colour. */
  ring?: string;
  /** Overrides everything, e.g. a not-yet-saved upload preview. */
  src?: string;
  /** A user's id puts their online dot on the avatar; Profile pictures have none. */
  userId?: string;
  dotSize?: number;
}) {
  const avatar = (
    <Avatar
      src={src ?? (photoId ? photoUrl(photoId) : avatarId ? avatarUrl(avatarId) : undefined)}
      alt={label ?? ''}
      sx={{
        width: size,
        height: size,
        bgcolor: 'background.subtle',
        color: 'text.secondary',
        fontSize: size * 0.42,
        fontWeight: 600,
        ...(ring ? { boxShadow: `0 0 0 1.5px ${ring}` } : {}),
      }}
    >
      {label?.[0]?.toUpperCase()}
    </Avatar>
  );
  if (!userId) return avatar;
  return (
    <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      {avatar}
      <Box sx={{ position: 'absolute', right: -1, bottom: -1, display: 'flex' }}>
        <PresenceDot userId={userId} size={dotSize ?? Math.max(8, Math.round(size * 0.3))} />
      </Box>
    </Box>
  );
}

export const RoleDot = ({ role, size = 7 }: { role: Role; size?: number }) => (
  <Box
    component="span"
    sx={{ width: size, height: size, borderRadius: '50%', bgcolor: ROLE_COLORS[role], flexShrink: 0, display: 'inline-block' }}
  />
);

export function RoleBadge({ role, size = 'small' }: { role: Role; size?: 'small' | 'medium' }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.75,
        height: size === 'small' ? 24 : 28,
        px: 1,
        borderRadius: 999,
        bgcolor: 'action.selected',
        fontSize: size === 'small' ? '0.75rem' : '0.8125rem',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {ROLE_LABELS[role]}
    </Box>
  );
}

/** Avatar + nickname (+ role) — the only identity shown about anyone (§2.2). */
export function UserChip({
  user,
  showRole = true,
  size = 28,
  subtitle,
}: {
  user: UserRef | null | undefined;
  showRole?: boolean;
  size?: number;
  subtitle?: string;
}) {
  if (!user) {
    return (
      <Typography variant="body2" color="text.disabled">
        Unassigned
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
      <UserAvatar avatarId={user.avatarId} photoId={user.photoId} size={size} label={user.nickname} userId={user.id} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} alignItems="center">
          <Typography variant="body2" fontWeight={550} noWrap>
            {user.nickname}
          </Typography>
          {showRole && (
            // The role as text: a coloured dot here read like an online status.
            <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
              {ROLE_LABELS[user.role]}
            </Typography>
          )}
        </Stack>
        {subtitle && (
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {subtitle}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
