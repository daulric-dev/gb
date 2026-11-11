import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';

/**
 * A pretend OpenID Connect identity provider for tests: a Bun server on
 * 127.0.0.1 serving discovery, a JWKS and a token endpoint that answers an
 * authorization code with an RS256 ID token signed by a throwaway key (never
 * trusted anywhere). The authorization endpoint is not served - a test reads
 * the `nonce` from the start URL, registers the claims for a code with
 * `codeFor`, and calls the callback itself.
 */
export interface FakeOidcIdp {
  /** `http://127.0.0.1:<port><path>`: the issuer it announces (unless overridden). */
  issuer: string;
  /** Mint a one-time code whose ID token carries these claims (iss, aud, iat, exp filled in). */
  codeFor(claims: Record<string, unknown>): string;
  /** Token requests received (form fields). */
  tokenRequests: Record<string, string>[];
  /** Every path requested, in order. */
  requests: string[];
  stop(): void;
}

export interface FakeOidcIdpOptions {
  /** Path of the issuer under the origin, e.g. `/realms/school`. Default none. */
  path?: string;
  /** The issuer the discovery document claims (default: the real one). */
  discoveredIssuer?: string;
  /** Sign with a key that is not in the JWKS. */
  wrongKey?: boolean;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export function startFakeOidcIdp(options: FakeOidcIdpOptions = {}): FakeOidcIdp {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomBytes(6).toString('hex');
  const codes = new Map<string, Record<string, unknown>>();
  const tokenRequests: Record<string, string>[] = [];
  const requests: string[] = [];
  const path = options.path ?? '';
  let issuer = '';

  const sign = (claims: Record<string, unknown>) => {
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const payload = b64url(JSON.stringify(claims));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = signer.sign(options.wrongKey ? other.privateKey : privateKey);
    return `${header}.${payload}.${b64url(signature)}`;
  };

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      requests.push(url.pathname);
      if (url.pathname === `${path}/.well-known/openid-configuration`) {
        return Response.json({
          issuer: options.discoveredIssuer ?? issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
        });
      }
      if (url.pathname === `${path}/jwks`) {
        return Response.json({
          keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }],
        });
      }
      if (url.pathname === `${path}/token` && req.method === 'POST') {
        const form = Object.fromEntries(new URLSearchParams(await req.text()));
        tokenRequests.push(form);
        const claims = codes.get(form.code ?? '');
        codes.delete(form.code ?? '');
        if (!claims) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        const now = Math.floor(Date.now() / 1000);
        return Response.json({
          access_token: randomBytes(16).toString('hex'),
          token_type: 'Bearer',
          expires_in: 300,
          id_token: sign({
            iss: issuer,
            aud: form.client_id,
            iat: now,
            exp: now + 300,
            ...claims,
          }),
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
  issuer = `http://127.0.0.1:${server.port}${path}`;

  return {
    issuer,
    codeFor(claims) {
      const code = randomBytes(12).toString('hex');
      codes.set(code, claims);
      return code;
    },
    tokenRequests,
    requests,
    stop: () => void server.stop(true),
  };
}
