import { createHash } from 'node:crypto';

/** A student who handed in, and the submission others will review. */
export interface Submitter {
  studentId: string;
  submissionId: string;
}

/** One review to do: `reviewerId` reviews `submissionId` (by `authorId`). */
export interface Allocation {
  reviewerId: string;
  submissionId: string;
  authorId: string;
}

/** The order key of a student under a setting's seed (stable, unguessable). */
export function rankKey(seed: string, studentId: string): string {
  return createHash('sha256').update(`${seed}:${studentId}`).digest('hex');
}

function byRank(seed: string) {
  return (a: Submitter, b: Submitter) => {
    const ka = rankKey(seed, a.studentId);
    const kb = rankKey(seed, b.studentId);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0;
  };
}

/** Reviews each student can do: N, but never more than there are classmates. */
export function reviewsEach(n: number, submitters: number): number {
  return Math.max(0, Math.min(n, submitters - 1));
}

/**
 * The first allocation, when the window opens. Submitters are put in a
 * seeded order and each reviews the next k in the ring (k = N, or one fewer
 * than the number of submitters). Everyone reviews exactly k and every
 * submission receives exactly k; nobody reviews themselves. The same
 * submitters and seed always give the same result.
 */
export function ringAllocation(
  submitters: Submitter[],
  n: number,
  seed: string,
): Allocation[] {
  const order = dedupe(submitters).sort(byRank(seed));
  const k = reviewsEach(n, order.length);
  const out: Allocation[] = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = 1; j <= k; j++) {
      const author = order[(i + j) % order.length];
      out.push({
        reviewerId: order[i].studentId,
        submissionId: author.submissionId,
        authorId: author.studentId,
      });
    }
  }
  return out;
}

/**
 * New allocations needed on top of `existing` (late joiners: a student who
 * handed in after the window opened). Existing rows are never moved.
 *
 * 1. Each submitter reviewing fewer than k gets more, choosing the
 *    submissions with the fewest reviews so far (so late joiners first
 *    review each other).
 * 2. Each submission with fewer than k reviews is given reviewers with the
 *    lightest load, but nobody is asked for more than k + 1.
 *
 * Ties are broken by the seeded order, so the result is deterministic, and
 * running it again on its own output adds nothing.
 */
export function topUpAllocation(
  submitters: Submitter[],
  existing: { reviewerId: string; submissionId: string }[],
  n: number,
  seed: string,
): Allocation[] {
  const order = dedupe(submitters).sort(byRank(seed));
  const k = reviewsEach(n, order.length);
  if (k === 0) return [];
  const rank = new Map(order.map((s, i) => [s.studentId, i]));
  const authorOf = new Map(order.map((s) => [s.submissionId, s.studentId]));
  const pairs = new Set(existing.map((e) => `${e.reviewerId}|${e.submissionId}`));
  const load = new Map<string, number>(order.map((s) => [s.studentId, 0]));
  const received = new Map<string, number>(order.map((s) => [s.submissionId, 0]));
  for (const e of existing) {
    if (load.has(e.reviewerId)) load.set(e.reviewerId, load.get(e.reviewerId)! + 1);
    if (received.has(e.submissionId)) {
      received.set(e.submissionId, received.get(e.submissionId)! + 1);
    }
  }

  const out: Allocation[] = [];
  const add = (reviewer: Submitter, target: Submitter) => {
    pairs.add(`${reviewer.studentId}|${target.submissionId}`);
    load.set(reviewer.studentId, load.get(reviewer.studentId)! + 1);
    received.set(target.submissionId, received.get(target.submissionId)! + 1);
    out.push({
      reviewerId: reviewer.studentId,
      submissionId: target.submissionId,
      authorId: target.studentId,
    });
  };

  // 1. Reviewers short of k.
  for (const reviewer of order) {
    while (load.get(reviewer.studentId)! < k) {
      const target = order
        .filter(
          (s) =>
            s.studentId !== reviewer.studentId &&
            !pairs.has(`${reviewer.studentId}|${s.submissionId}`),
        )
        .sort(
          (a, b) =>
            received.get(a.submissionId)! - received.get(b.submissionId)! ||
            // Start just after the reviewer in the ring, like the first run.
            ringDistance(rank, reviewer.studentId, a.studentId, order.length) -
              ringDistance(rank, reviewer.studentId, b.studentId, order.length),
        )[0];
      if (!target) break;
      add(reviewer, target);
    }
  }

  // 2. Submissions short of k.
  for (const target of order) {
    while (received.get(target.submissionId)! < k) {
      const reviewer = order
        .filter(
          (s) =>
            s.studentId !== target.studentId &&
            load.get(s.studentId)! < k + 1 &&
            !pairs.has(`${s.studentId}|${target.submissionId}`),
        )
        .sort(
          (a, b) =>
            load.get(a.studentId)! - load.get(b.studentId)! ||
            ringDistance(rank, a.studentId, target.studentId, order.length) -
              ringDistance(rank, b.studentId, target.studentId, order.length),
        )[0];
      if (!reviewer) break;
      add(reviewer, target);
    }
  }

  // authorOf is only for sanity: never pair a student with their own work.
  return out.filter((a) => authorOf.get(a.submissionId) !== a.reviewerId);
}

/** Allocation for the current state: the ring when nothing exists yet. */
export function allocate(
  submitters: Submitter[],
  existing: { reviewerId: string; submissionId: string }[],
  n: number,
  seed: string,
): Allocation[] {
  return existing.length === 0
    ? ringAllocation(submitters, n, seed)
    : topUpAllocation(submitters, existing, n, seed);
}

function ringDistance(
  rank: Map<string, number>,
  from: string,
  to: string,
  size: number,
): number {
  return (((rank.get(to)! - rank.get(from)!) % size) + size) % size;
}

function dedupe(submitters: Submitter[]): Submitter[] {
  const seen = new Set<string>();
  return submitters.filter((s) => {
    if (seen.has(s.studentId)) return false;
    seen.add(s.studentId);
    return true;
  });
}

// ── The review window ───────────────────────────────────────────────────────

export type OpenMode = 'after_due' | 'manual';
export type WindowState = 'scheduled' | 'not_started' | 'open' | 'closed';

export interface WindowInput {
  openMode: OpenMode;
  dueAt: Date | null;
  startedAt: Date | null;
  closesAt: Date;
}

/** When the window opens(ed): the start, else the due date (after_due). */
export function opensAt(w: WindowInput): Date | null {
  if (w.startedAt) return w.startedAt;
  return w.openMode === 'after_due' ? w.dueAt : null;
}

/**
 * - `scheduled`: opens by itself at the due date (after_due, not yet due).
 * - `not_started`: manual, waiting for the teacher.
 * - `open`: reviews can be written (the allocation is due or done).
 * - `closed`: past `closesAt`; authors can read their reviews.
 */
export function windowState(w: WindowInput, now: Date = new Date()): WindowState {
  if (now.getTime() >= w.closesAt.getTime()) return 'closed';
  const at = opensAt(w);
  if (!at) return 'not_started';
  return now.getTime() >= at.getTime() ? 'open' : 'scheduled';
}

/** Whether the window should open now (allocate) and has not yet. */
export function shouldOpen(w: WindowInput, now: Date = new Date()): boolean {
  return !w.startedAt && windowState(w, now) === 'open';
}

// ── Rubric marks ────────────────────────────────────────────────────────────

export interface ReviewMark {
  criterionId: string;
  ratingId: string | null;
  points: number;
  comment: string | null;
}

interface RubricShape {
  criteria: {
    id: string;
    points: number;
    ratings: { id: string; points: number }[];
  }[];
}

/**
 * Check a reviewer's marks against the rubric. A level takes its points; bare
 * points must be within 0 and the criterion's. When `complete`, every
 * criterion must be marked. Returns the cleaned marks or an error message.
 */
export function validateMarks(
  rubric: RubricShape,
  marks: {
    criterionId: string;
    ratingId?: string | null;
    points?: number | null;
    comment?: string | null;
  }[],
  complete: boolean,
): { marks: ReviewMark[] } | { error: string } {
  const out: ReviewMark[] = [];
  const seen = new Set<string>();
  for (const m of marks) {
    const criterion = rubric.criteria.find((c) => c.id === m.criterionId);
    if (!criterion) return { error: 'That criterion is not on this rubric' };
    if (seen.has(criterion.id)) return { error: 'Each criterion can be marked once' };
    seen.add(criterion.id);
    let points: number;
    let ratingId: string | null = null;
    if (m.ratingId) {
      const rating = criterion.ratings.find((r) => r.id === m.ratingId);
      if (!rating) return { error: 'That level is not on this criterion' };
      ratingId = rating.id;
      points = rating.points;
    } else if (typeof m.points === 'number' && Number.isFinite(m.points)) {
      points = m.points;
    } else {
      return { error: 'Choose a level or points for each criterion' };
    }
    if (points < 0 || points > criterion.points) {
      return { error: `Points must be between 0 and ${criterion.points}` };
    }
    const comment = m.comment?.trim() || null;
    if (comment && comment.length > 2000) {
      return { error: 'Keep each criterion comment under 2000 characters' };
    }
    out.push({ criterionId: criterion.id, ratingId, points, comment });
  }
  if (complete && seen.size < rubric.criteria.length) {
    return { error: 'Mark every criterion before submitting' };
  }
  return { marks: out };
}

/** The display name of a file shown to an anonymous reviewer. */
export function anonymousFileName(name: string, index: number): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).replace(/[^.A-Za-z0-9]/g, '').slice(0, 10) : '';
  return `Attachment ${index + 1}${ext}`;
}
