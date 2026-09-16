import '@fontsource-variable/inter';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterLuxon } from '@mui/x-date-pickers/AdapterLuxon';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@god/api-client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { ToastProvider } from '@/components/ToastProvider';
import { PresenceProvider } from '@/realtime/PresenceProvider';
import { RealtimeProvider } from '@/realtime/RealtimeProvider';
import { router } from '@/router';
import { theme } from '@/theme/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
  mutationCache: new MutationCache(),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme} defaultMode="system">
      <CssBaseline enableColorScheme />
      <LocalizationProvider dateAdapter={AdapterLuxon}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <AuthProvider>
              <RealtimeProvider>
                <PresenceProvider>
                  <RouterProvider router={router} />
                </PresenceProvider>
              </RealtimeProvider>
            </AuthProvider>
          </ToastProvider>
        </QueryClientProvider>
      </LocalizationProvider>
    </ThemeProvider>
  </StrictMode>,
);
