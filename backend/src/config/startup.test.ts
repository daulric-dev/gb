import { describe, expect, test } from 'bun:test';
import { startupWarnings, validateStartupConfig } from './startup';

describe('validateStartupConfig', () => {
  const valid = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/gradebook',
  };

  test('requires a valid PostgreSQL connection URL', () => {
    expect(() =>
      validateStartupConfig({ NODE_ENV: 'test' }),
    ).toThrow('DATABASE_URL must be set');
    expect(() =>
      validateStartupConfig({ ...valid, DATABASE_URL: 'http://localhost' }),
    ).toThrow('valid PostgreSQL connection URL');
  });

  test('requires a valid Redis URL when Redis is enabled', () => {
    expect(() =>
      validateStartupConfig({ ...valid, USE_REDIS: 'true' }),
    ).toThrow('REDIS_URL must be set');
    expect(() =>
      validateStartupConfig({
        ...valid,
        USE_REDIS: 'true',
        REDIS_URL: 'http://localhost:6379',
      }),
    ).toThrow('valid Redis connection URL');
  });

  test('accepts required settings when Redis is disabled', () => {
    expect(() => validateStartupConfig(valid)).not.toThrow();
  });

  test('validates the private-webhook override', () => {
    expect(() =>
      validateStartupConfig({ ...valid, WEBHOOK_ALLOW_PRIVATE: 'yes' }),
    ).toThrow('WEBHOOK_ALLOW_PRIVATE must be');
  });

  describe('API_URL in production', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      AUTH_SECRET: 'x'.repeat(32),
      DATA_ENCRYPTION_KEY: 'k'.repeat(32),
      FRONTEND_URL: 'https://app.example.com',
    };

    test('is required', () => {
      expect(() => validateStartupConfig(prod)).toThrow(
        'API_URL must be set in production',
      );
      expect(() => validateStartupConfig({ ...prod, API_URL: '  ' })).toThrow(
        'API_URL must be set in production',
      );
    });

    test('must be an absolute http(s) URL', () => {
      for (const API_URL of ['api.example.com', '/api', 'ftp://api.example.com']) {
        expect(() => validateStartupConfig({ ...prod, API_URL })).toThrow(
          'API_URL must be an absolute http(s) URL',
        );
      }
    });

    test('must use https unless the host is loopback', () => {
      expect(() =>
        validateStartupConfig({ ...prod, API_URL: 'http://api.example.com' }),
      ).toThrow('API_URL must use https in production');
      for (const API_URL of [
        'https://api.example.com',
        'https://api.example.com/',
        'http://localhost:3001',
        'http://127.0.0.1:3001',
        'http://[::1]:3001',
      ]) {
        expect(() => validateStartupConfig({ ...prod, API_URL })).not.toThrow();
      }
    });

    test('is optional outside production', () => {
      expect(() => validateStartupConfig(valid)).not.toThrow();
      expect(() =>
        validateStartupConfig({ ...valid, NODE_ENV: 'development' }),
      ).not.toThrow();
    });
  });

  test('requires a production auth secret', () => {
    expect(() =>
      validateStartupConfig({ ...valid, NODE_ENV: 'production' }),
    ).toThrow('AUTH_SECRET must be set');
  });
  test('rejects a short DATA_ENCRYPTION_KEY and accepts a long one', () => {
    expect(() =>
      validateStartupConfig({ ...valid, DATA_ENCRYPTION_KEY: 'short' }),
    ).toThrow('DATA_ENCRYPTION_KEY');
    expect(() =>
      validateStartupConfig({ ...valid, DATA_ENCRYPTION_KEY: 'k'.repeat(32) }),
    ).not.toThrow();
  });
  describe('FRONTEND_URL in production', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      AUTH_SECRET: 'x'.repeat(32),
      DATA_ENCRYPTION_KEY: 'k'.repeat(32),
      API_URL: 'https://api.example.com',
    };

    test('is required', () => {
      expect(() => validateStartupConfig(prod)).toThrow(
        'FRONTEND_URL must be set in production',
      );
    });

    test('refuses localhost and other loopback origins', () => {
      for (const FRONTEND_URL of [
        'http://localhost:3000',
        'https://localhost:3000',
        'https://app.example.com,http://127.0.0.1:3000',
        'http://[::1]:3000',
      ]) {
        expect(() => validateStartupConfig({ ...prod, FRONTEND_URL })).toThrow(
          'localhost is not allowed',
        );
      }
    });

    test('requires https', () => {
      expect(() =>
        validateStartupConfig({ ...prod, FRONTEND_URL: 'http://app.example.com' }),
      ).toThrow('must use https');
    });

    test('accepts https origins', () => {
      expect(() =>
        validateStartupConfig({
          ...prod,
          FRONTEND_URL: 'https://app.example.com, https://m.example.com',
        }),
      ).not.toThrow();
    });

    test('local preview (bun run preview) allows loopback origins', () => {
      expect(() =>
        validateStartupConfig({
          ...prod,
          LOCAL_PREVIEW: 'true',
          FRONTEND_URL: 'http://localhost:3000',
        }),
      ).not.toThrow();
    });

    test('local preview still requires https for other hosts', () => {
      expect(() =>
        validateStartupConfig({
          ...prod,
          LOCAL_PREVIEW: 'true',
          FRONTEND_URL: 'http://app.example.com',
        }),
      ).toThrow('must use https');
    });

    test('is not checked outside production', () => {
      expect(() =>
        validateStartupConfig({ ...valid, FRONTEND_URL: 'http://localhost:3000' }),
      ).not.toThrow();
    });
  });
});

describe('DATA_ENCRYPTION_KEY in production', () => {
  const prod = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/gradebook',
    AUTH_SECRET: 'x'.repeat(32),
    API_URL: 'https://api.example.com',
    FRONTEND_URL: 'https://app.example.com',
  };

  test('is required', () => {
    expect(() => validateStartupConfig(prod)).toThrow('DATA_ENCRYPTION_KEY must be set');
    expect(() => validateStartupConfig({ ...prod, DATA_ENCRYPTION_KEY: '  ' })).toThrow(
      'DATA_ENCRYPTION_KEY must be set',
    );
    expect(() => validateStartupConfig({ ...prod, DATA_ENCRYPTION_KEY: 'k'.repeat(32) })).not.toThrow();
  });

  test('is optional outside production', () => {
    expect(() =>
      validateStartupConfig({ NODE_ENV: 'development', DATABASE_URL: prod.DATABASE_URL }),
    ).not.toThrow();
  });
});

describe('startupWarnings: database TLS', () => {
  const warn = (DATABASE_URL: string) => startupWarnings({ DATABASE_URL });

  test('warns for a remote database without sslmode', () => {
    expect(warn('postgresql://u:p@db.example.com:5432/gb')[0]).toContain('without TLS');
    expect(warn('postgresql://u:p@10.0.0.5:5432/gb?sslmode=prefer')[0]).toContain('without TLS');
    expect(warn('postgresql://u:p@db.example.com/gb?sslmode=disable')).toHaveLength(1);
  });

  test('accepts TLS modes', () => {
    for (const mode of ['require', 'verify-ca', 'verify-full', 'VERIFY-FULL']) {
      expect(warn(`postgresql://u:p@db.example.com/gb?sslmode=${mode}`)).toEqual([]);
    }
    expect(warn('postgresql://u:p@db.example.com/gb?ssl=true')).toEqual([]);
  });

  test('does not warn for local hosts, compose services or sockets', () => {
    for (const url of [
      'postgresql://u:p@localhost:5432/gb',
      'postgresql://u:p@127.0.0.1/gb',
      'postgresql://u:p@[::1]/gb',
      'postgresql://u:p@db:5432/gb',
      'postgresql://u:p@host.docker.internal/gb',
      'postgresql://u:p@x/gb?host=/var/run/postgresql',
    ]) {
      expect(warn(url)).toEqual([]);
    }
  });
});
