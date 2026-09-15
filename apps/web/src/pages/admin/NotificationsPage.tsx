import AddRounded from '@mui/icons-material/AddRounded';
import AssignmentIndRounded from '@mui/icons-material/AssignmentIndRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import DoneAllRounded from '@mui/icons-material/DoneAllRounded';
import DoneRounded from '@mui/icons-material/DoneRounded';
import EditNoteRounded from '@mui/icons-material/EditNoteRounded';
import GppBadOutlined from '@mui/icons-material/GppBadOutlined';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import SwapHorizRounded from '@mui/icons-material/SwapHorizRounded';
import PersonAddAlt1Outlined from '@mui/icons-material/PersonAddAlt1Outlined';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import VerifiedUserOutlined from '@mui/icons-material/VerifiedUserOutlined';
import {
  Box,
  Button,
  Card,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  type SvgIconProps,
} from '@mui/material';
import type { NotificationDTO, NotificationType } from '@god/shared';
import { useMemo, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, ErrorState, PageHeader } from '@/components/common';
import { STATUS_COLORS } from '@/components/StatusChip';
import { useToast } from '@/components/ToastProvider';
import { errorMessage } from '@/lib/errors';
import { dayLabel, formatDateTime, inZone, relativeTime } from '@/lib/time';
import { notificationLink, notificationText, useMarkRead, useNotifications } from '@/notifications/useNotifications';
import { useNow } from './adminShared';

const TYPE_META: Record<NotificationType, { icon: ComponentType<SvgIconProps>; label: string }> = {
  'call.status_changed': { icon: SwapHorizRounded, label: 'Status change' },
  'call.assigned': { icon: AssignmentIndRounded, label: 'Assignment' },
  'call.message': { icon: ChatBubbleOutlineRounded, label: 'Message' },
  'call.updated': { icon: EditNoteRounded, label: 'Update' },
  'call.created': { icon: AddRounded, label: 'New call' },
  'todo.assigned': { icon: ChecklistRounded, label: 'To-do' },
  'todo.done': { icon: TaskAltRounded, label: 'To-do done' },
  'profile.submitted': { icon: PersonAddAlt1Outlined, label: 'Profile submitted' },
  'profile.approved': { icon: VerifiedUserOutlined, label: 'Profile approved' },
  'profile.rejected': { icon: GppBadOutlined, label: 'Profile rejected' },
};

/** A quiet neutral icon; status changes get a small dot in the destination status colour. */
function NotificationIcon({ n }: { n: NotificationDTO }) {
  const to = n.type === 'call.status_changed' ? n.payload.to : undefined;
  const Icon = TYPE_META[n.type]?.icon ?? NotificationsNoneRounded;
  return (
    <Box
      sx={{
        position: 'relative',
        width: 34,
        height: 34,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        color: 'text.secondary',
        bgcolor: 'action.selected',
      }}
    >
      <Icon sx={{ fontSize: 18 }} />
      {to && (
        <Box
          sx={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: STATUS_COLORS[to],
            border: 2,
            borderColor: 'background.paper',
          }}
        />
      )}
    </Box>
  );
}

type Filter = 'all' | 'unread';

export default function NotificationsPage() {
  const { zone } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, isLoading, isError, error, refetch } = useNotifications();
  const markRead = useMarkRead();
  const [filter, setFilter] = useState<Filter>('all');
  useNow(60_000); // keep relative times fresh

  const unread = data?.unreadCount ?? 0;

  const groups = useMemo(() => {
    const items = (data?.items ?? []).filter((n) => filter === 'all' || !n.readAt);
    const out: Array<{ key: string; label: string; items: NotificationDTO[] }> = [];
    for (const n of items) {
      const key = inZone(n.createdAt, zone).toISODate() ?? n.createdAt.slice(0, 10);
      let group = out[out.length - 1];
      if (!group || group.key !== key) {
        const label = dayLabel(n.createdAt, zone);
        group = { key, label: label === 'Today' || label === 'Yesterday' ? label : inZone(n.createdAt, zone).toFormat('cccc, LLL d'), items: [] };
        out.push(group);
      }
      group.items.push(n);
    }
    return out;
  }, [data, filter, zone]);

  const mark = (ids: string[] | 'all') =>
    markRead.mutate(ids, { onError: (err) => toast.error(errorMessage(err, 'Could not mark as read')) });

  const open = (n: NotificationDTO) => {
    if (!n.readAt) mark([n.id]);
    const link = notificationLink(n);
    if (link) navigate(link);
  };

  return (
    <Box sx={{ maxWidth: 860, mx: 'auto' }}>
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'You’re all caught up.'}
        actions={
          <Button
            variant="outlined"
            color="inherit"
            startIcon={<DoneAllRounded />}
            onClick={() => mark('all')}
            disabled={unread === 0 || markRead.isPending}
          >
            Mark all read
          </Button>
        }
      />

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filter}
          onChange={(_, v: Filter | null) => v && setFilter(v)}
          aria-label="Filter notifications"
        >
          <ToggleButton value="all" sx={{ px: 2 }}>
            All
          </ToggleButton>
          <ToggleButton value="unread" sx={{ px: 2, gap: 0.75 }}>
            Unread
            {unread > 0 && (
              <Box component="span" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
                {unread}
              </Box>
            )}
          </ToggleButton>
        </ToggleButtonGroup>
        {data && (
          <Typography variant="caption" color="text.secondary">
            Latest {data.items.length}
          </Typography>
        )}
      </Stack>

      {isLoading ? (
        <Card>
          <Stack spacing={0} divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
            {Array.from({ length: 6 }, (_, i) => (
              <Stack key={i} direction="row" spacing={2} sx={{ p: 2 }} alignItems="center">
                <Skeleton variant="circular" width={34} height={34} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton width="55%" />
                  <Skeleton width="35%" height={16} />
                </Box>
              </Stack>
            ))}
          </Stack>
        </Card>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : groups.length === 0 ? (
        <Card>
          {filter === 'unread' ? (
            <EmptyState
              icon={<DoneAllRounded />}
              title="No unread notifications"
              action={
                <Button size="small" onClick={() => setFilter('all')}>
                  Show all
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<NotificationsNoneRounded />}
              title="No notifications yet"
              description="Call updates, messages and assignments show up here."
            />
          )}
        </Card>
      ) : (
        <Stack spacing={2.5}>
          {groups.map((g) => (
            <Box key={g.key} component="section" aria-labelledby={`day-${g.key}`}>
              <Typography
                id={`day-${g.key}`}
                variant="body2"
                color="text.secondary"
                component="h2"
                fontWeight={500}
                sx={{ display: 'block', mb: 1, px: 0.5 }}
              >
                {g.label}
              </Typography>
              <Card>
                <List disablePadding>
                  {g.items.map((n, i) => {
                    const { title, body } = notificationText(n);
                    const isUnread = !n.readAt;
                    const link = notificationLink(n);
                    return (
                      <ListItem
                        key={n.id}
                        disablePadding
                        divider={i < g.items.length - 1}
                        secondaryAction={
                          isUnread ? (
                            <Tooltip title="Mark as read">
                              <IconButton
                                edge="end"
                                size="small"
                                aria-label="Mark as read"
                                onClick={() => mark([n.id])}
                              >
                                <DoneRounded sx={{ fontSize: 18, color: 'text.secondary' }} />
                              </IconButton>
                            </Tooltip>
                          ) : undefined
                        }
                      >
                        <ListItemButton
                          onClick={() => open(n)}
                          disabled={!link && !isUnread}
                          sx={{
                            borderRadius: 0,
                            py: 1.5,
                            pl: 2.5,
                            pr: isUnread ? 7 : 2,
                            gap: 1.5,
                            alignItems: 'flex-start',
                            '&.Mui-disabled': { opacity: 1 },
                          }}
                        >
                          <NotificationIcon n={n} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2" fontWeight={isUnread ? 600 : 400} sx={{ flex: 1, minWidth: 0 }}>
                                {title}
                              </Typography>
                            </Stack>
                            {body && (
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, wordBreak: 'break-word' }}>
                                {body}
                              </Typography>
                            )}
                            <Tooltip title={formatDateTime(n.createdAt, zone)}>
                              <Typography variant="caption" color="text.secondary" component="span" sx={{ mt: 0.5, display: 'inline-block' }}>
                                {TYPE_META[n.type]?.label ?? 'Notification'} · {relativeTime(n.createdAt)}
                              </Typography>
                            </Tooltip>
                          </Box>
                          {isUnread && (
                            <Box
                              aria-label="Unread"
                              sx={{
                                position: 'absolute',
                                left: 8,
                                top: '50%',
                                mt: '-3.5px',
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                bgcolor: 'primary.main',
                              }}
                            />
                          )}
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              </Card>
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}
