import { Alert, Snackbar, type AlertColor } from '@mui/material';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: ReactNode;
  severity: AlertColor;
  action?: ReactNode;
}

interface ToastApi {
  show: (message: ReactNode, severity?: AlertColor, action?: ReactNode) => void;
  success: (message: ReactNode) => void;
  error: (message: ReactNode) => void;
  info: (message: ReactNode, action?: ReactNode) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const current = queue[0];

  const show = useCallback((message: ReactNode, severity: AlertColor = 'info', action?: ReactNode) => {
    setQueue((q) => [...q.slice(-4), { id: Date.now() + Math.random(), message, severity, action }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (m) => show(m, 'success'),
      error: (m) => show(m, 'error'),
      info: (m, action) => show(m, 'info', action),
    }),
    [show],
  );

  const close = () => setQueue((q) => q.slice(1));

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        key={current?.id}
        open={Boolean(current)}
        autoHideDuration={current?.severity === 'error' ? 7000 : 4500}
        onClose={(_, reason) => reason !== 'clickaway' && close()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {current ? (
          <Alert
            onClose={close}
            severity={current.severity}
            variant="filled"
            action={current.action}
            sx={{ minWidth: 300, boxShadow: 6 }}
          >
            {current.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
