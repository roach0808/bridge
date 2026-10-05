import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config';
import { logger } from '../logger';

/**
 * Bank passwords are stored encrypted (AES-256-GCM), so a database dump or
 * backup does not give them away. Stored as `v1:<iv>:<tag>:<ciphertext>`, base64.
 */
const VERSION = 'v1';

let cached: Buffer | null = null;
function key(): Buffer {
  if (cached) return cached;
  if (config.BANK_ENCRYPTION_KEY) {
    cached = createHash('sha256').update(config.BANK_ENCRYPTION_KEY).digest();
  } else {
    if (config.NODE_ENV === 'production') {
      logger.warn('BANK_ENCRYPTION_KEY is not set: bank passwords are encrypted with a key derived from JWT_SECRET');
    }
    cached = Buffer.from(hkdfSync('sha256', config.JWT_SECRET, 'god-bank-passwords', 'bank-password-v1', 32));
  }
  return cached;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** Null when the value cannot be read with the current key. */
export function decryptSecret(stored: string): string | null {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
