import { describe, expect, test } from 'bun:test';
import { centsToDecimal, decimalToCents, ProviderApiError, safeEqual, send } from './http';

describe('centsToDecimal', () => {
  test.each([
    [30000, '300.00'],
    [1999, '19.99'],
    [500, '5.00'],
    [5, '0.05'],
    [0, '0.00'],
    [10, '0.10'],
    [123456789012, '1234567890.12'],
  ])('%d -> %s', (cents, expected) => {
    expect(centsToDecimal(cents)).toBe(expected);
  });

  test('zero-decimal currencies', () => {
    expect(centsToDecimal(500, 'JPY')).toBe('500');
  });

  test.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])('rejects %p', (bad) => {
    expect(() => centsToDecimal(bad)).toThrow(RangeError);
  });
});

describe('decimalToCents', () => {
  test.each([
    ['300.00', 30000],
    ['19.99', 1999],
    ['0.29', 29], // 0.29 * 100 = 28.999999999999996 with floats
    ['1.10', 110],
    ['4.35', 435], // 4.35 * 100 = 434.99999999999994 with floats
    ['5', 500],
    ['0.5', 50],
    ['10.000', 1000],
    [' 7.25 ', 725],
  ])('%s -> %d', (value, cents) => {
    expect(decimalToCents(value)).toBe(cents);
  });

  test('zero-decimal currencies', () => {
    expect(decimalToCents('500', 'JPY')).toBe(500);
    expect(() => decimalToCents('500.5', 'JPY')).toThrow(RangeError);
  });

  test.each(['', 'abc', '-1.00', '1.234', '1e3', '1,000.00', '.5'])('rejects %p', (bad) => {
    expect(() => decimalToCents(bad)).toThrow(RangeError);
  });

  test('round trip', () => {
    for (let c = 0; c < 2000; c += 7) expect(decimalToCents(centsToDecimal(c))).toBe(c);
  });
});

describe('safeEqual', () => {
  test('compares in constant time and handles length differences', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('send', () => {
  test('passes a timeout signal', async () => {
    let signal: AbortSignal | null | undefined;
    await send('X', (_u, init) => {
      signal = init?.signal;
      return Promise.resolve(new Response('ok'));
    }, 'https://x.test/a', { method: 'GET' });
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  test('network errors become ProviderApiError without the query string', async () => {
    const err = await send('X', () => Promise.reject(new Error('ECONNRESET')), 'https://x.test/a?token=secret', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderApiError);
    expect(err.message).toBe('X: request failed: ECONNRESET (/a)');
  });
});
