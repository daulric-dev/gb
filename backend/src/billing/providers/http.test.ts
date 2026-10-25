import { afterEach, describe, expect, test } from 'bun:test';
import { env, fromUnix, ProviderApiError, requireEnv } from './http';

const NAME = 'GB_HTTP_TEST_VAR';

afterEach(() => {
  delete process.env[NAME];
});

describe('env / requireEnv', () => {
  test('trims and treats blank as unset', () => {
    process.env[NAME] = '  value  ';
    expect(env(NAME)).toBe('value');
    process.env[NAME] = '   ';
    expect(env(NAME)).toBeUndefined();
  });

  test('requireEnv throws a ProviderApiError naming the variable', () => {
    expect(() => requireEnv('Stripe', NAME)).toThrow(ProviderApiError);
    expect(() => requireEnv('Stripe', NAME)).toThrow(`Stripe: ${NAME} is not set`);
    process.env[NAME] = 'x';
    expect(requireEnv('Stripe', NAME)).toBe('x');
  });
});

describe('fromUnix', () => {
  test('seconds to Date, null otherwise', () => {
    expect(fromUnix(1_700_000_000)?.toISOString()).toBe('2023-11-14T22:13:20.000Z');
    expect(fromUnix(null)).toBeNull();
    expect(fromUnix(undefined)).toBeNull();
  });
});
