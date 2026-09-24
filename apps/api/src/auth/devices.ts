import type { Request } from 'express';
import { prisma } from '../db';
import { logger } from '../logger';
import { countryOf, parseUserAgent } from './device';

/**
 * A browser remembers itself between visits and sends the token it made as
 * `X-Device-Id`; we give that token a name a person can read — `US-desktop-01`
 * — and keep it, so the audit trail can say which machine an action came from.
 *
 * A browser cannot read a MAC address, and nothing on the web can: the token is
 * the closest honest stand-in. It says "this browser again", not "this
 * computer" — a different browser, or cleared site data, is a new device.
 */
const TOKEN_HEADER = 'x-device-id';
/** A token is opaque to us; we only insist it is short and printable. */
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** token → device id, so a busy session does not look the device up every time. */
const cache = new Map<string, string>();
/** Nothing here is worth much memory: past this many browsers, start the cache again. */
const CACHE_MAX = 5_000;
/** device id → when we last wrote `lastSeenAt`, so we write it at most hourly. */
const touched = new Map<string, number>();
const TOUCH_EVERY = 60 * 60 * 1000;

export function deviceTokenOf(req: Request): string | null {
  const token = req.get(TOKEN_HEADER)?.trim();
  return token && TOKEN_RE.test(token) ? token : null;
}

/** `US-desktop-01`: where it is, what it is, and which one of those it is. */
function label(country: string | null, deviceType: string, n: number): string {
  return `${country ?? 'XX'}-${deviceType}-${String(n).padStart(2, '0')}`;
}

/**
 * The device this request came from, registering it the first time we see it.
 * Returns null when the browser sent no token (an old client, or a script).
 */
export async function deviceIdFor(req: Request): Promise<string | null> {
  const token = deviceTokenOf(req);
  if (!token) return null;
  const known = cache.get(token);
  if (known) {
    void touch(known);
    return known;
  }
  const country = countryOf(req);
  const { deviceType } = parseUserAgent(req.get('user-agent'));
  try {
    const existing = await prisma.device.findUnique({ where: { token }, select: { id: true } });
    const id = existing ? existing.id : await register(token, country, deviceType);
    if (cache.size >= CACHE_MAX) resetDeviceCache();
    cache.set(token, id);
    if (!existing) touched.set(id, Date.now());
    return id;
  } catch (err) {
    logger.warn({ err }, 'device lookup failed');
    return null;
  }
}

/**
 * Names the device after the ones already seen from that country on that kind
 * of machine. Two first-time requests can pick the same number, so the unique
 * label is the referee and we simply try the next one.
 */
async function register(token: string, country: string | null, deviceType: string): Promise<string> {
  const prefix = `${country ?? 'XX'}-${deviceType}-`;
  let n = (await prisma.device.count({ where: { label: { startsWith: prefix } } })) + 1;
  for (let attempt = 0; attempt < 5; attempt += 1, n += 1) {
    try {
      const created = await prisma.device.create({
        data: { token, label: label(country, deviceType, n), deviceType, country },
        select: { id: true },
      });
      return created.id;
    } catch (err) {
      // Someone else took either the label or the token in between.
      const taken = await prisma.device.findUnique({ where: { token }, select: { id: true } });
      if (taken) return taken.id;
      if (attempt === 4) throw err;
    }
  }
  throw new Error('unreachable');
}

/** Keeps `lastSeenAt` roughly current without a write on every request. */
async function touch(id: string): Promise<void> {
  const last = touched.get(id) ?? 0;
  if (Date.now() - last < TOUCH_EVERY) return;
  touched.set(id, Date.now());
  await prisma.device.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch((err) => {
    logger.warn({ err }, 'device touch failed');
  });
}

/** Tests and the seed start from a clean slate. */
export function resetDeviceCache(): void {
  cache.clear();
  touched.clear();
}
