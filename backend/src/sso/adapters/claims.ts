import type { User, UserIdentity } from '@supabase/supabase-js';
import type { SsoProfile } from '../sso.types';

/** The identity a user signed in with through `provider`, if any. */
export function identityFor(user: User, provider: string): UserIdentity | null {
  return user.identities?.find((i) => i.provider === provider) ?? null;
}

/**
 * A claim from the provider's token. Supabase keeps standard claims at the top
 * of identity_data and moves the rest under custom_claims, and has moved
 * claims between the two before, so both are read.
 */
export function claim(identity: UserIdentity | null, name: string): unknown {
  const data = (identity?.identity_data ?? {}) as Record<string, unknown>;
  if (data[name] !== undefined) return data[name];
  const custom = data.custom_claims as Record<string, unknown> | undefined;
  return custom?.[name];
}

export function claimString(identity: UserIdentity | null, name: string): string | null {
  const value = claim(identity, name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Names from standard OpenID claims, falling back to splitting a full name.
 * Good enough for every provider that follows the spec; adapters for ones
 * that do not can override profileFrom.
 */
export function standardProfile(user: User, provider: string): SsoProfile {
  const identity = identityFor(user, provider);
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const fromIdentity = claimString(identity, key);
      if (fromIdentity) return fromIdentity;
      const fromMeta = meta[key];
      if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim();
    }
    return null;
  };

  let firstName = pick('given_name', 'first_name');
  let lastName = pick('family_name', 'last_name', 'surname');
  if (!firstName && !lastName) {
    const full = pick('full_name', 'name');
    if (full) {
      const parts = full.split(/\s+/);
      firstName = parts[0] ?? null;
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
    }
  }

  return { firstName, lastName, avatarUrl: pick('avatar_url', 'picture') };
}

/** The domain part of the user's address, lower-cased. */
export function emailDomainOf(user: User): string | null {
  const email = user.email?.toLowerCase() ?? '';
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1) : null;
}
