import '@fontsource-variable/montserrat/wght.css';
import { Box, Stack, Typography } from '@mui/material';
import { useId } from 'react';

/**
 * Silver Horizon's identity: the palette, the SH monogram with its horizon arc,
 * and the lockup of the mark beside the name. The landing page, the Sign in page
 * and the app all draw the brand from here, and the icons in `public/` are
 * rendered from the same drawing.
 */

/** The brand palette, with a deeper teal where teal carries small text (contrast). */
export const BRAND = {
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

export const HEADLINE = '"Montserrat Variable", Montserrat, "Helvetica Neue", Arial, sans-serif';

/** Silver, as on the brand mark: for type on the navy ground. */
export const silverText = {
  backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #E6E9EE 46%, #AEB4C0 56%, #DDE0E6 100%)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
} as const;

/**
 * The letters S and H in Montserrat SemiBold, as outlines in the mark's 220 × 132
 * box, so the mark never waits for a font and looks the same everywhere.
 */
export const SH_PATH =
  'M 58.7 113.3 Q 48.2 113.3 38.6 110.3 Q 29 107.3 23.4 102.5 L 29.2 89.6 Q 34.6 93.9 42.5 96.7 Q 50.4 99.5 58.7 99.5 Q 65.8 99.5 70.1 98 Q 74.4 96.4 76.5 93.8 Q 78.5 91.1 78.5 87.8 Q 78.5 83.7 75.6 81.2 Q 72.7 78.8 68 77.3 Q 63.3 75.7 57.6 74.5 Q 51.9 73.2 46.2 71.5 Q 40.5 69.8 35.8 67 Q 31.1 64.2 28.2 59.6 Q 25.3 55.1 25.3 47.9 Q 25.3 40.6 29.2 34.5 Q 33.1 28.4 41.1 24.8 Q 49.1 21.1 61.4 21.1 Q 69.4 21.1 77.4 23.2 Q 85.3 25.2 91.3 29.1 L 86 42 Q 80 38.4 73.6 36.6 Q 67.2 34.9 61.2 34.9 Q 54.4 34.9 50.1 36.6 Q 45.7 38.2 43.7 41 Q 41.8 43.7 41.8 47.1 Q 41.8 51.2 44.7 53.7 Q 47.6 56.1 52.3 57.6 Q 57 59 62.7 60.3 Q 68.4 61.6 74.1 63.3 Q 79.8 65 84.5 67.7 Q 89.2 70.4 92.1 75 Q 95 79.6 95 86.6 Q 95 93.8 91 99.9 Q 87.1 106 79 109.6 Q 71 113.3 58.7 113.3 Z M 173.4 112 V 22.4 H 190 V 112 Z M 110.5 112 V 22.4 H 127.1 V 112 Z M 125.7 73.6 V 59.4 H 174.7 V 73.6 Z';

/** The horizon arc across the letters: a crescent, thickest where the sun rises. */
export const ARC_PATH = 'M2,120 C58,72 150,52 218,86 C150,63 62,82 2,120 Z';

/** Width over height of the mark's box. */
export const MARK_RATIO = 220 / 132;

type Size = number | string | Record<string, number | string>;

/**
 * The SH monogram with its horizon arc, sharp at any size. `onDark` is the
 * silver mark with a sunlit arc, for the navy ground; otherwise the navy mark.
 */
export function Monogram({ width, onDark = true, title }: { width: Size; onDark?: boolean; title?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <Box component="svg" viewBox="0 0 220 132" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} sx={{ width, height: 'auto', display: 'block', overflow: 'visible', flexShrink: 0 }}>
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
              <stop offset="0.5" stopColor={BRAND.navy} />
              <stop offset="1" stopColor="#1F2A44" />
            </>
          )}
        </linearGradient>
        <linearGradient id={`${id}-arc`} x1="0" y1="0" x2="1" y2="0">
          {/* On a light ground the arc is teal through slate, so it still reads at sidebar size. */}
          <stop offset="0" stopColor={onDark ? BRAND.glow : BRAND.muted} stopOpacity="0" />
          <stop offset="0.3" stopColor={onDark ? BRAND.glow : BRAND.muted} />
          <stop offset="0.62" stopColor={onDark ? '#FFF6E6' : BRAND.tealDeep} />
          <stop offset="0.86" stopColor={onDark ? BRAND.glow : BRAND.muted} />
          <stop offset="1" stopColor={onDark ? BRAND.glow : BRAND.muted} stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-flare`}>
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.25" stopColor={BRAND.glow} stopOpacity="0.75" />
          <stop offset="1" stopColor={BRAND.glow} stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={SH_PATH} fill={`url(#${id}-letters)`} />
      <path d={ARC_PATH} fill={`url(#${id}-arc)`} />
      {onDark && <circle cx="138" cy="64" r="22" fill={`url(#${id}-flare)`} />}
    </Box>
  );
}

/**
 * The mark beside the name. `markWidth` and `textSize` size it; the defaults are
 * the landing page's header.
 */
export function Lockup({
  onDark = true,
  markWidth = { xs: 46, md: 54 },
  textSize = { xs: 12, md: 14 },
  gap = { xs: 1.25, sm: 1.75 },
}: {
  onDark?: boolean;
  markWidth?: Size;
  textSize?: Size;
  gap?: number | Record<string, number>;
}) {
  return (
    <Stack direction="row" alignItems="center" spacing={gap} aria-label="Silver Horizon" role="img" sx={{ minWidth: 0 }}>
      <Monogram width={markWidth} onDark={onDark} />
      <Box sx={{ width: '1px', alignSelf: 'stretch', my: 0.75, bgcolor: onDark ? BRAND.lineOnNavy : BRAND.line, flexShrink: 0 }} />
      <Typography component="span" aria-hidden sx={{ fontFamily: HEADLINE, fontWeight: 500, fontSize: textSize, letterSpacing: '0.22em', color: onDark ? BRAND.silver : BRAND.ink, whiteSpace: 'nowrap' }}>
        SILVER HORIZON
      </Typography>
    </Stack>
  );
}
