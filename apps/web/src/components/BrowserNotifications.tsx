import CloseRounded from '@mui/icons-material/CloseRounded';
import NotificationsActiveOutlined from '@mui/icons-material/NotificationsActiveOutlined';
import { Alert, Box, Button, CircularProgress, IconButton, Stack, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { disableNotifications, enableNotifications, getPushState, type PushState } from '@/lib/push';

const PROMPT_DISMISSED_KEY = 'god.push.prompt-dismissed';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || ('standalone' in navigator && Boolean((navigator as { standalone?: boolean }).standalone));

function useBrowserNotifications() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getPushState().then(setState);
  }, []);
  const run = useCallback(async (action: () => Promise<PushState>) => {
    setBusy(true);
    try {
      setState(await action());
    } finally {
      setBusy(false);
    }
  }, []);
  return {
    state,
    busy,
    enable: () => run(enableNotifications),
    disable: () => run(disableNotifications),
  };
}

const STATE_TEXT: Record<PushState, string> = {
  on: 'On — you’ll be notified about new chat messages, to-dos and call updates, even when this site is closed.',
  'tab-only': 'On while this site is open in a tab. This browser can’t receive notifications when the site is closed.',
  off: 'Off in this browser.',
  denied: 'Blocked. To allow them, click the lock icon next to the address bar, set Notifications to Allow, then reload.',
  unsupported: 'This browser can’t show notifications.',
};

/** The Settings card: status, on/off and a test notification. */
export function BrowserNotificationsSettings() {
  const toast = useToast();
  const { state, busy, enable, disable } = useBrowserNotifications();
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    try {
      await api.push.test();
      toast.success('Test sent — it should appear in a few seconds');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  if (!state) return <CircularProgress size={18} />;
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color={state === 'denied' ? 'error.main' : 'text.secondary'}>
        {STATE_TEXT[state]}
      </Typography>
      {state === 'unsupported' && isIos() && !isStandalone() && (
        <Alert severity="info" variant="outlined">
          On iPhone and iPad: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, open the app from your home
          screen and turn notifications on there.
        </Alert>
      )}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {(state === 'off' || state === 'denied') && (
          <Button variant="contained" onClick={() => void enable()} disabled={busy || state === 'denied'} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <NotificationsActiveOutlined />}>
            Turn on
          </Button>
        )}
        {(state === 'on' || state === 'tab-only') && (
          <>
            {state === 'on' && (
              <Button variant="outlined" onClick={() => void test()} disabled={testing}>
                {testing ? <CircularProgress size={16} /> : 'Send a test'}
              </Button>
            )}
            <Button color="inherit" onClick={() => void disable()} disabled={busy} sx={{ color: 'text.secondary' }}>
              Turn off
            </Button>
          </>
        )}
      </Stack>
    </Stack>
  );
}

/** A dismissible nudge to turn notifications on, shown until the user decides. */
export function BrowserNotificationsPrompt() {
  const { state, busy, enable } = useBrowserNotifications();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(PROMPT_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  if (dismissed || state !== 'off' || Notification.permission !== 'default') return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(PROMPT_DISMISSED_KEY, '1');
    } catch {
      // Not remembered; it will show again next time.
    }
  };

  return (
    <Box
      sx={{
        mb: 2,
        px: 2,
        py: 1.25,
        borderRadius: 3,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        flexWrap: 'wrap',
      }}
    >
      <NotificationsActiveOutlined color="primary" />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 200 }}>
        Get notified about new messages and to-dos, even when this site is closed.
      </Typography>
      <Button size="small" variant="contained" onClick={() => void enable()} disabled={busy}>
        Turn on notifications
      </Button>
      <IconButton size="small" onClick={dismiss} aria-label="Not now">
        <CloseRounded fontSize="small" />
      </IconButton>
    </Box>
  );
}
