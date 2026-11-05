import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
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
import { Link as RouterLink } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { Horizon, PUBLIC_COLORS, riseIn } from './public/Horizon';

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
      className="light"
      sx={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: PUBLIC_COLORS.page,
        overflow: 'hidden',
      }}
    >
      <Horizon top="78%" />
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ position: 'relative', px: { xs: 2.5, sm: 4 }, pt: { xs: 2.5, md: 3.5 } }}>
        <Box component={RouterLink} to="/" aria-label="Silver Horizon home" sx={{ display: 'block', borderRadius: 1, '&:focus-visible': { outline: `2px solid ${PUBLIC_COLORS.accent}`, outlineOffset: 3 } }}>
          <Box component="img" src="/brand/logo.png" alt="" sx={{ height: { xs: 30, md: 36 }, width: 'auto', display: 'block' }} />
        </Box>
        <Button component={RouterLink} to="/" startIcon={<ArrowBackRounded />} sx={{ color: PUBLIC_COLORS.muted, '&:hover': { color: PUBLIC_COLORS.ink, bgcolor: 'transparent' } }}>
          Home
        </Button>
      </Stack>
      <Box sx={{ ...riseIn(), position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', px: 2, py: 5 }}>
      <Box sx={{ width: '100%', maxWidth: 400 }}>
        <Card component="form" onSubmit={submit} noValidate sx={{ p: { xs: 3, sm: 4 }, borderRadius: '24px', boxShadow: '0 24px 70px rgba(28, 57, 85, 0.16)' }}>
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
        <Typography variant="body2" component="p" sx={{ mt: 2.5, textAlign: 'center', color: PUBLIC_COLORS.muted }}>
          Accounts are by invitation.
        </Typography>
      </Box>
      </Box>
    </Box>
  );
}
