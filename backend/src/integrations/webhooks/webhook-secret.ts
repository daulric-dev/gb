import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { authSecret } from '@/account/secret';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';
/** HKDF info: a key for this purpose only (not the SSO secrets' key, not AUTH_SECRET). */
const INFO = 'gradebook:webhook-secret:v1';
/**
 * HKDF info for custom header values (the key a school's endpoint asks for):
 * another key, and the header id in the AAD, so a value can't be swapped with
 * the signing secret or moved to another header.
 */
const HEADER_INFO = 'gradebook:webhook-header:v1';
/** Signing secrets are 32 random bytes, shown as `whsec_<base64url>`. */
export const SECRET_BYTES = 32;
export const SECRET_PREFIX = 'whsec_';
/** A signing secret the school brings: printable ASCII, no edge spaces. */
export const CUSTOM_SECRET_MIN = 16;
export const CUSTOM_SECRET_MAX = 256;

/** Whose secret it is: one webhook of one school. */
export interface WebhookSecretOwner {
  schoolId: string;
  webhookId: string;
}

/** Whose header value it is: one header of one webhook of one school. */
export interface WebhookHeaderOwner extends WebhookSecretOwner {
  headerId: string;
}

type Purpose = 'signing' | 'header';

function key(purpose: Purpose): Buffer {
  return Buffer.from(
    hkdfSync('sha256', authSecret(), Buffer.alloc(0), purpose === 'header' ? HEADER_INFO : INFO, 32),
  );
}

/**
 * Additional authenticated data: the school and the webhook (and, for a
 * header value, the header id). A ciphertext copied onto another webhook's
 * row, another school's, another header or the other secret column does not
 * decrypt.
 */
function aad(owner: WebhookSecretOwner | WebhookHeaderOwner, purpose: Purpose): Buffer {
  const base = `school:${owner.schoolId.toLowerCase()}\nwebhook:${owner.webhookId.toLowerCase()}`;
  // The signing secret keeps its original AAD (existing rows must still decrypt).
  if (purpose === 'signing') return Buffer.from(base, 'utf8');
  return Buffer.from(`${base}\nheader:${(owner as WebhookHeaderOwner).headerId.toLowerCase()}`, 'utf8');
}

function seal(purpose: Purpose, owner: WebhookSecretOwner, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(purpose), iv);
  cipher.setAAD(aad(owner, purpose));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function open(purpose: Purpose, owner: WebhookSecretOwner, stored: string): string | null {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv(ALGO, key(purpose), Buffer.from(parts[1], 'base64'));
    decipher.setAAD(aad(owner, purpose));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** A new signing secret: 32 random bytes, `whsec_` + base64url. */
export function generateWebhookSecret(): string {
  return SECRET_PREFIX + randomBytes(SECRET_BYTES).toString('base64url');
}

/**
 * Why a signing secret the school supplies can't be used, or null:
 * 16-256 printable ASCII characters, no leading or trailing space.
 */
export function customSecretProblem(raw: string): string | null {
  if (raw.length < CUSTOM_SECRET_MIN || raw.length > CUSTOM_SECRET_MAX) {
    return `A signing secret must be ${CUSTOM_SECRET_MIN}-${CUSTOM_SECRET_MAX} characters`;
  }
  if (!/^[\x20-\x7e]+$/.test(raw)) {
    return 'A signing secret can only use printable ASCII characters';
  }
  if (raw.trim() !== raw) return 'A signing secret cannot start or end with a space';
  return null;
}

/** `v1:<iv>:<tag>:<ciphertext>` (base64), for public.school_webhook.secret_enc. */
export function encryptWebhookSecret(owner: WebhookSecretOwner, plaintext: string): string {
  return seal('signing', owner, plaintext);
}

/**
 * The plaintext, or null when it cannot be decrypted: AUTH_SECRET changed
 * since it was saved (rotate the webhook's secret), or the value belongs to
 * another webhook.
 */
export function decryptWebhookSecret(owner: WebhookSecretOwner, stored: string): string | null {
  return open('signing', owner, stored);
}

/** A custom header's value, for public.school_webhook_header.value_enc. */
export function encryptWebhookHeaderValue(owner: WebhookHeaderOwner, plaintext: string): string {
  return seal('header', owner, plaintext);
}

/** A custom header's value, or null when it cannot be decrypted (enter it again). */
export function decryptWebhookHeaderValue(owner: WebhookHeaderOwner, stored: string): string | null {
  return open('header', owner, stored);
}
