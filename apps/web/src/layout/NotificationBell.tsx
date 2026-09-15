import DoneAllRounded from '@mui/icons-material/DoneAllRounded';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItemButton,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import type { NotificationDTO } from '@god/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { EmptyState } from '@/components/common';
import { useToast } from '@/components/ToastProvider';
import { relativeTime } from '@/lib/time';
import { notificationLink, notificationText, useMarkRead, useNotifications } from '@/notifications/useNotifications';

export function NotificationBell() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { data } = useNotifications();
  const markRead = useMarkRead();
  const navigate = useNavigate();
  const toast = useToast();

  // Live toast for new notifications while the popover is closed.
  useEffect(() => {
    const handler = (e: Event) => {
      const n = (e as CustomEvent<NotificationDTO>).detail;
      const link = notificationLink(n);
      toast.info(
        notificationText(n).title,
        link ? (
          <Button color="inherit" size="small" onClick={() => navigate(link)}>
            Open
          </Button>
        ) : undefined,
      );
    };
    window.addEventListener('god:notification', handler);
    return () => window.removeEventListener('god:notification', handler);
  }, [toast, navigate]);

  const open = (n: NotificationDTO) => {
    if (!n.readAt) markRead.mutate([n.id]);
    const link = notificationLink(n);
    setAnchor(null);
    if (link) navigate(link);
  };

  const unread = data?.unreadCount ?? 0;
  const items = data?.items.slice(0, 8) ?? [];

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label={`${unread} unread notifications`}>
          <Badge badgeContent={unread} color="primary" max={99} sx={{ '& .MuiBadge-badge': { fontSize: 10.5, height: 17, minWidth: 17, px: 0.5 } }}>
            <NotificationsNoneRounded />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: { width: 380, maxWidth: 'calc(100vw - 24px)', mt: 1, border: 1, borderColor: 'divider', borderRadius: '14px', boxShadow: '0 12px 32px rgba(0, 0, 0, 0.12)' },
          },
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pl: 2, pr: 1, pt: 1.5, pb: 0.5 }}>
          <Typography variant="subtitle2">Notifications</Typography>
          <Button size="small" color="inherit" startIcon={<DoneAllRounded />} disabled={!unread} onClick={() => markRead.mutate('all')} sx={{ color: 'text.secondary' }}>
            Mark all read
          </Button>
        </Stack>
        {items.length === 0 ? (
          <EmptyState title="You're all caught up" icon={<NotificationsNoneRounded />} sx={{ py: 4 }} />
        ) : (
          <List dense sx={{ maxHeight: 420, overflow: 'auto', p: 1 }}>
            {items.map((n) => {
              const text = notificationText(n);
              return (
                <ListItemButton key={n.id} onClick={() => open(n)} sx={{ alignItems: 'flex-start', gap: 1.5, py: 1 }}>
                  <Box
                    sx={{
                      mt: 0.8,
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      flexShrink: 0,
                      bgcolor: n.readAt ? 'transparent' : 'primary.main',
                    }}
                  />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={n.readAt ? 400 : 600}>
                      {text.title}
                    </Typography>
                    {text.body && (
                      <Typography variant="caption" color="text.secondary" component="div" noWrap>
                        {text.body}
                      </Typography>
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, mt: 0.25 }}>
                    {relativeTime(n.createdAt)}
                  </Typography>
                </ListItemButton>
              );
            })}
          </List>
        )}
        <Divider />
        <Box sx={{ p: 1 }}>
          <Button
            fullWidth
            color="inherit"
            onClick={() => {
              setAnchor(null);
              navigate('/notifications');
            }}
          >
            View all
          </Button>
        </Box>
      </Popover>
    </>
  );
}
