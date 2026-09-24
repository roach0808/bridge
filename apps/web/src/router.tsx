import type { Role } from '@god/shared';
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Button } from '@mui/material';
import { createBrowserRouter, Navigate, Outlet, useLocation, useRouteError } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, FullPageSpinner, LoadingRows } from '@/components/common';
import { errorMessage } from '@/lib/errors';
import { AppLayout } from '@/layout/AppLayout';
import LoginPage from '@/pages/LoginPage';

/**
 * A deploy replaces every page file, so a tab left open asks for files that are gone.
 * The first such failure reloads the page once, which picks up the new version.
 */
const RELOAD_KEY = 'god.reloaded-for-update';

function lazyPage<T extends { default: ComponentType<unknown> }>(load: () => Promise<T>) {
  return lazy(async () => {
    try {
      const mod = await load();
      sessionStorage.removeItem(RELOAD_KEY);
      return mod;
    } catch (err) {
      if (!sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        window.location.reload();
        // Never resolves: the reload takes over.
        await new Promise(() => {});
      }
      throw err;
    }
  });
}

const DashboardPage = lazyPage(() => import('@/pages/DashboardPage'));
const CallsListPage = lazyPage(() => import('@/pages/calls/CallsListPage'));
const CallDetailPage = lazyPage(() => import('@/pages/calls/CallDetailPage'));
const NewCallPage = lazyPage(() => import('@/pages/calls/NewCallPage'));
const CalendarPage = lazyPage(() => import('@/pages/calendar/CalendarPage'));
const ChatPage = lazyPage(() => import('@/pages/chat/ChatPage'));
const TodosPage = lazyPage(() => import('@/pages/todos/TodosPage'));
const ProfilesPage = lazyPage(() => import('@/pages/profiles/ProfilesPage'));
const ProfileDetailPage = lazyPage(() => import('@/pages/profiles/ProfileDetailPage'));
const PlatformsPage = lazyPage(() => import('@/pages/admin/PlatformsPage'));
const TeamPage = lazyPage(() => import('@/pages/admin/TeamPage'));
const UsersPage = lazyPage(() => import('@/pages/admin/UsersPage'));
const AllChatsPage = lazyPage(() => import('@/pages/chat/AllChatsPage'));
const AuditPage = lazyPage(() => import('@/pages/admin/AuditPage'));
const InvoicingPage = lazyPage(() => import('@/pages/admin/InvoicingPage'));
const StatsPage = lazyPage(() => import('@/pages/stats/StatsPage'));
const NotificationsPage = lazyPage(() => import('@/pages/admin/NotificationsPage'));
const SettingsPage = lazyPage(() => import('@/pages/admin/SettingsPage'));

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

/** Shown when a page fails to load, usually because the app was updated in the background. */
function PageError() {
  const error = useRouteError();
  const stale = error instanceof Error && /dynamically imported module|Importing a module script failed/i.test(error.message);
  return (
    <EmptyState
      title={stale ? 'The app was updated' : 'Something went wrong'}
      description={stale ? 'Reload to get the new version.' : errorMessage(error)}
      action={
        <Button variant="contained" onClick={() => window.location.reload()}>
          Reload
        </Button>
      }
    />
  );
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
          // Static before dynamic: /chat/all is the owner's view, not a chat id.
          { path: 'chat/all', element: <Page roles={['founder']}><AllChatsPage /></Page> },
          { path: 'chat/all/:conversationId', element: <Page roles={['founder']}><AllChatsPage /></Page> },
          { path: 'chat/:conversationId', element: <Page><ChatPage /></Page> },
          { path: 'todos', element: <Page><TodosPage /></Page> },
          { path: 'stats', element: <Page roles={['founder', 'manager', 'associate']}><StatsPage /></Page> },
          { path: 'invoicing', element: <Page roles={['founder']}><InvoicingPage /></Page> },
          { path: 'profiles', element: <Page><ProfilesPage /></Page> },
          { path: 'profiles/:id', element: <Page><ProfileDetailPage /></Page> },
          { path: 'platforms', element: <Page roles={['founder', 'manager']}><PlatformsPage /></Page> },
          { path: 'team', element: <Page roles={['manager']}><TeamPage /></Page> },
          { path: 'users', element: <Page roles={['founder']}><UsersPage /></Page> },
          { path: 'audit', element: <Page roles={['founder']}><AuditPage /></Page> },
          { path: 'notifications', element: <Page><NotificationsPage /></Page> },
          { path: 'settings', element: <Page><SettingsPage /></Page> },
          { path: '*', element: <EmptyState title="Page not found" description="The page you are looking for does not exist." /> },
        ],
        errorElement: <PageError />,
      },
    ],
  },
]);
