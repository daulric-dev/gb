import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { createMockPrisma, holdJobLeaseElsewhere } from '@/test/prisma-mock';
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

  test('the exported pattern matches what JavaScript calls sealed', () => {
    expect(new RegExp(SEALED_PATTERN).test(sealText('pastoral_note.body', ROW, ''))).toBe(true);
  });
});

describe('encryptSensitiveText (boot backfill and secrets:reencrypt)', () => {
  /** Each encrypted column: its rows key in `db(...)`, Prisma model and column. */
  const MODELS: Record<string, { model: string; column: string }> = {
    'student.pastoral_note': { model: 'pastoral_note', column: 'body' },
    'student.pastoral_note.sar_withheld_reason': { model: 'pastoral_note', column: 'sar_withheld_reason' },
    'grading.activity_accommodation': { model: 'activity_accommodation', column: 'reason' },
    'grading.student_accommodation': { model: 'student_accommodation', column: 'reason' },
  };

  /** In-memory tables behind the Prisma mock: paged reads by id, compare-and-set writes. */
  function db(rows: Record<string, { id: string; value: string }[]>, locked = true) {
    const prisma = createMockPrisma();
    if (!locked) holdJobLeaseElsewhere(prisma);
    const updates: { model: string; where: any; data: any }[] = [];
    const byModel = new Map<string, { column: string; stored: { id: string; value: string }[] }[]>();
    for (const [table, { model, column }] of Object.entries(MODELS)) {
      const list = byModel.get(model) ?? [];
      list.push({ column, stored: rows[table] ?? [] });
      byModel.set(model, list);
    }
    for (const [model, columns] of byModel) {
      const pick = (args: any) => columns.find((c) => c.column in (args.select ?? args.data))!;
      prisma[model].findMany.mockImplementation(async (args: any) => {
        const { where, take, orderBy, select } = args;
        const { column, stored } = pick(args);
        expect(orderBy).toEqual({ id: 'asc' });
        expect(select).toEqual({ id: true, [column]: true });
        return [...stored]
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .filter((r) => r.id > where.id.gt)
          .slice(0, take)
          .map((r) => ({ id: r.id, [column]: r.value }));
      });
      prisma[model].updateMany.mockImplementation(async (args: any) => {
        const { where, data } = args;
        const { column, stored } = pick(args);
        updates.push({ model, where, data });
        const row = stored.find((r) => r.id === where.id && r.value === where[column]);
        if (!row) return { count: 0 };
        row.value = data[column];
        return { count: 1 };
      });
    }
    return { prisma, updates };
  }

  test('encrypts plain rows only, conditionally on the value read', async () => {
    const other = '8b8b8b8b-1111-4111-8111-111111111111';
    const sealed = sealText('pastoral_note.body', other, 'already');
    const { prisma, updates } = db({
      'student.pastoral_note': [
        { id: ROW, value: 'Plain note' },
        { id: other, value: sealed },
      ],
      'grading.activity_accommodation': [],
      'grading.student_accommodation': [],
    });
    const report = await encryptSensitiveText(prisma as any);
    // The sealed value is skipped, not counted.
    expect(report.pastoralNotes).toMatchObject({ scanned: 1, rewritten: 1, raced: 0 });
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ id: ROW, body: 'Plain note' });
    expect(openText('pastoral_note.body', ROW, updates[0].data.body)).toBe('Plain note');
    // Each batch ran under the backfill lease.
    expect(prisma.job_lease.create.mock.calls[0][0].data.key).toBe('gradebook:sensitive-text-backfill');
  });

  test('a row edited after it was read is counted as raced, not overwritten', async () => {
    const { prisma } = db({
      'student.pastoral_note': [{ id: ROW, value: 'Plain' }],
      'grading.activity_accommodation': [],
      'grading.student_accommodation': [],
    });
    prisma.pastoral_note.updateMany.mockResolvedValue({ count: 0 });
    const report = await encryptSensitiveText(prisma as any);
    expect(report.pastoralNotes).toMatchObject({ scanned: 1, rewritten: 0, raced: 1 });
  });

  test('pages through more than one batch in id order', async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      value: `note ${i}`,
    }));
    const { prisma } = db({
      'student.pastoral_note': many,
      'grading.activity_accommodation': [],
      'grading.student_accommodation': [],
    });
    const report = await encryptSensitiveText(prisma as any);
    expect(report.pastoralNotes).toMatchObject({ scanned: 450, rewritten: 450 });
    // Three pages and the empty end for the text, one empty page for withheld reasons.
    expect(prisma.pastoral_note.findMany).toHaveBeenCalledTimes(5);
  });

  test('a dry run writes nothing; another instance holding the lock means nothing to do', async () => {
    const rows = () => ({
      'student.pastoral_note': [{ id: ROW, value: 'Plain' }],
      'grading.activity_accommodation': [],
      'grading.student_accommodation': [],
    });
    const dry = db(rows());
    const report = await encryptSensitiveText(dry.prisma as any, { dryRun: true });
    expect(report.pastoralNotes.rewritten).toBe(1);
    expect(dry.updates).toHaveLength(0);

    const busy = db(rows(), false);
    await encryptSensitiveText(busy.prisma as any);
    expect(busy.updates).toHaveLength(0);
    expect(busy.prisma.pastoral_note.findMany).not.toHaveBeenCalled();
  });

  test('withheld reasons are encrypted too, under their own purpose', async () => {
    const { prisma, updates } = db({
      'student.pastoral_note': [],
      'student.pastoral_note.sar_withheld_reason': [{ id: ROW, value: 'Third party' }],
      'grading.activity_accommodation': [],
      'grading.student_accommodation': [],
    });
    const report = await encryptSensitiveText(prisma as any);
    expect(report.pastoralSarWithheldReasons).toMatchObject({ scanned: 1, rewritten: 1 });
    const next = updates[0].data.sar_withheld_reason as string;
    expect(openText('pastoral_note.sar_withheld_reason', ROW, next)).toBe('Third party');
    // Not readable as note text: a different purpose key.
    expect(openText('pastoral_note.body', ROW, next)).not.toBe('Third party');
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
    const next = updates[0].data.reason as string;
    expect(storedKeyId(next)).toBe(dataKeyId('d'.repeat(40)));
    expect(openText('student_accommodation.reason', ROW, next)).toBe('Reason');
  });
});
