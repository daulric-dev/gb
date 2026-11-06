import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { authSecret, dataEncryptionKey } from './secret';

/**
 * AES-256-GCM for the secrets kept in the database, with the key chosen by
 * a prefix on the stored value:
 *
 * - `v1:<iv>:<tag>:<ct>` - key derived from AUTH_SECRET. Every value written
 *   before DATA_ENCRYPTION_KEY existed, and every value written while it is
 *   unset.
 * - `v2:<kid>:<iv>:<tag>:<ct>` - key derived from DATA_ENCRYPTION_KEY; `kid`
 *   is a short fingerprint of that key, so a value written under another
 *   DATA_ENCRYPTION_KEY is recognised as such (and does not decrypt).
 *
 * Each caller passes its own HKDF `info` (one key per purpose) and additional
 * authenticated data (the row the value belongs to). Decryption returns null
 * on any failure, never throws.
 */
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const LEGACY = 'v1';
const KEYED = 'v2';

function derive(ikm: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), info, 32));
}

/** Short public fingerprint of DATA_ENCRYPTION_KEY (not usable to recover it). */
export function dataKeyId(dek: string): string {
  return createHash('sha256').update('gradebook:data-key-id:v1\n').update(dek).digest('hex').slice(0, 12);
}

/** Which key a stored value was written with: `auth`, a data key id, or null when unrecognised. */
export function storedKeyId(stored: string): string | null {
  const parts = stored.split(':');
  if (parts.length === 4 && parts[0] === LEGACY) return 'auth';
  if (parts.length === 5 && parts[0] === KEYED && parts[1]) return parts[1];
  return null;
}

/** True when the value is written with DATA_ENCRYPTION_KEY as currently set. */
export function isSealedWithCurrentDataKey(stored: string): boolean {
  const dek = dataEncryptionKey();
  return dek !== null && storedKeyId(stored) === dataKeyId(dek);
}

export function sealSecret(info: string, aad: Buffer, plaintext: string): string {
  const dek = dataEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, derive((dek ?? authSecret()), info), iv);
  cipher.setAAD(aad);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const body = [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64'));
  return dek ? [KEYED, dataKeyId(dek), ...body].join(':') : [LEGACY, ...body].join(':');
}

export function openSecret(info: string, aad: Buffer, stored: string): string | null {
  const parts = stored.split(':');
  let ikm: string;
  let body: string[];
  // Key selection outside the try: a misconfigured key is an error, not "undecryptable".
  if (parts.length === 4 && parts[0] === LEGACY) {
    ikm = authSecret();
    body = parts.slice(1);
  } else if (parts.length === 5 && parts[0] === KEYED) {
    const dek = dataEncryptionKey();
    if (!dek || parts[1] !== dataKeyId(dek)) return null;
    ikm = dek;
    body = parts.slice(2);
  } else {
    return null;
  }
  try {
    const decipher = createDecipheriv(ALGO, derive(ikm, info), Buffer.from(body[0], 'base64'));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(body[1], 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body[2], 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
