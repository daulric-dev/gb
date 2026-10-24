import { describe, expect, test } from 'bun:test';
import { Prisma } from '@/generated/prisma/client';
import {
  dateOnly,
  isForeignKeyViolation,
  isNotFound,
  isoDate,
  isUniqueViolation,
  num,
  pgCode,
  raisedMessage,
} from './db-values';

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError(`prisma ${code}`, {
    code,
    clientVersion: 'test',
    meta,
  });

describe('dateOnly', () => {
  test('formats a date column (midnight UTC) as YYYY-MM-DD', () => {
    expect(dateOnly(new Date('2026-09-01T00:00:00.000Z'))).toBe('2026-09-01');
  });

  test('uses the UTC calendar day, not the local one', () => {
    expect(dateOnly(new Date('2026-12-31T23:59:59.999Z'))).toBe('2026-12-31');
    expect(dateOnly(new Date('2027-01-01T00:00:00.000Z'))).toBe('2027-01-01');
  });

  test('is null for null and undefined', () => {
    expect(dateOnly(null)).toBeNull();
    expect(dateOnly(undefined)).toBeNull();
  });

  test('throws on an invalid Date (toISOString rejects it)', () => {
    expect(() => dateOnly(new Date('nope'))).toThrow(RangeError);
  });
});

describe('isoDate', () => {
  test('returns the full ISO timestamp', () => {
    const d = new Date('2026-03-04T05:06:07.089Z');
    expect(isoDate(d)).toBe('2026-03-04T05:06:07.089Z');
  });

  test('is null for null and undefined', () => {
    expect(isoDate(null)).toBeNull();
    expect(isoDate(undefined)).toBeNull();
  });
});

describe('num', () => {
  test('converts a Prisma Decimal to a number', () => {
    expect(num(new Prisma.Decimal('12.50'))).toBe(12.5);
  });

  test('converts a bigint, a numeric string and a number', () => {
    expect(num(BigInt(42))).toBe(42);
    expect(num('3.25')).toBe(3.25);
    expect(num(7)).toBe(7);
  });

  test('keeps zero (falsy) instead of turning it into null', () => {
    expect(num(0)).toBe(0);
    expect(num('0')).toBe(0);
    expect(num(new Prisma.Decimal(0))).toBe(0);
  });

  test('is null for null and undefined', () => {
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
  });

  test('a non-numeric string becomes NaN (not null)', () => {
    expect(num('abc')).toBeNaN();
  });
});

describe('isUniqueViolation', () => {
  test('true for Prisma P2002', () => {
    expect(isUniqueViolation(known('P2002'))).toBe(true);
  });

  test('true for a raw SQLSTATE 23505 in meta.code', () => {
    expect(isUniqueViolation(known('P2010', { code: '23505' }))).toBe(true);
  });

  test('true for a driver-adapter error carrying 23505', () => {
    const err = {
      meta: { driverAdapterError: { cause: { originalCode: '23505' } } },
    };
    expect(isUniqueViolation(err)).toBe(true);
  });

  test('true for a plain pg error with code 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  test('false for other codes and non-errors', () => {
    expect(isUniqueViolation(known('P2003'))).toBe(false);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  test('a P2002 look-alike that is not a PrismaClientKnownRequestError is ignored', () => {
    // pgCode only accepts 5-char SQLSTATE-shaped codes; "P2002" is 5 chars but
    // only P-codes from real Prisma errors should count.
    expect(isUniqueViolation({ code: 'P2002' })).toBe(false);
  });
});

describe('isForeignKeyViolation', () => {
  test('true for Prisma P2003 and SQLSTATE 23503', () => {
    expect(isForeignKeyViolation(known('P2003'))).toBe(true);
    expect(isForeignKeyViolation(known('P2010', { code: '23503' }))).toBe(true);
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
  });

  test('false for a unique violation', () => {
    expect(isForeignKeyViolation(known('P2002'))).toBe(false);
    expect(isForeignKeyViolation({ code: '23505' })).toBe(false);
  });
});

describe('isNotFound', () => {
  test('true only for Prisma P2025', () => {
    expect(isNotFound(known('P2025'))).toBe(true);
    expect(isNotFound(known('P2002'))).toBe(false);
    expect(isNotFound({ code: 'P2025' })).toBe(false);
    expect(isNotFound(new Error('Not found'))).toBe(false);
    expect(isNotFound(null)).toBe(false);
  });
});

describe('pgCode', () => {
  test('prefers meta.code over the error code', () => {
    expect(pgCode(known('P2010', { code: '22P02' }))).toBe('22P02');
  });

  test('reads the driver adapter original code', () => {
    expect(
      pgCode({
        code: 'P2010',
        meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
      }),
    ).toBe('40001');
  });

  test('falls back to a SQLSTATE-shaped top-level code', () => {
    expect(pgCode({ code: '23505' })).toBe('23505');
    expect(pgCode({ code: 'P0001' })).toBe('P0001');
  });

  test('ignores top-level codes that are not SQLSTATE-shaped', () => {
    expect(pgCode({ code: 'ECONNREFUSED' })).toBeUndefined();
    expect(pgCode({ code: '2350' })).toBeUndefined();
    expect(pgCode({ code: 'abcde' })).toBeUndefined();
  });

  test('ignores a non-string meta.code and falls through', () => {
    expect(pgCode({ code: '23505', meta: { code: 123 } })).toBe('23505');
  });

  test('undefined for null, undefined and code-less errors', () => {
    expect(pgCode(null)).toBeUndefined();
    expect(pgCode(undefined)).toBeUndefined();
    expect(pgCode(new Error('x'))).toBeUndefined();
    expect(pgCode({ meta: {} })).toBeUndefined();
  });
});

describe('raisedMessage', () => {
  test('joins the message with the JSON meta', () => {
    const err = known('P2010', { message: 'ERROR: no_attempts_left' });
    const text = raisedMessage(err);
    expect(text).toContain('prisma P2010');
    expect(text).toContain('no_attempts_left');
  });

  test('a message with no meta gets "{}"', () => {
    expect(raisedMessage(new Error('quiz_closed'))).toBe('quiz_closed {}');
  });

  test('tolerates null/undefined and odd values', () => {
    expect(raisedMessage(null)).toBe(' {}');
    expect(raisedMessage(undefined)).toBe(' {}');
    expect(raisedMessage({ meta: { a: 1 } })).toBe(' {"a":1}');
  });
});
