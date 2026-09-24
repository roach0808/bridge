const KEY = 'god.deviceId';

/**
 * A name this browser gives itself, kept in local storage and sent with every
 * request so the audit trail can say which device an action came from. A
 * browser cannot read a MAC address — nothing on the web can — so this is the
 * closest honest stand-in: the server turns it into a readable label such as
 * `US-desktop-01`.
 *
 * It identifies the browser, not the person: it is a random token, it says
 * nothing about who is signed in, and clearing site data starts a new one.
 */
export function deviceId(): string | null {
  try {
    const known = localStorage.getItem(KEY);
    if (known) return known;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(KEY, token);
    return token;
  } catch {
    // Private mode, or storage turned off: the request simply goes unnamed.
    return null;
  }
}
