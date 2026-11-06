import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link as RouterLink } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { BRAND, HEADLINE, Lockup, Monogram, silverText } from '@/components/brand';
import { GoogleSignInButton } from '@/components/GoogleSignInButton';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { MorningStars, Planet } from './public/LandingPage';
import { riseIn } from './public/Horizon';

const C = BRAND;

/** The agency's idea, as on the landing page. */
const IDEA = ['More opportunities', 'Strong support', 'More revenue'];

const focusRing = (color: string) => ({ '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: 3 } }) as const;

/** The fields, square-shouldered and in the brand's teal when in use. */
const field = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '4px',
    bgcolor: C.surface,
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: C.tealDeep, borderWidth: 2 },
  },
  '& .MuiInputLabel-root.Mui-focused': { color: C.tealDeep },
} as const;

/**
 * Signing in, in the brand: the night sky with the SH mark and the sunrise on
 * one side, the form on soft white on the other (above and below on a phone).
 * What it does is unchanged: email and password, Google when the API has it set
 * up, and a way back to the landing page.
 */
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
        minHeight: '100svh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.2fr) minmax(440px, 0.8fr)' },
        gridTemplateRows: { xs: 'auto 1fr', md: '1fr' },
        bgcolor: C.softWhite,
        color: C.ink,
        '@media (prefers-reduced-motion: reduce)': { '& *, & *::before, & *::after': { animation: 'none !important' } },
      }}
    >
      {/* ---------------- the brand: night sky, the mark, the idea, the sunrise ---------------- */}
      <Box
        component="section"
        aria-label="Silver Horizon"
        sx={{
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          minHeight: { xs: 300, sm: 340, md: '100svh' },
          background: `radial-gradient(90% 70% at 50% 0%, #142A5C 0%, ${C.navy} 60%, ${C.navyDeep} 100%)`,
          color: C.softWhite,
        }}
      >
        <MorningStars />
        {/* On a phone the band below already shows the mark and the name. */}
        <Box sx={{ position: 'relative', display: { xs: 'none', md: 'block' }, px: 5, pt: 3.5 }}>
          <Box component={RouterLink} to="/" aria-label="Silver Horizon home" sx={{ ...focusRing(C.tealLight), display: 'inline-block', borderRadius: 1, textDecoration: 'none', color: 'inherit' }}>
            <Lockup />
          </Box>
        </Box>

        <Box sx={{ position: 'relative', flex: 1, display: { xs: 'none', md: 'flex' }, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 4, pb: 18 }}>
          <Box sx={riseIn()}>
            <Monogram width={{ md: 190, lg: 220 }} />
          </Box>
          <Typography aria-hidden sx={{ ...riseIn(120), ...silverText, fontFamily: HEADLINE, fontWeight: 500, fontSize: 'clamp(26px, 3vw, 44px)', letterSpacing: '0.18em', mr: '-0.18em', mt: 3, lineHeight: 1.1 }}>
            SILVER HORIZON
          </Typography>
          <Typography sx={{ ...riseIn(200), color: C.silver, fontSize: 12, fontWeight: 500, letterSpacing: '0.3em', textTransform: 'uppercase', mt: 1.75 }}>
            The consulting collaboration platform
          </Typography>
          <Stack direction="row" alignItems="center" justifyContent="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ ...riseIn(300), mt: 5 }}>
            {IDEA.map((step, i) => (
              <Fragment key={step}>
                {i > 0 && <ChevronRightRounded aria-hidden sx={{ color: C.glow, fontSize: 20 }} />}
                <Typography component="span" sx={{ color: C.softWhite, fontSize: 13, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
                  {step}
                </Typography>
              </Fragment>
            ))}
          </Stack>
        </Box>

        {/* On a phone the brand is a band above the form: the mark, the name, the sunrise. */}
        <Stack alignItems="center" sx={{ position: 'relative', display: { xs: 'flex', md: 'none' }, flex: 1, justifyContent: 'center', pb: 6, pt: 4 }}>
          <Monogram width={110} />
          <Typography aria-hidden sx={{ ...silverText, fontFamily: HEADLINE, fontWeight: 500, fontSize: 20, letterSpacing: '0.18em', mr: '-0.18em', mt: 1.5 }}>
            SILVER HORIZON
          </Typography>
        </Stack>

        <Box sx={{ position: 'relative', height: { xs: 56, md: 150 } }}>
          <Planet bigSun />
        </Box>
      </Box>

      {/* ---------------- signing in ---------------- */}
      <Box component="main" sx={{ display: 'flex', flexDirection: 'column', px: { xs: 2.5, sm: 4 }, py: { xs: 2, md: 3.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            component={RouterLink}
            to="/"
            startIcon={<ArrowBackRounded />}
            sx={{ ...focusRing(C.tealDeep), color: C.muted, fontWeight: 500, '&:hover': { color: C.ink, bgcolor: 'transparent' } }}
          >
            Home
          </Button>
        </Box>
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: { xs: 1, md: 5 } }}>
          <Box component="form" onSubmit={submit} noValidate sx={{ ...riseIn(80), width: '100%', maxWidth: 380 }}>
            <Typography
              component="p"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                color: C.ink,
                fontFamily: HEADLINE,
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                mb: 2,
                '&::before': { content: '""', width: 28, height: '2px', bgcolor: C.teal, flexShrink: 0 },
              }}
            >
              Sign in
            </Typography>
            <Typography component="h1" sx={{ fontFamily: HEADLINE, fontWeight: 600, fontSize: { xs: 30, md: 36 }, letterSpacing: '-0.02em', lineHeight: 1.1, color: C.ink }}>
              Welcome back
            </Typography>
            <Typography sx={{ color: C.muted, fontSize: 16, mt: 1, mb: 4 }}>Sign in to your workspace.</Typography>
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
                sx={field}
              />
              <TextField
                label="Password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                sx={field}
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
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={busy || !email || !password}
                sx={{
                  ...focusRing(C.tealDeep),
                  minHeight: 48,
                  borderRadius: '4px',
                  fontWeight: 600,
                  fontSize: 15,
                  boxShadow: 'none',
                  bgcolor: C.tealDeep,
                  transition: 'background-color 160ms, transform 160ms, box-shadow 160ms',
                  '&:hover': { bgcolor: '#355E5B', boxShadow: '0 10px 28px -12px rgba(63, 110, 107, 0.8)', transform: 'translateY(-1px)' },
                  '&:active': { transform: 'scale(0.98)' },
                }}
              >
                {busy ? <CircularProgress size={20} color="inherit" /> : 'Sign in'}
              </Button>
            </Stack>
            <Typography variant="body2" component="p" sx={{ mt: 3, color: C.muted }}>
              Accounts are by invitation.
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
