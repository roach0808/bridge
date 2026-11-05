import { Box } from '@mui/material';
import { keyframes } from '@mui/material/styles';

/** The public pages keep one look, whatever colour scheme the app is set to. */
export const PUBLIC_COLORS = {
  night: '#071019',
  navy: '#0d1c2b',
  panel: 'rgba(255, 255, 255, 0.04)',
  line: 'rgba(214, 226, 240, 0.14)',
  silver: '#d6e2f0',
  text: '#f2f5f9',
  muted: '#9db0c5',
  glow: '#eaf2fb',
} as const;

const rise = keyframes`
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: none; }
`;

const breathe = keyframes`
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
`;

/** Eases a block into place on load, a little after the ones before it. Still for those who ask for less motion. */
export const riseIn = (delay = 0) => ({
  animation: `${rise} 800ms cubic-bezier(0.2, 0.7, 0.2, 1) ${delay}ms both`,
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
});

/**
 * The brand's silver horizon: the curve of a dark planet with light along its
 * edge. Decoration only, drawn in CSS, so the page has nothing to wait for.
 * `top` is where the crest of the curve sits.
 */
export function Horizon({ top }: { top: string | Record<string, string> }) {
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {/* Sky: the light rising behind the curve. */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(70% 55% at 50% 62%, rgba(92, 132, 178, 0.34), transparent 70%)`,
        }}
      />
      {/* The planet. */}
      <Box
        sx={{
          position: 'absolute',
          top,
          left: '50%',
          width: { xs: '260vw', md: '190vw' },
          aspectRatio: '1',
          transform: 'translateX(-50%)',
          borderRadius: '50%',
          background: `linear-gradient(180deg, #16293d 0%, ${PUBLIC_COLORS.night} 16%)`,
          boxShadow: `0 -1px 0 rgba(234, 242, 251, 0.85), 0 -10px 40px rgba(190, 214, 240, 0.34), 0 -50px 140px rgba(120, 165, 215, 0.26)`,
          animation: `${breathe} 9s ease-in-out infinite`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: 0.9 },
        }}
      />
      {/* The glint where the light breaks over the edge. */}
      <Box
        sx={{
          position: 'absolute',
          top,
          left: '50%',
          width: { xs: 320, md: 720 },
          height: { xs: 70, md: 110 },
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(50% 50% at 50% 50%, rgba(255, 255, 255, 0.85), rgba(190, 214, 240, 0.28) 34%, transparent 72%)`,
          filter: 'blur(5px)',
        }}
      />
    </Box>
  );
}
