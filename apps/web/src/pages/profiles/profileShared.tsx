import { Box, Stack, Tooltip } from '@mui/material';
import { PLATFORM_REGISTRATION_LABELS, type ProfileDTO } from '@god/shared';
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

/** One dot per platform: green registered, grey not registered, red banned. */
export function PlatformDots({ profile }: { profile: ProfileDTO }) {
  const statuses = profile.platformStatuses ?? [];
  if (!statuses.length) return null;
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      {statuses.map((s) => (
        <Tooltip key={s.platform.id} title={`${s.platform.name}: ${PLATFORM_REGISTRATION_LABELS[s.status]}`}>
          <Box
            component="span"
            aria-label={`${s.platform.name}: ${PLATFORM_REGISTRATION_LABELS[s.status]}`}
            sx={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor: PLATFORM_REGISTRATION_COLORS[s.status],
              opacity: s.status === 'not_registered' ? 0.45 : 1,
            }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}
