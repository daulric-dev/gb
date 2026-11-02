import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { authSecret } from '@/account/secret';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';
/** HKDF info: a key for this purpose only (not the SSO secrets' key, not AUTH_SECRET). */
const INFO = 'gradebook:webhook-secret:v1';
/** Signing secrets are 32 random bytes, shown as `whsec_<base64url>`. */
export const SECRET_BYTES = 32;
export const SECRET_PREFIX = 'whsec_';

/** Whose secret it is: one webhook of one school. */
export interface WebhookSecretOwner {
  schoolId: string;
  webhookId: string;
}

function key(): Buffer {
  return Buffer.from(hkdfSync('sha256', authSecret(), Buffer.alloc(0), INFO, 32));
}

/**
 * Additional authenticated data: the school and the webhook. A ciphertext
 * copied onto another webhook's row (or another school's) does not decrypt.
 */
function aad({ schoolId, webhookId }: WebhookSecretOwner): Buffer {
  return Buffer.from(
    `school:${schoolId.toLowerCase()}\nwebhook:${webhookId.toLowerCase()}`,
    'utf8',
  );
}

/** A new signing secret: 32 random bytes, `whsec_` + base64url. */
export function generateWebhookSecret(): string {
  return SECRET_PREFIX + randomBytes(SECRET_BYTES).toString('base64url');
}

/** `v1:<iv>:<tag>:<ciphertext>` (base64), for public.school_webhook.secret_enc. */
export function encryptWebhookSecret(owner: WebhookSecretOwner, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  cipher.setAAD(aad(owner));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

/**
 * The plaintext, or null when it cannot be decrypted: AUTH_SECRET changed
 * since it was saved (rotate the webhook's secret), or the value belongs to
 * another webhook.
 */
export function decryptWebhookSecret(owner: WebhookSecretOwner, stored: string): string | null {
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
