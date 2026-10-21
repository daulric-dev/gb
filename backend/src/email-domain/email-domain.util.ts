/**
 * Domains nobody can own on a school's behalf. Anyone can sign up at these,
 * so letting a school claim one would hand its students to whoever asked
 * first. Not exhaustive - DNS verification is the real gate - but it turns
 * the obvious mistake into a clear message instead of a failed verification.
 */
const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
  'hey.com',
  'fastmail.com',
  'tutanota.com',
  'qq.com',
  '163.com',
]);

const DOMAIN_PATTERN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Lower-case and strip what people paste: a leading "@", a scheme, a path,
 * a trailing dot. Returns null for anything that is not a plain domain.
 */
export function normalizeDomain(input: string): string | null {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^@/, '');
  d = d.split('/')[0].replace(/\.$/, '');
  if (d.length > 253 || !DOMAIN_PATTERN.test(d)) return null;
  return d;
}

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL.has(domain);
}

/** The domain of an email address, lower-cased; null if it has none. */
export function domainOfEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  return normalizeDomain(email.slice(at + 1));
}

export const VERIFICATION_PREFIX = 'gradebook-verification=';

/** Whether any TXT record carries the token. Records may arrive in chunks. */
export function txtHasToken(records: string[][], token: string): boolean {
  const wanted = `${VERIFICATION_PREFIX}${token}`;
  return records.some((chunks) => chunks.join('').trim() === wanted);
}
