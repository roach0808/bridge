/**
 * The sounds of a ring, made in the browser (no sound files): the person rung
 * hears a short bright phrase, the ringer a phone ringing out, each repeated
 * until it is stopped.
 *
 * Browsers only let a page make sound once the person has used it, so the first
 * tap, click or key anywhere in the app wakes the sound up (primeRingtone). A
 * ring that comes before that still shows; the tune starts at the next tap.
 */

type AudioContextClass = typeof AudioContext;
const Context: AudioContextClass | undefined =
  typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext);

let audio: AudioContext | null = null;

function context(): AudioContext | null {
  if (!Context) return null;
  audio ??= new Context();
  if (audio.state === 'suspended') void audio.resume().catch(() => undefined);
  return audio;
}

const WAKE_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/** Wakes the sound on the first use of the page, and again whenever the browser put it to sleep. */
export function primeRingtone() {
  const wake = () => {
    if (context()?.state === 'running') for (const e of WAKE_EVENTS) window.removeEventListener(e, wake, true);
  };
  for (const e of WAKE_EVENTS) window.addEventListener(e, wake, true);
}

/** Notes (MIDI numbers) and when each starts within the phrase, in seconds. */
const PHRASE: ReadonlyArray<readonly [note: number, at: number]> = [
  [76, 0],
  [79, 0.14],
  [84, 0.28],
  [79, 0.42],
  [76, 0.7],
  [79, 0.84],
  [84, 0.98],
  [88, 1.12],
];
/** One phrase and the pause after it. */
const LOOP_SECONDS = 2.4;

const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);

/** One bell-like note: a soft triangle with a quieter octave above, fading out fast. */
function bell(ac: AudioContext, out: AudioNode, note: number, at: number) {
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(1, at + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
  env.connect(out);
  for (const [type, mult, level] of [['triangle', 1, 1], ['sine', 2, 0.35]] as const) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = frequency(note) * mult;
    gain.gain.value = level;
    osc.connect(gain).connect(env);
    osc.start(at);
    osc.stop(at + 0.5);
  }
}

/** The ringback the ringer hears while waiting: the dual tone of a phone ringing out (440 + 480 Hz). */
function ringback(ac: AudioContext, out: AudioNode, at: number) {
  for (const start of [at, at + 0.6]) {
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(1, start + 0.02);
    env.gain.setValueAtTime(1, start + 0.4);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
    env.connect(out);
    for (const hz of [440, 480]) {
      const osc = ac.createOscillator();
      osc.frequency.value = hz;
      osc.connect(env);
      osc.start(start);
      osc.stop(start + 0.5);
    }
  }
}

/** Plays a sound every `period` seconds until what it returns is called. */
function loop(sound: (ac: AudioContext, out: AudioNode, at: number) => void, period: number, volume: number): () => void {
  const ac = context();
  if (!ac) return () => undefined;
  const out = ac.createGain();
  out.gain.value = volume;
  out.connect(ac.destination);
  let next = ac.currentTime + 0.05;
  // Plans a second ahead, so a busy tab doesn't stutter. While the sound is still
  // asleep the clock stands still, so nothing piles up before it wakes.
  const plan = () => {
    while (next < ac.currentTime + 1) {
      sound(ac, out, next);
      next += period;
    }
  };
  plan();
  const timer = window.setInterval(plan, 250);
  return () => {
    window.clearInterval(timer);
    out.gain.setTargetAtTime(0, ac.currentTime, 0.03);
    window.setTimeout(() => out.disconnect(), 400);
  };
}

/** Plays the tune over and over for the person rung; call what it returns to stop it. */
export const startRingtone = (volume = 0.25) => loop((ac, out, at) => PHRASE.forEach(([note, t]) => bell(ac, out, note, at + t)), LOOP_SECONDS, volume);

/** "Ring… ring…" for the ringer while the other person's screen rings; call what it returns to stop it. */
export const startRingback = (volume = 0.12) => loop(ringback, 3, volume);
