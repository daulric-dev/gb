import { randomBytes } from 'node:crypto';
import { openSecret, sealSecret } from '@/account/secret-box';

/**
 * HKDF info: a key for this purpose only (not the SSO secrets' key, not the
 * root secret itself). The root is DATA_ENCRYPTION_KEY when set, else
 * AUTH_SECRET; the stored prefix says which (see account/secret-box.ts).
 */
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

function info(purpose: Purpose): string {
  return purpose === 'header' ? HEADER_INFO : INFO;
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
  return sealSecret(info(purpose), aad(owner, purpose), plaintext);
}

function open(purpose: Purpose, owner: WebhookSecretOwner, stored: string): string | null {
  return openSecret(info(purpose), aad(owner, purpose), stored);
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

/**
 * For public.school_webhook.secret_enc: `v2:<kid>:<iv>:<tag>:<ct>` under
 * DATA_ENCRYPTION_KEY, or `v1:<iv>:<tag>:<ct>` under AUTH_SECRET when it is unset.
 */
export function encryptWebhookSecret(owner: WebhookSecretOwner, plaintext: string): string {
  return seal('signing', owner, plaintext);
}

/**
 * The plaintext, or null when it cannot be decrypted: the key it was saved
 * under (AUTH_SECRET for `v1`, DATA_ENCRYPTION_KEY for `v2`) changed since
 * (rotate the webhook's secret), or the value belongs to another webhook.
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
