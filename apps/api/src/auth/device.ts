import type { Request } from 'express';

export interface DeviceInfo {
  deviceType: string;
  browser: string | null;
  os: string | null;
  ip: string | null;
  country: string | null;
}

/**
 * Enough of the user agent to recognise a session in a list ("Chrome on
 * Windows, desktop"). Deliberately small: nothing here is a security decision.
 */
export function parseUserAgent(ua: string | undefined): Pick<DeviceInfo, 'deviceType' | 'browser' | 'os'> {
  const agent = ua ?? '';
  const browser =
    /Edg\//.test(agent) ? 'Edge'
    : /OPR\/|Opera/.test(agent) ? 'Opera'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) && /Version\//.test(agent) ? 'Safari'
    : /Firefox\//.test(agent) ? 'Firefox'
    : null;
  const os =
    /Windows NT/.test(agent) ? 'Windows'
    : /iPhone|iPad|iPod/.test(agent) ? 'iOS'
    : /Mac OS X/.test(agent) ? 'macOS'
    : /Android/.test(agent) ? 'Android'
    : /Linux/.test(agent) ? 'Linux'
    : null;
  const deviceType =
    /iPad|Tablet/.test(agent) ? 'tablet'
    : /Mobi|iPhone|Android.*Mobile/.test(agent) ? 'mobile'
    : os
      ? 'desktop'
      : 'unknown';
  return { deviceType, browser, os };
}

/**
 * The country of the request, as the proxy in front of us reports it: Vercel
 * and Cloudflare both add a header. We never send addresses to a third party,
 * so without a proxy header the country is simply unknown.
 */
export function countryOf(req: Request): string | null {
  const header =
    req.get('x-vercel-ip-country') ?? req.get('cf-ipcountry') ?? req.get('x-country-code') ?? req.get('fly-client-country');
  const code = header?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
}

export function deviceOf(req: Request): DeviceInfo {
  return {
    ...parseUserAgent(req.get('user-agent')),
    // `trust proxy` (§ TRUST_PROXY) makes this the real client address.
    ip: req.ip ?? null,
    country: countryOf(req),
  };
}
