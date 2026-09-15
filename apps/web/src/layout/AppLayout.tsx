import AddRounded from '@mui/icons-material/AddRounded';
import DarkModeOutlined from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlined from '@mui/icons-material/LightModeOutlined';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import {
  AppBar,
  Box,
  Button,
  ButtonBase,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useColorScheme,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { ROLE_LABELS } from '@god/shared';
import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth, useMe } from '@/auth/AuthProvider';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { RoleDot, UserAvatar } from '@/components/identity';
import { zoneCity } from '@/lib/time';
import { useRealtime } from '@/realtime/RealtimeProvider';
import { NAV_ITEMS, type NavItem } from './nav';
import { NotificationBell } from './NotificationBell';

const DRAWER_WIDTH = 240;

function Brand() {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: 2.25, height: 60 }}>
      <Box
        sx={{
          width: 28,
          height: 28,
          borderRadius: 2,
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        G
      </Box>
      <Typography fontWeight={650} letterSpacing="-0.01em">
        God System
      </Typography>
    </Stack>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const me = useMe();
  const navigate = useNavigate();
  const items = NAV_ITEMS.filter((i) => i.roles.includes(me.role));
  const badges = useNavBadges();
  const groups = (['work', 'admin', 'account'] as const).map((s) => items.filter((i) => i.section === s)).filter((g) => g.length);

  return (
    <Stack sx={{ height: '100%' }}>
      <Brand />
      {me.role !== 'expert' && (
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<AddRounded />}
            onClick={() => {
              navigate('/calls/new');
              onNavigate?.();
            }}
          >
            New call
          </Button>
        </Box>
      )}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.25 }}>
        {groups.map((group, i) => (
          <List key={i} dense disablePadding sx={{ pb: 1.5 }}>
            {group.map((item) => (
              <NavEntry key={item.to} item={item} onNavigate={onNavigate} badge={item.badge ? badges[item.badge] : 0} />
            ))}
          </List>
        ))}
      </Box>
    </Stack>
  );
}

/** Unread chat messages and open to-dos assigned to me, for the sidebar badges. */
function useNavBadges(): Record<NonNullable<NavItem['badge']>, number> {
  const conversations = useQuery({ queryKey: qk.chat.conversations, queryFn: api.chat.conversations, refetchInterval: 120_000 });
  const todos = useQuery({
    queryKey: qk.todos.list({ scope: 'assigned', status: 'open' }),
    queryFn: () => api.todos.list({ scope: 'assigned', status: 'open' }),
    refetchInterval: 120_000,
  });
  return {
    chat: (conversations.data ?? []).reduce((n, c) => n + c.unreadCount, 0),
    todos: todos.data?.length ?? 0,
  };
}

function NavEntry({ item, onNavigate, badge = 0 }: { item: NavItem; onNavigate?: () => void; badge?: number }) {
  const Icon = item.icon;
  const location = useLocation();
  const active =
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to) && !location.pathname.startsWith('/calls/new');
  return (
    <ListItemButton
      component={NavLink}
      to={item.to}
      onClick={onNavigate}
      selected={active}
      sx={{
        mb: 0.25,
        py: 0.75,
        color: 'text.secondary',
        '& .MuiListItemIcon-root': { color: 'text.secondary' },
        '&.Mui-selected, &.Mui-selected:hover': {
          bgcolor: 'action.selected',
          color: 'text.primary',
          '& .MuiListItemIcon-root': { color: 'text.primary' },
        },
      }}
    >
      <ListItemIcon sx={{ minWidth: 32 }}>
        <Icon sx={{ fontSize: 19 }} />
      </ListItemIcon>
      <ListItemText primary={item.label} slotProps={{ primary: { fontWeight: active ? 600 : 500, fontSize: 14 } }} />
      {badge > 0 && (
        <Box
          component="span"
          aria-label={`${badge} new`}
          sx={{
            minWidth: 20,
            height: 20,
            px: 0.75,
            borderRadius: 99,
            bgcolor: item.badge === 'chat' ? 'primary.main' : 'warning.main',
            color: 'common.white',
            fontSize: 11,
            fontWeight: 700,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {badge > 99 ? '99+' : badge}
        </Box>
      )}
    </ListItemButton>
  );
}

/** Which clock this user works on (§9.3), shown quietly in the top bar. */
function ZoneClock() {
  const { user, zone } = useAuth();
  const [now, setNow] = useState(DateTime.now());
  useEffect(() => {
    const t = setInterval(() => setNow(DateTime.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!user) return null;
  return (
    <Typography variant="body2" color="text.secondary" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>
      {zoneCity(zone)} · {now.setZone(zone).toFormat('h:mm a ZZZZ')}
    </Typography>
  );
}

function ColorModeToggle() {
  const { mode, systemMode, setMode } = useColorScheme();
  const resolved = mode === 'system' ? systemMode : mode;
  return (
    <Tooltip title={resolved === 'dark' ? 'Light mode' : 'Dark mode'}>
      <IconButton onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')} aria-label="Toggle color mode">
        {resolved === 'dark' ? <LightModeOutlined fontSize="small" /> : <DarkModeOutlined fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}

function UserMenu() {
  const me = useMe();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <ButtonBase onClick={(e) => setAnchor(e.currentTarget)} aria-label="Account menu" sx={{ borderRadius: 99, ml: 0.5 }}>
        <UserAvatar avatarId={me.avatarId} photoId={me.photoId} label={me.nickname} size={32} />
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 220, border: 1, borderColor: 'divider' } } }}
      >
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography variant="body2" fontWeight={600}>
            {me.nickname}
          </Typography>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <RoleDot role={me.role} size={6} />
            <Typography variant="caption" color="text.secondary">
              {ROLE_LABELS[me.role]} · {me.email}
            </Typography>
          </Stack>
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            navigate('/settings');
          }}
        >
          <ListItemIcon>
            <SettingsOutlined fontSize="small" />
          </ListItemIcon>
          Settings
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null);
            void logout();
          }}
        >
          <ListItemIcon>
            <LogoutRounded fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}

function ConnectionDot() {
  const { connected } = useRealtime();
  return (
    <Tooltip title={connected ? 'Live' : 'Reconnecting…'}>
      <Box
        aria-label={connected ? 'Live' : 'Offline'}
        sx={{ width: 7, height: 7, borderRadius: '50%', mx: 1, bgcolor: connected ? 'success.main' : 'warning.main' }}
      />
    </Tooltip>
  );
}

export function AppLayout() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant={desktop ? 'permanent' : 'temporary'}
          open={desktop || mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              borderRight: 1,
              borderColor: 'divider',
              bgcolor: 'background.default',
            },
          }}
        >
          <SidebarContent onNavigate={desktop ? undefined : () => setMobileOpen(false)} />
        </Drawer>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ bgcolor: 'background.default', backgroundImage: 'none' }}>
          <Toolbar sx={{ gap: 0.5, minHeight: { xs: 56, md: 60 }, px: { xs: 2, sm: 3, lg: 4 } }}>
            {!desktop && (
              <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
                <MenuRounded />
              </IconButton>
            )}
            <Box sx={{ flex: 1 }} />
            <ZoneClock />
            <ConnectionDot />
            <ColorModeToggle />
            <NotificationBell />
            <UserMenu />
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ flex: 1, px: { xs: 2, sm: 3, lg: 4 }, pb: 4, pt: 1, maxWidth: 1360, width: '100%', mx: 'auto' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
