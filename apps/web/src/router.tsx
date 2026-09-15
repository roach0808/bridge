import type { Role } from '@god/shared';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, FullPageSpinner, LoadingRows } from '@/components/common';
import { AppLayout } from '@/layout/AppLayout';
import LoginPage from '@/pages/LoginPage';

const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const CallsListPage = lazy(() => import('@/pages/calls/CallsListPage'));
const CallDetailPage = lazy(() => import('@/pages/calls/CallDetailPage'));
const NewCallPage = lazy(() => import('@/pages/calls/NewCallPage'));
const CalendarPage = lazy(() => import('@/pages/calendar/CalendarPage'));
const ChatPage = lazy(() => import('@/pages/chat/ChatPage'));
const TodosPage = lazy(() => import('@/pages/todos/TodosPage'));
const ProfilesPage = lazy(() => import('@/pages/admin/ProfilesPage'));
const PlatformsPage = lazy(() => import('@/pages/admin/PlatformsPage'));
const TeamPage = lazy(() => import('@/pages/admin/TeamPage'));
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'));
const InvoicingPage = lazy(() => import('@/pages/admin/InvoicingPage'));
const NotificationsPage = lazy(() => import('@/pages/admin/NotificationsPage'));
const SettingsPage = lazy(() => import('@/pages/admin/SettingsPage'));

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { hasRole } = useAuth();
  if (!hasRole(...roles)) {
    return <EmptyState title="Not available for your role" description="Ask the Founder if you think you need access." />;
  }
  return <>{children}</>;
}

function Page({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const content = <Suspense fallback={<LoadingRows rows={6} />}>{children}</Suspense>;
  return roles ? <RequireRole roles={roles}>{content}</RequireRole> : content;
}

function AnonymousOnly() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }
  return <Outlet />;
}

export const router = createBrowserRouter([
  { element: <AnonymousOnly />, children: [{ path: '/login', element: <LoginPage /> }] },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Page><DashboardPage /></Page> },
          { path: 'calls', element: <Page><CallsListPage /></Page> },
          { path: 'calls/new', element: <Page roles={['founder', 'manager', 'associate']}><NewCallPage /></Page> },
          { path: 'calls/:id', element: <Page><CallDetailPage /></Page> },
          { path: 'calendar', element: <Page><CalendarPage /></Page> },
          { path: 'chat', element: <Page><ChatPage /></Page> },
          { path: 'chat/:conversationId', element: <Page><ChatPage /></Page> },
          { path: 'todos', element: <Page><TodosPage /></Page> },
          { path: 'invoicing', element: <Page roles={['founder']}><InvoicingPage /></Page> },
          { path: 'profiles', element: <Page><ProfilesPage /></Page> },
          { path: 'platforms', element: <Page roles={['founder', 'manager']}><PlatformsPage /></Page> },
          { path: 'team', element: <Page roles={['manager']}><TeamPage /></Page> },
          { path: 'users', element: <Page roles={['founder']}><UsersPage /></Page> },
          { path: 'notifications', element: <Page><NotificationsPage /></Page> },
          { path: 'settings', element: <Page><SettingsPage /></Page> },
          { path: '*', element: <EmptyState title="Page not found" description="The page you are looking for does not exist." /> },
        ],
      },
    ],
  },
]);
