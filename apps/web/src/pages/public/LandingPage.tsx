import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import { Box, Button, Stack, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { PUBLIC_COLORS as C, riseIn } from './Horizon';

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

// ---- The page's system: one measure, one display face, one hairline. --------------

const MEASURE = 1240;
const GUTTER = 'max(20px, 4vw)';
const container = { width: `calc(100% - 2 * ${GUTTER})`, maxWidth: MEASURE, mx: 'auto' } as const;
/** Set on the measure's fourth column of five, which the path, the figures and the lists all share. */
const fourthColumn = { ml: { md: 'auto' }, width: { md: '40%' } } as const;
/** Sections breathe by the same amount all the way down. */
const SECTION_GAP = { xs: 10, md: 20 };

const DISPLAY = '"Newsreader Variable", "Iowan Old Style", Georgia, serif';
const display = {
  fontFamily: DISPLAY,
  fontOpticalSizing: 'auto',
  fontWeight: 400,
  fontFeatureSettings: '"lnum"',
  letterSpacing: '-0.022em',
  color: C.ink,
} as const;
const h2 = { ...display, fontSize: 'clamp(36px, 5vw, 68px)', lineHeight: 1.04, textWrap: 'balance' } as const;

const hairline = `1px solid ${C.line}`;
const focusRing = { '&:focus-visible': { outline: `2px solid ${C.accent}`, outlineOffset: 3 } } as const;
const QUIET = '160ms cubic-bezier(0.2, 0.7, 0.2, 1)';

const drawLine = keyframes`
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
`;

// ---- Small parts -----------------------------------------------------------------

/** Solid and square-shouldered: the page's one strong action, in navy or, on the navy ground, in paper. */
function ActionButton({ children, to, href, inverse, down }: { children: ReactNode; to?: string; href?: string; inverse?: boolean; down?: boolean }) {
  const Arrow = down ? ArrowDownwardRounded : ArrowForwardRounded;
  return (
    <Button
      {...(to ? { component: RouterLink, to } : { component: 'a', href })}
      endIcon={<Arrow sx={{ transition: `transform ${QUIET}` }} />}
      sx={{
        ...(inverse ? { '&:focus-visible': { outline: `2px solid ${C.paperOnGround}`, outlineOffset: 3 } } : focusRing),
        px: 2.75,
        py: 1.375,
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: '0.005em',
        borderRadius: '2px',
        boxShadow: 'none',
        color: inverse ? C.ground : '#ffffff',
        bgcolor: inverse ? C.paperOnGround : C.accent,
        transition: `background-color ${QUIET}`,
        '&:hover': {
          boxShadow: 'none',
          bgcolor: inverse ? '#ffffff' : C.ink,
          '& .MuiButton-endIcon svg': { transform: down ? 'translateY(2px)' : 'translateX(3px)' },
        },
        '@media (prefers-reduced-motion: reduce)': { '&:hover .MuiButton-endIcon svg': { transform: 'none' } },
      }}
    >
      {children}
    </Button>
  );
}

/** Text with a rule that comes in under it on hover. */
const quietLink = {
  ...focusRing,
  color: C.ink,
  fontSize: 15,
  fontWeight: 500,
  textDecoration: 'none',
  borderRadius: '1px',
  backgroundImage: `linear-gradient(${C.ink}, ${C.ink})`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: '0 100%',
  backgroundSize: '0 1px',
  paddingBottom: '2px',
  transition: `background-size ${QUIET}`,
  '&:hover': { backgroundSize: '100% 1px' },
} as const;

function Eyebrow({ children }: { children: string }) {
  return (
    <Typography component="p" sx={{ color: C.muted, fontSize: 15, fontWeight: 500, mb: { xs: 2, md: 3 } }}>
      {children}
    </Typography>
  );
}

/** The path of a call, sitting on the horizon: one line across the whole screen. */
function Journey() {
  return (
    // The sky above ends on this line, so it starts a dot's half-height up into it.
    <Box role="img" aria-label={`The path of a call: ${JOURNEY.join(', ')}`} sx={{ position: 'relative', mt: '-5px' }}>
      <Box
        sx={{
          position: 'absolute',
          top: 4,
          left: 0,
          right: 0,
          height: '1px',
          bgcolor: C.accent,
          transformOrigin: 'left',
          animation: `${drawLine} 1400ms cubic-bezier(0.2, 0.7, 0.2, 1) both`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      />
      <Box sx={{ ...container, position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${JOURNEY.length}, minmax(0, 1fr))` }}>
        {JOURNEY.map((step, i) => {
          const last = i === JOURNEY.length - 1;
          return (
            <Box key={step} sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  bgcolor: last ? C.accent : C.page,
                  border: `1px solid ${C.accent}`,
                }}
              />
              <Typography sx={{ mt: 1.5, pr: 0.5, color: last ? C.ink : C.muted, fontSize: { xs: 'clamp(10.5px, 3.1vw, 12px)', sm: 14 }, fontWeight: last ? 500 : 400, lineHeight: 1.25 }}>{step}</Typography>
            </Box>
          );
        })}
      </Box>
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
  // All three hang from stops on the path above: the first, the third and the fourth.
  const wideSpans = figures.length === 3 ? [2, 1, 2] : [2, 2];
  return (
    <Box component="section" aria-label="What has been delivered so far" sx={{ ...container, pt: { xs: 6, md: 9 } }}>
      <Box
        sx={{
          display: 'grid',
          // A column grows if its figure ever outgrows it, rather than running into the next.
          gridTemplateColumns: { xs: 'repeat(2, minmax(min-content, 1fr))', sm: 'repeat(3, minmax(min-content, 1fr))', md: 'repeat(5, minmax(min-content, 1fr))' },
          rowGap: 3,
          // Room kept while the server wakes, so the page does not jump when it answers.
          ...(isLoading ? { minHeight: { xs: 168, sm: 94 } } : {}),
        }}
      >
        {figures.map((f, i) => (
          <Box key={f.label} sx={{ ...riseIn(i * 90), pr: { xs: 2, md: 3 }, gridColumn: { xs: figures.length === 3 && i === 2 ? 'span 2' : 'span 1', sm: 'span 1', md: `span ${wideSpans[i]}` } }}>
            <Typography sx={{ ...display, fontSize: 'clamp(42px, 4.6vw, 64px)', lineHeight: 1, fontVariantNumeric: 'lining-nums tabular-nums' }}>{f.value}</Typography>
            <Typography sx={{ color: C.muted, fontSize: 15, mt: 1 }}>{f.label}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ---- Fragments of the app, drawn for the page: illustrations with nothing real in them. ----

function Sheet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box role="img" aria-label={label} sx={{ width: '100%', maxWidth: { xs: 520, md: 'none' }, bgcolor: C.surface, border: hairline, borderRadius: '3px', minWidth: 0 }}>
      {children}
    </Box>
  );
}

const sheetHead = { px: { xs: 2, sm: 2.5 }, pt: { xs: 2, sm: 2.5 }, pb: 2, borderBottom: hairline } as const;
const sheetTitle = { color: C.ink, fontSize: 15, fontWeight: 600, letterSpacing: '-0.005em' } as const;
const sheetNote = { color: C.muted, fontSize: 13 } as const;
const sheetAction = { px: 1.5, py: 0.625, borderRadius: '2px', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' } as const;

/** Who is free for a time, as an Associate sees it. */
function AssociatePicture() {
  const experts = [
    { where: 'Expert in New York', local: '10:00 AM', free: true },
    { where: 'Expert in London', local: '3:00 PM', free: true },
    { where: 'Expert in Seoul', local: '11:00 PM', free: false },
  ];
  return (
    <Sheet label="Illustration: choosing a time and seeing which Experts are free, each in their own time zone">
      <Box sx={sheetHead}>
        <Typography sx={sheetTitle}>Who is free at 10:00 AM?</Typography>
        <Typography sx={sheetNote}>Tuesday · 60 minutes</Typography>
      </Box>
      {experts.map((e, i) => (
        <Stack key={e.where} direction="row" alignItems="center" spacing={1.5} sx={{ px: { xs: 2, sm: 2.5 }, py: 1.5, borderTop: i ? hairline : 'none', opacity: e.free ? 1 : 0.55 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ color: C.ink, fontSize: 14, fontWeight: 500 }}>{e.where}</Typography>
            <Typography sx={sheetNote}>{e.local} their time</Typography>
          </Box>
          <Box component="span" sx={{ ...sheetAction, ...(e.free ? { bgcolor: C.accent, color: '#ffffff' } : { color: C.muted, px: 0 }) }}>
            {e.free ? 'Schedule' : 'Busy'}
          </Box>
        </Stack>
      ))}
    </Sheet>
  );
}

/** A new call to confirm, as an Expert sees it. */
function ExpertPicture() {
  const days = [{ day: 'Mon' }, { day: 'Tue', call: true }, { day: 'Wed' }, { day: 'Thu' }, { day: 'Fri', off: true }];
  return (
    <Sheet label="Illustration: a new call to confirm in the Expert's own time zone, beside their calendar">
      <Box sx={sheetHead}>
        <Typography sx={sheetTitle}>New call to confirm</Typography>
        <Typography sx={{ ...sheetNote, mb: 1.75 }}>Tuesday, 3:00 PM your time · 60 minutes</Typography>
        <Stack direction="row" spacing={1}>
          <Box component="span" sx={{ ...sheetAction, bgcolor: C.accent, color: '#ffffff' }}>
            Confirm
          </Box>
          <Box component="span" sx={{ ...sheetAction, border: hairline, color: C.ink }}>
            Ask to move it
          </Box>
        </Stack>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        {days.map((d, i) => (
          <Box key={d.day} sx={{ position: 'relative', height: 124, borderLeft: i ? hairline : 'none', px: 1, pt: 1 }}>
            <Typography sx={{ ...sheetNote, fontSize: 12 }}>{d.day}</Typography>
            {d.call && <Box sx={{ position: 'absolute', left: 4, right: 4, top: 58, height: 34, borderRadius: '2px', bgcolor: C.accent }} />}
            {d.off && (
              <Box
                sx={{
                  position: 'absolute',
                  inset: '32px 0 0 0',
                  display: 'grid',
                  placeItems: 'center',
                  backgroundImage: `repeating-linear-gradient(135deg, ${C.line} 0 1px, transparent 1px 7px)`,
                }}
              >
                <Typography sx={{ ...sheetNote, fontSize: 12, bgcolor: C.surface, px: 0.75 }}>Off</Typography>
              </Box>
            )}
          </Box>
        ))}
      </Box>
    </Sheet>
  );
}

/**
 * What a visitor sees at the site's address before signing in. Everything here
 * is public: it sells Silver Horizon, showing at a high level how Associates and
 * Experts work on it, with illustrations and no real data. There is nothing to
 * load, so it never waits on the server.
 *
 * Its language is meant to carry into the app: type before decoration, a serif for
 * what is said and Inter for what is used, hairlines rather than boxes, square
 * shoulders, and navy kept for what matters.
 */
export default function LandingPage() {
  return (
    <Box className="light" sx={{ minHeight: '100vh', bgcolor: C.page, color: C.ink, overflowX: 'hidden', '& ::selection': { bgcolor: C.accent, color: '#ffffff' } }}>
      {/* ---------------- first screen: sky, and the horizon ---------------- */}
      <Box
        component="section"
        sx={{
          minHeight: { xs: 640, md: '92svh' },
          display: 'flex',
          flexDirection: 'column',
          // The sky deepens a little toward the horizon, and stops on it.
          background: `linear-gradient(180deg, ${C.page} 30%, #e4ebf3 100%)`,
        }}
      >
        <Box component="header" sx={{ ...container, pt: { xs: 2.5, md: 3.5 }, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box component="img" src="/brand/logo.png" alt="Silver Horizon" sx={{ height: { xs: 30, md: 36 }, width: 'auto', display: 'block' }} />
          <Stack direction="row" spacing={{ xs: 2.5, sm: 4 }} alignItems="center">
            <Box component="a" href="#how-it-works" sx={{ ...quietLink, display: { xs: 'none', sm: 'block' }, color: C.muted, '&:hover': { color: C.ink, backgroundSize: '100% 1px' } }}>
              How it works
            </Box>
            <Box component={RouterLink} to="/login" sx={quietLink}>
              Sign in
            </Box>
          </Stack>
        </Box>

        <Box sx={{ ...container, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', py: { xs: 6, md: 5 } }}>
          <Typography
            component="h1"
            sx={{
              ...display,
              ...riseIn(),
              fontSize: 'clamp(50px, 8.8vw, 132px)',
              lineHeight: 0.98,
              letterSpacing: '-0.032em',
              '& span': { display: 'block' },
              '& em': { fontStyle: 'italic', color: C.accent },
            }}
          >
            <span>Connecting expertise.</span> <span><em>Expanding perspective.</em></span>
          </Typography>
          {/* Set off to the right: the headline runs the full measure, its answer sits under its far end. */}
          <Box sx={{ ...riseIn(140), ...fourthColumn, mt: { xs: 3.5, md: 5 } }}>
            <Typography sx={{ color: C.ink, fontSize: { xs: 18, md: 20 }, lineHeight: 1.45, letterSpacing: '-0.005em', textWrap: 'pretty', mb: { xs: 3, md: 3.5 } }}>
              A trusted platform for expert consulting, strategic connections, and professional insight.
            </Typography>
            <ActionButton href="#how-it-works" down>
              See how it works
            </ActionButton>
          </Box>
        </Box>
      </Box>

      <Journey />

      <Numbers />

      {/* ---------------- what it is ---------------- */}
      <Box component="section" aria-labelledby="what-heading" sx={{ ...container, pt: SECTION_GAP }}>
        <Eyebrow>What we do</Eyebrow>
        <Typography id="what-heading" component="h2" sx={{ ...h2, maxWidth: 920 }}>
          The answers that matter are held by people, not documents.
        </Typography>
        <Box sx={{ mt: { xs: 5, md: 9 }, borderBottom: hairline }}>
          {PILLARS.map((p) => (
            <Box
              key={p.title}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(5, minmax(0, 1fr))' },
                rowGap: 1,
                py: { xs: 2.5, md: 3.5 },
                borderTop: hairline,
                alignItems: 'baseline',
              }}
            >
              <Typography component="h3" sx={{ ...display, fontSize: { xs: 26, md: 32 }, lineHeight: 1.15, letterSpacing: '-0.015em', gridColumn: { md: 'span 3' } }}>
                {p.title}
              </Typography>
              <Typography sx={{ color: C.muted, fontSize: { xs: 16, md: 17 }, lineHeight: 1.5, gridColumn: { md: 'span 2' } }}>{p.body}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ---------------- who does what ---------------- */}
      <Box component="section" id="how-it-works" aria-labelledby="how-heading" sx={{ pt: SECTION_GAP, scrollMarginTop: 24 }}>
        <Box sx={container}>
          <Eyebrow>How it works</Eyebrow>
          <Typography id="how-heading" component="h2" sx={{ ...h2, maxWidth: 820 }}>
            Everyone on a call, working from the same page.
          </Typography>
        </Box>
        <Stack spacing={{ xs: 7, md: 12 }} sx={{ mt: { xs: 6, md: 10 } }}>
          {ROLES.map((r, i) => {
            // The tinted ground runs off the screen, on alternating sides; what stands on it stays on the measure.
            const flipped = i % 2 === 1;
            return (
              <Box
                key={r.role}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: `${GUTTER} minmax(0, 1fr) ${GUTTER}`,
                    md: `minmax(${GUTTER}, 1fr) repeat(2, minmax(0, ${MEASURE / 2}px)) minmax(${GUTTER}, 1fr)`,
                  },
                  rowGap: { xs: 4, md: 0 },
                }}
              >
                <Box sx={{ gridRow: 1, gridColumn: { xs: 2, md: flipped ? 3 : 2 }, alignSelf: 'center', ...(flipped ? { pl: { md: 9 } } : { pr: { md: 9 } }) }}>
                  <Typography component="p" sx={{ color: C.muted, fontSize: 15, fontWeight: 500, mb: 1.5 }}>
                    {r.role}
                  </Typography>
                  <Typography component="h3" sx={{ ...display, fontSize: 'clamp(30px, 3.2vw, 44px)', lineHeight: 1.08, letterSpacing: '-0.02em', textWrap: 'balance', mb: { xs: 3, md: 4 } }}>
                    {r.title}
                  </Typography>
                  <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, borderBottom: hairline }}>
                    {r.points.map((point) => (
                      <Box component="li" key={point} sx={{ py: 1.5, borderTop: hairline, color: C.ink, fontSize: 16, lineHeight: 1.45 }}>
                        {point}
                      </Box>
                    ))}
                  </Box>
                </Box>
                <Box sx={{ gridRow: { xs: 2, md: 1 }, gridColumn: { xs: '1 / -1', md: flipped ? '1 / 3' : '3 / -1' }, bgcolor: C.tint }} />
                <Box
                  sx={{
                    gridRow: { xs: 2, md: 1 },
                    gridColumn: { xs: 2, md: flipped ? 2 : 3 },
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    py: { xs: 4, md: 9 },
                    ...(flipped ? { pr: { md: 7 } } : { pl: { md: 7 } }),
                  }}
                >
                  {r.picture === 'associate' ? <AssociatePicture /> : <ExpertPicture />}
                </Box>
              </Box>
            );
          })}
        </Stack>
      </Box>

      {/* ---------------- the path of a call ---------------- */}
      <Box component="section" aria-labelledby="path-heading" sx={{ ...container, pt: SECTION_GAP, pb: SECTION_GAP }}>
        <Eyebrow>The path of a call</Eyebrow>
        <Typography id="path-heading" component="h2" sx={h2}>
          From first booking to paid.
        </Typography>
        <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0, mt: { xs: 4, md: 8 }, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }, columnGap: 4 }}>
          {STEPS.map((s, i) => (
            <Box component="li" key={s.title} sx={{ borderTop: `1px solid ${C.accent}`, pt: 1.75, pb: { xs: 4, md: 0 } }}>
              <Typography sx={{ color: C.muted, fontSize: 14, fontVariantNumeric: 'tabular-nums', mb: { xs: 2, md: 5 } }}>
                0{i + 1}&ensp;·&ensp;{s.who}
              </Typography>
              <Typography component="h3" sx={{ ...display, fontSize: { xs: 28, md: 32 }, lineHeight: 1.12, letterSpacing: '-0.015em', mb: 1.25 }}>
                {s.title}
              </Typography>
              <Typography sx={{ color: C.muted, fontSize: 16, lineHeight: 1.5 }}>{s.body}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ---------------- closing: below the horizon, the page comes to ground ---------------- */}
      <Box sx={{ bgcolor: C.ground, color: C.paperOnGround }}>
        <Box component="section" aria-labelledby="close-heading" sx={{ ...container, pt: { xs: 9, md: 16 }, pb: { xs: 9, md: 14 } }}>
          <Typography
            id="close-heading"
            component="h2"
            sx={{ ...display, color: '#ffffff', fontStyle: 'italic', fontSize: 'clamp(64px, 12vw, 184px)', lineHeight: 0.95, letterSpacing: '-0.035em' }}
          >
            See further.
          </Typography>
          <Box sx={{ ...fourthColumn, mt: { xs: 5, md: 8 } }}>
            <Typography sx={{ color: C.paperOnGround, fontSize: { xs: 18, md: 20 }, lineHeight: 1.45, mb: { xs: 3, md: 3.5 } }}>Accounts are by invitation.</Typography>
            <ActionButton to="/login" inverse>
              Sign in
            </ActionButton>
          </Box>
        </Box>
        <Box component="footer" sx={{ borderTop: '1px solid rgba(232, 238, 245, 0.16)' }}>
          <Box sx={{ ...container, py: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box component="img" src="/brand/logo-dark.png" alt="" sx={{ height: 24, width: 'auto', display: 'block', opacity: 0.85 }} />
            <Typography sx={{ color: C.mutedOnGround, fontSize: 13 }}>© {new Date().getFullYear()} Silver Horizon</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
