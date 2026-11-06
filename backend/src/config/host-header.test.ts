import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { apiBase, oidcRedirectUri, samlAcsUrl } from '@/sso/sso.config';
import { publicImageUrl } from '@/images/public-url';

/**
 * URLs this API hands out (SSO redirect / SAML ACS, avatar links) must never
 * be built from the request's Host header in production: it is client-set.
 */
const KEYS = ['NODE_ENV', 'API_URL', 'S3_PUBLIC_URL'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  delete process.env.API_URL;
  delete process.env.S3_PUBLIC_URL;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const forged = {
  protocol: 'https',
  headers: { host: 'evil.example' },
} as any;

describe('apiBase', () => {
  test('uses API_URL whenever it is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_URL = 'https://api.example.com/';
    expect(apiBase(forged)).toBe('https://api.example.com');
    expect(oidcRedirectUri(forged)).toBe(
      'https://api.example.com/api/auth/sso/callback',
    );
    expect(samlAcsUrl(forged)).toBe(
      'https://api.example.com/api/auth/sso/saml/acs',
    );
  });

  test('never reads the Host header in production', () => {
    process.env.NODE_ENV = 'production';
    expect(apiBase(forged)).not.toContain('evil.example');
    expect(samlAcsUrl(forged)).not.toContain('evil.example');
  });

  test('falls back to the request host in development', () => {
    process.env.NODE_ENV = 'development';
    expect(apiBase({ protocol: 'http', headers: { host: '192.168.1.5:3001' } } as any)).toBe(
      'http://192.168.1.5:3001',
    );
    expect(apiBase()).toBe('http://localhost:3001');
  });
});

describe('publicImageUrl', () => {
  test('ignores the request origin in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.API_URL = 'https://api.example.com';
    expect(publicImageUrl('avatars/u.png', 'https://evil.example')).toBe(
      'https://api.example.com/api/images/avatars/u.png',
    );
    delete process.env.API_URL;
    expect(publicImageUrl('avatars/u.png', 'https://evil.example')).not.toContain(
      'evil.example',
    );
  });

  test('uses the request origin as a development fallback', () => {
    process.env.NODE_ENV = 'development';
    expect(publicImageUrl('avatars/u.png', 'http://192.168.1.5:3001/')).toBe(
      'http://192.168.1.5:3001/api/images/avatars/u.png',
    );
  });
});
