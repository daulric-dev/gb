import { describe, expect, test } from 'bun:test';
import {
  allocate,
  anonymousFileName,
  opensAt,
  reviewsEach,
  ringAllocation,
  shouldOpen,
  topUpAllocation,
  validateMarks,
  windowState,
  type Allocation,
  type Submitter,
} from './allocation';

const subs = (n: number, from = 0): Submitter[] =>
  Array.from({ length: n }, (_, i) => ({
    studentId: `stu-${i + from}`,
    submissionId: `sub-${i + from}`,
  }));

function counts(rows: Allocation[]) {
  const load = new Map<string, number>();
  const received = new Map<string, number>();
  for (const r of rows) {
    load.set(r.reviewerId, (load.get(r.reviewerId) ?? 0) + 1);
    received.set(r.submissionId, (received.get(r.submissionId) ?? 0) + 1);
  }
  return { load, received };
}

const key = (r: { reviewerId: string; submissionId: string }) => `${r.reviewerId}|${r.submissionId}`;

describe('ringAllocation', () => {
  test('everyone reviews N and every submission receives N; nobody reviews themselves', () => {
    for (const size of [2, 3, 5, 12, 31]) {
      for (const n of [1, 2, 3]) {
        const rows = ringAllocation(subs(size), n, 'seed');
        const k = reviewsEach(n, size);
        const { load, received } = counts(rows);
        expect(rows.length).toBe(size * k);
        for (const s of subs(size)) {
          expect(load.get(s.studentId) ?? 0).toBe(k);
          expect(received.get(s.submissionId) ?? 0).toBe(k);
        }
        for (const r of rows) {
          expect(r.submissionId).not.toBe(r.reviewerId.replace('stu', 'sub'));
          expect(r.authorId).not.toBe(r.reviewerId);
        }
        expect(new Set(rows.map(key)).size).toBe(rows.length);
      }
    }
  });

  test('N is capped at one fewer than the number of submitters', () => {
    const rows = ringAllocation(subs(3), 5, 'seed');
    expect(reviewsEach(5, 3)).toBe(2);
    expect(rows).toHaveLength(6);
    expect(ringAllocation(subs(1), 2, 'seed')).toEqual([]);
    expect(ringAllocation([], 2, 'seed')).toEqual([]);
  });

  test('is deterministic: the same submitters in any order give the same result', () => {
    const a = ringAllocation(subs(9), 2, 'seed-1');
    const b = ringAllocation([...subs(9)].reverse(), 2, 'seed-1');
    expect(b.map(key).sort()).toEqual(a.map(key).sort());
    // A different seed gives a different (but equally fair) order.
    const c = ringAllocation(subs(9), 2, 'seed-2');
    expect(c.map(key).sort()).not.toEqual(a.map(key).sort());
  });

  test('duplicate submitters are counted once', () => {
    const rows = ringAllocation([...subs(4), subs(4)[0]], 1, 'seed');
    expect(rows).toHaveLength(4);
  });
});

describe('topUpAllocation (late joiners)', () => {
  test('a late submitter reviews N and is reviewed N; nobody does more than N + 1', () => {
    const first = ringAllocation(subs(6), 2, 'seed');
    const all = subs(7);
    const added = topUpAllocation(all, first, 2, 'seed');
    const late = 'stu-6';
    expect(added.filter((a) => a.reviewerId === late)).toHaveLength(2);
    expect(added.filter((a) => a.authorId === late)).toHaveLength(2);
    const { load } = counts([...first, ...added]);
    for (const s of all) expect(load.get(s.studentId)!).toBeLessThanOrEqual(3);
    for (const a of added) expect(a.authorId).not.toBe(a.reviewerId);
    // Existing rows never move.
    expect(added.some((a) => first.some((f) => key(f) === key(a)))).toBe(false);
  });

  test('several late joiners review each other first', () => {
    const first = ringAllocation(subs(5), 2, 'seed');
    const late = subs(3, 5);
    const added = topUpAllocation([...subs(5), ...late], first, 2, 'seed');
    const lateIds = new Set(late.map((s) => s.studentId));
    const lateSubs = new Set(late.map((s) => s.submissionId));
    for (const s of late) {
      const theirs = added.filter((a) => a.reviewerId === s.studentId);
      expect(theirs).toHaveLength(2);
      // Late work had no reviews, so they pick it before anything else.
      expect(theirs.every((a) => lateSubs.has(a.submissionId))).toBe(true);
    }
    const { received } = counts([...first, ...added]);
    for (const s of late) expect(received.get(s.submissionId)).toBe(2);
    expect(added.every((a) => !(lateIds.has(a.reviewerId) && a.authorId === a.reviewerId))).toBe(true);
  });

  test('is stable: running it again adds nothing', () => {
    const first = ringAllocation(subs(6), 2, 'seed');
    const added = topUpAllocation(subs(8), first, 2, 'seed');
    expect(topUpAllocation(subs(8), [...first, ...added], 2, 'seed')).toEqual([]);
    expect(allocate(subs(6), first, 2, 'seed')).toEqual([]);
  });

  test('allocate uses the ring when nothing exists yet', () => {
    expect(allocate(subs(5), [], 2, 's')).toEqual(ringAllocation(subs(5), 2, 's'));
  });

  test('a student no longer submitting (excused) is simply not in the list', () => {
    const first = ringAllocation(subs(5), 2, 'seed');
    // stu-4 excused: drops out of the submitters; nothing new is invented.
    const added = topUpAllocation(subs(4), first, 2, 'seed');
    expect(added.every((a) => a.reviewerId !== 'stu-4' && a.authorId !== 'stu-4')).toBe(true);
  });
});

describe('the review window', () => {
  const due = new Date('2026-11-20T12:00:00Z');
  const closes = new Date('2026-11-27T12:00:00Z');

  test('after the due date: scheduled, then open, then closed', () => {
    const w = { openMode: 'after_due' as const, dueAt: due, startedAt: null, closesAt: closes };
    expect(windowState(w, new Date('2026-11-19T00:00:00Z'))).toBe('scheduled');
    expect(windowState(w, new Date('2026-11-21T00:00:00Z'))).toBe('open');
    expect(shouldOpen(w, new Date('2026-11-21T00:00:00Z'))).toBe(true);
    expect(windowState(w, closes)).toBe('closed');
    expect(shouldOpen(w, closes)).toBe(false);
    expect(opensAt(w)).toEqual(due);
  });

  test('manual: waits for the teacher, then open until it closes', () => {
    const w = { openMode: 'manual' as const, dueAt: due, startedAt: null, closesAt: closes };
    expect(windowState(w, new Date('2026-11-21T00:00:00Z'))).toBe('not_started');
    expect(shouldOpen(w, new Date('2026-11-21T00:00:00Z'))).toBe(false);
    const started = { ...w, startedAt: new Date('2026-11-18T00:00:00Z') };
    expect(windowState(started, new Date('2026-11-19T00:00:00Z'))).toBe('open');
    expect(shouldOpen(started, new Date('2026-11-19T00:00:00Z'))).toBe(false);
  });
});

describe('validateMarks', () => {
  const rubric = {
    criteria: [
      { id: 'c1', points: 4, ratings: [{ id: 'r1', points: 4 }, { id: 'r2', points: 2 }] },
      { id: 'c2', points: 6, ratings: [] },
    ],
  };

  test('a level takes its points; bare points must fit', () => {
    const ok = validateMarks(rubric, [{ criterionId: 'c1', ratingId: 'r2' }, { criterionId: 'c2', points: 5 }], true);
    expect(ok).toEqual({
      marks: [
        { criterionId: 'c1', ratingId: 'r2', points: 2, comment: null },
        { criterionId: 'c2', ratingId: null, points: 5, comment: null },
      ],
    });
    expect(validateMarks(rubric, [{ criterionId: 'c2', points: 7 }], false)).toHaveProperty('error');
    expect(validateMarks(rubric, [{ criterionId: 'cX', points: 1 }], false)).toHaveProperty('error');
    expect(validateMarks(rubric, [{ criterionId: 'c1', ratingId: 'nope' }], false)).toHaveProperty('error');
  });

  test('submitting needs every criterion; a draft does not', () => {
    expect(validateMarks(rubric, [{ criterionId: 'c1', ratingId: 'r1' }], false)).toHaveProperty('marks');
    expect(validateMarks(rubric, [{ criterionId: 'c1', ratingId: 'r1' }], true)).toEqual({
      error: 'Mark every criterion before submitting',
    });
  });
});

test('anonymous file names keep only the extension', () => {
  expect(anonymousFileName('Jane Smith essay.PDF', 0)).toBe('Attachment 1.PDF');
  expect(anonymousFileName('noextension', 2)).toBe('Attachment 3');
});
