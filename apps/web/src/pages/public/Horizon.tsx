import { Box } from '@mui/material';
import { keyframes } from '@mui/material/styles';

/** The public pages keep one look, whatever colour scheme the app is set to. */
export const PUBLIC_COLORS = {
  page: '#f7f9fc',
  surface: '#ffffff',
  tint: '#eef3f8',
  line: 'rgba(28, 57, 85, 0.14)',
  accent: '#1c3955',
  ink: '#12263b',
  muted: '#55687d',
} as const;

const rise = keyframes`
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: none; }
`;

const breathe = keyframes`
  0%, 100% { opacity: 0.88; }
  50% { opacity: 1; }
`;

/** Eases a block into place on load, a little after the ones before it. Still for those who ask for less motion. */
export const riseIn = (delay = 0) => ({
  animation: `${rise} 800ms cubic-bezier(0.2, 0.7, 0.2, 1) ${delay}ms both`,
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
});

/**
 * The brand's silver horizon: a bright sky over the curve of a silver planet,
 * with light along its edge. Decoration only, drawn in CSS, so the page has
 * nothing to wait for. `top` is where the crest of the curve sits.
 */
export function Horizon({ top }: { top: string | Record<string, string> }) {
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {/* Sky: the light rising behind the curve. */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(70% 55% at 50% 62%, rgba(255, 255, 255, 0.95), transparent 72%), linear-gradient(180deg, #ffffff 0%, #e6edf5 100%)`,
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
          background: `linear-gradient(180deg, #b9cbdd 0%, #dbe5ef 4%, ${PUBLIC_COLORS.page} 10%)`,
          boxShadow: `0 -1px 0 #ffffff, 0 -6px 30px rgba(255, 255, 255, 0.95), 0 -30px 110px rgba(120, 155, 195, 0.32)`,
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
          background: `radial-gradient(50% 50% at 50% 50%, #ffffff, rgba(255, 255, 255, 0.7) 34%, transparent 72%)`,
          filter: 'blur(5px)',
        }}
      />
    </Box>
  );
}
