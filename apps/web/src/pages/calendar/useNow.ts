import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';

/** The current instant, refreshed on the minute boundary (then every `everyMs`). */
export function useNow(everyMs = 30_000): DateTime {
  const [now, setNow] = useState(() => DateTime.now());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const tick = () => setNow(DateTime.now());
    const align = setTimeout(() => {
      tick();
      interval = setInterval(tick, everyMs);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      clearTimeout(align);
      if (interval) clearInterval(interval);
    };
  }, [everyMs]);
  return now;
}
