import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import { Box, Stack, Typography } from '@mui/material';
import { PLATFORM_REGISTRATION_LABELS, type PlatformRegistration, type ProfileDTO } from '@god/shared';
import type { MouseEvent } from 'react';
import { PLATFORM_REGISTRATION_COLORS } from '@/components/ProfileDetails';

/**
 * What a profile still needs before it is fully set up. Only what the viewer
 * is allowed to see: Experts get nothing, bank details are the Founder's business.
 */
export function pendingItems(p: ProfileDTO): string[] {
  const items: string[] = [];
  if (p.status === 'pending') items.push('Waiting for review');
  if (p.status === 'rejected') items.push('Rejected — needs changes');
  // Null means the viewer cannot see the field at all (Experts), so nothing is missing for them.
  if (p.email === null && p.platformStatuses) items.push('Email');
  if (p.phone === null && p.platformStatuses) items.push('Phone number');
  if (p.needsBank) items.push('Bank details');
  if (p.bankCount === 0 && !p.needsBank) items.push('Bank details (before the first call)');
  if (p.onboardedAt === null && p.platformStatuses && p.status === 'approved') items.push('Onboard date');
  const unregistered = (p.platformStatuses ?? []).filter((s) => s.status === 'not_registered');
  if (p.platformStatuses && unregistered.length === p.platformStatuses.length) items.push('Not registered on any platform');
  return items;
}

/** Green registered, grey not registered, red banned. */
export function PlatformDot({ status }: { status: PlatformRegistration }) {
  return (
    <Box
      component="span"
      sx={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        flexShrink: 0,
        bgcolor: PLATFORM_REGISTRATION_COLORS[status],
        opacity: status === 'not_registered' ? 0.45 : 1,
      }}
    />
  );
}

/**
 * The row only carries the platform that matters most (priority one), by name,
 * so it is plain where the Profile is registered. Clicking opens the rest.
 */
export function TopPlatformStatus({ profile, expanded, onToggle }: { profile: ProfileDTO; expanded: boolean; onToggle: () => void }) {
  const statuses = profile.platformStatuses ?? [];
  const top = statuses[0];
  if (!top) return null;
  const rest = statuses.length - 1;
  return (
    <Stack
      component="button"
      type="button"
      direction="row"
      spacing={0.75}
      alignItems="center"
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={expanded}
      sx={{
        border: 0,
        p: 0.25,
        bgcolor: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
        borderRadius: 1,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <PlatformDot status={top.status} />
      <Typography variant="body2" noWrap>
        {top.platform.name}
      </Typography>
      <Typography variant="caption" noWrap sx={{ color: PLATFORM_REGISTRATION_COLORS[top.status], fontWeight: 600 }}>
        {PLATFORM_REGISTRATION_LABELS[top.status]}
      </Typography>
      {rest > 0 && (
        <Typography variant="caption" color="text.secondary">
          +{rest}
        </Typography>
      )}
      <ExpandMoreRounded sx={{ fontSize: 16, color: 'text.secondary', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
    </Stack>
  );
}

/** Every platform this Profile stands on, with where it stands. */
export function AllPlatformStatuses({ profile }: { profile: ProfileDTO }) {
  const statuses = profile.platformStatuses ?? [];
  return (
    <Stack direction="row" spacing={2.5} flexWrap="wrap" useFlexGap sx={{ py: 0.5 }}>
      {statuses.map((s) => (
        <Stack key={s.platform.id} direction="row" spacing={0.75} alignItems="center">
          <PlatformDot status={s.status} />
          <Typography variant="body2">{s.platform.name}</Typography>
          <Typography variant="caption" sx={{ color: PLATFORM_REGISTRATION_COLORS[s.status], fontWeight: 600 }}>
            {PLATFORM_REGISTRATION_LABELS[s.status]}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}
