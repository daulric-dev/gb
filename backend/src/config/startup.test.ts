import { describe, expect, test } from 'bun:test';
import { validateStartupConfig } from './startup';

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

  test('requires a production auth secret', () => {
    expect(() =>
      validateStartupConfig({ ...valid, NODE_ENV: 'production' }),
    ).toThrow('AUTH_SECRET must be set');
  });
});
