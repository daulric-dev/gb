import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  allowedOrigins,
  authCookieSecure,
  insecureCookieWarning,
  authCookieDomain,
  corsOriginFor,
  isOriginAllowed,
  primaryOrigin,
} from './origins';

const KEYS = ['FRONTEND_URL', 'AUTH_COOKIE_DOMAIN', 'NODE_ENV'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('allowedOrigins', () => {
  test('defaults to localhost:3000 when unset', () => {
    expect(allowedOrigins()).toEqual(['http://localhost:3000']);
  });

  test('defaults when set to an empty string', () => {
    process.env.FRONTEND_URL = '';
    expect(allowedOrigins()).toEqual(['http://localhost:3000']);
  });

  test('defaults when the list is only commas and whitespace', () => {
    process.env.FRONTEND_URL = ' , ,, ';
    expect(allowedOrigins()).toEqual(['http://localhost:3000']);
  });

  test('splits, trims and drops empty entries', () => {
    process.env.FRONTEND_URL =
      ' https://app.example.com , https://m.example.com,, ';
    expect(allowedOrigins()).toEqual([
      'https://app.example.com',
      'https://m.example.com',
    ]);
  });

  test('a single origin', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    expect(allowedOrigins()).toEqual(['https://app.example.com']);
  });
});

describe('primaryOrigin', () => {
  test('is the first configured origin', () => {
    process.env.FRONTEND_URL = 'https://b.example.com,https://a.example.com';
    expect(primaryOrigin()).toBe('https://b.example.com');
  });

  test('is the default when unset', () => {
    expect(primaryOrigin()).toBe('http://localhost:3000');
  });
});

describe('corsOriginFor', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.com,https://m.example.com';
  });

  test('echoes an allowed origin', () => {
    expect(corsOriginFor('https://m.example.com')).toBe('https://m.example.com');
  });

  test('falls back to the primary origin for an unknown one', () => {
    expect(corsOriginFor('https://evil.test')).toBe('https://app.example.com');
  });

  test('falls back to the primary origin when there is no origin', () => {
    expect(corsOriginFor(undefined)).toBe('https://app.example.com');
    expect(corsOriginFor(null)).toBe('https://app.example.com');
    expect(corsOriginFor('')).toBe('https://app.example.com');
  });

  test('echoes a LAN origin outside production', () => {
    expect(corsOriginFor('http://192.168.1.20:8081')).toBe(
      'http://192.168.1.20:8081',
    );
  });

  test('does not echo a LAN origin in production', () => {
    process.env.NODE_ENV = 'production';
    expect(corsOriginFor('http://192.168.1.20:8081')).toBe(
      'https://app.example.com',
    );
  });

  test('requires an exact match (no trailing slash / case folding)', () => {
    expect(corsOriginFor('https://app.example.com/')).toBe(
      'https://app.example.com',
    );
    expect(corsOriginFor('https://APP.example.com')).toBe(
      'https://app.example.com',
    );
  });
});

describe('isOriginAllowed', () => {
  test('true when there is no Origin header', () => {
    process.env.NODE_ENV = 'production';
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed(null)).toBe(true);
    expect(isOriginAllowed('')).toBe(true);
  });

  test('true for a configured origin, in any environment', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.NODE_ENV = 'production';
    expect(isOriginAllowed('https://app.example.com')).toBe(true);
  });

  test('false for an unconfigured public origin', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    expect(isOriginAllowed('https://evil.test')).toBe(false);
  });

  describe('private-network origins outside production', () => {
    const allowed = [
      'http://localhost',
      'http://localhost:8081',
      'https://localhost:3000',
      'http://127.0.0.1:19006',
      'http://[::1]:3000',
      'http://10.0.0.5',
      'http://10.255.1.2:8080',
      'http://192.168.0.10:8081',
      'http://172.16.0.1',
      'http://172.20.4.4:3000',
      'http://172.31.255.255',
    ];
    for (const origin of allowed) {
      test(`allows ${origin}`, () => {
        process.env.FRONTEND_URL = 'https://app.example.com';
        expect(isOriginAllowed(origin)).toBe(true);
      });
    }

    const rejected = [
      'http://172.15.0.1',
      'http://172.32.0.1',
      'http://11.0.0.1',
      'http://192.169.0.1',
      'ftp://localhost',
      'http://localhost.evil.test',
      'http://localhost:abc',
      'http://10.0.0.5/path',
      'http://evil.test?x=localhost',
    ];
    for (const origin of rejected) {
      test(`rejects ${origin}`, () => {
        process.env.FRONTEND_URL = 'https://app.example.com';
        expect(isOriginAllowed(origin)).toBe(false);
      });
    }
  });

  test('rejects LAN origins in production unless configured', () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://app.example.com,http://10.0.0.5';
    expect(isOriginAllowed('http://localhost:3000')).toBe(false);
    expect(isOriginAllowed('http://192.168.1.2')).toBe(false);
    expect(isOriginAllowed('http://10.0.0.5')).toBe(true);
  });

  test('NODE_ENV values other than "production" count as development', () => {
    process.env.NODE_ENV = 'staging';
    expect(isOriginAllowed('http://10.1.2.3')).toBe(true);
  });
});

describe('authCookieDomain', () => {
  test('undefined outside production', () => {
    process.env.FRONTEND_URL = 'https://app.example.com';
    process.env.AUTH_COOKIE_DOMAIN = '.example.com';
    expect(authCookieDomain()).toBeUndefined();
    process.env.NODE_ENV = 'development';
    expect(authCookieDomain()).toBeUndefined();
  });

  describe('in production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    test('uses AUTH_COOKIE_DOMAIN when set (trimmed)', () => {
      process.env.AUTH_COOKIE_DOMAIN = '  .school.test  ';
      expect(authCookieDomain()).toBe('.school.test');
    });

    test('"none" (any case) means a host-only cookie', () => {
      process.env.AUTH_COOKIE_DOMAIN = 'none';
      expect(authCookieDomain()).toBeUndefined();
      process.env.AUTH_COOKIE_DOMAIN = 'NONE';
      expect(authCookieDomain()).toBeUndefined();
    });

    test('a blank override is ignored and the domain is derived', () => {
      process.env.AUTH_COOKIE_DOMAIN = '   ';
      process.env.FRONTEND_URL = 'https://app.example.com';
      expect(authCookieDomain()).toBe('.example.com');
    });

    test('derives the last two labels of the primary origin', () => {
      process.env.FRONTEND_URL =
        'https://portal.app.example.com:8443,https://other.test';
      expect(authCookieDomain()).toBe('.example.com');
    });

    test('a two-label host derives itself', () => {
      process.env.FRONTEND_URL = 'https://example.com';
      expect(authCookieDomain()).toBe('.example.com');
    });

    test('a multi-part suffix derives the public suffix (documented limitation)', () => {
      process.env.FRONTEND_URL = 'https://app.example.co.uk';
      expect(authCookieDomain()).toBe('.co.uk');
    });

    test('an unparseable primary origin gives undefined', () => {
      process.env.FRONTEND_URL = 'not a url';
      expect(authCookieDomain()).toBeUndefined();
    });

    test('an IP-address or single-label origin gives a host-only cookie (undefined)', () => {
      for (const url of ['http://10.0.0.5:3000', 'http://[::1]:3000', 'http://intranet:3000']) {
        process.env.FRONTEND_URL = url;
        expect(authCookieDomain()).toBeUndefined();
      }
    });
  });
});

describe('authCookieSecure / insecureCookieWarning', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  test('Secure in production, off otherwise', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_COOKIE_SECURE;
    expect(authCookieSecure()).toBe(true);
    process.env.NODE_ENV = 'development';
    expect(authCookieSecure()).toBe(false);
  });

  test('AUTH_COOKIE_SECURE overrides either way', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_COOKIE_SECURE = 'false';
    expect(authCookieSecure()).toBe(false);
    process.env.NODE_ENV = 'development';
    process.env.AUTH_COOKIE_SECURE = 'TRUE';
    expect(authCookieSecure()).toBe(true);
  });

  test('warns only when cookies are Secure but the API is plain http', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AUTH_COOKIE_SECURE;
    process.env.API_URL = 'http://localhost:3001';
    expect(insecureCookieWarning()).toMatch(/AUTH_COOKIE_SECURE=false/);
    process.env.API_URL = 'https://api.example.com';
    expect(insecureCookieWarning()).toBeNull();
    process.env.API_URL = 'http://localhost:3001';
    process.env.AUTH_COOKIE_SECURE = 'false';
    expect(insecureCookieWarning()).toBeNull();
  });
});
