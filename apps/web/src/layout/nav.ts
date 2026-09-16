import AccountTreeRounded from '@mui/icons-material/AccountTreeRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import ChatRounded from '@mui/icons-material/ChatRounded';
import ChecklistRounded from '@mui/icons-material/ChecklistRounded';
import DashboardRounded from '@mui/icons-material/DashboardRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import HubRounded from '@mui/icons-material/HubRounded';
import ManageAccountsRounded from '@mui/icons-material/ManageAccountsRounded';
import NotificationsRounded from '@mui/icons-material/NotificationsRounded';
import PhoneInTalkRounded from '@mui/icons-material/PhoneInTalkRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import type { SvgIconProps } from '@mui/material';
import type { Role } from '@god/shared';
import type { ComponentType } from 'react';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<SvgIconProps>;
  roles: Role[];
  section: 'work' | 'admin' | 'account';
  /** A live count shown next to the label. */
  badge?: 'chat' | 'todos';
}

const ALL: Role[] = ['founder', 'manager', 'associate', 'expert'];

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: DashboardRounded, roles: ALL, section: 'work' },
  { to: '/calls', label: 'Calls', icon: PhoneInTalkRounded, roles: ALL, section: 'work' },
  { to: '/calendar', label: 'Calendar', icon: CalendarMonthRounded, roles: ALL, section: 'work' },
  { to: '/chat', label: 'Chat', icon: ChatRounded, roles: ALL, section: 'work', badge: 'chat' },
  { to: '/todos', label: 'To-dos', icon: ChecklistRounded, roles: ALL, section: 'work', badge: 'todos' },
  { to: '/invoicing', label: 'Invoicing', icon: ReceiptLongRounded, roles: ['founder'], section: 'work' },
  { to: '/profiles', label: 'Profiles', icon: AccountTreeRounded, roles: ALL, section: 'admin' },
  { to: '/platforms', label: 'Platforms', icon: HubRounded, roles: ['founder', 'manager'], section: 'admin' },
  { to: '/team', label: 'Team', icon: GroupsRounded, roles: ['manager'], section: 'admin' },
  { to: '/users', label: 'Users', icon: ManageAccountsRounded, roles: ['founder'], section: 'admin' },
  { to: '/audit', label: 'Audit', icon: HistoryRounded, roles: ['founder'], section: 'admin' },
  { to: '/notifications', label: 'Notifications', icon: NotificationsRounded, roles: ALL, section: 'account' },
  { to: '/settings', label: 'Settings', icon: SettingsRounded, roles: ALL, section: 'account' },
];

export const SECTION_LABELS: Record<NavItem['section'], string> = {
  work: 'Workspace',
  admin: 'Manage',
  account: 'Account',
};
