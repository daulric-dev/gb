import { describe, test, expect } from 'bun:test';
import { verifyContent, matchesSignature } from './file-content';

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // xlsx/docx
function webp(): Buffer {
  const b = Buffer.alloc(16, 0);
  b.write('RIFF', 0, 'ascii');
  b.write('WEBP', 8, 'ascii');
  return b;
}

describe('matchesSignature', () => {
  test('accepts each fingerprintable format', () => {
    expect(matchesSignature(PDF, 'application/pdf')).toBe(true);
    expect(matchesSignature(PNG, 'image/png')).toBe(true);
    expect(matchesSignature(JPEG, 'image/jpeg')).toBe(true);
    expect(matchesSignature(webp(), 'image/webp')).toBe(true);
    expect(
      matchesSignature(
        ZIP,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe(true);
  });

  test('rejects bytes that do not match the declared type', () => {
    expect(matchesSignature(PNG, 'application/pdf')).toBe(false);
    expect(matchesSignature(PDF, 'image/png')).toBe(false);
    expect(matchesSignature(Buffer.alloc(2), 'image/jpeg')).toBe(false);
  });
});

describe('verifyContent', () => {
  test('passes a well-formed, allowed binary file', () => {
    expect(verifyContent(PDF, 'application/pdf')).toEqual({ ok: true });
  });

  test('accepts text types without a signature', () => {
    expect(verifyContent(Buffer.from('hello'), 'text/plain')).toEqual({
      ok: true,
    });
    expect(verifyContent(Buffer.from('a,b,c'), 'text/csv')).toEqual({
      ok: true,
    });
  });

  test('rejects an unsupported type', () => {
    const r = verifyContent(Buffer.from('<svg/>'), 'image/svg+xml');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Unsupported');
  });

  test('rejects a file whose bytes contradict the declared type', () => {
    // Declared PDF, actually a PNG — the classic content-type spoof.
    const r = verifyContent(PNG, 'application/pdf');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('do not match');
  });
});
