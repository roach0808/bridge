import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export default function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  useEffect(() => {
    // Without the setting (or an older API), the page just shows the password form.
    api.auth
      .config()
      .then((c) => setGoogleClientId(c.googleClientId))
      .catch(() => setGoogleClientId(null));
  }, []);

  const signInWithGoogle = async (credential: string) => {
    setBusy(true);
    setError(null);
    try {
      await loginWithGoogle(credential);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        py: 6,
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 380 }}>
        <Stack direction="row" spacing={1.25} alignItems="center" justifyContent="center" sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontWeight: 650,
              fontSize: 14,
            }}
          >
            G
          </Box>
          <Typography variant="subtitle1" component="div">
            God System
          </Typography>
        </Stack>
        <Card component="form" onSubmit={submit} noValidate sx={{ p: { xs: 3, sm: 4 } }}>
          <Typography variant="h5" component="h1" sx={{ mb: 0.5 }}>
            Welcome back
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Sign in to your workspace.
          </Typography>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            {googleClientId && (
              <>
                <GoogleSignInButton clientId={googleClientId} onCredential={(c) => void signInWithGoogle(c)} onError={setError} width={300} />
                <Divider sx={{ typography: 'caption', color: 'text.secondary' }}>or use your password</Divider>
              </>
            )}
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus={!googleClientId}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <TextField
              label="Password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShow((s) => !s)} edge="end" aria-label={show ? 'Hide password' : 'Show password'}>
                        {show ? <VisibilityOffRounded /> : <VisibilityRounded />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button type="submit" variant="contained" size="large" disabled={busy || !email || !password} sx={{ minHeight: 42 }}>
              {busy ? <CircularProgress size={20} color="inherit" /> : 'Sign in'}
            </Button>
          </Stack>
        </Card>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 3, textAlign: 'center' }}>
          Accounts are created by the Founder or a Manager.
        </Typography>
      </Box>
    </Box>
  );
}
