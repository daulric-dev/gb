import { openSecret, sealSecret } from '@/account/secret-box';

/**
 * HKDF info: a key for this purpose only, never the root secret itself
 * (DATA_ENCRYPTION_KEY when set, else AUTH_SECRET; see account/secret-box.ts).
 */
const INFO = 'gradebook:school-sso-secret:v1';

/** Whose secret it is: one school's app for one provider. */
export interface SsoSecretOwner {
  schoolId: string;
  provider: string;
}

/**
 * Additional authenticated data: the school and the provider. A ciphertext
 * copied to another school's row, or another provider's, does not decrypt.
 */
function aad({ schoolId, provider }: SsoSecretOwner): Buffer {
  return Buffer.from(`school:${schoolId.toLowerCase()}\nprovider:${provider}`, 'utf8');
}

/**
 * Encrypt a school's client secret for public.school_sso_provider:
 * `v2:<kid>:<iv>:<tag>:<ct>` under DATA_ENCRYPTION_KEY, or
 * `v1:<iv>:<tag>:<ct>` under AUTH_SECRET when it is unset (base64).
 */
export function encryptSsoSecret(owner: SsoSecretOwner, plaintext: string): string {
  return sealSecret(INFO, aad(owner), plaintext);
}

/**
 * The plaintext, or null when the value cannot be decrypted - most often
 * because the key it was saved under changed since (AUTH_SECRET for `v1`
 * values, DATA_ENCRYPTION_KEY for `v2`; the secret must then be entered
 * again), or because it was stored for another school or provider.
 */
export function decryptSsoSecret(owner: SsoSecretOwner, stored: string): string | null {
  return openSecret(INFO, aad(owner), stored);
}
