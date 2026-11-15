import { afterEach, expect, test } from 'bun:test';
import { translationCacheTtlHours } from './translation.constants';

const saved = process.env.TRANSLATION_CACHE_TTL_HOURS;
afterEach(() => {
  if (saved === undefined) delete process.env.TRANSLATION_CACHE_TTL_HOURS;
  else process.env.TRANSLATION_CACHE_TTL_HOURS = saved;
});

test('translated text is cached for 24 hours by default', () => {
  delete process.env.TRANSLATION_CACHE_TTL_HOURS;
  expect(translationCacheTtlHours()).toBe(24);
});

test('TRANSLATION_CACHE_TTL_HOURS sets it (1 - 720); anything else falls back to 24', () => {
  process.env.TRANSLATION_CACHE_TTL_HOURS = '6';
  expect(translationCacheTtlHours()).toBe(6);
  for (const bad of ['0', '721', '1.5', 'week', '']) {
    process.env.TRANSLATION_CACHE_TTL_HOURS = bad;
    expect(translationCacheTtlHours()).toBe(24);
  }
});
