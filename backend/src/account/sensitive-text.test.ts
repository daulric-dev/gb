import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createMockPrisma } from '@/test/prisma-mock';
import {
  encryptSensitiveText,
  isSealedText,
  openText,
  SEALED_PATTERN,
  sealText,
  UNREADABLE_TEXT,
} from './sensitive-text';
import { storedKeyId, dataKeyId } from './secret-box';

const ROW = '7a7a7a7a-1111-4111-8111-111111111111';
const saved = { auth: process.env.AUTH_SECRET, dek: process.env.DATA_ENCRYPTION_KEY };
afterAll(() => {
  if (saved.auth === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = saved.auth;
  if (saved.dek === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = saved.dek;
});
beforeEach(() => {
  process.env.AUTH_SECRET = 'a'.repeat(40);
  delete process.env.DATA_ENCRYPTION_KEY;
});

describe('sealed student text', () => {
  test('round-trips per field and row, under AUTH_SECRET (v1) or DATA_ENCRYPTION_KEY (v2)', () => {
    const v1 = sealText('pastoral_note.body', ROW, 'Note ✓ text');
    expect(isSealedText(v1)).toBe(true);
    expect(storedKeyId(v1)).toBe('auth');
    expect(openText('pastoral_note.body', ROW, v1)).toBe('Note ✓ text');

    process.env.DATA_ENCRYPTION_KEY = 'd'.repeat(40);
    const v2 = sealText('student_accommodation.reason', ROW, 'Reason');
    expect(storedKeyId(v2)).toBe(dataKeyId('d'.repeat(40)));
    expect(openText('student_accommodation.reason', ROW, v2)).toBe('Reason');
    // v1 values keep opening after DATA_ENCRYPTION_KEY is set.
    expect(openText('pastoral_note.body', ROW, v1)).toBe('Note ✓ text');
  });

  test('is bound to its column and row', () => {
    const v = sealText('activity_accommodation.reason', ROW, 'Reason');
    expect(openText('student_accommodation.reason', ROW, v)).toBe(UNREADABLE_TEXT);
    expect(openText('activity_accommodation.reason', '00000000-0000-4000-8000-000000000000', v)).toBe(UNREADABLE_TEXT);
  });

  test('plain text (rows from before encryption) reads as it is, even when it looks a bit like a value', () => {
    for (const plain of ['Helped a classmate', 'v1:a:b:c', 'v2:abc:def']) {
      expect(isSealedText(plain)).toBe(false);
      expect(openText('pastoral_note.body', ROW, plain)).toBe(plain);
    }
    expect(openText('pastoral_note.body', ROW, null)).toBeNull();
  });

  test('the SQL pattern matches what JavaScript calls sealed', () => {
    expect(new RegExp(SEALED_PATTERN).test(sealText('pastoral_note.body', ROW, ''))).toBe(true);
  });
});

describe('encryptSensitiveText (boot backfill and secrets:reencrypt)', () => {
  function db(rows: Record<string, { id: string; value: string }[]>, locked = true) {
    const prisma = createMockPrisma();
    const updates: { sql: string; args: unknown[] }[] = [];
    prisma.$queryRawUnsafe.mockImplementation(async (sql: string, ...args: any[]) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked }];
      const table = Object.keys(rows).find((t) => sql.includes(`FROM ${t}`))!;
      const after = args[0] as string;
      return rows[table].filter((r) => r.id > after).slice(0, args[1] as number);
    });
    prisma.$executeRawUnsafe.mockImplementation(async (sql: string, ...args: unknown[]) => {
      updates.push({ sql, args });
      return 1;
    });
    return { prisma, updates };
  }

  test('encrypts plain rows only, conditionally on the value read', async () => {
    const sealed = sealText('pastoral_note.body', ROW, 'already');
    const { prisma, updates } = db({
      'student.pastoral_note': [{ id: ROW, value: 'Plain note' }],
      'grading.activity_accommodation': [],
      'grading.student_accommodation': [],
    });
    const report = await encryptSensitiveText(prisma as any);
    expect(report.pastoralNotes).toMatchObject({ scanned: 1, rewritten: 1 });
    expect(updates).toHaveLength(1);
    const [next, id, previous] = updates[0].args as string[];
    expect(id).toBe(ROW);
    expect(previous).toBe('Plain note');
    expect(openText('pastoral_note.body', ROW, next)).toBe('Plain note');
    expect(updates[0].sql).toContain('AND body = $3');
    // The select filters out values already sealed.
    const select = prisma.$queryRawUnsafe.mock.calls.find((c: any[]) => String(c[0]).includes('FROM student.pastoral_note'))!;
    expect(select[0]).toContain('body !~ $3');
    expect(select[3]).toBe(SEALED_PATTERN);
    expect(sealed).toBeTruthy();
  });

  test('a dry run writes nothing; another instance holding the lock means nothing to do', async () => {
    const rows = {
      'student.pastoral_note': [{ id: ROW, value: 'Plain' }],
      'grading.activity_accommodation': [],
      'grading.student_accommodation': [],
    };
    const dry = db(rows);
    const report = await encryptSensitiveText(dry.prisma as any, { dryRun: true });
    expect(report.pastoralNotes.rewritten).toBe(1);
    expect(dry.updates).toHaveLength(0);

    const busy = db(rows, false);
    await encryptSensitiveText(busy.prisma as any);
    expect(busy.updates).toHaveLength(0);
  });

  test('rotate moves v1 values onto DATA_ENCRYPTION_KEY and skips current ones', async () => {
    const v1 = sealText('student_accommodation.reason', ROW, 'Reason');
    process.env.DATA_ENCRYPTION_KEY = 'd'.repeat(40);
    const other = '8b8b8b8b-1111-4111-8111-111111111111';
    const current = sealText('student_accommodation.reason', other, 'Now');
    const { prisma, updates } = db({
      'student.pastoral_note': [],
      'grading.activity_accommodation': [],
      'grading.student_accommodation': [
        { id: ROW, value: v1 },
        { id: other, value: current },
      ],
    });
    const report = await encryptSensitiveText(prisma as any, { rotate: true });
    expect(report.studentAccommodations).toMatchObject({ scanned: 2, rewritten: 1, current: 1 });
    const next = updates[0].args[0] as string;
    expect(storedKeyId(next)).toBe(dataKeyId('d'.repeat(40)));
    expect(openText('student_accommodation.reason', ROW, next)).toBe('Reason');
  });
});
