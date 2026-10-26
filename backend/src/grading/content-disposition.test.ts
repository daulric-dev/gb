import { describe, expect, test } from 'bun:test';
import { contentDisposition } from './content-disposition';

describe('contentDisposition', () => {
  test('an ASCII name keeps both forms', () => {
    expect(contentDisposition('inline', 'essay.pdf')).toBe(
      `inline; filename="essay.pdf"; filename*=UTF-8''essay.pdf`,
    );
  });

  test('a non-ASCII name is encoded and the header stays ASCII', () => {
    const value = contentDisposition('inline', 'résumé 日本.pdf');
    expect(value).toMatch(/^[\x20-\x7e]+$/);
    expect(value).toContain(`filename*=UTF-8''r%C3%A9sum%C3%A9%20`);
    expect(value).toContain('filename="resume .pdf"');
  });

  test('quotes, backslashes and newlines cannot break out of the header', () => {
    const value = contentDisposition('inline', 'a"b\\c\r\nX-Evil: 1.txt');
    expect(value).not.toMatch(/[\r\n]/);
    expect(value).toContain('filename="abcX-Evil: 1.txt"');
    expect(value).toContain('a%22b%5Cc%0D%0AX-Evil%3A%201.txt');
  });

  test('a missing name falls back to "file"', () => {
    expect(contentDisposition('inline', null)).toContain('filename="file"');
    expect(contentDisposition('inline', '日本')).toContain('filename="file"');
  });
});
