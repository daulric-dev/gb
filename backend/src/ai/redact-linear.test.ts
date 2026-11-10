import { describe, expect, test } from 'bun:test';
import { plainText, redact, redactEmails, safeMarkdown, stripTags, suppliedUrls, trimTrailing } from './redact';

const fast = (fn: () => unknown) => {
  const started = performance.now();
  fn();
  return performance.now() - started;
};

describe('redactEmails', () => {
  test('replaces addresses and keeps surrounding text and punctuation', () => {
    expect(redactEmails('mail ann.lee+x@school.example.org.')).toBe('mail [email].');
    expect(redactEmails('a@b.co and c_d@e-f.io')).toBe('[email] and [email]');
    expect(redactEmails('first.last%tag@sub.domain.edu, then')).toBe('[email], then');
  });

  test('leaves things that are not addresses', () => {
    for (const s of ['@handle', 'x@y', 'x@y.', 'x@y.c', 'a @ b.com', 'x@y.c0m', 'price@@10.00']) {
      expect(redactEmails(s)).toBe(s);
    }
  });

  test('is linear on inputs that made the old regex backtrack', () => {
    expect(fast(() => redactEmails('%'.repeat(200_000)))).toBeLessThan(200);
    expect(fast(() => redactEmails('a@'.repeat(100_000)))).toBeLessThan(200);
  });

  test('redact still removes emails and names together', () => {
    expect(redact('Ann (ann@x.org) wrote', { student: { first_name: 'Ann' } })).toBe('[Student] ([email]) wrote');
  });
});

describe('stripTags', () => {
  test('removes tags, including ones rebuilt from leftovers', () => {
    expect(stripTags('a <b>bold</b> c')).toBe('a bold c');
    expect(stripTags('<<script>script>alert(1)<</script>/script>')).toBe('alert(1)');
    expect(stripTags('<scr<script>ipt>x')).toBe('ipt>x'); // the tag opened at the first '<' runs to the next '>'
    expect(stripTags('x <!-- c --> y <?php ?> z')).toBe('x  y  z');
  });

  test('keeps a lone < that cannot start a tag (maths)', () => {
    expect(stripTags('if x < 3 and 5 > y')).toBe('if x < 3 and 5 > y');
  });

  test('is linear on many <', () => {
    expect(fast(() => stripTags('<'.repeat(200_000)))).toBeLessThan(200);
    expect(fast(() => stripTags('<a'.repeat(100_000)))).toBeLessThan(200);
  });

  test('plainText and safeMarkdown never return a tag', () => {
    const evil = '<<script>script>x<</script>/script><img src=x onerror=1>';
    expect(plainText(evil)).not.toMatch(/<[A-Za-z/!?]/);
    expect(safeMarkdown(evil)).not.toMatch(/<[A-Za-z/!?]/);
  });
});

describe('trimTrailing', () => {
  test('trims only trailing punctuation, linearly', () => {
    expect(trimTrailing('https://a.example/x?!.,', '.,;:!?')).toBe('https://a.example/x');
    expect(trimTrailing('!!!', '!')).toBe('');
    expect(fast(() => trimTrailing('!'.repeat(200_000) + 'x', '!'))).toBeLessThan(200);
    expect([...suppliedUrls('see https://a.example/p!!!')]).toEqual(['https://a.example/p']);
  });
});
