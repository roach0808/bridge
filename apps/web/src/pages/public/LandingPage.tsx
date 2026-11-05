import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { Horizon, PUBLIC_COLORS as C, riseIn } from './Horizon';

const PILLARS = [
  {
    title: 'Expert consulting',
    body: 'One-to-one calls with people who know a field from the inside, so a hard question gets a first-hand answer.',
  },
  {
    title: 'Strategic connections',
    body: 'The right person for the question, brought together at a time that works, wherever in the world they are.',
  },
  {
    title: 'Professional insight',
    body: 'Perspective you can act on: what people who do the work see, and what a report cannot tell you.',
  },
];

const ROLES = [
  {
    role: 'For Associates',
    title: 'Arrange the call without the back and forth.',
    points: [
      'See who is free at a glance, side by side, each in their own time zone.',
      'Book a call and share the meeting details from one screen.',
      'Follow every call live, from the first booking to the finish.',
      'See your part of each call as it is earned.',
    ],
    picture: 'associate',
  },
  {
    role: 'For Experts',
    title: 'Bring your expertise. The rest is taken care of.',
    points: [
      'Keep your own calendar and time off, in your own time zone.',
      'Confirm a new call in one click, or ask to move it.',
      'Read the research prepared for the call before it starts.',
      'Say how long it ran, and see your pay for each call.',
    ],
    picture: 'expert',
  },
] as const;

const STEPS = [
  { who: 'Associate', title: 'Books it', body: 'Finds a free Expert and a time that works, and sets the call up.' },
  { who: 'Expert', title: 'Confirms it', body: 'Sees the time in their own zone, and accepts it or asks to move it.' },
  { who: 'Expert', title: 'Takes the call', body: 'Prepares, joins and talks, then says how long it ran.' },
  { who: 'Silver Horizon', title: 'Settles it', body: 'The invoice is sent, the payment comes in, and everyone sees their pay.' },
];

const JOURNEY = ['Arranged', 'Confirmed', 'On the call', 'Finished', 'Settled'];

const container = { width: '100%', maxWidth: 1180, mx: 'auto', px: { xs: 2.5, sm: 4 } } as const;

const silverText = {
  background: `linear-gradient(180deg, ${C.ink} 25%, ${C.accent} 62%, #4a6b8f 100%)`,
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
} as const;

const focusRing = { '&:focus-visible': { outline: `2px solid ${C.accent}`, outlineOffset: 3 } } as const;

function SignInButton({ large }: { large?: boolean }) {
  return (
    <Button
      component={RouterLink}
      to="/login"
      endIcon={large ? <ArrowForwardRounded /> : undefined}
      sx={{
        ...focusRing,
        px: large ? 3.5 : 2.25,
        py: large ? 1.4 : 0.75,
        fontSize: large ? 16 : 14,
        fontWeight: 600,
        borderRadius: 99,
        color: '#ffffff',
        bgcolor: C.accent,
        boxShadow: large ? '0 10px 34px rgba(28, 57, 85, 0.28)' : 'none',
        transition: 'transform 160ms, background-color 160ms',
        '&:hover': { bgcolor: C.ink, transform: 'translateY(-1px)' },
      }}
    >
      Sign in
    </Button>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <Typography component="p" sx={{ color: C.muted, fontSize: 13, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', mb: 2 }}>
      {children}
    </Typography>
  );
}

/** A call's path, as a line of light moving along its stages. */
function Journey() {
  return (
    <Box
      role="img"
      aria-label={`The path of a call: ${JOURNEY.join(', ')}`}
      sx={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `repeat(${JOURNEY.length}, minmax(0, 1fr))`,
        px: { xs: 0.5, sm: 2 },
        py: { xs: 2.25, sm: 3 },
        borderRadius: { xs: '18px', sm: '24px' },
        border: `1px solid ${C.line}`,
        background: 'rgba(255, 255, 255, 0.78)',
        boxShadow: '0 16px 50px rgba(28, 57, 85, 0.1)',
        backdropFilter: 'blur(14px)',
      }}
    >
      {JOURNEY.map((step, i) => (
        <Stack key={step} alignItems="center" useFlexGap spacing={1.25} sx={{ position: 'relative', minWidth: 0 }}>
          {i > 0 && (
            <Box sx={{ position: 'absolute', top: 6, right: '50%', width: '100%', height: '1px', background: `linear-gradient(90deg, ${C.line}, ${C.accent})` }} />
          )}
          <Box
            sx={{
              position: 'relative',
              width: 13,
              height: 13,
              borderRadius: '50%',
              bgcolor: i === JOURNEY.length - 1 ? C.accent : C.surface,
              border: `2px solid ${C.accent}`,
              boxShadow: i === JOURNEY.length - 1 ? '0 0 0 5px rgba(28, 57, 85, 0.12)' : 'none',
            }}
          />
          <Typography sx={{ color: i === JOURNEY.length - 1 ? C.ink : C.muted, fontSize: { xs: 11, sm: 14 }, fontWeight: 500, textAlign: 'center', lineHeight: 1.25 }}>
            {step}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

/** Nothing to boast of yet is nothing to show: a figure appears once it says something. */
const MIN_CALLS = 1;
const MIN_HOURS = 1;
const MIN_INCOME = 1000;

const whole = new Intl.NumberFormat('en-US');

/**
 * What has been delivered so far, live from the platform. The server may be
 * asleep, so this fills in when it answers, and the rest of the page never waits;
 * if it cannot answer, the section is simply not there.
 */
function Numbers() {
  const { data, isLoading } = useQuery({ queryKey: qk.publicStats, queryFn: () => api.publicStats(), staleTime: 60_000, refetchInterval: 60_000, retry: 1 });
  const figures = data
    ? [
        ...(data.deliveredCalls >= MIN_CALLS ? [{ value: whole.format(data.deliveredCalls), label: 'Calls delivered' }] : []),
        ...(data.hoursDelivered >= MIN_HOURS ? [{ value: whole.format(data.hoursDelivered), label: 'Hours of expertise' }] : []),
        ...(data.incomeAtLeast >= MIN_INCOME ? [{ value: `$${whole.format(data.incomeAtLeast)}+`, label: 'Total income on invoice' }] : []),
      ]
    : [];
  if (!isLoading && figures.length === 0) return null;
  return (
    <Box component="section" aria-label="What has been delivered so far" sx={{ ...container, pt: { xs: 7, md: 12 } }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: `repeat(${isLoading ? 3 : figures.length}, minmax(0, 1fr))` },
          borderTop: `1px solid ${C.line}`,
          borderBottom: `1px solid ${C.line}`,
          minHeight: { sm: 158 },
        }}
      >
        {figures.map((f, i) => (
          <Box
            key={f.label}
            sx={{
              ...riseIn(i * 100),
              py: { xs: 2.5, sm: 4 },
              pl: { sm: i ? 4 : 0 },
              borderLeft: { sm: i ? `1px solid ${C.line}` : 'none' },
              borderTop: { xs: i ? `1px solid ${C.line}` : 'none', sm: 'none' },
            }}
          >
            <Typography sx={{ ...silverText, fontSize: 'clamp(38px, 5vw, 64px)', fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums' }}>
              {f.value}
            </Typography>
            <Typography sx={{ color: C.muted, fontSize: 15, mt: 0.75 }}>{f.label}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** A window of the app, drawn for the page: an illustration, with nothing real in it. */
function Picture({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box
      role="img"
      aria-label={label}
      sx={{
        borderRadius: '20px',
        border: `1px solid ${C.line}`,
        bgcolor: C.surface,
        boxShadow: '0 24px 60px rgba(28, 57, 85, 0.14)',
        p: { xs: 2, md: 2.5 },
        minWidth: 0,
      }}
    >
      {children}
    </Box>
  );
}

const PICTURE_ROW = { display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1.25, borderRadius: '12px', bgcolor: C.tint } as const;
const pictureTitle = { color: C.ink, fontSize: 15, fontWeight: 600 } as const;
const pictureNote = { color: C.muted, fontSize: 13 } as const;

/** Who is free for a time, as an Associate sees it. */
function AssociatePicture() {
  const experts = [
    { where: 'Expert in New York', local: '10:00 AM', free: true },
    { where: 'Expert in London', local: '3:00 PM', free: true },
    { where: 'Expert in Seoul', local: '11:00 PM', free: false },
  ];
  return (
    <Picture label="Illustration: choosing a time and seeing which Experts are free, each in their own time zone">
      <Typography sx={pictureTitle}>Who is free at 10:00 AM?</Typography>
      <Typography sx={{ ...pictureNote, mb: 1.75 }}>Tuesday · 60 minutes</Typography>
      <Stack spacing={1}>
        {experts.map((e) => (
          <Box key={e.where} sx={{ ...PICTURE_ROW, opacity: e.free ? 1 : 0.55 }}>
            <Box sx={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, bgcolor: e.free ? '#2f9e6e' : C.muted }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ color: C.ink, fontSize: 14, fontWeight: 500 }}>{e.where}</Typography>
              <Typography sx={pictureNote}>{e.local} their time</Typography>
            </Box>
            <Box component="span" sx={{ px: 1.5, py: 0.5, borderRadius: 99, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', ...(e.free ? { bgcolor: C.accent, color: '#ffffff' } : { color: C.muted }) }}>
              {e.free ? 'Schedule' : 'Busy'}
            </Box>
          </Box>
        ))}
      </Stack>
    </Picture>
  );
}

/** A new call to confirm, as an Expert sees it. */
function ExpertPicture() {
  return (
    <Picture label="Illustration: a new call to confirm in the Expert's own time zone, beside their calendar">
      <Typography sx={pictureTitle}>New call to confirm</Typography>
      <Typography sx={{ ...pictureNote, mb: 1.75 }}>Tuesday, 3:00 PM your time · 60 minutes</Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
        <Box component="span" sx={{ px: 2, py: 0.75, borderRadius: 99, bgcolor: C.accent, color: '#ffffff', fontSize: 14, fontWeight: 600 }}>
          Confirm
        </Box>
        <Box component="span" sx={{ px: 2, py: 0.75, borderRadius: 99, border: `1px solid ${C.line}`, color: C.accent, fontSize: 14, fontWeight: 500 }}>
          Ask to move it
        </Box>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 0.75 }}>
        {[
          { day: 'Mon' },
          { day: 'Tue', call: true },
          { day: 'Wed' },
          { day: 'Thu' },
          { day: 'Fri', off: true },
        ].map((d) => (
          <Box
            key={d.day}
            sx={{
              height: 92,
              borderRadius: '10px',
              p: 0.75,
              bgcolor: C.tint,
              position: 'relative',
            }}
          >
            <Typography sx={{ ...pictureNote, fontSize: 12 }}>{d.day}</Typography>
            {d.call && <Box sx={{ position: 'absolute', left: 5, right: 5, top: 42, height: 30, borderRadius: '6px', bgcolor: C.accent }} />}
            {d.off && (
              <Box sx={{ position: 'absolute', left: 5, right: 5, top: 26, bottom: 5, borderRadius: '6px', border: `1px dashed ${C.muted}`, display: 'grid', placeItems: 'center' }}>
                <Typography sx={{ ...pictureNote, fontSize: 11 }}>Off</Typography>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Picture>
  );
}

/**
 * What a visitor sees at the site's address before signing in. Everything here
 * is public: it sells Silver Horizon, showing at a high level how Associates and
 * Experts work on it, with illustrations and no real data. There is nothing to
 * load, so it never waits on the server.
 */
export default function LandingPage() {
  return (
    <Box className="light" sx={{ minHeight: '100vh', bgcolor: C.page, color: C.ink, overflowX: 'hidden', '& ::selection': { bgcolor: C.accent, color: '#ffffff' } }}>
      {/* ---------------- first screen ---------------- */}
      <Box component="section" sx={{ position: 'relative', minHeight: { xs: 720, md: '100vh' }, display: 'flex', flexDirection: 'column', pb: { xs: 3, md: 5 } }}>
        <Horizon top={{ xs: '66%', md: '66%' }} />

        <Box component="header" sx={{ ...container, position: 'relative', pt: { xs: 2.5, md: 3.5 }, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box component="img" src="/brand/logo.png" alt="Silver Horizon" sx={{ height: { xs: 30, md: 36 }, width: 'auto', display: 'block' }} />
          <Stack direction="row" spacing={{ xs: 1, sm: 3 }} alignItems="center">
            <Box
              component="a"
              href="#how-it-works"
              sx={{ ...focusRing, display: { xs: 'none', sm: 'block' }, color: C.muted, fontSize: 14, fontWeight: 500, textDecoration: 'none', borderRadius: 1, '&:hover': { color: C.ink } }}
            >
              How it works
            </Box>
            <SignInButton />
          </Stack>
        </Box>

        <Box sx={{ ...container, position: 'relative', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', pt: { xs: 7, md: '9vh' } }}>
          <Typography
            component="h1"
            sx={{
              ...silverText,
              ...riseIn(),
              fontSize: 'clamp(42px, 7vw, 92px)',
              fontWeight: 600,
              lineHeight: 1.04,
              letterSpacing: '-0.04em',
              // Room for the g and p: the gradient text is clipped to this box.
              pb: '0.14em',
              '& span': { display: 'block' },
            }}
          >
            <span>Connecting expertise.</span> <span>Expanding perspective.</span>
          </Typography>
          <Typography
            sx={{
              ...riseIn(120),
              mt: { xs: 1.5, md: 2 },
              maxWidth: 620,
              color: C.accent,
              opacity: 0.86,
              fontSize: { xs: 17, md: 20 },
              lineHeight: 1.5,
            }}
          >
            A trusted platform for expert consulting, strategic connections, and professional insight.
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ ...riseIn(240), mt: { xs: 3, md: 3.5 } }}>
            <Button
              component="a"
              href="#how-it-works"
              endIcon={<ArrowDownwardRounded />}
              sx={{
                ...focusRing,
                px: 3.5,
                py: 1.4,
                fontSize: 16,
                fontWeight: 600,
                borderRadius: 99,
                color: '#ffffff',
                bgcolor: C.accent,
                boxShadow: '0 10px 34px rgba(28, 57, 85, 0.28)',
                transition: 'transform 160ms, background-color 160ms',
                '&:hover': { bgcolor: C.ink, transform: 'translateY(-1px)' },
              }}
            >
              See how it works
            </Button>
          </Stack>

          <Box sx={{ ...riseIn(380), width: '100%', maxWidth: 860, mt: 'auto', pt: { xs: 7, md: 6 } }}>
            <Journey />
          </Box>
        </Box>
      </Box>

      <Numbers />

      {/* ---------------- what it is ---------------- */}
      <Box component="section" aria-labelledby="what-heading" sx={{ ...container, pt: { xs: 9, md: 16 } }}>
        <Eyebrow>What we do</Eyebrow>
        <Typography id="what-heading" component="h2" sx={{ fontSize: 'clamp(32px, 4.6vw, 56px)', fontWeight: 600, lineHeight: 1.08, letterSpacing: '-0.03em', maxWidth: 820 }}>
          The answers that matter are held by people, not documents.
        </Typography>
        <Box sx={{ display: 'grid', gap: { xs: 1.5, md: 2 }, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, mt: { xs: 4, md: 7 } }}>
          {PILLARS.map((p) => (
            <Box
              key={p.title}
              sx={{
                p: { xs: 3, md: 4 },
                borderRadius: '24px',
                border: `1px solid ${C.line}`,
                background: `linear-gradient(160deg, ${C.tint}, ${C.surface} 55%)`,
              }}
            >
              <Typography component="h3" sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 600, letterSpacing: '-0.02em', mb: 1.25 }}>
                {p.title}
              </Typography>
              <Typography sx={{ color: C.muted, fontSize: 16, lineHeight: 1.55 }}>{p.body}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ---------------- who does what ---------------- */}
      <Box component="section" id="how-it-works" aria-labelledby="how-heading" sx={{ ...container, pt: { xs: 9, md: 16 }, scrollMarginTop: 24 }}>
        <Eyebrow>How it works</Eyebrow>
        <Typography id="how-heading" component="h2" sx={{ fontSize: 'clamp(32px, 4.6vw, 56px)', fontWeight: 600, lineHeight: 1.08, letterSpacing: '-0.03em', maxWidth: 820 }}>
          Everyone on a call, working from the same page.
        </Typography>
        <Stack spacing={{ xs: 2, md: 3 }} sx={{ mt: { xs: 4, md: 7 } }}>
          {ROLES.map((r, i) => (
            <Box
              key={r.role}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                gap: { xs: 3, md: 6 },
                alignItems: 'center',
                p: { xs: 3, md: 6 },
                borderRadius: '28px',
                border: `1px solid ${C.line}`,
                background: `linear-gradient(160deg, ${C.tint}, ${C.surface} 60%)`,
              }}
            >
              <Box sx={{ order: { md: i % 2 } }}>
                <Typography component="p" sx={{ color: C.accent, fontSize: 15, fontWeight: 600, mb: 1.25 }}>
                  {r.role}
                </Typography>
                <Typography component="h3" sx={{ fontSize: 'clamp(26px, 3vw, 38px)', fontWeight: 600, lineHeight: 1.12, letterSpacing: '-0.025em', mb: { xs: 2.5, md: 3 } }}>
                  {r.title}
                </Typography>
                <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {r.points.map((point) => (
                    <Stack key={point} component="li" direction="row" spacing={1.25} alignItems="flex-start">
                      <CheckRounded sx={{ fontSize: 20, color: C.accent, mt: 0.2, flexShrink: 0 }} />
                      <Typography sx={{ color: C.muted, fontSize: 16, lineHeight: 1.5 }}>{point}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
              {r.picture === 'associate' ? <AssociatePicture /> : <ExpertPicture />}
            </Box>
          ))}
        </Stack>
      </Box>

      {/* ---------------- the path of a call ---------------- */}
      <Box component="section" aria-labelledby="path-heading" sx={{ ...container, pt: { xs: 9, md: 16 } }}>
        <Eyebrow>The path of a call</Eyebrow>
        <Typography id="path-heading" component="h2" sx={{ fontSize: 'clamp(32px, 4.6vw, 56px)', fontWeight: 600, lineHeight: 1.08, letterSpacing: '-0.03em' }}>
          From first booking to paid.
        </Typography>
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, mt: { xs: 3, md: 6 }, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: { md: 4 } }}>
          {STEPS.map((s, i) => (
            <Box component="li" key={s.title} sx={{ borderTop: `1px solid ${C.line}`, pt: 2.5, pb: { xs: 3.5, md: 0 } }}>
              <Stack direction="row" alignItems="center" spacing={1.25} sx={{ mb: { xs: 1.25, md: 3 } }}>
                <Typography sx={{ color: C.muted, fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>0{i + 1}</Typography>
                <Box component="span" sx={{ px: 1.25, py: 0.25, borderRadius: 99, border: `1px solid ${C.line}`, color: C.accent, fontSize: 12.5, fontWeight: 500 }}>
                  {s.who}
                </Box>
              </Stack>
              <Typography component="h3" sx={{ fontSize: { xs: 24, md: 28 }, fontWeight: 600, letterSpacing: '-0.02em', mb: 1 }}>
                {s.title}
              </Typography>
              <Typography sx={{ color: C.muted, fontSize: 16, lineHeight: 1.55 }}>{s.body}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ---------------- closing ---------------- */}
      <Box component="section" aria-labelledby="close-heading" sx={{ position: 'relative', mt: { xs: 8, md: 14 }, pt: { xs: 9, md: 14 }, pb: { xs: 22, md: 30 }, textAlign: 'center' }}>
        <Horizon top={{ xs: '74%', md: '72%' }} />
        <Box sx={{ ...container, position: 'relative' }}>
          <Typography id="close-heading" component="h2" sx={{ ...silverText, fontSize: 'clamp(36px, 6vw, 76px)', fontWeight: 600, lineHeight: 1.05, letterSpacing: '-0.035em' }}>
            See further.
          </Typography>
          <Typography sx={{ color: C.accent, opacity: 0.86, fontSize: { xs: 16, md: 18 }, mt: 2, mb: 3.5 }}>Accounts are by invitation.</Typography>
          <SignInButton large />
        </Box>
      </Box>

      <Box component="footer" sx={{ ...container, position: 'relative', py: 3, borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Box component="img" src="/brand/logo.png" alt="" sx={{ height: 22, width: 'auto', display: 'block', opacity: 0.75 }} />
        <Typography sx={{ color: C.muted, fontSize: 13 }}>© {new Date().getFullYear()} Silver Horizon</Typography>
      </Box>
    </Box>
  );
}
