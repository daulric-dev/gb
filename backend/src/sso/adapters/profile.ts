import type { SsoProfile } from '../sso.types';

/** A non-empty string claim, trimmed; the first value of a list. */
export function claimString(
  claims: Record<string, unknown>,
  ...names: string[]
): string | null {
  for (const name of names) {
    let value = claims[name];
    if (Array.isArray(value)) value = value[0];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Names from standard OpenID claims (or SAML attributes under the names
 * given), falling back to splitting a full name.
 */
export function standardProfile(
  claims: Record<string, unknown>,
  names: {
    first?: string[];
    last?: string[];
    full?: string[];
    picture?: string[];
  } = {},
): SsoProfile {
  let firstName = claimString(claims, ...(names.first ?? ['given_name']));
  let lastName = claimString(claims, ...(names.last ?? ['family_name']));
  if (!firstName && !lastName) {
    const full = claimString(claims, ...(names.full ?? ['name']));
    if (full) {
      const parts = full.split(/\s+/);
      firstName = parts[0] ?? null;
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
    }
  }
  const picture = claimString(claims, ...(names.picture ?? ['picture']));
  return {
    firstName,
    lastName,
    avatarUrl: picture?.startsWith('https://') ? picture : null,
  };
}
