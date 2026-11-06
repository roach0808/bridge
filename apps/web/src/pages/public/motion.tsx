import { Box, type SxProps, type Theme } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { createContext, useContext, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

/**
 * The landing page's motion: type that moves on the key messages, small
 * responses that confirm an action, and depth drawn in CSS. All of it stops for
 * a visitor whose device asks for reduced motion, or who pauses it on the page.
 *
 * Nothing moves with the scroll: moving layers over the twinkling stars made
 * scrolling stutter on ordinary laptops, so the sky stays still while you scroll.
 */

const STORE = 'sh.landing.motionPaused';
const REDUCE = '(prefers-reduced-motion: reduce)';

function readPaused() {
  try {
    return localStorage.getItem(STORE) === '1';
  } catch {
    return false;
  }
}

export interface MotionPreference {
  /** No motion at all: the device asks for it, or the visitor paused it. */
  calm: boolean;
  /** The device asks for reduced motion; the page cannot override that. */
  systemCalm: boolean;
  paused: boolean;
  setPaused: (paused: boolean) => void;
}

export function useMotionPreference(): MotionPreference {
  const [systemCalm, setSystemCalm] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(REDUCE).matches));
  const [paused, setPausedState] = useState(readPaused);
  useEffect(() => {
    const mq = window.matchMedia?.(REDUCE);
    if (!mq) return;
    const change = () => setSystemCalm(mq.matches);
    mq.addEventListener('change', change);
    return () => mq.removeEventListener('change', change);
  }, []);
  const setPaused = (next: boolean) => {
    setPausedState(next);
    try {
      localStorage.setItem(STORE, next ? '1' : '0');
    } catch {
      // A private window: it holds for this visit only.
    }
  };
  return { calm: systemCalm || paused, systemCalm, paused, setPaused };
}

const MotionContext = createContext<MotionPreference>({ calm: true, systemCalm: true, paused: false, setPaused: () => {} });
export const MotionProvider = MotionContext.Provider;
export const useMotion = () => useContext(MotionContext);

/** Every animation and transition below this stops when the page is calm. */
export const calmRoot = {
  '&[data-calm] *, &[data-calm] *::before, &[data-calm] *::after': { animation: 'none !important', transition: 'none !important' },
} as const;

/** True once the element has come into view; it then stays true. */
export function useInView<T extends Element>(threshold = 0.2): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (!('IntersectionObserver' in window)) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, threshold]);
  return [ref, seen];
}

/** Waits at its first frame until `play`; once calm, there is no animation and the element simply shows. */
export const playWhen = (play: boolean) => ({ animationPlayState: play ? 'running' : 'paused' }) as const;

export const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

// Fade and slide only: a blur here would have to be repainted every frame on every letter.
const rise = keyframes`
  from { opacity: 0; transform: translateY(0.5em); }
  to { opacity: 1; transform: none; }
`;

export const riseCard = keyframes`
  from { opacity: 0; transform: translateY(28px); }
  to { opacity: 1; transform: none; }
`;

export const tiltIn = keyframes`
  from { opacity: 0; transform: perspective(1200px) rotateX(16deg) translateY(36px); }
  to { opacity: 1; transform: perspective(1200px) rotateX(0deg) translateY(0); }
`;

/** Read by screen readers, invisible on screen. In pixels: a bare 1 here would mean 100% to MUI. */
const SR_ONLY = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/**
 * A line of type that assembles itself, word by word or letter by letter.
 * Screen readers get the line once, whole; the moving pieces are hidden from them.
 */
export function KineticText({
  text,
  by = 'word',
  play = true,
  delay = 0,
  stagger = 70,
  duration = 750,
  pieceSx,
}: {
  text: string;
  by?: 'word' | 'letter';
  play?: boolean;
  delay?: number;
  stagger?: number;
  duration?: number;
  /** Styles each moving piece; a gradient fill must be set here, not on the line. */
  pieceSx?: SxProps<Theme>;
}) {
  const parts = by === 'letter' ? [...text] : text.split(/(\s+)/);
  let n = 0;
  return (
    <>
      <Box component="span" sx={SR_ONLY}>
        {text}
      </Box>
      <Box component="span" aria-hidden>
        {parts.map((part, i) =>
          /^\s+$/.test(part) ? (
            <span key={i}>{part}</span>
          ) : (
            <Box
              key={i}
              component="span"
              sx={[
                { display: 'inline-block', whiteSpace: 'pre', animation: `${rise} ${duration}ms ${EASE} ${delay + n++ * stagger}ms both`, ...playWhen(play) },
                ...(Array.isArray(pieceSx) ? pieceSx : [pieceSx]),
              ]}
            >
              {part}
            </Box>
          ),
        )}
      </Box>
    </>
  );
}

/** Kinetic type that waits until it is on the screen: for section headlines. */
export function RevealText(props: Omit<Parameters<typeof KineticText>[0], 'play'>) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.4);
  return (
    <Box component="span" ref={ref}>
      <KineticText {...props} play={seen} />
    </Box>
  );
}

/**
 * A figure that counts up to its value once seen, and moves from the old value
 * to the new one when it changes. Room for the final figure is kept, so nothing
 * around it shifts while it counts.
 */
export function CountUp({ value, format, play }: { value: number; format: (n: number) => string; play: boolean }) {
  const { calm } = useMotion();
  const [shown, setShown] = useState(calm ? value : 0);
  const current = useRef(shown);
  useEffect(() => {
    if (calm) {
      current.current = value;
      setShown(value);
      return;
    }
    if (!play) return;
    const from = current.current;
    const start = performance.now();
    const duration = from === 0 ? 1600 : 900;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - k) ** 3;
      const next = Math.round(from + (value - from) * eased);
      current.current = next;
      setShown(next);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, play, calm]);
  return (
    <>
      <Box component="span" sx={SR_ONLY}>
        {format(value)}
      </Box>
      <Box component="span" aria-hidden sx={{ display: 'inline-grid' }}>
        <span style={{ gridArea: '1 / 1', visibility: 'hidden' }}>{format(value)}</span>
        <span style={{ gridArea: '1 / 1' }}>{format(shown)}</span>
      </Box>
    </>
  );
}

/**
 * Turns an element a few degrees toward the mouse, for depth. Touch and pens
 * leave it alone, and so does a calm page. Sets `--rx` and `--ry` on the target.
 */
export function useTilt<T extends HTMLElement>(calm: boolean, max = 9) {
  const ref = useRef<T>(null);
  const set = (rx: number, ry: number) => {
    ref.current?.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
    ref.current?.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
  };
  return {
    ref,
    onPointerMove: (e: PointerEvent) => {
      if (calm || e.pointerType !== 'mouse' || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const x = Math.max(-0.5, Math.min(0.5, (e.clientX - (r.left + r.width / 2)) / window.innerWidth));
      const y = Math.max(-0.5, Math.min(0.5, (e.clientY - (r.top + r.height / 2)) / window.innerHeight));
      set(-y * max * 2, x * max * 2);
    },
    onPointerLeave: () => set(0, 0),
  };
}

