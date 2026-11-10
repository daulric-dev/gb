import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';

/**
 * The small slice of JWT (RFC 7519) LTI needs, on node:crypto: RS256 only.
 * Nothing else is accepted on the way in - no `none`, no HMAC (which would
 * let a public key be used as a shared secret).
 */

export type JwtHeader = { alg: string; typ?: string; kid?: string };
export type JwtPayload = Record<string, unknown>;

export interface DecodedJwt {
  header: JwtHeader;
  payload: JwtPayload;
  signingInput: string;
  signature: Buffer;
}

export class JwtError extends Error {}

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function signJwt(payload: JwtPayload, privateKey: KeyObject, kid: string): string {
  const header: JwtHeader = { alg: 'RS256', typ: 'JWT', kid };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign('sha256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

function parsePart(part: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new JwtError('Malformed token');
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new JwtError('Malformed token');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JwtError('Malformed token');
  }
  return value as Record<string, unknown>;
}

/** Split and parse a compact JWS without trusting anything in it yet. */
export function decodeJwt(token: string): DecodedJwt {
  if (typeof token !== 'string' || token.length > 16_384) throw new JwtError('Malformed token');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[2]) throw new JwtError('Malformed token');
  const header = parsePart(parts[0]) as JwtHeader;
  const payload = parsePart(parts[1]);
  if (header.alg !== 'RS256') throw new JwtError('Only RS256 is accepted');
  if (header.kid !== undefined && typeof header.kid !== 'string') throw new JwtError('Malformed kid');
  if (!/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new JwtError('Malformed token');
  return {
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], 'base64url'),
  };
}

export function verifySignature(decoded: DecodedJwt, key: KeyObject): boolean {
  if (key.asymmetricKeyType !== 'rsa') return false;
  try {
    return verify('sha256', Buffer.from(decoded.signingInput), key, decoded.signature);
  } catch {
    return false;
  }
}

/** An RSA public key from a JWK, or null when it is not one we accept. */
export function rsaKeyFromJwk(jwk: Record<string, unknown>): KeyObject | null {
  if (jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;
  if (jwk.use !== undefined && jwk.use !== 'sig') return null;
  if (jwk.alg !== undefined && jwk.alg !== 'RS256') return null;
  try {
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return null;
    return key;
  } catch {
    return null;
  }
}

/** An RSA public key (2048+ bits) from PEM, or null. */
export function rsaKeyFromPem(pem: string): KeyObject | null {
  try {
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'rsa') return null;
    if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return null;
    return key;
  } catch {
    return null;
  }
}

export interface ClaimRules {
  issuer?: string;
  /** `aud` must be, or contain, one of these. */
  audience: readonly string[];
  nowSeconds?: number;
  skewSeconds: number;
  /** exp may be at most this far ahead. */
  maxLifetimeSeconds?: number;
}

/** Check exp / iat / nbf / iss / aud. Throws JwtError with the reason. */
export function checkClaims(payload: JwtPayload, rules: ClaimRules): void {
  const now = rules.nowSeconds ?? Math.floor(Date.now() / 1000);
  const { exp, iat, nbf, iss, aud } = payload;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) throw new JwtError('Missing exp');
  if (exp + rules.skewSeconds < now) throw new JwtError('Token expired');
  if (typeof iat !== 'number' || !Number.isFinite(iat)) throw new JwtError('Missing iat');
  if (iat - rules.skewSeconds > now) throw new JwtError('Token issued in the future');
  if (nbf !== undefined && (typeof nbf !== 'number' || nbf - rules.skewSeconds > now)) {
    throw new JwtError('Token not yet valid');
  }
  if (rules.maxLifetimeSeconds !== undefined && exp - now > rules.maxLifetimeSeconds) {
    throw new JwtError('Token lifetime too long');
  }
  if (rules.issuer !== undefined && iss !== rules.issuer) throw new JwtError('Wrong issuer');
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.some((a) => typeof a === 'string' && rules.audience.includes(a))) {
    throw new JwtError('Wrong audience');
  }
}
