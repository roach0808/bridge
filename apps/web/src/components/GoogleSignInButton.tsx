import { Box } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { useEffect, useRef, useState } from 'react';

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void; ux_mode?: 'popup' }) => void;
      renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';
let scriptLoad: Promise<GoogleIdentity> | null = null;

/** Loads Google's sign-in library once. */
function loadGoogle(): Promise<GoogleIdentity> {
  scriptLoad ??= new Promise((resolve, reject) => {
    if (window.google) return resolve(window.google);
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error('Google sign-in did not load')));
    script.onerror = () => {
      scriptLoad = null;
      reject(new Error('Google sign-in could not load. Check your connection.'));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

/**
 * Google's own "Sign in with Google" button. Google shows its account picker in a popup
 * and hands back a signed ID token (`credential`), which the API checks.
 */
export function GoogleSignInButton({
  clientId,
  onCredential,
  onError,
  width = 320,
}: {
  clientId: string;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { mode, systemMode } = useColorScheme();
  const dark = (mode === 'system' ? systemMode : mode) === 'dark';
  const [ready, setReady] = useState(false);
  // The latest handlers, without re-rendering Google's button on every render.
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    let cancelled = false;
    loadGoogle()
      .then((google) => {
        if (cancelled || !ref.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: ({ credential }) =>
            credential ? handlers.current.onCredential(credential) : handlers.current.onError('Google sign-in was cancelled'),
        });
        google.accounts.id.renderButton(ref.current, {
          type: 'standard',
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          // Otherwise Google picks the language from the visitor's location.
          locale: 'en',
          width,
        });
        setReady(true);
      })
      .catch((err: Error) => handlers.current.onError(err.message));
    return () => {
      cancelled = true;
    };
  }, [clientId, dark, width]);

  return <Box ref={ref} sx={{ display: 'flex', justifyContent: 'center', minHeight: 44, opacity: ready ? 1 : 0, transition: 'opacity .2s' }} />;
}
