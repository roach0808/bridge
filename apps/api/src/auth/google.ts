import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';

export interface GoogleAccount {
  /** Google's permanent id for the account; unlike the email it never changes. */
  subject: string;
  email: string;
}

const client = new OAuth2Client();

/**
 * Checks the ID token the "Sign in with Google" button gave the browser: signed by Google,
 * issued for our client ID, not expired, and for an address Google has verified.
 * Returns null when any of that fails.
 */
export async function verifyGoogleCredential(credential: string): Promise<GoogleAccount | null> {
  if (!config.GOOGLE_CLIENT_ID) return null;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: config.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true) return null;
    return { subject: payload.sub, email: payload.email.toLowerCase() };
  } catch {
    return null;
  }
}
