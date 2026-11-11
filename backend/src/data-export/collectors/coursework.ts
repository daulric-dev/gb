import type { Collector, ExportObject } from '../data-export.types';
import { openText } from '@/account/sensitive-text';
import { courseNames, studentIn, unique } from './helpers';
import { fileObject } from './files';

type FileRow = { id: string; name: string; bucket: string; storage_path: string; status: string; size_bytes: bigint };
const FILE_SELECT = { id: true, name: true, bucket: true, storage_path: true, status: true, size_bytes: true } as const;

/**
 * Submissions with everything marked on them. Parent exports get what the
 * parent portal shows: the work list (title, due, handed in or not) with
 * `showWork`, and marks and feedback with `showGrades`; never the work
 * itself.
 */
export const courseworkCollector: Collector = {
  id: 'coursework',
  title: 'Coursework and grades',
  description:
    'Every assignment and quiz submission: what was handed in (text, answers, files - copied into files/coursework/), when, marks, feedback, rubric results, late penalties and excusals; deadline extensions and adjustments (extra time); peer reviews written and received.',
  covers: [
    'grading.submission.student_id',
    'grading.activity_extension.student_id',
    'grading.activity_accommodation.student_id',
    'grading.student_accommodation.student_id',
    'grading.peer_review_allocation.reviewer_id',
  ],
  scopes: ['self', 'staff', 'parent'],
  async collect(ctx) {
    const { prisma, subject } = ctx;
    if (subject.studentIds.length === 0) return { data: { submissions: [] }, count: 0 };
    const parent = subject.scope === 'parent';
    const showGrades = !parent || !!subject.parentSettings?.showGrades;
    const showWork = !parent || !!subject.parentSettings?.showWork;
    if (parent && !showGrades && !showWork) return { data: { submissions: [] }, count: 0 };
    const inCourse = subject.schoolId ? { activity: { course: { school_id: subject.schoolId } } } : {};

    const submissions = await prisma.submission.findMany({
      where: {
        student_id: studentIn(ctx),
        ...inCourse,
        // Parents see published work only, as in the portal.
        ...(parent ? { activity: { status: 'published', ...(subject.schoolId ? { course: { school_id: subject.schoolId } } : {}) } } : {}),
      },
      select: {
        id: true,
        status: true,
        text_body: true,
        submitted_at: true,
        score: true,
        raw_score: true,
        feedback: true,
        graded_at: true,
        attempt_count: true,
        excused: true,
        excused_reason: true,
        late_seconds: true,
        late_penalty_percent: true,
        late_penalty_waived: true,
        quiz_started_at: true,
        tab_switch_count: true,
        created_at: true,
        updated_at: true,
        activity: { select: { id: true, title: true, kind: true, points: true, due_at: true, course_id: true } },
        file: { select: FILE_SELECT },
        submission_file: { select: { file: { select: FILE_SELECT } } },
        quiz_answer: {
          select: {
            text_answer: true,
            matches: true,
            numeric_answer: true,
            option_ids: true,
            manual_points: true,
            manual_feedback: true,
            marked_at: true,
            quiz_question: { select: { prompt: true, kind: true, points: true } },
            quiz_option: { select: { label: true } },
            file: { select: FILE_SELECT },
          },
        },
        rubric_assessment: {
          select: {
            points: true,
            comment: true,
            rubric_criterion: { select: { title: true, points: true } },
            rubric_rating: { select: { label: true } },
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });
    const courses = await courseNames(ctx, submissions.map((s) => s.activity.course_id));
    const objects: ExportObject[] = [];
    const copy = (f: FileRow | null) => {
      if (!f || parent) return null;
      const obj = fileObject('coursework', f);
      if (obj) objects.push(obj);
      return { name: f.name, copiedTo: obj?.path ?? null };
    };

    const rows = submissions.map((s) => {
      const base = {
        course: courses.get(s.activity.course_id) ?? null,
        activity: s.activity.title,
        kind: s.activity.kind,
        dueAt: s.activity.due_at,
        status: s.status,
        submittedAt: s.submitted_at,
      };
      const grades = showGrades
        ? {
            pointsPossible: s.activity.points,
            score: s.score,
            scoreBeforeLatePenalty: s.raw_score,
            latePenaltyPercent: s.late_penalty_percent,
            latePenaltyWaived: s.late_penalty_waived,
            feedback: s.feedback,
            gradedAt: s.graded_at,
            excused: s.excused,
            excusedReason: s.excused_reason,
            rubric: s.rubric_assessment.map((r) => ({
              criterion: r.rubric_criterion.title,
              pointsPossible: r.rubric_criterion.points,
              rating: r.rubric_rating?.label ?? null,
              points: r.points,
              comment: r.comment,
            })),
          }
        : {};
      if (parent) return { ...base, ...grades };
      return {
        id: s.id,
        ...base,
        ...grades,
        text: s.text_body,
        attempts: s.attempt_count,
        lateSeconds: s.late_seconds,
        quizStartedAt: s.quiz_started_at,
        tabSwitchCount: s.tab_switch_count,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        files: [s.file, ...s.submission_file.map((sf) => sf.file)]
          .filter((f, i, all) => f && all.findIndex((g) => g?.id === f.id) === i)
          .map((f) => copy(f)),
        quizAnswers: s.quiz_answer.map((a) => ({
          question: a.quiz_question.prompt,
          questionKind: a.quiz_question.kind,
          pointsPossible: a.quiz_question.points,
          chosenOption: a.quiz_option?.label ?? null,
          chosenOptionIds: a.option_ids,
          text: a.text_answer,
          number: a.numeric_answer,
          matches: a.matches,
          file: copy(a.file),
          points: a.manual_points,
          feedback: a.manual_feedback,
          markedAt: a.marked_at,
        })),
      };
    });

    if (parent) return { data: { submissions: rows }, count: rows.length };

    const [extensions, activityAdjustments, standingAdjustment, reviewsWritten, reviewsReceived] = await Promise.all([
      prisma.activity_extension.findMany({
        where: { student_id: studentIn(ctx), ...inCourse },
        select: { due_at: true, reason: true, created_at: true, activity: { select: { title: true, course_id: true } } },
      }),
      prisma.activity_accommodation.findMany({
        where: { student_id: studentIn(ctx), ...inCourse },
        select: {
          id: true,
          time_multiplier: true,
          extra_minutes: true,
          lockdown_exempt: true,
          reason: true,
          created_at: true,
          activity: { select: { title: true, course_id: true } },
        },
      }),
      prisma.student_accommodation.findMany({
        where: { student_id: studentIn(ctx) },
        select: { id: true, time_multiplier: true, extra_minutes: true, lockdown_exempt: true, reason: true, created_at: true, updated_at: true },
      }),
      prisma.peer_review_allocation.findMany({
        where: { reviewer_id: studentIn(ctx), ...(subject.schoolId ? inCourse : {}) },
        select: {
          comment: true,
          rubric_marks: true,
          submitted_at: true,
          hidden: true,
          hidden_reason: true,
          activity: { select: { title: true, course_id: true } },
        },
      }),
      prisma.peer_review_allocation.findMany({
        where: { submission: { student_id: studentIn(ctx) }, submitted_at: { not: null }, ...(subject.scope === 'self' ? { hidden: false } : {}) },
        select: { comment: true, rubric_marks: true, submitted_at: true, hidden: true, activity: { select: { title: true, course_id: true } } },
      }),
    ]);
    const more = await courseNames(
      ctx,
      unique([...extensions, ...activityAdjustments, ...reviewsWritten, ...reviewsReceived].map((r) => r.activity.course_id)),
    );
    // Accommodation reasons need student:sensitive in a staff export.
    const showReason = subject.scope === 'self' || !!subject.sensitive;
    const where = (a: { title: string; course_id: string }) => ({ course: more.get(a.course_id) ?? null, activity: a.title });
    const data = {
      submissions: rows,
      extensions: extensions.map((e) => ({ ...where(e.activity), newDueAt: e.due_at, reason: e.reason, grantedAt: e.created_at })),
      adjustments: [
        ...standingAdjustment.map((a) => ({
          appliesTo: 'all timed quizzes',
          timeMultiplier: a.time_multiplier,
          extraMinutes: a.extra_minutes,
          lockdownExempt: a.lockdown_exempt,
          reason: showReason ? openText('student_accommodation.reason', a.id, a.reason) : undefined,
          setAt: a.created_at,
          updatedAt: a.updated_at,
        })),
        ...activityAdjustments.map((a) => ({
          appliesTo: where(a.activity),
          timeMultiplier: a.time_multiplier,
          extraMinutes: a.extra_minutes,
          lockdownExempt: a.lockdown_exempt,
          reason: showReason ? openText('activity_accommodation.reason', a.id, a.reason) : undefined,
          setAt: a.created_at,
        })),
      ],
      peerReviewsWritten: reviewsWritten.map((r) => ({
        ...where(r.activity),
        comment: r.comment,
        marks: r.rubric_marks,
        handedInAt: r.submitted_at,
        hiddenByStaff: r.hidden,
        ...(subject.scope === 'staff' ? { hiddenReason: r.hidden_reason } : {}),
      })),
      // Who wrote a review is left out: reviews may be anonymous.
      peerReviewsReceived: reviewsReceived.map((r) => ({
        ...where(r.activity),
        comment: r.comment,
        marks: r.rubric_marks,
        handedInAt: r.submitted_at,
        ...(subject.scope === 'staff' ? { hiddenByStaff: r.hidden } : {}),
      })),
    };
    const count =
      rows.length +
      data.extensions.length +
      data.adjustments.length +
      data.peerReviewsWritten.length +
      data.peerReviewsReceived.length;
    return { data, count, objects };
  },
};

export const masteryCollector: Collector = {
  id: 'mastery',
  title: 'Learning outcomes (mastery)',
  description: 'Evidence of mastery recorded against the school\'s learning outcomes: which outcome, from which piece of work, and the result.',
  covers: ['grading.outcome_evidence.student_id'],
  scopes: ['self', 'staff', 'parent'],
  parentSetting: 'showMastery',
  async collect(ctx) {
    if (ctx.subject.studentIds.length === 0) return { data: [], count: 0 };
    const rows = await ctx.prisma.outcome_evidence.findMany({
      where: { student_id: studentIn(ctx), ...(ctx.subject.schoolId ? { course: { school_id: ctx.subject.schoolId } } : {}) },
      select: {
        source: true,
        ratio: true,
        rating_rank: true,
        rating_count: true,
        assessed_at: true,
        course_id: true,
        outcome: { select: { code: true, title: true } },
        activity: { select: { title: true } },
      },
      orderBy: { assessed_at: 'asc' },
    });
    const courses = await courseNames(ctx, rows.map((r) => r.course_id));
    const data = rows.map((r) => ({
      outcome: `${r.outcome.code} ${r.outcome.title}`.trim(),
      course: courses.get(r.course_id) ?? null,
      activity: r.activity.title,
      source: r.source,
      result: r.ratio,
      ratingRank: r.rating_rank,
      ratingCount: r.rating_count,
      assessedAt: r.assessed_at,
    }));
    return { data, count: data.length };
  },
};
