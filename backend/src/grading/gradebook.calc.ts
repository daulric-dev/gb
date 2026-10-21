/**
 * The course total, as pure functions.
 *
 * Kept free of Nest and Supabase so the rules in LMS_REVAMP_PLAN.md ("Grade
 * calculation") can be tested exhaustively, and so the teacher's gradebook,
 * the student's grades page and the portal course cards all compute the same
 * number from the same code.
 *
 * The model is Canvas's "current grade": only marked work counts, so a
 * student's total is what they have earned so far, not what they would have
 * if every missing piece scored zero.
 */

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
}

export interface CalcResult {
  percent: number | null;
  groups: CalcGroupScore[];
}

export interface CalcBand {
  label: string;
  minPercentage: number;
  maxPercentage: number;
}

export const UNGROUPED_NAME = 'Ungrouped';

/** Two decimals: enough for a gradebook, and stable across float noise. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

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
    { earned: number; possible: number }
  >();
  for (const g of ordered) buckets.set(g.id, { earned: 0, possible: 0 });

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
      buckets.set(null, { earned: 0, possible: 0 });
    }

    const submission = lookup(activity.id);
    if (!counts(activity, submission)) continue;

    const bucket = buckets.get(key)!;
    bucket.earned += Number(submission!.score);
    bucket.possible += Number(activity.points);
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

  return { percent, groups: scores };
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
