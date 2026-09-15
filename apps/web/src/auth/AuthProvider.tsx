import type { MeDTO, Role } from '@god/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onSessionExpired, socket } from '@/lib/api';
import { detachNotificationsOnSignOut, syncNotificationsAfterSignIn } from '@/lib/push';
import { viewerZone } from '@/lib/time';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: MeDTO | null;
  /** The zone this user sees times in (§9.3). */
  zone: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: MeDTO) => void;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<MeDTO | null>(null);
  const queryClient = useQueryClient();

  const reset = useCallback(() => {
    socket.disconnect();
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  // Restore the session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    api.auth.restore().then((auth) => {
      if (cancelled) return;
      if (auth) {
        setUser(auth.user);
        setStatus('authenticated');
      } else {
        setStatus('anonymous');
      }
    });
    onSessionExpired(reset);
    return () => {
      cancelled = true;
    };
  }, [reset]);

  // Attach this browser's notification subscription to whoever is signed in.
  useEffect(() => {
    if (status === 'authenticated') void syncNotificationsAfterSignIn();
  }, [status, user?.id]);

  useEffect(() => {
    if (status === 'authenticated' && !socket.connected) socket.connect();
    const revoked = () => reset();
    socket.on('session:revoked', revoked);
    return () => {
      socket.off('session:revoked', revoked);
    };
  }, [status, reset]);

  const login = useCallback(async (email: string, password: string) => {
    const auth = await api.auth.login(email, password);
    setUser(auth.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await detachNotificationsOnSignOut();
      await api.auth.logout();
    } finally {
      reset();
    }
  }, [reset]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      zone: viewerZone(user),
      login,
      logout,
      setUser,
      hasRole: (...roles) => Boolean(user && roles.includes(user.role)),
    }),
    [status, user, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For screens that only render when signed in. */
export function useMe(): MeDTO {
  const { user } = useAuth();
  if (!user) throw new Error('useMe used without a signed-in user');
  return user;
}
