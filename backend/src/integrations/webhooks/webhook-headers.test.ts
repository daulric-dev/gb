import { describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import {
  headerNameProblem,
  headerValueProblem,
  MAX_HEADERS,
  planHeaders,
  redactValues,
} from './webhook-headers';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const saved = [
  { id: A, name: 'Authorization', value_enc: 'v1:a' },
  { id: B, name: 'X-API-Key', value_enc: 'v1:b' },
];

describe('header names', () => {
  test('letters, digits and -, at most 100; Authorization is allowed', () => {
    for (const ok of ['Authorization', 'X-API-Key', 'x-tenant-1', 'a'.repeat(100)]) {
      expect(headerNameProblem(ok)).toBeNull();
    }
    for (const bad of ['', 'X API Key', 'X_API_Key', 'X-Key:', 'Ключ', 'a'.repeat(101), 'X-Key\r\nEvil']) {
      expect(headerNameProblem(bad)).not.toBeNull();
    }
  });

  test("GradeBook's own and client-owned headers are reserved, ignoring case", () => {
    for (const r of ['Content-Type', 'content-length', 'HOST', 'User-Agent', 'Transfer-Encoding', 'Connection',
      'X-GradeBook-Signature', 'x-gradebook-anything']) {
      expect(headerNameProblem(r)).toContain("can't be replaced");
    }
  });
});

describe('header values', () => {
  test('1-4096 printable characters, no CR/LF', () => {
    expect(headerValueProblem('X', 'Bearer abc.def')).toBeNull();
    expect(headerValueProblem('X', 'a'.repeat(4096))).toBeNull();
    expect(headerValueProblem('X', '')).not.toBeNull();
    expect(headerValueProblem('X', 'a'.repeat(4097))).not.toBeNull();
    expect(headerValueProblem('X', 'abc\r\nX-Evil: 1')).toContain('line breaks');
    expect(headerValueProblem('X', 'abc\n')).toContain('line breaks');
  });
});

describe('planHeaders (the full desired list)', () => {
  test('new headers need a value and get a fresh id', () => {
    const p = planHeaders([], [{ name: 'X-API-Key', value: 'k' }]);
    expect(p.create).toEqual([{ id: expect.any(String), name: 'X-API-Key', value: 'k' }]);
    expect(p.changes).toEqual({ added: ['X-API-Key'] });
    expect(() => planHeaders([], [{ name: 'X-API-Key' }])).toThrow(BadRequestException);
    expect(() => planHeaders([], [{ name: 'X-API-Key', value: '' }])).toThrow(BadRequestException);
  });

  test('a saved id without a value keeps it (rename allowed); with a value replaces it; missing ones are deleted', () => {
    const p = planHeaders(saved, [
      { id: A, name: 'Authorization' },
      { id: B, name: 'X-Api-Token', value: 'new' },
    ]);
    expect(p.update).toEqual([{ id: B, name: 'X-Api-Token', value: 'new' }]);
    expect(p.remove).toEqual([]);
    expect(p.changes).toEqual({ renamed: [{ before: 'X-API-Key', after: 'X-Api-Token' }], valueChanged: ['X-Api-Token'] });

    const kept = planHeaders(saved, [{ id: A, name: 'Authorization', value: '' }]);
    expect(kept.update).toEqual([]);
    expect(kept.remove).toEqual([B]);
    expect(kept.changes).toEqual({ removed: ['X-API-Key'] });

    expect(planHeaders(saved, []).remove).toEqual([A, B]);
  });

  test('audit changes never hold a value', () => {
    const p = planHeaders(saved, [{ id: A, name: 'Authorization', value: 'Bearer s3cr3t' }, { name: 'X-New', value: 'n3w-val' }]);
    expect(JSON.stringify(p.changes)).not.toContain('s3cr3t');
    expect(JSON.stringify(p.changes)).not.toContain('n3w-val');
  });

  test('duplicates (ignoring case), unknown ids, reserved names, bad values and too many are refused', () => {
    const bad: Parameters<typeof planHeaders>[1][] = [
      [{ name: 'X-Key', value: 'a' }, { name: 'x-key', value: 'b' }],
      [{ id: A, name: 'Authorization' }, { id: A, name: 'Other' }],
      [{ id: '99999999-9999-4999-8999-999999999999', name: 'X-Key' }],
      [{ name: 'Host', value: 'evil' }],
      [{ name: 'X-Key', value: 'a\nb' }],
      Array.from({ length: MAX_HEADERS + 1 }, (_, i) => ({ name: `X-H${i}`, value: 'v' })),
    ];
    for (const input of bad) expect(() => planHeaders(saved, input)).toThrow(BadRequestException);
    expect(planHeaders([], Array.from({ length: MAX_HEADERS }, (_, i) => ({ name: `X-H${i}`, value: 'v' }))).create).toHaveLength(MAX_HEADERS);
  });
});

describe('redactValues', () => {
  test('replaces every value (longest first); very short ones are left alone', () => {
    expect(redactValues('got Bearer abc123 and abc123', ['abc123', 'Bearer abc123'])).toBe('got [redacted] and [redacted]');
    expect(redactValues('a b c', ['a'])).toBe('a b c');
    expect(redactValues(null, ['abcd'])).toBeNull();
  });
});
