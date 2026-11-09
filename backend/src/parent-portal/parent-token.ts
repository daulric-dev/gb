import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Invite tokens and link codes. Only the SHA-256 of either is stored, so a
 * database read never yields a usable token.
 */

/** Days an emailed invitation stays valid. */
export const INVITE_TTL_DAYS = 14;
/** Days a one-time link code stays valid. */
export const LINK_CODE_TTL_DAYS = 7;

/** A 256-bit URL-safe token for an emailed invitation link. */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

// Crockford-style: no 0/O, 1/I/L, U, so a code read aloud or copied by hand
// survives. 30 symbols, 10 characters: about 49 bits.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 10;

/** A one-time link code, shown as XXXXX-XXXXX. */
export function newLinkCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

/** A typed code as stored: upper case, no spaces or dashes. */
export function normaliseLinkCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * The stored hash. Codes are hashed in their normalised form, under a
 * different prefix from link tokens so the two can never collide.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(`parent-invite:${token}`).digest('hex');
}

export function hashLinkCode(code: string): string {
  return createHash('sha256').update(`parent-code:${normaliseLinkCode(code)}`).digest('hex');
}

export function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
