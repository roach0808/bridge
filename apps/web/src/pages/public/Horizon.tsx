import { keyframes } from '@mui/material/styles';

/*
 * The old silver-planet horizon and its palette lived here; the public pages now
 * draw the brand from `@/components/brand`, with the sky and the planet on the
 * landing page. What stays is the small entrance both pages share.
 */

const rise = keyframes`
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: none; }
`;

/** Eases a block into place on load, a little after the ones before it. Still for those who ask for less motion. */
export const riseIn = (delay = 0) => ({
  animation: `${rise} 800ms cubic-bezier(0.2, 0.7, 0.2, 1) ${delay}ms both`,
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
});
