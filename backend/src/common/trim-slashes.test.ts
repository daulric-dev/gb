import { describe, expect, test } from 'bun:test';
import { trimTrailingSlashes } from './trim-slashes';

describe('trimTrailingSlashes', () => {
  test('removes only trailing slashes', () => {
    expect(trimTrailingSlashes('https://a.example/api///')).toBe('https://a.example/api');
    expect(trimTrailingSlashes('/a/b/')).toBe('/a/b');
    expect(trimTrailingSlashes('/a//b')).toBe('/a//b');
    expect(trimTrailingSlashes('no-slash')).toBe('no-slash');
    expect(trimTrailingSlashes('')).toBe('');
    expect(trimTrailingSlashes('///')).toBe('');
  });

  test('stays fast on input the old regex backtracked on', () => {
    const evil = '/'.repeat(200_000) + 'x';
    const started = performance.now();
    expect(trimTrailingSlashes(evil)).toBe(evil);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
