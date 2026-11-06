import '@fontsource-variable/montserrat/wght.css';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import GroupsOutlined from '@mui/icons-material/GroupsOutlined';
import PauseRounded from '@mui/icons-material/PauseRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import TravelExploreOutlined from '@mui/icons-material/TravelExploreOutlined';
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded';
import { Box, Button, Stack, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';
import { riseIn } from './Horizon';
import { CountUp, EASE, KineticText, MotionProvider, RevealText, calmRoot, playWhen, riseCard, tiltIn, useInView, useMotion, useMotionPreference, useTilt } from './motion';

/** What working with us brings: to Experts, to Associates, and to both. */
const BENEFITS = [
  {
    audience: 'For Experts',
    title: 'More of the right projects, fully prepared.',
    points: [
      'More projects than you could find alone, matched to the field you know from the inside.',
      'Calls at times that work for you, wherever in the world you are.',
      'Research prepared before each call, so your first-hand insight counts from the first minute.',
    ],
  },
  {
    audience: 'For Associates',
    title: 'Strong Experts behind every profile.',
    points: [
      'Experts who deliver high-quality consultations, call after call.',
      'Consistent quality builds each profile’s reputation, and brings more project invitations.',
      'Smooth communication with Experts, in one shared workflow from booking to settlement.',
    ],
  },
  {
    audience: 'For both',
    title: 'Clear payments, clear numbers.',
    points: [
      'Stable, transparent tracking of every payment, from invoice to bank.',
      'Bank support, so earnings arrive where they should.',
      'Statistics from our database that show what is working and where to grow.',
    ],
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
  { image: 'step-apply', who: 'Associate', title: 'Project application', body: 'A tailored application is submitted, addressing the client\u2019s screening questions.' },
  { image: 'step-client', who: 'Client', title: 'Client selection', body: 'The client reviews the responses and confirms the fit.' },
  { image: 'step-schedule', who: 'Associate', title: 'Scheduling', body: 'A time is agreed across time zones, and the consultation is arranged with the Expert.' },
  { image: 'step-call', who: 'Expert', title: 'Consultation', body: 'The Expert prepares, shares first-hand insight, and confirms the call\u2019s duration.' },
  { image: 'step-paid', who: 'All parties', title: 'Settlement', body: 'The engagement is invoiced, payment is received, and each party sees their earnings.' },
];

/** What one good engagement leaves behind, from the centre outward. */
const COMPOUND = [
  { title: 'Successful calls', body: 'Every consultation delivered well adds to a record clients can trust.' },
  { title: 'Greater credibility', body: 'A stronger record builds confidence in our Experts and in Silver Horizon.' },
  { title: 'More opportunities', body: 'Credibility opens the door to more projects, and the cycle begins again from a stronger position.' },
];

// ---- The brand: Silver Horizon's identity system. -----------------------------------

/** The brand palette, with a deeper teal where teal carries small text (contrast). */
const C = {
  navy: '#0B1630',
  navyDeep: '#060D1F',
  charcoal: '#1F242B',
  silver: '#C0C4CC',
  silverMuted: '#8F98AA',
  softWhite: '#F6F7F9',
  surface: '#FFFFFF',
  teal: '#5E8F8C',
  tealDeep: '#3F6E6B',
  tealLight: '#8FC1BD',
  /** The light where the sun meets the horizon. Light only, never text. */
  glow: '#F4B25B',
  ink: '#0B1630',
  muted: '#5A6474',
  line: 'rgba(11, 22, 48, 0.14)',
  lineOnNavy: 'rgba(192, 196, 204, 0.22)',
} as const;

const MEASURE = 1240;
const GUTTER = 'max(20px, 4vw)';
const container = { width: `calc(100% - 2 * ${GUTTER})`, maxWidth: MEASURE, mx: 'auto' } as const;
/** Sections breathe by the same amount all the way down. */
const SECTION_GAP = { xs: 10, md: 18 };

const HEADLINE = '"Montserrat Variable", Montserrat, "Helvetica Neue", Arial, sans-serif';
const heading = { fontFamily: HEADLINE, fontWeight: 600, letterSpacing: '-0.02em', color: C.ink } as const;
const h2 = { ...heading, fontSize: 'clamp(32px, 4.4vw, 58px)', lineHeight: 1.08, textWrap: 'balance' } as const;
/** Silver, as on the brand mark: for type on the navy ground. */
const silverText = {
  backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #E6E9EE 46%, #AEB4C0 56%, #DDE0E6 100%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
} as const;

const hairline = `1px solid ${C.line}`;
const focusRing = (color: string) => ({ '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: 3 } }) as const;
const QUIET = '160ms cubic-bezier(0.2, 0.7, 0.2, 1)';

const dawn = keyframes`
  from { opacity: 0; transform: translate(-50%, 12px) scaleX(0.6); }
  to { opacity: 1; transform: translate(-50%, 0) scaleX(1); }
`;

// ---- Small parts -----------------------------------------------------------------

/**
 * The SH monogram with its horizon arc, drawn so it stays sharp at any size.
 * `onDark` is the silver mark with a sunlit arc; otherwise the navy mark.
 */
function Monogram({ width, onDark = true, title }: { width: number | string | Record<string, number | string>; onDark?: boolean; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <Box component="svg" viewBox="0 0 220 132" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} sx={{ width, height: 'auto', display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`${id}-letters`} x1="0" y1="0" x2="0" y2="1">
          {onDark ? (
            <>
              <stop offset="0" stopColor="#FFFFFF" />
              <stop offset="0.46" stopColor="#E3E6EB" />
              <stop offset="0.56" stopColor="#A4ABB8" />
              <stop offset="1" stopColor="#D9DCE2" />
            </>
          ) : (
            <>
              <stop offset="0" stopColor="#3A4866" />
              <stop offset="0.5" stopColor="#0B1630" />
              <stop offset="1" stopColor="#1F2A44" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${id}-arc`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={onDark ? C.glow : '#8F98AA'} stopOpacity="0" />
          <stop offset="0.32" stopColor={onDark ? C.glow : '#8F98AA'} />
          <stop offset="0.62" stopColor={onDark ? '#FFF6E6' : C.navy} />
          <stop offset="0.86" stopColor={onDark ? C.glow : '#8F98AA'} />
          <stop offset="1" stopColor={onDark ? C.glow : '#8F98AA'} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-flare`}>
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.25" stopColor={C.glow} stopOpacity="0.75" />
          <stop offset="1" stopColor={C.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <text x="110" y="112" textAnchor="middle" fontFamily={HEADLINE} fontWeight="600" fontSize="128" letterSpacing="-1" fill={`url(#${id}-letters)`}>
        SH
      </text>
      <path d="M2,120 C58,72 150,52 218,86 C150,63 62,82 2,120 Z" fill={`url(#${id}-arc)`} />
      {onDark && <circle cx="138" cy="64" r="22" fill={`url(#${id}-flare)`} />}
    </Box>
  );
}

/** The mark beside the name, for the header and the footer. */
function Lockup({ onDark = true }: { onDark?: boolean }) {
  return (
    <Stack direction="row" alignItems="center" spacing={{ xs: 1.25, sm: 1.75 }} aria-label="Silver Horizon" role="img">
      <Monogram width={{ xs: 46, md: 54 }} onDark={onDark} />
      <Box sx={{ width: '1px', alignSelf: 'stretch', my: 0.75, bgcolor: onDark ? C.lineOnNavy : C.line }} />
      <Typography component="span" aria-hidden sx={{ fontFamily: HEADLINE, fontWeight: 500, fontSize: { xs: 12, md: 14 }, letterSpacing: '0.24em', color: onDark ? C.silver : C.ink, whiteSpace: 'nowrap' }}>
        SILVER HORIZON
      </Typography>
    </Stack>
  );
}

/** Square-shouldered, in teal; `ghost` is the quieter silver outline beside it on the navy. */
function ActionButton({ children, to, href, down, ghost }: { children: ReactNode; to?: string; href?: string; down?: boolean; ghost?: boolean }) {
  const Arrow = down ? ArrowDownwardRounded : ArrowForwardRounded;
  return (
    <Button
      {...(to ? { component: RouterLink, to } : { component: 'a', href })}
      endIcon={ghost ? undefined : <Arrow sx={{ transition: `transform ${QUIET}` }} />}
      sx={{
        ...focusRing(C.tealLight),
        px: 2.75,
        py: 1.375,
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: '0.01em',
        borderRadius: '3px',
        boxShadow: 'none',
        position: 'relative',
        overflow: 'hidden',
        transition: `background-color ${QUIET}, border-color ${QUIET}, transform ${QUIET}, box-shadow ${QUIET}`,
        // Hovering lifts it a little; pressing answers at once.
        '&:active': { transform: 'translateY(0) scale(0.98)' },
        ...(ghost
          ? { color: C.softWhite, border: `1px solid ${C.lineOnNavy}`, '&:hover': { transform: 'translateY(-1px)', borderColor: C.silver, bgcolor: 'rgba(255,255,255,0.04)' } }
          : {
              color: '#ffffff',
              bgcolor: C.tealDeep,
              // A band of light crosses the button on hover.
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)',
                transform: 'translateX(-120%)',
                transition: `transform 700ms ${EASE}`,
              },
              '&:hover': {
                transform: 'translateY(-1px)',
                bgcolor: '#355E5B',
                boxShadow: '0 10px 28px -10px rgba(94, 143, 140, 0.75)',
                '&::after': { transform: 'translateX(120%)' },
                '& .MuiButton-endIcon svg': { transform: down ? 'translateY(2px)' : 'translateX(3px)' },
              },
            }),
        '@media (prefers-reduced-motion: reduce)': { '&:hover .MuiButton-endIcon svg': { transform: 'none' } },
      }}
    >
      {children}
    </Button>
  );
}

/** Text with a rule that comes in under it on hover, on the navy. */
const headerLink = {
  ...focusRing(C.tealLight),
  color: C.silver,
  fontSize: 15,
  fontWeight: 500,
  textDecoration: 'none',
  borderRadius: '1px',
  backgroundImage: `linear-gradient(${C.silver}, ${C.silver})`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: '0 100%',
  backgroundSize: '0 1px',
  paddingBottom: '2px',
  transition: `background-size ${QUIET}, color ${QUIET}`,
  '&:hover': { backgroundSize: '100% 1px', color: '#ffffff' },
} as const;

/** Spaced capitals after a short teal rule, as the brand sheet labels its parts. */
function Eyebrow({ children, onDark }: { children: string; onDark?: boolean }) {
  return (
    <Typography
      component="p"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        color: onDark ? C.silver : C.ink,
        fontFamily: HEADLINE,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        mb: { xs: 2, md: 2.5 },
        '&::before': { content: '""', width: 28, height: '2px', bgcolor: onDark ? C.tealLight : C.teal, flexShrink: 0 },
      }}
    >
      {children}
    </Typography>
  );
}

/** The three promises on the horizon, as on the brand banner. */
/** The agency's idea, read left to right: what we give Experts, how, and what it brings. */
const IDEA = [
  { label: 'More opportunities', body: 'We open more projects to our Experts than they could find alone.', Icon: TravelExploreOutlined },
  { label: 'Strong support', body: 'Well-prepared Profiles and a dedicated Associate team stand behind every engagement.', Icon: GroupsOutlined },
  { label: 'More revenue', body: 'Each engagement delivered well grows what our Experts and our team earn.', Icon: TrendingUpRounded },
];

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
  const [ref, seen] = useInView<HTMLElement>(0.3);
  const plain = (n: number) => whole.format(n);
  // While counting, the income moves in whole thousands, as it is always shown rounded down.
  const money = (n: number) => `$${whole.format(Math.floor(n / 1000) * 1000)}+`;
  const figures = data
    ? [
        ...(data.deliveredCalls >= MIN_CALLS ? [{ value: data.deliveredCalls, format: plain, label: 'Calls delivered' }] : []),
        ...(data.hoursDelivered >= MIN_HOURS ? [{ value: data.hoursDelivered, format: plain, label: 'Hours of expertise' }] : []),
        ...(data.incomeAtLeast >= MIN_INCOME ? [{ value: data.incomeAtLeast, format: money, label: 'Total income on invoice' }] : []),
      ]
    : [];
  if (!isLoading && figures.length === 0) return null;
  return (
    <Box ref={ref} component="section" aria-label="What has been delivered so far" sx={{ ...container, position: 'relative', pt: { xs: 6, md: 7 } }}>
      <Box
        sx={{
          display: 'grid',
          maxWidth: 1000,
          mx: 'auto',
          // A column grows if its figure ever outgrows it, rather than running into the next.
          gridTemplateColumns: { xs: 'repeat(2, minmax(min-content, 1fr))', sm: `repeat(${Math.max(figures.length, 1)}, minmax(min-content, 1fr))` },
          rowGap: 4,
          // Room kept while the server wakes, so the page does not jump when it answers.
          ...(isLoading ? { minHeight: { xs: 196, sm: 104 } } : {}),
        }}
      >
        {figures.map((f, i) => (
          <Box
            key={f.label}
            sx={{
              ...riseIn(i * 90),
              textAlign: 'center',
              px: 1.5,
              gridColumn: { xs: figures.length === 3 && i === 2 ? 'span 2' : 'span 1', sm: 'span 1' },
              borderLeft: { sm: i ? `1px solid ${C.lineOnNavy}` : 'none' },
            }}
          >
            {/* Sized to its own text, so the silver covers every character however wide the figure grows. */}
            <Typography sx={{ ...heading, ...silverText, display: 'inline-block', fontSize: 'clamp(30px, 4.4vw, 60px)', lineHeight: 1.05, letterSpacing: '-0.025em', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              <CountUp value={f.value} format={f.format} play={seen} />
            </Typography>
            <Typography sx={{ color: C.silverMuted, fontSize: 13, fontWeight: 500, letterSpacing: '0.16em', textTransform: 'uppercase', mt: 1.25 }}>{f.label}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * The curve of the planet and the light along its edge, brightest where the sun
 * is about to rise. Decoration only, drawn in CSS.
 */
function Planet({ bigSun = false }: { bigSun?: boolean }) {
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: { xs: '340vw', sm: '220vw', md: '170vw' },
          aspectRatio: '1 / 1',
          borderRadius: '50%',
          background: `radial-gradient(50% 50% at 50% 50%, ${C.navyDeep} 92%, #0A1C45 98%, #12306A 100%)`,
          boxShadow: '0 -1px 0 rgba(214, 232, 255, 0.95), 0 -6px 18px rgba(140, 190, 255, 0.55), 0 -40px 90px rgba(70, 130, 255, 0.28), 0 -120px 200px rgba(40, 90, 200, 0.18)',
        }}
      />
      {/* The sunrise, on the crest: a wide warm sky, and the bright light where it meets the edge. */}
      <Box sx={{ position: 'absolute', inset: 0 }}>
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translate(-50%, 0)',
          ...(bigSun
            ? { width: { xs: '200vw', md: '120vw' }, height: { xs: 320, md: 560 }, mt: { xs: '-160px', md: '-280px' } }
            : { width: { xs: '120vw', md: '64vw' }, height: { xs: 140, md: 220 }, mt: { xs: '-70px', md: '-110px' } }),
          background: bigSun
            ? `radial-gradient(50% 50% at 50% 50%, rgba(255, 244, 225, 1) 0%, rgba(255, 214, 150, 0.9) 4%, rgba(244, 178, 91, 0.6) 11%, rgba(244, 150, 70, 0.28) 26%, rgba(220, 120, 60, 0.1) 45%, rgba(220, 120, 60, 0) 70%)`
            : `radial-gradient(50% 50% at 50% 50%, rgba(255, 236, 205, 0.95) 0%, rgba(244, 178, 91, 0.55) 9%, rgba(244, 150, 70, 0.18) 32%, rgba(244, 150, 70, 0) 70%)`,
          animation: `${dawn} 1600ms cubic-bezier(0.2, 0.7, 0.2, 1) both`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      />
      </Box>
      {bigSun && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: '50%',
            width: { xs: '90vw', md: '46vw' },
            height: { xs: 10, md: 14 },
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: 'radial-gradient(50% 50% at 50% 50%, rgba(255, 252, 245, 1) 0%, rgba(255, 220, 160, 0.85) 25%, rgba(244, 178, 91, 0) 100%)',
            filter: 'blur(1px)',
            animation: `${dawn} 1600ms cubic-bezier(0.2, 0.7, 0.2, 1) both`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />
      )}
    </Box>
  );
}

/** Reach widening from each success: rings of teal. No figures: it shows the idea, not a measurement. */
const ringGrow = keyframes`
  from { opacity: 0; transform: translateX(-50%) scale(0.35); }
  to { opacity: 1; transform: translateX(-50%) scale(1); }
`;

function Compounding() {
  const [ref, seen] = useInView<HTMLDivElement>(0.35);
  const rings = [
    { size: 100, fill: 'rgba(94, 143, 140, 0.18)', label: COMPOUND[2]!.title, at: 83, color: '#ffffff' },
    { size: 70, fill: 'rgba(94, 143, 140, 0.42)', label: COMPOUND[1]!.title, at: 52, color: '#ffffff' },
    { size: 40, fill: C.tealLight, label: COMPOUND[0]!.title, at: 13, color: C.ink },
  ];
  return (
    <Box
      ref={ref}
      role="img"
      aria-label={`Rings widening outward: ${COMPOUND.map((c) => c.title).join(', then ')}`}
      sx={{ position: 'relative', width: '100%', maxWidth: 600, ml: { md: 'auto' }, aspectRatio: '2 / 1' }}
    >
      {/* Each success widens the reach: the rings grow out from the centre, one after another. */}
      {rings.map((r, i) => (
        <Box
          key={r.label}
          sx={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            transformOrigin: '50% 100%',
            width: `${r.size}%`,
            aspectRatio: '2 / 1',
            borderRadius: '9999px 9999px 0 0',
            bgcolor: r.fill,
            animation: `${ringGrow} 900ms ${EASE} ${(rings.length - 1 - i) * 280}ms both`,
            ...playWhen(seen),
          }}
        />
      ))}
      {rings.map((r, i) => (
        <Typography
          key={r.label}
          aria-hidden
          sx={{ animation: `${riseCard} 600ms ${EASE} ${(rings.length - 1 - i) * 280 + 450}ms both`, ...playWhen(seen), position: 'absolute', left: 0, right: 0, bottom: `${r.at}%`, textAlign: 'center', color: r.color, fontSize: { xs: 11, sm: 13 }, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.2 }}
        >
          {r.label}
        </Typography>
      ))}
    </Box>
  );
}

// ---- Fragments of the app, drawn for the page: illustrations with nothing real in them. ----

function Sheet({ label, children }: { label: string; children: ReactNode }) {
  const [ref, seen] = useInView<HTMLDivElement>(0.3);
  return (
    <Box
      ref={ref}
      role="img"
      aria-label={label}
      sx={{
        width: '100%',
        maxWidth: { xs: 520, md: 'none' },
        bgcolor: C.surface,
        border: hairline,
        borderRadius: '6px',
        minWidth: 0,
        boxShadow: '0 24px 60px -30px rgba(6, 13, 31, 0.45)',
        // It tips up into place, with depth, as it reaches the screen; afterwards it lifts under the mouse.
        animation: `${tiltIn} 1000ms ${EASE} backwards`,
        ...playWhen(seen),
        transition: `transform 400ms ${EASE}, box-shadow 400ms ${EASE}`,
        '&:hover': { transform: 'translateY(-6px)', boxShadow: '0 36px 70px -30px rgba(6, 13, 31, 0.55)' },
      }}
    >
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
          <Box component="span" sx={{ ...sheetAction, ...(e.free ? { bgcolor: C.navy, color: '#ffffff' } : { color: C.muted, px: 0 }) }}>
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
          <Box component="span" sx={{ ...sheetAction, bgcolor: C.navy, color: '#ffffff' }}>
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
            {d.call && <Box sx={{ position: 'absolute', left: 4, right: 4, top: 58, height: 34, borderRadius: '2px', bgcolor: C.teal }} />}
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

/** Lets a visitor stop the page's motion; a device that asks for less motion has it off already. */
function MotionSwitch() {
  const { systemCalm, paused, setPaused } = useMotion();
  if (systemCalm) return <Typography sx={{ color: C.silverMuted, fontSize: 13 }}>Animations off, as your device asks</Typography>;
  return (
    <Button
      size="small"
      onClick={() => setPaused(!paused)}
      startIcon={paused ? <PlayArrowRounded /> : <PauseRounded />}
      aria-pressed={paused}
      sx={{ ...focusRing(C.tealLight), color: C.silver, fontSize: 13, fontWeight: 500, textTransform: 'none', '&:hover': { color: '#ffffff', bgcolor: 'rgba(255,255,255,0.05)' } }}
    >
      {paused ? 'Play animations' : 'Pause animations'}
    </Button>
  );
}

/** The loop back from the last step to the first draws itself, from right to left. */
const drawBack = keyframes`
  from { clip-path: inset(0 0 0 100%); }
  to { clip-path: inset(0 0 0 0); }
`;

/** A faint field of stars, for depth behind the brand; it drifts more slowly than the page. */
/** The same sky on every visit: a small seeded generator, not Math.random. */
function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface Star {
  /** Across and down, as fractions of the sky. */
  x: number;
  y: number;
  radius: number;
  alpha: number;
  warm: boolean;
}

/** One layer of morning stars: more of them high in the sky. */
function starLayer(seed: number, count: number, size: [number, number], warmth = 0): Star[] {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => ({
    x: rand(),
    y: rand() ** 1.6 * 0.78,
    radius: size[0] + rand() * (size[1] - size[0]),
    alpha: 0.6 + rand() * 0.4,
    warm: rand() < warmth,
  }));
}

/**
 * Three layers that twinkle out of step with each other. They hold still until
 * the first screen has finished appearing (about 1.6 s), so the twinkling never
 * competes with the opening on a slower laptop.
 */
const STAR_LAYERS = [
  { stars: starLayer(11, 150, [0.8, 1.3]), duration: 7, delay: 1.8 },
  { stars: starLayer(23, 90, [1.1, 1.8], 0.15), duration: 9, delay: 2.6 },
  { stars: starLayer(37, 45, [1.5, 2.4], 0.25), duration: 11, delay: 3.4 },
];

/**
 * How bright a star may be where it stands: fading toward the dawn, and faint
 * behind the brand, the headline and the buttons, so none reads as a speck in the text.
 */
function skyAlpha(x: number, y: number, narrow: boolean) {
  const dawn = y < 0.48 ? 1 : y < 0.68 ? 1 - ((y - 0.48) / 0.2) * 0.55 : y < 0.84 ? 0.45 * (1 - (y - 0.68) / 0.16) : 0;
  const [cx, cy, rx, ry] = narrow ? [0.5, 0.36, 0.62, 0.3] : [0.5, 0.42, 0.34, 0.34];
  const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
  const clearing = d < 0.55 ? 0.12 : d < 1 ? 0.12 + ((d - 0.55) / 0.45) * 0.88 : 1;
  return dawn * clearing;
}

/**
 * A layer of stars painted once onto a canvas, and again only when the sky
 * changes size. Twinkling fades the whole canvas, which the browser does
 * without painting anything: hundreds of stars cost no more than one picture.
 */
function StarCanvas({ stars }: { stars: Star[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const paint = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const narrow = w < 900;
      for (const star of stars) {
        const alpha = star.alpha * skyAlpha(star.x, star.y, narrow);
        if (alpha < 0.02) continue;
        const x = star.x * w;
        const y = star.y * h;
        const color = star.warm ? '255, 226, 180' : '235, 242, 255';
        const glow = ctx.createRadialGradient(x, y, 0, x, y, star.radius);
        glow.addColorStop(0, `rgba(${color}, ${alpha})`);
        glow.addColorStop(1, `rgba(${color}, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(x - star.radius, y - star.radius, star.radius * 2, star.radius * 2);
      }
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [stars]);
  return <Box component="canvas" ref={ref} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />;
}

/** A few morning stars that outshine the rest, with a soft halo. */
const BRIGHT_STARS = [
  { x: 14, y: 18, size: 3 },
  { x: 31, y: 7, size: 2.4 },
  { x: 78, y: 12, size: 3.2 },
  { x: 88, y: 31, size: 2.2 },
  { x: 62, y: 5, size: 2.6 },
  { x: 6, y: 38, size: 2 },
  { x: 46, y: 24, size: 1.8 },
  { x: 94, y: 9, size: 2.4 },
  { x: 22, y: 46, size: 2 },
  { x: 70, y: 40, size: 2.2 },
  { x: 54, y: 15, size: 1.8 },
  { x: 38, y: 33, size: 2 },
  { x: 83, y: 50, size: 1.8 },
  { x: 3, y: 12, size: 2.2 },
];

const twinkle = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
`;

const glimmer = keyframes`
  0%, 100% { opacity: 0.95; transform: translate(-50%, -50%) scale(1); }
  50% { opacity: 0.45; transform: translate(-50%, -50%) scale(0.7); }
`;

/** The night sky before dawn: stars that twinkle, and fade out as the sky lightens toward the sun. Decoration only. */
function MorningStars() {
  return (
    <Box
      aria-hidden
      sx={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
      }}
    >
      {STAR_LAYERS.map((layer, i) => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            inset: 0,
            // Only the layer's opacity changes: nothing is painted again.
            willChange: 'opacity',
            animation: `${twinkle} ${layer.duration}s ease-in-out ${layer.delay}s infinite`,
          }}
        >
          <StarCanvas stars={layer.stars} />
        </Box>
      ))}
      {BRIGHT_STARS.map((star, i) => (
        <Box
          key={i}
          sx={{
            position: 'absolute',
            left: `${star.x}%`,
            top: `${star.y}%`,
            width: star.size,
            height: star.size,
            borderRadius: '50%',
            bgcolor: '#FFF7EA',
            boxShadow: `0 0 ${star.size * 3}px ${star.size}px rgba(255, 236, 205, 0.45), 0 0 ${star.size * 8}px ${star.size * 2}px rgba(160, 190, 255, 0.18)`,
            transform: 'translate(-50%, -50%)',
            willChange: 'transform, opacity',
            animation: `${glimmer} ${5 + (i % 4) * 1.7}s ease-in-out ${-i * 1.3}s infinite`,
            // Bright stars stay out of the text too.
            opacity: skyAlpha(star.x / 100, star.y / 100, false) < 0.5 ? 0 : undefined,
            display: skyAlpha(star.x / 100, star.y / 100, false) < 0.5 ? 'none' : undefined,
          }}
        />
      ))}
    </Box>
  );
}

/**
 * What a visitor sees at the site's address before signing in. Everything here
 * is public: it sells Silver Horizon, showing at a high level how Associates and
 * Experts work on it, with illustrations and no real data. Only the live figures
 * come from the server, and the page never waits for them.
 *
 * It wears the brand identity: the SH monogram on midnight navy with its sunlit
 * horizon, silver type, Montserrat for headlines and Inter for everything else,
 * soft white below the horizon, and teal for what moves the eye.
 */
export default function LandingPage() {
  const motion = useMotionPreference();
  // The monogram turns a little toward the mouse.
  const tilt = useTilt<HTMLDivElement>(motion.calm);
  const [stepsRef, stepsSeen] = useInView<HTMLOListElement>(0.12);
  const [loopRef, loopSeen] = useInView<HTMLDivElement>(0.8);
  return (
    <MotionProvider value={motion}>
    <Box
      className="light"
      data-calm={motion.calm || undefined}
      sx={{ ...calmRoot, minHeight: '100vh', bgcolor: C.softWhite, color: C.ink, overflowX: 'hidden', '& ::selection': { bgcolor: C.tealDeep, color: '#ffffff' } }}
    >
      {/* ---------------- first screen: the brand on the night sky, the planet's horizon ---------------- */}
      <Box
        component="section"
        onPointerMove={tilt.onPointerMove}
        onPointerLeave={tilt.onPointerLeave}
        sx={{
          position: 'relative',
          overflow: 'hidden',
          background: `radial-gradient(90% 60% at 50% 0%, #142A5C 0%, ${C.navy} 58%, ${C.navyDeep} 100%)`,
          color: C.softWhite,
        }}
      >
        <MorningStars />
        <Box component="header" sx={{ ...container, position: 'relative', pt: { xs: 2.5, md: 3 }, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Lockup />
          <Stack direction="row" spacing={{ xs: 2.5, sm: 4 }} alignItems="center">
            <Box component="a" href="#how-it-works" sx={{ ...headerLink, display: { xs: 'none', sm: 'block' } }}>
              How it works
            </Box>
            <Box component={RouterLink} to="/login" sx={{ ...headerLink, color: '#ffffff', fontWeight: 600 }}>
              Sign in
            </Box>
          </Stack>
        </Box>

        <Box
          sx={{
            ...container,
            position: 'relative',
            textAlign: 'center',
            pt: { xs: 6, md: 'clamp(16px, 4svh, 40px)' },
            pb: { xs: 8, md: 'clamp(28px, 6.5svh, 64px)' },
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <Box sx={{ ...riseIn(), perspective: '900px' }}>
            <Box ref={tilt.ref} sx={{ transform: 'rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))', transition: `transform 500ms ${EASE}`, willChange: 'transform' }}>
              <Monogram width={{ xs: 150, sm: 190, md: 'clamp(140px, 23svh, 210px)' }} />
            </Box>
          </Box>
          {/* The name assembles letter by letter. */}
          <Typography
            component="p"
            aria-hidden
            sx={{ fontFamily: HEADLINE, fontWeight: 500, fontSize: 'clamp(24px, 4.2vw, 56px)', letterSpacing: '0.18em', lineHeight: 1.1, mt: { xs: 2.5, md: 3 }, mr: '-0.18em', whiteSpace: 'nowrap' }}
          >
            <KineticText text="SILVER HORIZON" by="letter" delay={150} stagger={32} duration={650} pieceSx={silverText} />
          </Typography>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ ...riseIn(350), mt: { xs: 1.5, md: 2 }, width: '100%', maxWidth: 760 }}>
            <Box sx={{ flex: 1, height: '1px', bgcolor: C.lineOnNavy }} />
            <Typography sx={{ color: C.silver, fontSize: { xs: 10.5, sm: 12, md: 13 }, fontWeight: 500, letterSpacing: { xs: '0.18em', md: '0.3em' }, textTransform: 'uppercase' }}>
              The consulting collaboration platform
            </Typography>
            <Box sx={{ flex: 1, height: '1px', bgcolor: C.lineOnNavy }} />
          </Stack>
          <Typography component="h1" sx={{ ...heading, color: '#ffffff', fontWeight: 500, fontSize: 'clamp(22px, 2.6vw, 34px)', lineHeight: 1.3, letterSpacing: '-0.01em', mt: { xs: 4.5, md: 'clamp(18px, 3.8svh, 36px)' } }}>
            <KineticText text="Connecting expertise. Expanding perspective." delay={420} stagger={45} duration={650} />
          </Typography>
          <Typography sx={{ ...riseIn(650), color: C.silver, fontSize: { xs: 16, md: 18 }, lineHeight: 1.55, maxWidth: 640, mt: 1.5, textWrap: 'pretty' }}>
            We create more opportunities for our Experts. Backed by well-prepared Profiles and a dedicated Associate team, every engagement is set up to succeed, and to bring in more revenue.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ ...riseIn(750), mt: { xs: 3.5, md: 4 } }}>
            <ActionButton href="#how-it-works" down>
              See how it works
            </ActionButton>
            <ActionButton to="/login" ghost>
              Sign in
            </ActionButton>
          </Stack>
        </Box>

        {/* Below the horizon: the planet's dark side, where the idea and the figures stand. */}
        <Box sx={{ position: 'relative', pt: { xs: 6, md: 'clamp(26px, 5svh, 48px)' }, pb: { xs: 8, md: 10 } }}>
          <Planet bigSun />
          <Box
            component="ol"
            aria-label="Our idea"
            sx={{ ...container, position: 'relative', listStyle: 'none', p: 0, my: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, rowGap: 3.5, maxWidth: 1000 }}
          >
            {IDEA.map(({ label, body, Icon }, i) => (
              <Box
                component="li"
                key={label}
                sx={{
                  ...riseIn(850 + i * 100),
                  position: 'relative',
                  textAlign: 'center',
                  px: { xs: 1, sm: 2.5 },
                  borderLeft: { sm: i ? `1px solid ${C.lineOnNavy}` : 'none' },
                }}
              >
                {/* One leads to the next. */}
                {i > 0 && (
                  <ChevronRightRounded
                    aria-hidden
                    sx={{ display: { xs: 'none', sm: 'block' }, position: 'absolute', left: 0, top: 14, transform: 'translateX(-50%)', fontSize: 22, color: C.glow, bgcolor: C.navyDeep, borderRadius: '50%' }}
                  />
                )}
                <Icon sx={{ fontSize: { xs: 28, md: 32 }, color: C.glow, mb: 1 }} />
                <Typography component="h2" sx={{ color: C.softWhite, fontFamily: HEADLINE, fontSize: { xs: 13, md: 14 }, fontWeight: 600, letterSpacing: { xs: '0.14em', md: '0.2em' }, textTransform: 'uppercase', lineHeight: 1.4 }}>
                  {label}
                </Typography>
                <Typography sx={{ color: C.silver, fontSize: { xs: 14, md: 15 }, lineHeight: 1.5, mt: 0.75, maxWidth: 280, mx: 'auto' }}>{body}</Typography>
              </Box>
            ))}
          </Box>
          <Numbers />
        </Box>
      </Box>

      {/* ---------------- what it is ---------------- */}
      <Box component="section" aria-labelledby="what-heading" sx={{ ...container, pt: SECTION_GAP }}>
        <Eyebrow>What we do</Eyebrow>
        <Typography id="what-heading" component="h2" sx={{ ...h2, maxWidth: 900 }}>
          <RevealText text="We make every engagement worth more, for Experts and Associates alike." stagger={45} />
        </Typography>
        <Box sx={{ mt: { xs: 5, md: 8 }, borderBottom: hairline }}>
          {BENEFITS.map((b, i) => (
            <Box
              key={b.audience}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(5, minmax(0, 1fr))' },
                columnGap: 5,
                rowGap: 2,
                py: { xs: 3, md: 4.5 },
                borderTop: i === BENEFITS.length - 1 ? `2px solid ${C.teal}` : hairline,
              }}
            >
              <Box sx={{ gridColumn: { md: 'span 2' } }}>
                <Typography sx={{ color: i === BENEFITS.length - 1 ? C.tealDeep : C.muted, fontSize: 12, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', mb: 1 }}>{b.audience}</Typography>
                <Typography component="h3" sx={{ ...heading, fontSize: 'clamp(22px, 2.4vw, 32px)', lineHeight: 1.18, textWrap: 'balance' }}>
                  {b.title}
                </Typography>
              </Box>
              <Box component="ul" sx={{ gridColumn: { md: 'span 3' }, listStyle: 'none', m: 0, p: 0, display: 'grid', rowGap: 1.5, alignContent: 'start', pt: { md: 3.25 } }}>
                {b.points.map((point) => (
                  <Box
                    component="li"
                    key={point}
                    sx={{
                      position: 'relative',
                      pl: 3,
                      color: C.ink,
                      fontSize: { xs: 16, md: 17 },
                      lineHeight: 1.55,
                      '&::before': { content: '""', position: 'absolute', left: 0, top: '0.78em', width: 14, height: '2px', bgcolor: C.teal },
                    }}
                  >
                    {point}
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ---------------- people, across the whole screen ---------------- */}
      <Box
        component="img"
        src="/landing/room.webp"
        alt="A team around a meeting table, on a video call with colleagues on the wall screen"
        loading="lazy"
        width={2200}
        height={1323}
        sx={{ display: 'block', width: '100%', height: 'clamp(280px, 48vw, 760px)', objectFit: 'cover', objectPosition: '50% 62%', mt: { xs: 8, md: 14 } }}
      />

      {/* ---------------- who does what ---------------- */}
      <Box component="section" id="how-it-works" aria-labelledby="how-heading" sx={{ pt: SECTION_GAP, scrollMarginTop: 24 }}>
        <Box sx={container}>
          <Eyebrow>How it works</Eyebrow>
          <Typography id="how-heading" component="h2" sx={{ ...h2, maxWidth: 900 }}>
            <RevealText text="Everyone on a call, working from the same page." stagger={45} />
          </Typography>
        </Box>
        <Stack spacing={{ xs: 7, md: 12 }} sx={{ mt: { xs: 6, md: 10 } }}>
          {ROLES.map((r, i) => {
            // The ground runs off the screen, on alternating sides; what stands on it stays on the measure.
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
                  <Eyebrow>{r.role}</Eyebrow>
                  <Typography component="h3" sx={{ ...heading, fontSize: 'clamp(26px, 3vw, 40px)', lineHeight: 1.15, textWrap: 'balance', mb: { xs: 3, md: 4 } }}>
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
                <Box
                  sx={{
                    gridRow: { xs: 2, md: 1 },
                    gridColumn: { xs: '1 / -1', md: flipped ? '1 / 3' : '3 / -1' },
                    background: flipped
                      ? `linear-gradient(160deg, ${C.teal} 0%, ${C.tealDeep} 100%)`
                      : `radial-gradient(80% 90% at 30% 110%, #17346E 0%, ${C.navy} 60%)`,
                  }}
                />
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

      {/* ---------------- one engagement, and its way back to the start ---------------- */}
      <Box component="section" aria-labelledby="path-heading" sx={{ ...container, pt: SECTION_GAP, pb: { xs: 8, md: 12 } }}>
        <Eyebrow>One engagement</Eyebrow>
        <Typography id="path-heading" component="h2" sx={h2}>
          <RevealText text="From application to settlement." stagger={45} />
        </Typography>
        <Box ref={stepsRef} component="ol" sx={{ listStyle: 'none', m: 0, p: 0, mt: { xs: 4, md: 8 }, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', lg: 'repeat(5, minmax(0, 1fr))' }, columnGap: 3, rowGap: { sm: 5 } }}>
          {STEPS.map((s, i) => {
            const last = i === STEPS.length - 1;
            return (
              <Box
                component="li"
                key={s.title}
                sx={{
                  pb: { xs: 4, sm: 0 },
                  animation: `${riseCard} 700ms ${EASE} ${i * 110}ms backwards`,
                  ...playWhen(stepsSeen),
                  '&:hover img': { transform: 'scale(1.05)' },
                  '&:hover [data-step-number]': { color: C.tealDeep },
                }}
              >
                <Box sx={{ overflow: 'hidden', borderRadius: '4px', mb: 2.5 }}>
                  <Box component="img" src={`/landing/${s.image}.webp`} alt="" loading="lazy" width={1200} height={900} sx={{ display: 'block', width: '100%', height: 'auto', transition: `transform 700ms ${EASE}` }} />
                </Box>
                <Box sx={{ borderTop: `2px solid ${last ? C.teal : C.navy}`, pt: 2 }}>
                  <Typography data-step-number sx={{ ...heading, transition: `color 300ms ${EASE}`, color: last ? C.tealDeep : C.silverMuted, fontSize: 'clamp(44px, 4.4vw, 64px)', lineHeight: 1, fontVariantNumeric: 'tabular-nums', mb: 1.5 }}>0{i + 1}</Typography>
                  <Typography sx={{ color: C.muted, fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', mb: { xs: 1, md: 1.5 } }}>{s.who}</Typography>
                  <Typography component="h3" sx={{ ...heading, fontSize: { xs: 22, lg: 21 }, lineHeight: 1.2, mb: 1 }}>
                    {s.title}
                  </Typography>
                  <Typography sx={{ color: C.muted, fontSize: { xs: 16, lg: 15 }, lineHeight: 1.55 }}>{s.body}</Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
        {/* The line that makes it a cycle: out of the last step and back up into the first. */}
        {/* Watched from outside: a fully clipped element never counts as on the screen. */}
        <Box ref={loopRef}>
        <Box
          sx={{
            position: 'relative',
            mt: { xs: 2, sm: 5 },
            height: { xs: 48, md: 64 },
            borderLeft: `2px solid ${C.teal}`,
            borderRight: `2px solid ${C.teal}`,
            borderBottom: `2px solid ${C.teal}`,
            animation: `${drawBack} 1600ms ${EASE} both`,
            ...playWhen(loopSeen),
          }}
        >
          <Box sx={{ position: 'absolute', top: -2, left: -8, width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderBottom: `11px solid ${C.teal}` }} />
          <Typography sx={{ position: 'absolute', left: '50%', bottom: 0, transform: 'translate(-50%, 50%)', bgcolor: C.softWhite, px: { xs: 1.5, md: 3 }, color: C.ink, fontSize: { xs: 14, md: 16 }, fontWeight: 600, textAlign: 'center', width: 'max-content', maxWidth: { xs: '66%', sm: '84%' } }}>
            Each success strengthens the next engagement
          </Typography>
        </Box>
        </Box>
      </Box>

      {/* ---------------- why it compounds ---------------- */}
      <Box component="section" aria-labelledby="compound-heading" sx={{ background: `radial-gradient(70% 90% at 85% 100%, #133063 0%, ${C.navy} 60%)` }}>
        <Box sx={{ ...container, pt: { xs: 8, md: 13 }, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, columnGap: 7, rowGap: 6 }}>
          <Box sx={{ pb: { md: 13 } }}>
            <Eyebrow onDark>How credibility compounds</Eyebrow>
            <Typography id="compound-heading" component="h2" sx={{ ...h2, color: '#ffffff', fontSize: 'clamp(30px, 3.8vw, 50px)' }}>
              <RevealText text="Every successful call earns the next." stagger={45} />
            </Typography>
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, mt: { xs: 4, md: 6 } }}>
              {COMPOUND.map((c) => (
                <Box component="li" key={c.title} sx={{ py: 2.25, borderTop: `1px solid ${C.lineOnNavy}` }}>
                  <Typography component="h3" sx={{ ...heading, color: '#ffffff', fontSize: 20, lineHeight: 1.25, mb: 0.5 }}>
                    {c.title}
                  </Typography>
                  <Typography sx={{ color: C.silver, fontSize: 16, lineHeight: 1.55 }}>{c.body}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
          <Box sx={{ alignSelf: 'end', minWidth: 0 }}>
            <Compounding />
          </Box>
        </Box>
      </Box>

      {/* ---------------- closing: back to the horizon ---------------- */}
      <Box component="section" aria-labelledby="close-heading" sx={{ position: 'relative', overflow: 'hidden', bgcolor: C.navyDeep, color: C.softWhite }}>
        <Box sx={{ ...container, position: 'relative', textAlign: 'center', pt: { xs: 9, md: 13 }, pb: { xs: 16, md: 22 } }}>
          <Typography id="close-heading" component="h2" sx={{ ...heading, fontSize: 'clamp(52px, 9vw, 128px)', lineHeight: 1, letterSpacing: '-0.03em' }}>
            <RevealText text="See further." by="letter" stagger={55} duration={900} pieceSx={silverText} />
          </Typography>
          <Typography sx={{ color: C.silver, fontSize: { xs: 17, md: 19 }, lineHeight: 1.5, mt: { xs: 2.5, md: 3 }, mb: { xs: 3.5, md: 4 } }}>Accounts are by invitation.</Typography>
          <ActionButton to="/login">Sign in</ActionButton>
        </Box>
        <Box sx={{ position: 'relative', height: { xs: 70, md: 110 } }}>
          <Planet />
        </Box>
      </Box>
      <Box component="footer" sx={{ bgcolor: C.navyDeep, borderTop: `1px solid ${C.lineOnNavy}` }}>
        <Box sx={{ ...container, py: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Lockup />
          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
            <MotionSwitch />
            <Typography sx={{ color: C.silverMuted, fontSize: 13 }}>© {new Date().getFullYear()} Silver Horizon</Typography>
          </Stack>
        </Box>
      </Box>
    </Box>
    </MotionProvider>
  );
}
