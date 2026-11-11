import { describe, expect, test } from 'bun:test';
import { COLLECTORS, EXCLUDED, collectorsFor, coveredColumns } from './registry';
import { scanPersonColumns } from './schema-scan';

const key = (c: { table: string; column: string }) => `${c.table}.${c.column}`;

describe('data export registry', () => {
  const scanned = scanPersonColumns();
  const scannedKeys = new Set(scanned.map(key));

  test('the schema scan finds the person columns it should', () => {
    // A sanity check on the scanner itself, so an empty scan cannot pass.
    for (const k of [
      'grading.submission.student_id',
      'chat.message.sender_id',
      'account.session.user_id',
      'public.ai_request.user_id',
      'student.pastoral_note.student_id',
      'course.attendance_record.student_id',
    ]) {
      expect(scannedKeys.has(k)).toBe(true);
    }
    expect(scanned.length).toBeGreaterThan(80);
  });

  test('every person column is exported by a collector or excluded with a reason', () => {
    const covered = coveredColumns();
    const missing = [...scannedKeys].filter((k) => !covered.has(k) && !(k in EXCLUDED));
    // A new table or column holding a user, profile or student id: add it to
    // a collector's `covers` (and export it) or to EXCLUDED with the reason.
    expect(missing).toEqual([]);
  });

  test('every covered or excluded column exists (no stale or misspelt entries)', () => {
    const stale = [...coveredColumns(), ...Object.keys(EXCLUDED)].filter((k) => !scannedKeys.has(k));
    expect(stale).toEqual([]);
  });

  test('a column is either covered or excluded, not both', () => {
    const covered = coveredColumns();
    expect(Object.keys(EXCLUDED).filter((k) => covered.has(k))).toEqual([]);
  });

  test('every exclusion has a real reason', () => {
    for (const [k, reason] of Object.entries(EXCLUDED)) {
      expect(`${k}: ${reason}`.length).toBeGreaterThan(k.length + 30);
    }
  });

  test('collector ids are unique, safe file names', () => {
    const ids = COLLECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  test('staff-only records never reach self or parent exports', () => {
    for (const scope of ['self', 'parent'] as const) {
      const ids = collectorsFor(scope).map((c) => c.id);
      expect(ids).not.toContain('pastoral-notes');
      expect(ids).not.toContain('staff-records');
    }
    const staff = collectorsFor('staff').map((c) => c.id);
    expect(staff).toContain('pastoral-notes');
    expect(staff).toContain('staff-records');
  });

  test('parent exports hold only what the parent portal can show', () => {
    expect(collectorsFor('parent').map((c) => c.id).sort()).toEqual(
      ['attendance', 'coursework', 'mastery', 'memberships', 'profile', 'reports'].sort(),
    );
  });
});
