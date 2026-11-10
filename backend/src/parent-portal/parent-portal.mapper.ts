/**
 * Parent-facing shapes, built by naming every field (never spreading the
 * student-portal rows), so a field added to those later does not leak to
 * parents by default.
 */

type When = string | null;

interface StudentWorkItem {
  id: string;
  courseId: string;
  courseName: string | null;
  kind: string;
  title: string;
  points: number;
  effectiveDueAt: When;
  hasExtension: boolean;
  /** Until when late work is still accepted from the child, if at all. */
  lateUntil?: When;
  submission: {
    status: string;
    score: number | null;
    excused: boolean;
    submittedAt: When;
    lateSeconds?: number;
  } | null;
}

export type ParentWorkState = 'upcoming' | 'missing' | 'submitted' | 'graded' | 'excused';

export interface ParentWorkItem {
  id: string;
  courseId: string;
  courseName: string | null;
  kind: string;
  title: string;
  points: number;
  dueAt: When;
  hasExtension: boolean;
  /** Missing work can still be handed in (late) until then; null when not. */
  lateUntil: When;
  /** Handed in after the due date. */
  late: boolean;
  state: ParentWorkState;
  submittedAt: When;
  /** Only when graded and the school shows grades. */
  score: number | null;
}

/** Where one piece of work stands for the child, on their own due date. */
export function workState(item: StudentWorkItem, now: number = Date.now()): ParentWorkState {
  const s = item.submission;
  if (s?.excused) return 'excused';
  if (s?.status === 'graded') return 'graded';
  if (s?.status === 'submitted') return 'submitted';
  const due = item.effectiveDueAt ? Date.parse(item.effectiveDueAt) : null;
  if (due !== null && due <= now) return 'missing';
  return 'upcoming';
}

/**
 * Upcoming (not handed in, not yet due or undated), missing (past the
 * child's effective due date, extensions included, and not handed in) and
 * recently returned work. Instructions, attempts and feedback are left out.
 */
export function toParentWork(
  items: StudentWorkItem[],
  showGrades: boolean,
  now: number = Date.now(),
) {
  const all: ParentWorkItem[] = items.map((i) => {
    const state = workState(i, now);
    return {
      id: i.id,
      courseId: i.courseId,
      courseName: i.courseName,
      kind: i.kind,
      title: i.title,
      points: i.points,
      dueAt: i.effectiveDueAt,
      hasExtension: i.hasExtension,
      lateUntil: i.lateUntil ?? null,
      late: (i.submission?.lateSeconds ?? 0) > 0,
      state,
      submittedAt: i.submission?.submittedAt ?? null,
      score: showGrades && state === 'graded' ? (i.submission?.score ?? null) : null,
    };
  });
  return {
    upcoming: all.filter((i) => i.state === 'upcoming'),
    missing: all.filter((i) => i.state === 'missing'),
    done: all.filter((i) => i.state === 'submitted' || i.state === 'graded' || i.state === 'excused'),
  };
}

interface StudentGradesData {
  grade: {
    percent: number | null;
    letter: string | null;
    groups: {
      groupId: string | null;
      name: string;
      weight: number | null;
      earned: number;
      possible: number;
      percent: number | null;
    }[];
  };
  activities: {
    id: string;
    title: string;
    kind: string;
    points: number;
    dueAt: When;
    groupName: string | null;
    dropped: boolean;
    submission: { status: string; score: number | null; excused: boolean } | null;
  }[];
}

/** A course's grades for a parent: totals, groups and marked scores only. */
export function toParentGrades(data: StudentGradesData) {
  return {
    grade: {
      percent: data.grade.percent,
      letter: data.grade.letter,
      groups: data.grade.groups.map((g) => ({
        groupId: g.groupId,
        name: g.name,
        weight: g.weight,
        earned: g.earned,
        possible: g.possible,
        percent: g.percent,
      })),
    },
    activities: data.activities.map((a) => ({
      id: a.id,
      title: a.title,
      kind: a.kind,
      points: a.points,
      dueAt: a.dueAt,
      groupName: a.groupName,
      dropped: a.dropped,
      // The score only once marked (the student-portal rule), never feedback.
      status: a.submission?.excused
        ? 'excused'
        : a.submission?.status === 'graded'
          ? 'graded'
          : a.submission?.status === 'submitted'
            ? 'submitted'
            : 'not_submitted',
      score: a.submission?.status === 'graded' ? a.submission.score : null,
    })),
  };
}
