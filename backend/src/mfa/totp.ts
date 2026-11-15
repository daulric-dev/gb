import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 time-based one-time passwords (the codes authenticator apps show)
 * on node:crypto, with no dependency: HMAC-SHA-1, 6 digits, 30-second steps,
 * the defaults every authenticator app assumes. Pure functions; the service
 * keeps secrets, replay and lockout state.
 */

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_S = 30;
/** Steps either side of now still accepted (clock drift): ±30 seconds. */
export const TOTP_WINDOW = 1;
/** 160-bit secrets, as RFC 4226 recommends for HMAC-SHA-1. */
export const SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, upper case, without padding (what authenticator apps take). */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Inverse of base32Encode; ignores case, spaces and padding. Throws on other characters. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = BASE32.indexOf(ch);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new random secret, base32. */
export function newSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** RFC 4226 HOTP for one counter value. */
export function hotp(key: Buffer, counter: bigint, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const mac = createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The time step a moment falls in. */
export function timeStep(nowMs: number, period = TOTP_PERIOD_S): bigint {
  return BigInt(Math.floor(nowMs / 1000 / period));
}

/** The code for a moment. */
export function totp(key: Buffer, nowMs: number, digits = TOTP_DIGITS): string {
  return hotp(key, timeStep(nowMs), digits);
}

/** Digits only: authenticator apps show "123 456". */
export function cleanCode(code: string): string {
  return String(code ?? '').replace(/[\s-]/g, '');
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The time step the code belongs to, within ±window of now, or null. Steps at
 * or before `lastUsedStep` never match, so a code (or an older one) cannot be
 * replayed after a newer one was accepted.
 */
export function matchStep(
  key: Buffer,
  code: string,
  nowMs: number,
  lastUsedStep: bigint | null = null,
  window = TOTP_WINDOW,
): bigint | null {
  const given = cleanCode(code);
  if (!/^\d{6}$/.test(given)) return null;
  const now = timeStep(nowMs);
  let found: bigint | null = null;
  // Every candidate is checked (no early exit), so timing says nothing about which matched.
  for (let delta = -window; delta <= window; delta++) {
    const step = now + BigInt(delta);
    if (step < 0n) continue;
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (sameText(hotp(key, step), given) && found === null) found = step;
  }
  return found;
}

/** otpauth:// URI for a QR code (Key URI Format, as Google Authenticator documents it). */
export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_S),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Recovery codes ─────────────────────────────────────────────────────────

export const RECOVERY_CODE_COUNT = 10;
/** No 0/o, 1/l/i: read off paper without guessing. 31 symbols, 10 of them ≈ 49.5 bits. */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** `xxxxx-xxxxx`, lower case. */
export function newRecoveryCode(): string {
  let out = '';
  for (let i = 0; i < 10; i++) {
    if (i === 5) out += '-';
    out += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  }
  return out;
}

export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(newRecoveryCode());
  return [...codes];
}

/** Lower case, no spaces or hyphens: what is hashed and compared. */
export function normalizeRecoveryCode(code: string): string {
  return String(code ?? '').toLowerCase().replace(/[\s-]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(`gradebook:mfa-recovery:v1\n${normalizeRecoveryCode(code)}`).digest('hex');
}
