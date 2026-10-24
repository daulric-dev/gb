/**
 * The course total, as pure functions.
 *
 * Kept free of Nest and the database so the rules in LMS_REVAMP_PLAN.md ("Grade
 * calculation") can be tested exhaustively, and so the teacher's gradebook,
 * the student's grades page and the portal course cards all compute the same
 * number from the same code.
 *
 * The model is Canvas's "current grade": only marked work counts, so a
 * student's total is what they have earned so far, not what they would have
 * if every missing piece scored zero.
 */

import { roundScore } from './round';

export interface CalcActivity {
  id: string;
  assignmentGroupId: string | null;
  points: number;
  status: 'draft' | 'published' | 'closed';
  omitFromFinalGrade: boolean;
}

export interface CalcGroup {
  id: string;
  name: string;
  weight: number | null;
  position: number;
  /** Drop this many of a student's counted marks that hurt the group most. */
  dropLowest?: number;
  /** Then drop this many that help it most. */
  dropHighest?: number;
}

export interface CalcSubmission {
  status: 'draft' | 'submitted' | 'graded' | null;
  score: number | null;
  excused: boolean;
}

export interface CalcGroupScore {
  groupId: string | null;
  name: string;
  weight: number | null;
  earned: number;
  possible: number;
  percent: number | null;
  /** Activities left out of this group's total by its drop rules. */
  dropped: string[];
}

export interface CalcResult {
  percent: number | null;
  groups: CalcGroupScore[];
  /** Every dropped activity id, across all groups. */
  dropped: string[];
}

/** One counted mark, as the drop rules see it. */
export interface DropItem {
  id: string;
  earned: number;
  possible: number;
}

export interface CalcBand {
  label: string;
  minPercentage: number;
  maxPercentage: number;
}

export const UNGROUPED_NAME = 'Ungrouped';

/** Two decimals: enough for a gradebook, and stable across float noise. */
const round2 = roundScore;

/**
 * Whether one activity's mark counts toward the total for one student.
 *
 * Drafts are the teacher's working copy and closed work was published first,
 * so "published" here means published or closed. Ungraded work is ignored
 * rather than counted as zero, and an excused mark is left out entirely -
 * both its score and its points.
 */
export function counts(
  activity: CalcActivity,
  submission: CalcSubmission | undefined,
): boolean {
  if (activity.status !== 'published' && activity.status !== 'closed') {
    return false;
  }
  if (activity.omitFromFinalGrade) return false;
  if (!submission) return false;
  if (submission.status !== 'graded') return false;
  if (submission.excused) return false;
  // Un-excusing a student who never handed in leaves a graded row without a
  // score; there is nothing to count until a teacher marks it.
  if (submission.score === null || submission.score === undefined) return false;
  return true;
}

/**
 * Whether the course is weighted at all.
 *
 * Weighted as soon as any group carries a positive weight. A group with no
 * weight in a weighted course then counts for nothing, the same treatment the
 * implicit Ungrouped bucket gets; a course whose weights are all blank or all
 * zero has nothing to weight by, so it falls back to plain points.
 */
export function isWeighted(groups: CalcGroup[]): boolean {
  return groups.some((g) => g.weight !== null && g.weight > 0);
}

/**
 * One student's course total.
 *
 * `submissions` is keyed by activity id. Activities whose group is not in
 * `groups` (deleted, or from another course) fall into Ungrouped, which is
 * only listed when something is in it.
 */
export function calculateCourseGrade(
  groups: CalcGroup[],
  activities: CalcActivity[],
  submissions: Map<string, CalcSubmission> | Record<string, CalcSubmission>,
): CalcResult {
  const lookup = (id: string): CalcSubmission | undefined =>
    submissions instanceof Map ? submissions.get(id) : submissions[id];

  const weighted = isWeighted(groups);
  const ordered = [...groups].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
  const known = new Set(ordered.map((g) => g.id));

  const buckets = new Map<
    string | null,
    { earned: number; possible: number; items: DropItem[]; dropped: string[] }
  >();
  const empty = () => ({
    earned: 0,
    possible: 0,
    items: [] as DropItem[],
    dropped: [] as string[],
  });
  for (const g of ordered) buckets.set(g.id, empty());

  let hasUngrouped = false;

  for (const activity of activities) {
    // Only published work shapes the visible groups; a draft in a group of
    // its own must not make an empty Ungrouped row appear.
    if (activity.status !== 'published' && activity.status !== 'closed') {
      continue;
    }

    const key =
      activity.assignmentGroupId && known.has(activity.assignmentGroupId)
        ? activity.assignmentGroupId
        : null;

    if (key === null && !hasUngrouped) {
      hasUngrouped = true;
      buckets.set(null, empty());
    }

    const submission = lookup(activity.id);
    if (!counts(activity, submission)) continue;

    buckets.get(key)!.items.push({
      id: activity.id,
      earned: Number(submission!.score),
      possible: Number(activity.points),
    });
  }

  // Drop rules apply per student, among the marks that count, before the
  // group's sums are taken. Ungrouped has no rules.
  const rules = new Map(ordered.map((g) => [g.id, g]));
  for (const [key, bucket] of buckets) {
    const group = key === null ? undefined : rules.get(key);
    const { kept, dropped } = applyDrops(
      bucket.items,
      group?.dropLowest ?? 0,
      group?.dropHighest ?? 0,
    );
    bucket.dropped = dropped;
    for (const item of kept) {
      bucket.earned += item.earned;
      bucket.possible += item.possible;
    }
  }

  const scores: CalcGroupScore[] = ordered.map((g) => {
    const b = buckets.get(g.id)!;
    return {
      groupId: g.id,
      name: g.name,
      weight: g.weight,
      earned: round2(b.earned),
      possible: round2(b.possible),
      percent: b.possible > 0 ? round2((b.earned / b.possible) * 100) : null,
      dropped: b.dropped,
    };
  });

  if (hasUngrouped) {
    const b = buckets.get(null)!;
    scores.push({
      groupId: null,
      name: UNGROUPED_NAME,
      weight: weighted ? 0 : null,
      earned: round2(b.earned),
      possible: round2(b.possible),
      percent: b.possible > 0 ? round2((b.earned / b.possible) * 100) : null,
      dropped: b.dropped,
    });
  }

  let percent: number | null;

  if (weighted) {
    // Renormalise over the groups that have marked work, so a term with no
    // exam yet is not dragged down by the exam's empty share.
    let weightSum = 0;
    let weightedSum = 0;
    for (const s of scores) {
      const w = s.weight ?? 0;
      // Unrounded, so rounding happens once, on the total.
      const b = buckets.get(s.groupId)!;
      if (w <= 0 || b.possible <= 0) continue;
      weightSum += w;
      weightedSum += w * ((b.earned / b.possible) * 100);
    }
    percent = weightSum > 0 ? round2(weightedSum / weightSum) : null;
  } else {
    let earned = 0;
    let possible = 0;
    for (const b of buckets.values()) {
      earned += b.earned;
      possible += b.possible;
    }
    percent = possible > 0 ? round2((earned / possible) * 100) : null;
  }

  return { percent, groups: scores, dropped: scores.flatMap((g) => g.dropped) };
}

/**
 * Exhaustive search is used while the number of ways to choose what to drop
 * stays under this; past it, the ratio search below (exact too, just harder
 * to read) takes over.
 */
const EXHAUSTIVE_LIMIT = 5000;

/**
 * Canvas's drop rules for one group of one student's counted marks.
 *
 * "Drop lowest" is not "drop the smallest percentages": with unequal points
 * the marks to drop are the ones whose removal leaves the highest group
 * percentage (dropping a 0/1 can matter less than dropping a 40/100). So the
 * kept set is the one of the right size with the best earned/possible ratio,
 * and "drop highest" is then the same search for the worst ratio among what
 * is left. At least one mark is always kept: a rule never empties a group.
 *
 * Ties go to keeping the earlier activities, so the result is stable.
 */
export function applyDrops(
  items: DropItem[],
  dropLowest: number,
  dropHighest: number,
): { kept: DropItem[]; dropped: string[] } {
  let kept = items;
  const dropped: string[] = [];

  const low = Math.min(Math.max(0, Math.floor(dropLowest)), kept.length - 1);
  if (low > 0) {
    const next = bestSubset(kept, kept.length - low, 1);
    dropped.push(...kept.filter((i) => !next.includes(i)).map((i) => i.id));
    kept = next;
  }

  const high = Math.min(Math.max(0, Math.floor(dropHighest)), kept.length - 1);
  if (high > 0) {
    const next = bestSubset(kept, kept.length - high, -1);
    dropped.push(...kept.filter((i) => !next.includes(i)).map((i) => i.id));
    kept = next;
  }

  return { kept, dropped };
}

/**
 * Compare two kept sets by ratio, times `sign` (1 = higher is better, -1 =
 * lower is better). A set with no possible points has no percentage at all,
 * so it loses to any set that has one.
 */
function better(
  a: { earned: number; possible: number },
  b: { earned: number; possible: number },
  sign: 1 | -1,
): boolean {
  if (a.possible <= 0) return false;
  if (b.possible <= 0) return true;
  // Cross-multiplied, so equal ratios compare equal without division noise.
  return sign * (a.earned * b.possible - b.earned * a.possible) > 1e-9;
}

function totals(items: DropItem[]) {
  let earned = 0;
  let possible = 0;
  for (const i of items) {
    earned += i.earned;
    possible += i.possible;
  }
  return { earned, possible };
}

function choose(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) {
    r = (r * (n - k + i)) / i;
    if (r > EXHAUSTIVE_LIMIT) return Infinity;
  }
  return r;
}

/** The `keep`-sized subset with the best ratio (see `better`). */
export function bestSubset(
  items: DropItem[],
  keep: number,
  sign: 1 | -1,
): DropItem[] {
  if (keep >= items.length) return items;
  const drop = items.length - keep;
  if (choose(items.length, drop) <= EXHAUSTIVE_LIMIT) {
    return exhaustiveSubset(items, drop, sign);
  }
  return ratioSearchSubset(items, keep, sign);
}

/** Try every choice of `drop` items to leave out. */
function exhaustiveSubset(
  items: DropItem[],
  drop: number,
  sign: 1 | -1,
): DropItem[] {
  let best: DropItem[] | null = null;
  let bestTotals = { earned: 0, possible: 0 };
  const out: number[] = [];

  // Combinations of indices to drop, latest first, so the first best found
  // (and kept on ties) drops the latest activities.
  const walk = (start: number) => {
    if (out.length === drop) {
      const skip = new Set(out);
      const kept = items.filter((_, i) => !skip.has(i));
      const t = totals(kept);
      if (best === null || better(t, bestTotals, sign)) {
        best = kept;
        bestTotals = t;
      }
      return;
    }
    for (let i = start; i >= drop - out.length - 1; i--) {
      out.push(i);
      walk(i - 1);
      out.pop();
    }
  };
  walk(items.length - 1);
  return best ?? items;
}

/**
 * Dinkelbach's method for the best ratio over fixed-size subsets: for a
 * guess q the best set maximises sum(earned - q * possible), which is just
 * the top `keep` items by that value; re-guess q from that set until it
 * stops improving. Exact, and converges in a handful of rounds.
 */
export function ratioSearchSubset(
  items: DropItem[],
  keep: number,
  sign: 1 | -1,
): DropItem[] {
  const indexed = items.map((item, index) => ({ item, index }));
  // Start from the largest-points items so the first guess has a ratio.
  let current = [...indexed]
    .sort((a, b) => b.item.possible - a.item.possible || a.index - b.index)
    .slice(0, keep)
    .map((x) => x.item);
  let t = totals(current);

  for (let round = 0; round < 100 && t.possible > 0; round++) {
    const q = t.earned / t.possible;
    const next = [...indexed]
      .sort((a, b) => {
        const va = sign * (a.item.earned - q * a.item.possible);
        const vb = sign * (b.item.earned - q * b.item.possible);
        return vb - va || a.index - b.index;
      })
      .slice(0, keep)
      .sort((a, b) => a.index - b.index)
      .map((x) => x.item);
    const nt = totals(next);
    if (!better(nt, t, sign)) break;
    current = next;
    t = nt;
  }

  const chosen = new Set(current);
  return items.filter((i) => chosen.has(i));
}

/**
 * The letter for a percentage.
 *
 * Bands are matched on their lower bound, highest first, rather than needing
 * min <= p <= max: scales are usually typed as whole numbers (A 90-100,
 * B 80-89), and a strict match would leave 89.5 with no letter at all.
 */
export function letterFor(
  bands: CalcBand[],
  percent: number | null,
): string | null {
  if (percent === null || bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => b.minPercentage - a.minPercentage);
  const band = sorted.find((b) => percent >= b.minPercentage);
  return band?.label ?? null;
}
