import type { Prisma } from '@/generated/prisma/client';
import { questionCredit } from '@/grading/quiz-questions';

type Db = Prisma.TransactionClient;

export type EvidenceSource = 'activity' | 'rubric' | 'question';

/** The evidence a submission should have for one alignment. */
export interface DesiredEvidence {
  alignmentId: string;
  outcomeId: string;
  submissionId: string;
  studentId: string;
  source: EvidenceSource;
  ratio: number;
  ratingRank: number | null;
  ratingCount: number | null;
  assessedAt: Date;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A mark counts as evidence only once it is final and not excused. */
export function countsAsEvidence(s: { status: string; excused: boolean }): boolean {
  return s.status === 'graded' && !s.excused;
}

/**
 * The mark that measures learning: the raw mark before any late penalty
 * (`raw_score`), else the stored score (an imported mark, or one from before
 * late policies). Mastery measures learning, not punctuality.
 */
export function markBeforePenalty(s: { score: unknown; raw_score: unknown }): number | null {
  const raw = s.raw_score ?? s.score;
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** A rating's rank among its criterion's ratings, lowest points first (ties by position). */
export function ratingRank(
  ratings: { id: string; points: number; position: number }[],
  ratingId: string,
): { rank: number; count: number } | null {
  const ordered = [...ratings].sort((a, b) => a.points - b.points || a.position - b.position);
  const rank = ordered.findIndex((r) => r.id === ratingId);
  return rank < 0 ? null : { rank, count: ordered.length };
}

/**
 * Work out every aligned outcome's evidence again for an activity's
 * submissions (or only `studentIds`'), in the caller's transaction, and
 * write the difference.
 *
 * The one place marks become mastery evidence. Called wherever a mark is
 * written: teacher marks (`grade()`, which LTI score passback also uses),
 * excusing, waivers, rubric marking, quiz scoring (submit and expiry),
 * essay/file question marking, the gradebook import and an activity's
 * points changing; and when an alignment is added.
 *
 * - Only `graded`, not excused submissions produce evidence; anything else
 *   has its evidence removed.
 * - A whole-activity alignment uses the mark before any late penalty
 *   (`raw_score`, else `score`) over the activity's points.
 * - A rubric row (criterion) alignment uses that criterion's assessment:
 *   the chosen rating's rank (mapped onto the scale when read) and points
 *   over the criterion's points.
 * - A quiz question alignment uses the question's credit (0..1) from the
 *   stored answers, for questions the student's attempt included; a
 *   question still waiting for the teacher's mark is skipped.
 *
 * Cheap when nothing is aligned: one query, then it returns.
 */
export async function refreshOutcomeEvidence(
  tx: Db,
  activityId: string,
  studentIds?: string[],
): Promise<void> {
  if (studentIds && studentIds.length === 0) return;
  const activity = await tx.activity.findUnique({
    where: { id: activityId },
    select: { id: true, course_id: true, kind: true, points: true },
  });
  if (!activity) return;

  const alignments = await tx.outcome_alignment.findMany({
    where: {
      course_id: activity.course_id,
      OR: [
        { activity_id: activityId },
        { criterion_id: { not: null } },
        ...(activity.kind === 'quiz' ? [{ question_id: { not: null } }] : []),
      ],
    },
    select: { id: true, outcome_id: true, activity_id: true, criterion_id: true, question_id: true },
  });

  const studentFilter = studentIds ? { student_id: { in: studentIds } } : {};
  const submissions = await tx.submission.findMany({
    where: { activity_id: activityId, ...studentFilter },
    select: {
      id: true,
      student_id: true,
      status: true,
      excused: true,
      score: true,
      raw_score: true,
      graded_at: true,
      submitted_at: true,
      updated_at: true,
    },
  });
  if (!submissions || submissions.length === 0) return;
  const submissionIds = submissions.map((s) => s.id);

  const existing = await tx.outcome_evidence.findMany({
    where: { submission_id: { in: submissionIds } },
    select: {
      id: true,
      alignment_id: true,
      submission_id: true,
      ratio: true,
      rating_rank: true,
      rating_count: true,
      assessed_at: true,
    },
  });
  if ((!alignments || alignments.length === 0) && (!existing || existing.length === 0)) return;

  const desired = await desiredEvidence(tx, activity, alignments ?? [], submissions);
  await writeEvidence(tx, activity, desired, existing ?? []);
}

async function desiredEvidence(
  tx: Db,
  activity: { id: string; kind: string; points: unknown },
  alignments: { id: string; outcome_id: string; activity_id: string | null; criterion_id: string | null; question_id: string | null }[],
  submissions: {
    id: string;
    student_id: string;
    status: string;
    excused: boolean;
    score: unknown;
    raw_score: unknown;
    graded_at: Date | null;
    submitted_at: Date | null;
    updated_at: Date;
  }[],
): Promise<DesiredEvidence[]> {
  const counted = submissions.filter(countsAsEvidence);
  if (counted.length === 0 || alignments.length === 0) return [];
  const out: DesiredEvidence[] = [];
  const at = (s: { graded_at: Date | null; submitted_at: Date | null; updated_at: Date }) =>
    s.graded_at ?? s.submitted_at ?? s.updated_at;
  const points = Number(activity.points);

  // Whole activity.
  const whole = alignments.filter((a) => a.activity_id === activity.id);
  if (whole.length && points > 0) {
    for (const s of counted) {
      const mark = markBeforePenalty(s);
      if (mark === null) continue;
      for (const a of whole) {
        out.push({
          alignmentId: a.id,
          outcomeId: a.outcome_id,
          submissionId: s.id,
          studentId: s.student_id,
          source: 'activity',
          ratio: clamp01(mark / points),
          ratingRank: null,
          ratingCount: null,
          assessedAt: at(s),
        });
      }
    }
  }

  // Rubric rows.
  const byCriterion = new Map<string, typeof alignments>();
  for (const a of alignments) {
    if (!a.criterion_id) continue;
    byCriterion.set(a.criterion_id, [...(byCriterion.get(a.criterion_id) ?? []), a]);
  }
  if (byCriterion.size) {
    const assessments = await tx.rubric_assessment.findMany({
      where: { submission_id: { in: counted.map((s) => s.id) }, criterion_id: { in: [...byCriterion.keys()] } },
      select: { submission_id: true, criterion_id: true, rating_id: true, points: true },
    });
    if (assessments?.length) {
      const criteria = await tx.rubric_criterion.findMany({
        where: { id: { in: [...new Set(assessments.map((r) => r.criterion_id))] } },
        select: {
          id: true,
          points: true,
          rubric_rating: { select: { id: true, points: true, position: true } },
        },
      });
      const criterionOf = new Map((criteria ?? []).map((c) => [c.id, c]));
      const subOf = new Map(counted.map((s) => [s.id, s]));
      for (const r of assessments) {
        const c = criterionOf.get(r.criterion_id);
        const s = subOf.get(r.submission_id);
        if (!c || !s) continue;
        const max = Number(c.points);
        const ratio = max > 0 ? clamp01(Number(r.points) / max) : 0;
        const rank = r.rating_id
          ? ratingRank(
              (c.rubric_rating ?? []).map((x) => ({ id: x.id, points: Number(x.points), position: x.position })),
              r.rating_id,
            )
          : null;
        for (const a of byCriterion.get(r.criterion_id) ?? []) {
          out.push({
            alignmentId: a.id,
            outcomeId: a.outcome_id,
            submissionId: s.id,
            studentId: s.student_id,
            source: 'rubric',
            ratio,
            ratingRank: rank?.rank ?? null,
            ratingCount: rank?.count ?? null,
            assessedAt: at(s),
          });
        }
      }
    }
  }

  // Quiz questions.
  const byQuestion = new Map<string, typeof alignments>();
  for (const a of alignments) {
    if (!a.question_id) continue;
    byQuestion.set(a.question_id, [...(byQuestion.get(a.question_id) ?? []), a]);
  }
  if (activity.kind === 'quiz' && byQuestion.size) {
    out.push(...(await questionEvidence(tx, activity.id, counted, byQuestion, at)));
  }
  return out;
}

async function questionEvidence(
  tx: Db,
  activityId: string,
  counted: { id: string; student_id: string; graded_at: Date | null; submitted_at: Date | null; updated_at: Date }[],
  byQuestion: Map<string, { id: string; outcome_id: string }[]>,
  at: (s: { graded_at: Date | null; submitted_at: Date | null; updated_at: Date }) => Date,
): Promise<DesiredEvidence[]> {
  const ids = [...byQuestion.keys()];
  const [questions, plans, answers] = await Promise.all([
    tx.quiz_question.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        activity_id: true,
        kind: true,
        points: true,
        numeric_answer: true,
        numeric_tolerance: true,
        partial_credit: true,
        quiz_option: { select: { id: true, label: true, is_correct: true, match_label: true } },
      },
    }),
    tx.quiz_attempt_question.findMany({
      where: { submission_id: { in: counted.map((s) => s.id) } },
      select: { submission_id: true, question_id: true },
    }),
    tx.quiz_answer.findMany({
      where: { submission_id: { in: counted.map((s) => s.id) }, question_id: { in: ids } },
      select: {
        submission_id: true,
        question_id: true,
        option_id: true,
        option_ids: true,
        matches: true,
        text_answer: true,
        numeric_answer: true,
        file_id: true,
        manual_points: true,
      },
    }),
  ]);
  const planOf = new Map<string, Set<string>>();
  for (const p of plans ?? []) {
    planOf.set(p.submission_id, (planOf.get(p.submission_id) ?? new Set()).add(p.question_id));
  }
  const answerOf = new Map((answers ?? []).map((a) => [`${a.submission_id}:${a.question_id}`, a]));
  const out: DesiredEvidence[] = [];
  for (const s of counted) {
    const plan = planOf.get(s.id);
    for (const q of questions ?? []) {
      // The attempt's own questions; an attempt from before attempt plans
      // used the quiz's own questions.
      const included = plan ? plan.has(q.id) : q.activity_id === activityId;
      if (!included) continue;
      const a = answerOf.get(`${s.id}:${q.id}`);
      const { credit, needsMarking } = questionCredit(
        {
          kind: q.kind,
          points: Number(q.points),
          numericAnswer: q.numeric_answer === null ? null : Number(q.numeric_answer),
          numericTolerance: Number(q.numeric_tolerance ?? 0),
          partialCredit: q.partial_credit,
          options: (q.quiz_option ?? []).map((o) => ({
            id: o.id,
            label: o.label,
            isCorrect: o.is_correct,
            matchLabel: o.match_label,
          })),
        },
        a
          ? {
              optionId: a.option_id,
              optionIds: a.option_ids,
              matches: (a.matches as Record<string, string> | null) ?? null,
              text: a.text_answer,
              numeric: a.numeric_answer === null ? null : Number(a.numeric_answer),
              fileId: a.file_id,
              manualPoints: a.manual_points === null ? null : Number(a.manual_points),
            }
          : null,
      );
      if (needsMarking) continue;
      if (Number(q.points) <= 0) continue;
      for (const al of byQuestion.get(q.id) ?? []) {
        out.push({
          alignmentId: al.id,
          outcomeId: al.outcome_id,
          submissionId: s.id,
          studentId: s.student_id,
          source: 'question',
          ratio: clamp01(credit),
          ratingRank: null,
          ratingCount: null,
          assessedAt: at(s),
        });
      }
    }
  }
  return out;
}

async function writeEvidence(
  tx: Db,
  activity: { id: string; course_id: string },
  desired: DesiredEvidence[],
  existing: {
    id: string;
    alignment_id: string;
    submission_id: string;
    ratio: number;
    rating_rank: number | null;
    rating_count: number | null;
    assessed_at: Date;
  }[],
): Promise<void> {
  const key = (alignmentId: string, submissionId: string) => `${alignmentId}:${submissionId}`;
  const want = new Map(desired.map((d) => [key(d.alignmentId, d.submissionId), d]));
  const stale = existing.filter((e) => !want.has(key(e.alignment_id, e.submission_id)));
  if (stale.length) {
    await tx.outcome_evidence.deleteMany({ where: { id: { in: stale.map((e) => e.id) } } });
  }
  const have = new Map(existing.map((e) => [key(e.alignment_id, e.submission_id), e]));
  const create: DesiredEvidence[] = [];
  for (const d of want.values()) {
    const e = have.get(key(d.alignmentId, d.submissionId));
    if (!e) {
      create.push(d);
      continue;
    }
    const same =
      Math.abs(e.ratio - d.ratio) < 1e-9 &&
      e.rating_rank === d.ratingRank &&
      e.rating_count === d.ratingCount &&
      new Date(e.assessed_at).getTime() === d.assessedAt.getTime();
    if (same) continue;
    await tx.outcome_evidence.update({
      where: { id: e.id },
      data: {
        ratio: d.ratio,
        rating_rank: d.ratingRank,
        rating_count: d.ratingCount,
        assessed_at: d.assessedAt,
      },
    });
  }
  if (create.length) {
    await tx.outcome_evidence.createMany({
      data: create.map((d) => ({
        outcome_id: d.outcomeId,
        alignment_id: d.alignmentId,
        submission_id: d.submissionId,
        student_id: d.studentId,
        course_id: activity.course_id,
        activity_id: activity.id,
        source: d.source,
        ratio: d.ratio,
        rating_rank: d.ratingRank,
        rating_count: d.ratingCount,
        assessed_at: d.assessedAt,
      })),
      skipDuplicates: true,
    });
  }
}

/**
 * The activities whose submissions an alignment can produce evidence on:
 * the activity itself, the activities whose submissions were marked on the
 * criterion, or the quizzes that asked the question.
 */
export async function activitiesForAlignment(
  tx: Db,
  target: { activityId?: string | null; criterionId?: string | null; questionId?: string | null },
): Promise<string[]> {
  if (target.activityId) return [target.activityId];
  if (target.criterionId) {
    const rows = await tx.submission.findMany({
      where: { rubric_assessment: { some: { criterion_id: target.criterionId } } },
      select: { activity_id: true },
      distinct: ['activity_id'],
    });
    return (rows ?? []).map((r) => r.activity_id);
  }
  if (target.questionId) {
    const [question, rows] = await Promise.all([
      tx.quiz_question.findUnique({ where: { id: target.questionId }, select: { activity_id: true } }),
      tx.submission.findMany({
        where: {
          OR: [
            { quiz_answer: { some: { question_id: target.questionId } } },
            { quiz_attempt_question: { some: { question_id: target.questionId } } },
          ],
        },
        select: { activity_id: true },
        distinct: ['activity_id'],
      }),
    ]);
    return [...new Set([...(question?.activity_id ? [question.activity_id] : []), ...(rows ?? []).map((r) => r.activity_id)])];
  }
  return [];
}

/**
 * For course copy and template import: copy the source course's own
 * outcomes and its alignments onto the copied activities, rubric rows and
 * quiz questions. `activityIds`, `criterionIds` and `questionIds` map source
 * ids to their copies; an alignment whose target was not copied is skipped.
 * School outcomes stay the same outcome when both courses are in the same
 * school and are skipped otherwise; course outcomes are copied (archived
 * ones only when something copied still uses them). No evidence is copied.
 * Run inside the copy's transaction.
 */
export async function copyOutcomeAlignments(
  tx: Db,
  input: {
    sourceCourseId: string;
    targetCourseId: string;
    activityIds: Map<string, string>;
    criterionIds?: Map<string, string>;
    questionIds?: Map<string, string>;
    userId?: string | null;
  },
): Promise<{ outcomes: number; alignments: number }> {
  const [source, target] = await Promise.all([
    tx.course.findUnique({ where: { id: input.sourceCourseId }, select: { school_id: true } }),
    tx.course.findUnique({ where: { id: input.targetCourseId }, select: { school_id: true } }),
  ]);
  if (!source || !target) return { outcomes: 0, alignments: 0 };
  const sameSchool = source.school_id === target.school_id;

  const [ownOutcomes, alignments] = await Promise.all([
    tx.outcome.findMany({
      where: { course_id: input.sourceCourseId },
      select: {
        id: true,
        parent_id: true,
        code: true,
        title: true,
        description: true,
        subject: true,
        grade_level: true,
        position: true,
        archived_at: true,
      },
    }),
    tx.outcome_alignment.findMany({
      where: { course_id: input.sourceCourseId },
      select: {
        outcome_id: true,
        activity_id: true,
        criterion_id: true,
        question_id: true,
        outcome: { select: { course_id: true, school_id: true } },
      },
    }),
  ]);

  const mapTarget = (a: { activity_id: string | null; criterion_id: string | null; question_id: string | null }) => {
    if (a.activity_id) {
      const id = input.activityIds.get(a.activity_id);
      return id ? { activity_id: id } : null;
    }
    if (a.criterion_id) {
      const id = input.criterionIds?.get(a.criterion_id);
      return id ? { criterion_id: id } : null;
    }
    if (a.question_id) {
      const id = input.questionIds?.get(a.question_id);
      return id ? { question_id: id } : null;
    }
    return null;
  };
  const usable = alignments.filter((a) => mapTarget(a) && (a.outcome.course_id || sameSchool));
  const usedOwn = new Set(usable.filter((a) => a.outcome.course_id).map((a) => a.outcome_id));

  // Copy course outcomes, parents first so children can point at them.
  const outcomeMap = new Map<string, string>();
  const toCopy = ownOutcomes.filter((o) => !o.archived_at || usedOwn.has(o.id));
  const pending = [...toCopy];
  let guard = pending.length + 1;
  while (pending.length && guard-- > 0) {
    for (let i = 0; i < pending.length; ) {
      const o = pending[i];
      const parentKnown = !o.parent_id || outcomeMap.has(o.parent_id) || !toCopy.some((x) => x.id === o.parent_id);
      if (!parentKnown) {
        i++;
        continue;
      }
      const created = await tx.outcome.create({
        data: {
          school_id: target.school_id,
          course_id: input.targetCourseId,
          parent_id: o.parent_id ? (outcomeMap.get(o.parent_id) ?? null) : null,
          code: o.code,
          title: o.title,
          description: o.description,
          subject: o.subject,
          grade_level: o.grade_level,
          position: o.position,
          archived_at: o.archived_at,
          created_by: input.userId ?? null,
        },
        select: { id: true },
      });
      outcomeMap.set(o.id, created.id);
      pending.splice(i, 1);
    }
  }

  let count = 0;
  for (const a of usable) {
    const outcomeId = a.outcome.course_id ? outcomeMap.get(a.outcome_id) : a.outcome_id;
    const t = mapTarget(a);
    if (!outcomeId || !t) continue;
    await tx.outcome_alignment.createMany({
      data: [{ outcome_id: outcomeId, course_id: input.targetCourseId, created_by: input.userId ?? null, ...t }],
      skipDuplicates: true,
    });
    count++;
  }
  return { outcomes: outcomeMap.size, alignments: count };
}
