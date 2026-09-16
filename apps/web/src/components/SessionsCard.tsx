import ComputerRounded from '@mui/icons-material/ComputerRounded';
import PhoneIphoneRounded from '@mui/icons-material/PhoneIphoneRounded';
import TabletMacRounded from '@mui/icons-material/TabletMacRounded';
import DevicesOtherRounded from '@mui/icons-material/DevicesOtherRounded';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import type { SessionDTO } from '@god/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ToastProvider';
import { ErrorState } from '@/components/common';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { qk } from '@/lib/queryKeys';
import { relativeTime } from '@/lib/time';
import { countryName, flagEmoji } from '@/pages/admin/adminShared';

const DEVICE_ICONS: Record<string, typeof ComputerRounded> = {
  desktop: ComputerRounded,
  mobile: PhoneIphoneRounded,
  tablet: TabletMacRounded,
  unknown: DevicesOtherRounded,
};

const describe = (s: SessionDTO) =>
  [s.browser, s.os].filter(Boolean).join(' on ') || `${s.deviceType === 'unknown' ? 'Unknown' : s.deviceType} device`;

/**
 * Where this account is signed in. Sessions last until they are signed out
 * here, or the account is deactivated.
 */
export function SessionsCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: api.auth.sessions });

  const signOut = useMutation({
    mutationFn: (id: string) => api.auth.signOutSession(id),
    onSuccess: ({ signedOut }) => {
      void queryClient.invalidateQueries({ queryKey: qk.sessions });
      toast.success(signedOut === 1 ? 'Signed out of that device' : `Signed out of ${signedOut} devices`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (sessions.isLoading) return <CircularProgress size={18} />;
  if (sessions.isError) return <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />;

  const rows = sessions.data ?? [];
  const others = rows.filter((s) => !s.current).length;

  return (
    <Stack spacing={1.25}>
      <Typography variant="body2" color="text.secondary">
        You stay signed in on each device until you sign out here.
      </Typography>
      {rows.map((s) => {
        const Icon = DEVICE_ICONS[s.deviceType] ?? DevicesOtherRounded;
        return (
          <Stack key={s.id} direction="row" spacing={1.5} alignItems="center" sx={{ py: 0.75, borderTop: 1, borderColor: 'divider' }}>
            <Icon sx={{ fontSize: 22, color: 'text.secondary' }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap">
                <Typography variant="body2" fontWeight={550}>
                  {describe(s)}
                </Typography>
                {s.current && (
                  <Box component="span" sx={{ px: 0.75, height: 18, borderRadius: 99, bgcolor: 'success.main', color: 'common.white', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>
                    This device
                  </Box>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {s.country ? `${flagEmoji(s.country)} ${countryName(s.country) ?? s.country} · ` : ''}
                Last used {relativeTime(s.lastUsedAt)} · Signed in {relativeTime(s.signedInAt)}
              </Typography>
            </Box>
            {!s.current && (
              <Button size="small" color="inherit" disabled={signOut.isPending} onClick={() => signOut.mutate(s.id)} sx={{ color: 'text.secondary' }}>
                Sign out
              </Button>
            )}
          </Stack>
        );
      })}
      {others > 0 && (
        <Box>
          <Button size="small" variant="outlined" disabled={signOut.isPending} onClick={() => signOut.mutate('all')}>
            Sign out of all other devices
          </Button>
        </Box>
      )}
    </Stack>
  );
}
