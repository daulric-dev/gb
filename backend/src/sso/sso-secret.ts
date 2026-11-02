import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { authSecret } from '@/account/secret';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';
/** HKDF info: a key for this purpose only, never AUTH_SECRET itself. */
const INFO = 'gradebook:school-sso-secret:v1';

/** Whose secret it is: one school's app for one provider. */
export interface SsoSecretOwner {
  schoolId: string;
  provider: string;
}

function key(): Buffer {
  return Buffer.from(hkdfSync('sha256', authSecret(), Buffer.alloc(0), INFO, 32));
}

/**
 * Additional authenticated data: the school and the provider. A ciphertext
 * copied to another school's row, or another provider's, does not decrypt.
 */
function aad({ schoolId, provider }: SsoSecretOwner): Buffer {
  return Buffer.from(`school:${schoolId.toLowerCase()}\nprovider:${provider}`, 'utf8');
}

/**
 * Encrypt a school's client secret for public.school_sso_provider
 * (`v1:<iv>:<tag>:<ciphertext>`, base64).
 */
export function encryptSsoSecret(owner: SsoSecretOwner, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  cipher.setAAD(aad(owner));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ct].map((p) =>
    typeof p === 'string' ? p : p.toString('base64'),
  ).join(':');
}

/**
 * The plaintext, or null when the value cannot be decrypted - most often
 * because AUTH_SECRET changed since it was saved (the secret must then be
 * entered again), or because it was stored for another school or provider.
 */
export function decryptSsoSecret(owner: SsoSecretOwner, stored: string): string | null {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv(ALGO, key(), Buffer.from(parts[1], 'base64'));
    decipher.setAAD(aad(owner));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
