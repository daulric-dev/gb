import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ZipArchive } from 'archiver';
import { basename } from 'node:path';
import { PrismaService } from '@/prisma/prisma.service';
import { AuditLogService, auditChanges } from '@/audit-log/audit-log.service';
import type { Prisma } from '@/generated/prisma/client';
import { isUniqueViolation, pgCode, raisedMessage } from '@/common/db-values';
import { roundScore, scoreOrNull } from './round';
import { FileManagerService } from '@/file-manager/file-manager.service';
import {
  CourseAccessService,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import {
  ACTIVITY_ORDER,
  ACTIVITY_SELECT,
  toPortalActivity,
  ts,
} from './activity.mapper';
import { loadAssessments, loadRubric } from './rubric.service';
import {
  assertNotClosed,
  closedError,
  effectiveCloseAt,
  effectiveDueAt,
  isPastDue,
  isQuizAttemptOpen,
  newQuizAttemptExpiry,
  studentDueFields,
} from './due-date';
import { refreshLateness } from './lateness';
import { toLatePolicy, toLateness } from './late-policy';
import { randomInt } from 'node:crypto';
import {
  answerRow,
  buildAttemptPlan,
  fileTypeAllowed,
  isManualKind,
  questionCredit,
  toSavedAnswer,
  toStudentQuestion,
  type AnswerInput,
  type AnswerRow,
} from './quiz-questions';
import { rescoreQuizFromAnswers } from './quiz-rescore';
import { CacheService } from '@/cache/cache.service';
import {
  accommodatedTimeLimit,
  effectiveAccommodation,
  lockdownFor,
  toAccommodationSummary,
  type AccommodationRow,
  type EffectiveAccommodation,
} from './accommodation';
import { loadAccommodation } from './accommodation.service';
import {
  scoreValue,
  toActivityRef,
  WebhookEvents,
} from '@/integrations/events';

const STUDENT_ACTIVITY_SELECT = {
  id: true,
  course_id: true,
  kind: true,
  title: true,
  instructions: true,
  points: true,
  due_at: true,
  status: true,
  allow_file: true,
  allow_multiple_files: true,
  allow_text: true,
  max_attempts: true,
  time_limit_minutes: true,
  lockdown_browser: true,
  shuffle_questions: true,
  shuffle_options: true,
  rubric_id: true,
  late_until: true,
  late_penalty_mode: true,
  late_penalty_value: true,
  late_penalty_cap: true,
} satisfies Prisma.activitySelect;

const DRAFT_SELECT = {
  id: true,
  status: true,
  file_id: true,
  attempt_count: true,
  graded_by: true,
  quiz_started_at: true,
  quiz_expires_at: true,
  is_away: true,
  tab_switch_count: true,
  last_away_at: true,
} satisfies Prisma.submissionSelect;

const MARKED_SELECT = {
  id: true,
  student_id: true,
  status: true,
  score: true,
  feedback: true,
  excused: true,
  excused_reason: true,
  graded_at: true,
  raw_score: true,
  late_seconds: true,
  late_penalty_percent: true,
  late_penalty_waived: true,
} satisfies Prisma.submissionSelect;

/** What a student or teacher is shown of a submission's lateness. */
const LATE_SELECT = {
  raw_score: true,
  late_seconds: true,
  late_penalty_percent: true,
  late_penalty_waived: true,
} satisfies Prisma.submissionSelect;

const MAX_SUBMISSION_FILES = 20;

const STUDENT_QUESTION_SELECT = {
  id: true,
  prompt: true,
  kind: true,
  points: true,
  sort_order: true,
  file_types: true,
  file_max_mb: true,
} satisfies Prisma.quiz_questionSelect;

const STUDENT_OPTION_SELECT = {
  id: true,
  question_id: true,
  label: true,
  match_label: true,
  sort_order: true,
} satisfies Prisma.quiz_optionSelect;

/** grading.submit_quiz's row, with the final score and status after it. */
type QuizScoredRow = {
  score: Prisma.Decimal | null;
  points: Prisma.Decimal | null;
  attempts_used: number | null;
  status: 'draft' | 'submitted' | 'graded';
};

type SubmissionFileInfo = {
  id: string;
  name: string;
  contentType: string;
};

/**
 * Submissions: a student's work on an activity, and the mark on it.
 *
 * Since the move to courses the submission is the only place a mark lives
 * (the Canvas model). Nothing here writes grading.grade any more; the course
 * gradebook reads submissions directly.
 */
@Injectable()
export class SubmissionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubmissionService.name);
  private quizSweepTimer?: ReturnType<typeof setInterval>;
  private sweepingQuizAttempts = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileManagerService,
    private readonly access: CourseAccessService,
    @Optional() private readonly webhooks?: WebhookEvents,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() private readonly cache?: CacheService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.quizSweepTimer = setInterval(
      () => void this.sweepExpiredQuizAttempts(),
      5_000,
    );
    void this.sweepExpiredQuizAttempts();
  }

  onModuleDestroy() {
    if (this.quizSweepTimer) clearInterval(this.quizSweepTimer);
    this.quizSweepTimer = undefined;
  }

  // ── webhooks ──────────────────────────────────────────────────────────────

  /**
   * grade.recorded after a mark (or excuse) committed. Fire and forget: the
   * payload is only built when the school has a webhook for it.
   */
  private emitGrade(
    activityId: string,
    marked: ReturnType<SubmissionService['toMarked']>,
    userId: string,
    source: 'teacher' | 'excuse',
  ) {
    const webhooks = this.webhooks;
    if (!webhooks) return;
    void (async () => {
      const activity = await webhooks.activity(activityId);
      if (!activity) return;
      const row = await this.prisma.activity.findUnique({
        where: { id: activityId },
        select: { course_id: true },
      });
      if (!row?.course_id) return;
      await webhooks.emitForCourse(
        row.course_id,
        'grade.recorded',
        async (course) => ({
          submission: { id: marked.id },
          activity,
          course,
          student: await webhooks.student(marked.studentId),
          grade: {
            score: marked.score,
            points: activity.points,
            status: marked.status,
            excused: marked.excused,
          },
          gradedBy: await webhooks.staffOrNull(userId),
          source,
        }),
      );
    })().catch(() => undefined);
  }

  // ── student side ──────────────────────────────────────────────────────────

  /**
   * The courses whose work a student can see: enrolled and not dropped, in a
   * course that is published (or archived, so past work stays readable).
   */
  private async visibleCourses(
    studentId: string,
  ): Promise<Map<string, string>> {
    const enrolments = await this.prisma.course_student.findMany({
      where: { student_id: studentId, status: { in: ['active', 'completed'] } },
      select: { course_id: true },
    });

    const courseIds = [...new Set(enrolments.map((e) => e.course_id))];
    if (courseIds.length === 0) return new Map();

    const courses = await this.prisma.course.findMany({
      where: {
        id: { in: courseIds },
        status: { in: ['published', 'archived'] },
      },
      select: { id: true, name: true },
    });

    return new Map(courses.map((c) => [c.id, c.name]));
  }

  /** The due dates a teacher extended for this student, by activity. */
  private async extensionsFor(
    studentId: string,
    activityIds: string[],
  ): Promise<Map<string, Date>> {
    if (activityIds.length === 0) return new Map();
    const rows = await this.prisma.activity_extension.findMany({
      where: { student_id: studentId, activity_id: { in: activityIds } },
      select: { activity_id: true, due_at: true },
    });
    return new Map(rows.map((r) => [r.activity_id, r.due_at]));
  }

  /**
   * The quiz accommodation that applies to this student on each activity:
   * the activity's own, else their school-wide default.
   */
  private async accommodationsFor(
    studentId: string,
    activityIds: string[],
  ): Promise<Map<string, EffectiveAccommodation | null>> {
    if (activityIds.length === 0) return new Map();
    const [own, fallback] = await Promise.all([
      this.prisma.activity_accommodation.findMany({
        where: { student_id: studentId, activity_id: { in: activityIds } },
        select: {
          activity_id: true,
          time_multiplier: true,
          extra_minutes: true,
          lockdown_exempt: true,
        },
      }),
      this.prisma.student_accommodation.findUnique({
        where: { student_id: studentId },
        select: {
          time_multiplier: true,
          extra_minutes: true,
          lockdown_exempt: true,
        },
      }),
    ]);
    const ownOf = new Map<string, AccommodationRow>(
      (own ?? []).map((r) => [r.activity_id, r]),
    );
    return new Map(
      activityIds.map((id) => [
        id,
        effectiveAccommodation(ownOf.get(id), fallback),
      ]),
    );
  }

  /**
   * The student's to-do: published and closed work across every course they
   * can see. Drafts are the teacher's working copy; closed work stays so a
   * student can still see what they did and what it scored.
   */
  async listForStudent(studentId: string) {
    const courses = await this.visibleCourses(studentId);
    if (courses.size === 0) return [];

    const rows = await this.prisma.activity.findMany({
      where: {
        course_id: { in: [...courses.keys()] },
        status: { in: ['published', 'closed'] },
      },
      select: STUDENT_ACTIVITY_SELECT,
      orderBy: { due_at: { sort: 'asc', nulls: 'last' } },
    });

    if (rows.length === 0) return [];

    const activityIds = rows.map((a) => a.id);
    const [submissions, extensions] = await Promise.all([
      this.prisma.submission.findMany({
        where: {
          student_id: studentId,
          activity_id: { in: activityIds },
        },
        select: {
          id: true,
          activity_id: true,
          status: true,
          score: true,
          excused: true,
          submitted_at: true,
          graded_at: true,
          quiz_started_at: true,
          quiz_expires_at: true,
          ...LATE_SELECT,
        },
      }),
      this.extensionsFor(studentId, activityIds),
    ]);

    const byActivity = new Map(submissions.map((s) => [s.activity_id, s]));
    const now = Date.now();

    const items = rows.map((a) => {
      const submission = byActivity.get(a.id);
      const graded = submission?.status === 'graded';

      return {
        id: a.id,
        courseId: a.course_id,
        courseName: courses.get(a.course_id) ?? null,
        kind: a.kind,
        title: a.title,
        instructions: a.instructions,
        points: Number(a.points),
        dueAt: ts(a.due_at),
        ...studentDueFields(a, extensions.get(a.id), submission, now),
        ...toLatePolicy(a),
        status: a.status,
        allowFile: a.allow_file,
        allowMultipleFiles: a.allow_multiple_files,
        allowText: a.allow_text,
        submission: submission
          ? {
              id: submission.id,
              status: submission.status,
              score:
                graded && submission.score !== null
                  ? roundScore(Number(submission.score))
                  : null,
              excused: !!submission.excused,
              submittedAt: ts(submission.submitted_at),
              gradedAt: ts(submission.graded_at),
              lateSeconds: submission.late_seconds ?? 0,
              latePenaltyPercent: submission.late_penalty_waived
                ? 0
                : Number(submission.late_penalty_percent ?? 0),
            }
          : null,
      };
    });
    // The to-do runs on each student's own dates, extensions included.
    const time = (v: string | null) => (v ? Date.parse(v) : Infinity);
    return items.sort(
      (a, b) => time(a.effectiveDueAt) - time(b.effectiveDueAt),
    );
  }

  /** One course's published and closed work, with the student's state on each. */
  async listCourseForStudent(studentId: string, courseId: string) {
    await this.access.requireStudent(studentId, courseId);

    const rows = await this.prisma.activity.findMany({
      where: { course_id: courseId, status: { in: ['published', 'closed'] } },
      select: ACTIVITY_SELECT,
      orderBy: ACTIVITY_ORDER,
    });

    if (rows.length === 0) return [];

    const activityIds = rows.map((a) => a.id);
    const quizIds = rows.filter((a) => a.kind === 'quiz').map((a) => a.id);
    const [submissions, extensions, accommodations] = await Promise.all([
      this.prisma.submission.findMany({
        where: {
          student_id: studentId,
          activity_id: { in: activityIds },
        },
        select: {
          activity_id: true,
          status: true,
          score: true,
          excused: true,
          feedback: true,
          submitted_at: true,
          attempt_count: true,
          quiz_started_at: true,
          quiz_expires_at: true,
          ...LATE_SELECT,
        },
      }),
      this.extensionsFor(studentId, activityIds),
      this.accommodationsFor(studentId, quizIds),
    ]);

    const byActivity = new Map(submissions.map((s) => [s.activity_id, s]));
    const now = Date.now();

    return rows.map((a) => {
      const submission = byActivity.get(a.id);
      const accommodation = accommodations.get(a.id);
      return {
        ...toPortalActivity(a, submission),
        // The student's own time and Lockdown, after any accommodation.
        timeLimitMinutes: accommodatedTimeLimit(
          a.time_limit_minutes,
          accommodation,
        ),
        lockdownBrowser: lockdownFor(a.lockdown_browser, accommodation),
        ...studentDueFields(a, extensions.get(a.id), submission, now),
      };
    });
  }

  /** The activity itself, with questions but never the correct answers. */
  async getForStudent(studentId: string, activityId: string) {
    const activity = await this.requireAssignedActivity(studentId, activityId);

    let submission = await this.prisma.submission.findFirst({
      where: { activity_id: activityId, student_id: studentId },
      select: {
        id: true,
        status: true,
        text_body: true,
        file_id: true,
        score: true,
        feedback: true,
        excused: true,
        submitted_at: true,
        graded_at: true,
        attempt_count: true,
        quiz_started_at: true,
        quiz_expires_at: true,
        ...LATE_SELECT,
      },
    });
    // An attempt past its end (its time limit, or the due date for one
    // without) is submitted with what was saved before showing the result.
    if (
      submission?.quiz_started_at &&
      !isQuizAttemptOpen(submission, activity.effective_close_at)
    ) {
      await this.finalizeExpiredQuizAttempt(
        submission.id,
        studentId,
        activityId,
        activity.effective_close_at,
      );
      submission = await this.prisma.submission.findFirst({
        where: { activity_id: activityId, student_id: studentId },
        select: {
          id: true,
          status: true,
          text_body: true,
          file_id: true,
          score: true,
          feedback: true,
          excused: true,
          submitted_at: true,
          graded_at: true,
          attempt_count: true,
          quiz_started_at: true,
          quiz_expires_at: true,
          ...LATE_SELECT,
        },
      });
    }

    const accommodation =
      activity.kind === 'quiz'
        ? await loadAccommodation(this.prisma, studentId, activityId)
        : null;

    const savedAnswers =
      activity.kind === 'quiz' && submission?.quiz_started_at
        ? await this.prisma.quiz_answer.findMany({
            where: { submission_id: submission.id },
            select: {
              question_id: true,
              option_id: true,
              text_answer: true,
              option_ids: true,
              matches: true,
              numeric_answer: true,
              file_id: true,
            },
          })
        : [];

    // The attempt's own questions in its order when it has them (fixed when
    // it started: drawn from banks and shuffled per student), else the quiz's.
    // Never the answer key: see toStudentQuestion.
    const questions =
      activity.kind === 'quiz'
        ? await this.studentQuestions(activityId, submission?.id ?? null)
        : [];
    const questionCount =
      activity.kind === 'quiz'
        ? await this.questionCount(activityId, questions.length, submission?.id ?? null)
        : 0;

    // Once marked, the teacher's points and comments on essay and file
    // questions (their marks, not an answer key).
    const markedQuestions =
      activity.kind === 'quiz' && submission?.status === 'graded'
        ? (
            await this.prisma.quiz_answer.findMany({
              where: { submission_id: submission.id, manual_points: { not: null } },
              select: { question_id: true, manual_points: true, manual_feedback: true },
            })
          ).map((m) => ({
            questionId: m.question_id,
            points: scoreOrNull(m.manual_points),
            feedback: m.manual_feedback ?? null,
          }))
        : [];

    const files = submission
      ? await this.submissionFiles(submission.id, submission.file_id)
      : [];
    const graded = submission?.status === 'graded';

    // The rubric is shown up front so the student knows how the work will be
    // marked; the levels they were given only once the mark is final (and
    // only if it was marked with the rubric rather than a bare score).
    const rubric = await loadRubric(this.prisma, activity.rubric_id);
    const rubricAssessment =
      rubric && graded && submission
        ? ((await loadAssessments(this.prisma, [submission.id], rubric)).get(
            submission.id,
          ) ?? null)
        : null;

    return {
      id: activity.id,
      courseId: activity.course_id,
      kind: activity.kind,
      title: activity.title,
      instructions: activity.instructions,
      points: Number(activity.points),
      dueAt: ts(activity.due_at),
      ...studentDueFields(activity, activity.extension_due_at, submission),
      ...toLatePolicy(activity),
      status: activity.status,
      allowFile: activity.allow_file,
      allowMultipleFiles: activity.allow_multiple_files,
      allowText: activity.allow_text,
      // 0 means unlimited, matching the teacher's editor.
      maxAttempts: activity.max_attempts ?? 0,
      // The student's own time limit and Lockdown, after any accommodation;
      // standardTimeLimitMinutes is the quiz's, so the page can show both.
      timeLimitMinutes: accommodatedTimeLimit(
        activity.time_limit_minutes,
        accommodation,
      ),
      standardTimeLimitMinutes: activity.time_limit_minutes,
      lockdownBrowser: lockdownFor(activity.lockdown_browser, accommodation),
      attemptsUsed: submission?.attempt_count ?? 0,
      questions,
      // How many questions an attempt has (bank draws included).
      questionCount,
      markedQuestions,
      quizAttempt:
        activity.kind === 'quiz' && submission?.quiz_started_at
          ? {
              startedAt: ts(submission.quiz_started_at),
              expiresAt: ts(submission.quiz_expires_at),
              serverNow: new Date().toISOString(),
              answers: savedAnswers.map(toSavedAnswer),
            }
          : null,
      rubric,
      rubricAssessment,
      submission: submission
        ? {
            id: submission.id,
            status: submission.status,
            textBody: submission.text_body,
            fileId: files[0]?.id ?? null,
            fileName: files[0]?.name ?? null,
            files,
            // A teacher may be partway through marking; show the mark once
            // it is final.
            score:
              graded && submission.score !== null
                ? roundScore(Number(submission.score))
                : null,
            feedback: graded ? submission.feedback : null,
            excused: !!submission.excused,
            submittedAt: ts(submission.submitted_at),
            gradedAt: ts(submission.graded_at),
            attemptCount: submission.attempt_count ?? 0,
            // A quiz with essay or file questions waits for the teacher.
            needsMarking:
              activity.kind === 'quiz' && submission.status === 'submitted',
            ...(() => {
              const late = toLateness(submission);
              return {
                lateSeconds: late.lateSeconds,
                latePenaltyPercent: late.latePenaltyWaived
                  ? 0
                  : late.latePenaltyPercent,
                rawScore: graded ? late.rawScore : null,
              };
            })(),
          }
        : null,
    };
  }

  /** Display names for attached files, so the UI can label a download. */
  private async fileDetails(
    ids: string[],
  ): Promise<Map<string, SubmissionFileInfo>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const data = await this.prisma.file.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, content_type: true },
    });

    return new Map(
      data.map((f) => [
        f.id,
        { id: f.id, name: f.name, contentType: f.content_type },
      ]),
    );
  }

  private async submissionFiles(
    submissionId: string,
    legacyFileId: string | null,
  ): Promise<SubmissionFileInfo[]> {
    const links = await this.prisma.submission_file.findMany({
      where: { submission_id: submissionId },
      select: {
        file: { select: { id: true, name: true, content_type: true } },
      },
      orderBy: { sort_order: 'asc' },
    });
    if (links.length > 0) {
      return links.map(({ file }) => ({
        id: file.id,
        name: file.name,
        contentType: file.content_type,
      }));
    }

    if (!legacyFileId) return [];
    return [
      (await this.fileDetails([legacyFileId])).get(legacyFileId) ?? {
        id: legacyFileId,
        name: 'Attached file',
        contentType: 'application/octet-stream',
      },
    ];
  }

  private async submissionFilesById(
    submissions: { id: string; file_id: string | null }[],
  ): Promise<Map<string, SubmissionFileInfo[]>> {
    const ids = submissions.map(({ id }) => id);
    if (ids.length === 0) return new Map();

    const links = await this.prisma.submission_file.findMany({
      where: { submission_id: { in: ids } },
      select: {
        submission_id: true,
        file: { select: { id: true, name: true, content_type: true } },
      },
      orderBy: [{ submission_id: 'asc' }, { sort_order: 'asc' }],
    });
    const bySubmission = new Map<string, SubmissionFileInfo[]>();
    for (const link of links) {
      const current = bySubmission.get(link.submission_id) ?? [];
      current.push({
        id: link.file.id,
        name: link.file.name,
        contentType: link.file.content_type,
      });
      bySubmission.set(link.submission_id, current);
    }

    const missingLegacyIds = submissions
      .filter(
        ({ id, file_id }) =>
          (bySubmission.get(id)?.length ?? 0) === 0 && file_id,
      )
      .map(({ file_id }) => file_id as string);
    const fallbackDetails = await this.fileDetails(missingLegacyIds);

    for (const submission of submissions) {
      if ((bySubmission.get(submission.id)?.length ?? 0) > 0) continue;
      const fallback = submission.file_id
        ? fallbackDetails.get(submission.file_id)
        : undefined;
      bySubmission.set(
        submission.id,
        fallback
          ? [fallback]
          : submission.file_id
            ? [
                {
                  id: submission.file_id,
                  name: 'Attached file',
                  contentType: 'application/octet-stream',
                },
              ]
            : [],
      );
    }
    return bySubmission;
  }

  /**
   * An activity is only this student's if it is published (or closed) in a
   * course they are enrolled in and can see. Anything else is reported as
   * missing, so ids from other courses reveal nothing.
   */
  private async requireAssignedActivity(studentId: string, activityId: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: STUDENT_ACTIVITY_SELECT,
    });

    if (
      !activity?.course_id ||
      !['published', 'closed'].includes(activity.status)
    ) {
      throw new NotFoundException('Activity not found');
    }

    let course: Awaited<ReturnType<CourseAccessService['requireStudent']>>;
    try {
      course = await this.access.requireStudent(studentId, activity.course_id);
    } catch {
      throw new NotFoundException('Activity not found');
    }

    const extension = await this.prisma.activity_extension.findUnique({
      where: {
        activity_id_student_id: {
          activity_id: activityId,
          student_id: studentId,
        },
      },
      select: { due_at: true },
    });

    return {
      ...activity,
      course_id: activity.course_id,
      school_id: course.school_id,
      extension_due_at: extension?.due_at ?? null,
      // The date that applies to this student: their extension, if any.
      effective_due_at: effectiveDueAt(activity.due_at, extension?.due_at),
      // When it closes to them: the extension, else late-until, else due.
      effective_close_at: effectiveCloseAt(
        activity.due_at,
        activity.late_until,
        extension?.due_at,
      ),
    };
  }

  /**
   * The same, for the routes that hand work in. Offline work is marked by the
   * teacher from paper or in person; there is nothing to submit online.
   */
  private async requireSubmittable(studentId: string, activityId: string) {
    const activity = await this.requireAssignedActivity(studentId, activityId);
    if (activity.kind === 'offline') {
      throw new ConflictException(
        'This is marked offline; there is nothing to hand in here',
      );
    }

    // An archived course stays readable for the record, but archiving does
    // not close its activities, so hand-ins are refused at the course level.
    try {
      await this.access.requireStudent(studentId, activity.course_id, {
        allowArchived: false,
      });
    } catch {
      throw new ConflictException('This course is closed to new work');
    }
    return activity;
  }

  /** The questions one attempt was given, in order, or null for none stored. */
  private async attemptQuestions(
    db: Pick<Prisma.TransactionClient, 'quiz_attempt_question'>,
    submissionId: string | null,
  ) {
    if (!submissionId) return null;
    const rows = await db.quiz_attempt_question.findMany({
      where: { submission_id: submissionId },
      select: { question_id: true, position: true, option_order: true },
      orderBy: { position: 'asc' },
    });
    return rows?.length ? rows : null;
  }

  /**
   * The questions as the student sees them: the attempt's own when it has
   * them (in its order, options in its order), else the quiz's own.
   */
  private async studentQuestions(activityId: string, submissionId: string | null) {
    const attempt = await this.attemptQuestions(this.prisma, submissionId);
    if (attempt) {
      const ids = attempt.map((a) => a.question_id);
      const [qs, options] = await Promise.all([
        this.prisma.quiz_question.findMany({
          where: { id: { in: ids } },
          select: STUDENT_QUESTION_SELECT,
        }),
        this.prisma.quiz_option.findMany({
          where: { question_id: { in: ids } },
          select: STUDENT_OPTION_SELECT,
          orderBy: { sort_order: 'asc' },
        }),
      ]);
      const byId = new Map((qs ?? []).map((q) => [q.id, q]));
      return attempt.flatMap((a) => {
        const q = byId.get(a.question_id);
        if (!q) return [];
        return [
          toStudentQuestion(
            q,
            (options ?? []).filter((o) => o.question_id === q.id),
            a.option_order,
          ),
        ];
      });
    }

    const cacheKey = `quiz:student-questions:v2:${activityId}`;
    const cached = (await this.cache?.get(cacheKey)) as unknown[] | undefined | null;
    if (cached) return cached as ReturnType<typeof toStudentQuestion>[];
    const qs = await this.prisma.quiz_question.findMany({
      where: { activity_id: activityId },
      select: STUDENT_QUESTION_SELECT,
      orderBy: { sort_order: 'asc' },
    });
    const ids = qs.map((q) => q.id);
    const options = ids.length
      ? await this.prisma.quiz_option.findMany({
          where: { question_id: { in: ids } },
          select: STUDENT_OPTION_SELECT,
          orderBy: { sort_order: 'asc' },
        })
      : [];
    // Ordering items are never sent in their right order: before an attempt
    // is started (or for one from before attempts were stored) they are
    // listed alphabetically.
    const questions = qs.map((q) => {
      const own = (options ?? []).filter((o) => o.question_id === q.id);
      const order =
        q.kind === 'ordering'
          ? [...own].sort((x, y) => x.label.localeCompare(y.label)).map((o) => o.id)
          : null;
      return toStudentQuestion(q, own, order);
    });
    // Questions are frozen once the quiz is published, so this cannot go stale.
    await this.cache?.set(cacheKey, questions, 3600);
    return questions;
  }

  /** How many questions an attempt has: its own, or the quiz's plus its draws. */
  private async questionCount(
    activityId: string,
    shown: number,
    submissionId: string | null,
  ) {
    if (await this.attemptQuestions(this.prisma, submissionId)) return shown;
    const draws = await this.prisma.quiz_bank_draw.findMany({
      where: { activity_id: activityId },
      select: { draw_count: true },
    });
    return shown + (draws ?? []).reduce((n, d) => n + d.draw_count, 0);
  }

  /**
   * Fix a new attempt's questions: the quiz's own plus random questions
   * from its bank draws, shuffled as the quiz says, from a fresh seed. The
   * result is stored, so resuming and re-scoring use the same questions.
   */
  private async planAttempt(
    tx: Prisma.TransactionClient,
    activity: { id: string; shuffle_questions?: boolean; shuffle_options?: boolean },
    submissionId: string,
  ) {
    const [fixed, draws] = await Promise.all([
      tx.quiz_question.findMany({
        where: { activity_id: activity.id },
        select: { id: true, kind: true },
        orderBy: { sort_order: 'asc' },
      }),
      tx.quiz_bank_draw.findMany({
        where: { activity_id: activity.id },
        select: { bank_id: true, draw_count: true },
        orderBy: { sort_order: 'asc' },
      }),
    ]);
    const bankQuestions = draws?.length
      ? await tx.quiz_question.findMany({
          where: { bank_id: { in: draws.map((d) => d.bank_id) } },
          select: { id: true, kind: true, bank_id: true },
          orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        })
      : [];
    const allIds = [...(fixed ?? []), ...(bankQuestions ?? [])].map((q) => q.id);
    const options = allIds.length
      ? await tx.quiz_option.findMany({
          where: { question_id: { in: allIds } },
          select: { id: true, question_id: true },
          orderBy: { sort_order: 'asc' },
        })
      : [];
    const optionIds = (id: string) =>
      (options ?? []).filter((o) => o.question_id === id).map((o) => o.id);
    const plan = buildAttemptPlan(randomInt(0, 2 ** 31), {
      fixed: (fixed ?? []).map((q) => ({ id: q.id, kind: q.kind, optionIds: optionIds(q.id) })),
      draws: (draws ?? []).map((d) => ({
        count: d.draw_count,
        questions: (bankQuestions ?? [])
          .filter((q) => q.bank_id === d.bank_id)
          .map((q) => ({ id: q.id, kind: q.kind, optionIds: optionIds(q.id) })),
      })),
      shuffleQuestions: !!activity.shuffle_questions,
      shuffleOptions: !!activity.shuffle_options,
    });
    await tx.quiz_attempt_question.deleteMany({ where: { submission_id: submissionId } });
    await this.cache?.delete(`quiz:structure:${submissionId}`);
    if (plan.length) {
      await tx.quiz_attempt_question.createMany({
        data: plan.map((row) => ({
          submission_id: submissionId,
          question_id: row.questionId,
          position: row.position,
          option_order: row.optionOrder,
        })),
      });
    }
  }

  /** The draft a student works in; created on first touch. */
  private async ensureDraft(studentId: string, activityId: string) {
    const find = () =>
      this.prisma.submission.findFirst({
        where: { activity_id: activityId, student_id: studentId },
        select: DRAFT_SELECT,
      });

    const existing = await find();
    if (existing) return existing;

    try {
      return await this.prisma.submission.create({
        data: {
          activity_id: activityId,
          student_id: studentId,
          status: 'draft',
        },
        select: DRAFT_SELECT,
      });
    } catch (error) {
      // Two first touches at once (a double click, two tabs): the loser hits
      // the (activity, student) key, and the winner's draft is the one to use.
      if (isUniqueViolation(error)) {
        const created = await find();
        if (created) return created;
      }
      this.logger.error(
        `Failed to open submission: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to start this work');
    }
  }

  async startQuizAttempt(studentId: string, activityId: string) {
    const activity = await this.requireSubmittable(studentId, activityId);
    if (activity.kind !== 'quiz') {
      throw new BadRequestException('This is not a quiz');
    }
    if (activity.status !== 'published') {
      throw new ConflictException('This quiz is closed');
    }

    const draft = await this.ensureDraft(studentId, activityId);
    const accommodation = activity.time_limit_minutes
      ? await loadAccommodation(this.prisma, studentId, activityId)
      : null;
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        {
          attempt_count: number;
          graded_by: string | null;
          quiz_started_at: Date | null;
          quiz_expires_at: Date | null;
        }[]
      >`
        select attempt_count, graded_by, quiz_started_at, quiz_expires_at
        from grading.submission
        where id = ${draft.id}::uuid
        for update
      `;
      if (!locked) throw new NotFoundException('Activity not found');
      if (locked.graded_by) {
        throw new BadRequestException(
          'Your teacher has marked this quiz, so it cannot be retaken',
        );
      }
      if (locked.quiz_started_at) {
        // An attempt begun in time carries on past the due date until its
        // own end, so resuming it is always allowed while it runs.
        if (!isQuizAttemptOpen(locked, activity.effective_close_at)) {
          throw new ConflictException('This quiz attempt has expired');
        }
        return {
          startedAt: locked.quiz_started_at.toISOString(),
          expiresAt: locked.quiz_expires_at?.toISOString() ?? null,
          serverNow: new Date().toISOString(),
        };
      }
      assertNotClosed(activity.effective_close_at, activity.effective_due_at);
      if (
        activity.max_attempts !== null &&
        locked.attempt_count >= activity.max_attempts
      ) {
        throw new ConflictException('You have no attempts left');
      }

      const startedAt = new Date();
      // With no time limit the attempt ends when the quiz is due, so the
      // expiry sweep submits it then. A timed attempt gets the student's
      // accommodated time (extra time never applies to an untimed one: only
      // an extension moves the due date).
      const expiresAt = newQuizAttemptExpiry(
        startedAt,
        accommodatedTimeLimit(activity.time_limit_minutes, accommodation),
        activity.effective_due_at,
        activity.effective_close_at,
      );
      // A new attempt: the last one's answers go, and its questions are
      // drawn and ordered afresh (bank questions included).
      await tx.quiz_answer.deleteMany({
        where: { submission_id: draft.id },
      });
      await this.planAttempt(tx, activity, draft.id);
      await tx.submission.update({
        where: { id: draft.id },
        data: {
          quiz_started_at: startedAt,
          quiz_expires_at: expiresAt,
          is_away: false,
          tab_switch_count: 0,
          last_away_at: null,
          updated_at: startedAt,
        },
      });
      await this.cache?.set(
        `quiz:presence:${activityId}:${studentId}`,
        {
          isAway: false,
          reason: null,
          lastPingAt: startedAt.toISOString(),
        },
        35,
      );
      return {
        startedAt: startedAt.toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
        serverNow: new Date().toISOString(),
      };
    });
  }

  async saveQuizAnswers(
    studentId: string,
    activityId: string,
    answers: AnswerInput[],
  ) {
    const activity = await this.requireSubmittable(studentId, activityId);
    if (activity.kind !== 'quiz') {
      throw new BadRequestException('This is not a quiz');
    }
    const draft = await this.ensureDraft(studentId, activityId);

    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { quiz_started_at: Date | null; quiz_expires_at: Date | null }[]
      >`
        select quiz_started_at, quiz_expires_at
        from grading.submission
        where id = ${draft.id}::uuid
        for update
      `;
      if (!locked?.quiz_started_at) {
        if (isPastDue(activity.effective_close_at)) {
          throw closedError(
            activity.effective_close_at,
            activity.effective_due_at,
          );
        }
        throw new ConflictException('Start the quiz before saving answers');
      }
      if (
        locked.quiz_expires_at &&
        locked.quiz_expires_at.getTime() <= Date.now()
      ) {
        throw new ConflictException(
          'Time is up; your saved answers were submitted',
        );
      }
      // An attempt from before this deploy may have no expiry: with no time
      // limit it ends at the due date.
      if (!isQuizAttemptOpen(locked, activity.effective_close_at)) {
        throw closedError(activity.effective_close_at, activity.effective_due_at);
      }

      const accepted = await this.validQuizAnswers(
        tx,
        activityId,
        draft.id,
        studentId,
        answers,
      );
      await tx.quiz_answer.deleteMany({
        where: { submission_id: draft.id },
      });
      if (accepted.length > 0) {
        await tx.quiz_answer.createMany({
          data: accepted.map((answer) => this.quizAnswerRow(draft.id, answer)),
        });
      }
      const savedAt = new Date();
      await tx.submission.update({
        where: { id: draft.id },
        data: { updated_at: savedAt },
      });
      return { savedAt: savedAt.toISOString() };
    });
  }

  async updateQuizPresence(
    studentId: string,
    activityId: string,
    dto: { isAway: boolean; reason?: string },
  ) {
    const activity = await this.requireSubmittable(studentId, activityId);
    if (activity.kind !== 'quiz') {
      throw new BadRequestException('This is not a quiz');
    }
    // Only lockdown quizzes are monitored; a normal quiz must not collect
    // tab-switch counts from a client that calls this anyway.
    if (!activity.lockdown_browser) {
      return { ok: true };
    }
    // Nor is a student exempt from Lockdown: their assistive tools may take
    // focus, and that must not read as leaving the quiz.
    const accommodation = await loadAccommodation(
      this.prisma,
      studentId,
      activityId,
    );
    if (accommodation?.lockdownExempt) {
      return { ok: true };
    }

    const draft = await this.prisma.submission.findFirst({
      where: { activity_id: activityId, student_id: studentId },
      select: {
        id: true,
        status: true,
        quiz_started_at: true,
        quiz_expires_at: true,
        is_away: true,
        tab_switch_count: true,
      },
    });

    if (!draft || !draft.quiz_started_at || draft.status !== 'draft') {
      return { ok: true };
    }

    if (draft.quiz_expires_at && draft.quiz_expires_at.getTime() <= Date.now()) {
      return { ok: true, expired: true };
    }

    const now = new Date();
    const cacheKey = `quiz:presence:${activityId}:${studentId}`;
    await this.cache?.set(
      cacheKey,
      {
        isAway: dto.isAway,
        reason: dto.reason ?? null,
        lastPingAt: now.toISOString(),
      },
      35,
    );

    if (dto.isAway) {
      // Count leaving the quiz once per departure: an away client keeps
      // pinging, and every ping must not add another switch.
      await this.prisma.submission.update({
        where: { id: draft.id },
        data: {
          is_away: true,
          // A departure, not every away ping: count it and stamp when it began.
          ...(draft.is_away
            ? {}
            : { tab_switch_count: { increment: 1 }, last_away_at: now }),
          updated_at: now,
        },
      });
    } else if (draft.is_away) {
      await this.prisma.submission.update({
        where: { id: draft.id },
        data: {
          is_away: false,
          updated_at: now,
        },
      });
    }

    return { ok: true };
  }

  /**
   * The answers to keep: one per question, only for this attempt's questions
   * (its own set, else the quiz's), each of the right shape for its kind
   * (see answerRow), and a file only when it is the student's own finished
   * upload. Anything else is dropped rather than refused.
   */
  private async validQuizAnswers(
    tx: Prisma.TransactionClient,
    activityId: string,
    submissionId: string,
    studentId: string,
    answers: AnswerInput[],
  ): Promise<AnswerRow[]> {
    // Answers are saved often during an attempt, and its questions are fixed
    // when it starts, so their shape is cached per submission (and dropped
    // when a new attempt is planned).
    const cacheKey = `quiz:structure:${submissionId}`;
    type Structure = [string, string, string[]][];
    let cached = ((await this.cache?.get(cacheKey)) as Structure | null | undefined) ?? null;
    if (!cached) {
      const attempt = await this.attemptQuestions(tx, submissionId);
      const questions = await tx.quiz_question.findMany({
        where: attempt
          ? { id: { in: attempt.map((a) => a.question_id) } }
          : { activity_id: activityId },
        select: { id: true, kind: true },
      });
      const ids = (questions ?? []).map((q) => q.id);
      const options = ids.length
        ? await tx.quiz_option.findMany({
            where: { question_id: { in: ids } },
            select: { id: true, question_id: true },
          })
        : [];
      cached = (questions ?? []).map((q) => [
        q.id,
        q.kind as string,
        (options ?? []).filter((o) => o.question_id === q.id).map((o) => o.id),
      ]);
      await this.cache?.set(cacheKey, cached, 3600);
    }
    const structure = new Map(
      cached.map(([id, kind, optionIds]) => [id, { kind, optionIds: new Set(optionIds) }]),
    );

    const rows = new Map<string, AnswerRow>();
    for (const answer of answers) {
      const question = structure.get(answer.questionId);
      if (!question) continue;
      const row = answerRow(question, answer);
      if (row) rows.set(answer.questionId, row);
    }

    const fileIds = [...rows.values()].flatMap((r) => (r.file_id ? [r.file_id] : []));
    if (fileIds.length) {
      const owner = await this.userIdForStudent(studentId);
      const own = await tx.file.findMany({
        where: { id: { in: fileIds }, owner_id: owner, status: 'ready', deleted_at: null },
        select: { id: true },
      });
      const ok = new Set((own ?? []).map((f) => f.id));
      for (const [id, row] of rows) {
        if (row.file_id && !ok.has(row.file_id)) rows.delete(id);
      }
    }
    return [...rows.values()];
  }

  private quizAnswerRow(submissionId: string, row: AnswerRow) {
    return {
      submission_id: submissionId,
      question_id: row.question_id,
      option_id: row.option_id,
      option_ids: row.option_ids,
      matches: row.matches ?? undefined,
      text_answer: row.text_answer,
      numeric_answer: row.numeric_answer,
      file_id: row.file_id,
    };
  }

  /**
   * After grading.submit_quiz scored an attempt (score = raw_score, before
   * any late penalty): apply the late policy, and return the row with the
   * final score and whether it waits for the teacher.
   */
  private async afterQuizScored(
    tx: Prisma.TransactionClient,
    activityId: string,
    studentId: string,
    submissionId: string,
    scored: {
      score: Prisma.Decimal | null;
      points: Prisma.Decimal | null;
      attempts_used: number | null;
    }[],
  ): Promise<QuizScoredRow[]> {
    if (scored.length === 0) return [];
    await refreshLateness(tx, activityId, [studentId]);
    const after = await tx.submission.findUnique({
      where: { id: submissionId },
      select: { score: true, status: true },
    });
    return scored.map((row) => ({
      ...row,
      score: after?.score !== undefined ? after.score : row.score,
      status: after?.status === 'submitted' ? 'submitted' : 'graded',
    }));
  }

  private emitQuizCompleted(
    activity: {
      id: string;
      course_id: string;
      title: string;
      kind: string;
      points: unknown;
    },
    studentId: string,
    submissionId: string,
    row: QuizScoredRow,
  ) {
    const webhooks = this.webhooks;
    if (!webhooks) return;
    // Not completed until the teacher marks the essay and file questions.
    if (row.status === 'submitted') return;
    void webhooks.emitForCourse(
      activity.course_id,
      'quiz.completed',
      async (course) => ({
        submission: { id: submissionId, attempt: row.attempts_used ?? null },
        activity: toActivityRef(activity),
        course,
        student: await webhooks.student(studentId),
        grade: {
          score: scoreValue(row.score),
          points:
            row.points === null
              ? Number(activity.points)
              : scoreValue(row.points),
          status: 'graded',
          excused: false,
        },
      }),
    );
  }

  private async finalizeExpiredQuizAttempt(
    submissionId: string,
    studentId: string,
    activityId: string,
    dueAt: Date | null = null,
  ) {
    const completed = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        {
          quiz_started_at: Date | null;
          quiz_expires_at: Date | null;
          expired: boolean;
        }[]
      >`
        select quiz_started_at, quiz_expires_at,
               quiz_expires_at is not null and quiz_expires_at <= now() as expired
        from grading.submission
        where id = ${submissionId}::uuid
        for update
      `;
      if (!locked?.quiz_started_at) return null;
      // Ended by its time limit, or (no expiry) by the due date.
      const ended =
        locked.expired ||
        (!locked.quiz_expires_at && isPastDue(dueAt));
      if (!ended) return null;
      const scored = await tx.$queryRaw<
        {
          score: Prisma.Decimal | null;
          points: Prisma.Decimal | null;
          attempts_used: number | null;
        }[]
      >`
        select * from grading.submit_quiz(
          ${submissionId}::uuid,
          ${studentId}::uuid
        )
      `;
      const [row] = await this.afterQuizScored(
        tx,
        activityId,
        studentId,
        submissionId,
        scored,
      );
      return row ?? null;
    });
    if (!completed) return;
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, course_id: true, title: true, kind: true, points: true },
    });
    if (activity) {
      this.emitQuizCompleted(activity, studentId, submissionId, completed);
    }
  }

  private async sweepExpiredQuizAttempts() {
    if (this.sweepingQuizAttempts) return;
    this.sweepingQuizAttempts = true;
    try {
      const completed = await this.prisma.$transaction(async (tx) => {
        const expired = await tx.$queryRaw<
          {
            id: string;
            student_id: string;
            activity_id: string;
            course_id: string;
            title: string;
            kind: string;
            points: Prisma.Decimal;
          }[]
        >`
          select s.id, s.student_id, a.id as activity_id, a.course_id,
                 a.title, a.kind, a.points
          from grading.submission s
          join grading.activity a on a.id = s.activity_id
          where s.quiz_expires_at <= now()
          order by s.quiz_expires_at
          limit 50
          for update of s skip locked
        `;
        const rows: {
          submissionId: string;
          studentId: string;
          activity: {
            id: string;
            course_id: string;
            title: string;
            kind: string;
            points: unknown;
          };
          result: QuizScoredRow;
        }[] = [];
        for (const attempt of expired) {
          const scored = await tx.$queryRaw<
            {
              score: Prisma.Decimal | null;
              points: Prisma.Decimal | null;
              attempts_used: number | null;
            }[]
          >`
            select * from grading.submit_quiz(
              ${attempt.id}::uuid,
              ${attempt.student_id}::uuid
            )
          `;
          const [result] = await this.afterQuizScored(
            tx,
            attempt.activity_id,
            attempt.student_id,
            attempt.id,
            scored,
          );
          if (result) {
            rows.push({
              submissionId: attempt.id,
              studentId: attempt.student_id,
              activity: {
                id: attempt.activity_id,
                course_id: attempt.course_id,
                title: attempt.title,
                kind: attempt.kind,
                points: attempt.points,
              },
              result,
            });
          }
        }
        return rows;
      });
      for (const attempt of completed) {
        this.emitQuizCompleted(
          attempt.activity,
          attempt.studentId,
          attempt.submissionId,
          attempt.result,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to finalize expired quiz attempts: ${(error as Error).message}`,
      );
    } finally {
      this.sweepingQuizAttempts = false;
    }
  }

  /**
   * Start a direct upload for the draft, as the student's own file.
   *
   * Students hold no catalog permissions, so they cannot reach the file
   * manager's own endpoints; this is the one way in, and it only ever writes
   * to their own draft for an activity set to their class. Uploading as the
   * student's own user means the usual checks and ownership all apply.
   */
  async createUploadTicket(
    studentId: string,
    activityId: string,
    input: { name: string; sizeBytes: number; contentType: string },
  ) {
    const activity = await this.requireSubmittable(studentId, activityId);

    if (activity.kind !== 'assignment') {
      throw new BadRequestException('This is not an assignment');
    }
    if (!activity.allow_file) {
      throw new BadRequestException('This assignment does not accept files');
    }
    if (activity.status !== 'published') {
      throw new ConflictException('This assignment is closed');
    }

    const draft = await this.ensureDraft(studentId, activityId);
    if (draft.status !== 'draft') {
      throw new ConflictException('You have already submitted this');
    }
    assertNotClosed(activity.effective_close_at, activity.effective_due_at);

    await this.assertUploadCapacity(
      draft.id,
      activity.allow_multiple_files,
      draft.file_id,
    );

    const owner = await this.userIdForStudent(studentId);
    return this.files.createSubmissionUploadTicket(
      owner,
      input,
      await this.courseSchoolId(activity.course_id),
    );
  }

  async finaliseUploadedFile(
    studentId: string,
    activityId: string,
    fileId: string,
  ) {
    const activity = await this.requireSubmittable(studentId, activityId);

    if (activity.kind !== 'assignment' || !activity.allow_file) {
      throw new BadRequestException('This assignment does not accept files');
    }
    if (activity.status !== 'published') {
      throw new ConflictException('This assignment is closed');
    }

    const draft = await this.ensureDraft(studentId, activityId);
    if (draft.status !== 'draft') {
      throw new ConflictException('You have already submitted this');
    }
    // An upload started in time but finished after the close is not attached.
    assertNotClosed(activity.effective_close_at, activity.effective_due_at);
    await this.assertUploadCapacity(
      draft.id,
      activity.allow_multiple_files,
      draft.file_id,
    );

    const owner = await this.userIdForStudent(studentId);
    const file = await this.files.finaliseSubmissionUpload(owner, fileId);
    await this.linkUploadedFile(
      draft.id,
      file.id,
      activity.allow_multiple_files,
    );

    return { fileId: file.id, name: file.name };
  }

  /**
   * A running attempt's file question, for an upload to answer it: the
   * question must be in the attempt and be a file upload.
   */
  private async requireFileQuestion(
    studentId: string,
    activityId: string,
    questionId: string,
  ) {
    const activity = await this.requireSubmittable(studentId, activityId);
    if (activity.kind !== 'quiz') {
      throw new BadRequestException('This is not a quiz');
    }
    const draft = await this.prisma.submission.findFirst({
      where: { activity_id: activityId, student_id: studentId },
      select: { id: true, quiz_started_at: true, quiz_expires_at: true },
    });
    if (!draft?.quiz_started_at || !isQuizAttemptOpen(draft, activity.effective_close_at)) {
      throw new ConflictException('Start the quiz before uploading');
    }
    const attempt = await this.attemptQuestions(this.prisma, draft.id);
    const question = await this.prisma.quiz_question.findFirst({
      where: attempt
        ? { id: questionId, AND: [{ id: { in: attempt.map((a) => a.question_id) } }] }
        : { id: questionId, activity_id: activityId },
      select: { id: true, kind: true, file_types: true, file_max_mb: true },
    });
    if (!question || question.kind !== 'file_upload') {
      throw new NotFoundException('Question not found');
    }
    return { activity, question };
  }

  /** Start a direct upload answering one file question of a running attempt. */
  async createQuizUploadTicket(
    studentId: string,
    activityId: string,
    questionId: string,
    input: { name: string; sizeBytes: number; contentType: string },
  ) {
    const { activity, question } = await this.requireFileQuestion(
      studentId,
      activityId,
      questionId,
    );
    if (!fileTypeAllowed(question.file_types ?? [], input)) {
      throw new BadRequestException(
        `This question accepts ${question.file_types.join(', ')}`,
      );
    }
    if (question.file_max_mb && input.sizeBytes > question.file_max_mb * 1024 * 1024) {
      throw new BadRequestException(
        `This question accepts files up to ${question.file_max_mb} MB`,
      );
    }
    const owner = await this.userIdForStudent(studentId);
    return this.files.createSubmissionUploadTicket(
      owner,
      input,
      await this.courseSchoolId(activity.course_id),
    );
  }

  /**
   * Check the uploaded bytes. The answer itself is saved with the others
   * (`fileId` on the question's answer), so this only returns the file.
   */
  async finaliseQuizUpload(
    studentId: string,
    activityId: string,
    questionId: string,
    fileId: string,
  ) {
    const { question } = await this.requireFileQuestion(studentId, activityId, questionId);
    const owner = await this.userIdForStudent(studentId);
    const file = await this.files.finaliseSubmissionUpload(owner, fileId);
    if (
      !fileTypeAllowed(question.file_types ?? [], {
        name: file.name,
        contentType: (file as { contentType?: string }).contentType ?? '',
      })
    ) {
      throw new BadRequestException(
        `This question accepts ${question.file_types.join(', ')}`,
      );
    }
    return { fileId: file.id, name: file.name };
  }

  private async assertUploadCapacity(
    submissionId: string,
    allowMultipleFiles: boolean,
    legacyFileId: string | null,
  ) {
    let attachedCount = await this.prisma.submission_file.count({
      where: { submission_id: submissionId },
    });
    if (attachedCount === 0 && legacyFileId) attachedCount = 1;

    const maxFiles = allowMultipleFiles ? MAX_SUBMISSION_FILES : 1;
    if (attachedCount >= maxFiles) {
      throw new BadRequestException(
        allowMultipleFiles
          ? `A submission can have at most ${MAX_SUBMISSION_FILES} files`
          : 'This assignment allows only one file',
      );
    }
  }

  private async linkUploadedFile(
    submissionId: string,
    fileId: string,
    allowMultipleFiles: boolean,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Serializes concurrent uploads before checking the per-submission cap.
      const draft = await tx.submission.updateMany({
        where: { id: submissionId, status: 'draft' },
        data: { updated_at: new Date() },
      });
      if (draft.count === 0) {
        throw new ConflictException('You have already submitted this');
      }

      const sortOrder = await tx.submission_file.count({
        where: { submission_id: submissionId },
      });
      const legacyFile = await tx.submission.findUnique({
        where: { id: submissionId },
        select: { file_id: true },
      });
      const attachedCount = sortOrder || (legacyFile?.file_id ? 1 : 0);
      const maxFiles = allowMultipleFiles ? MAX_SUBMISSION_FILES : 1;
      if (attachedCount >= maxFiles) {
        throw new BadRequestException(
          allowMultipleFiles
            ? `A submission can have at most ${MAX_SUBMISSION_FILES} files`
            : 'This assignment allows only one file',
        );
      }

      await tx.submission_file.create({
        data: {
          submission_id: submissionId,
          file_id: fileId,
          sort_order: attachedCount,
        },
      });
      await tx.submission.updateMany({
        where: { id: submissionId, file_id: null },
        data: { file_id: fileId, updated_at: new Date() },
      });
    });
  }

  /** The login behind a student record, which owns anything they upload. */
  /** Whose upload limit a hand-in is held to: the course's school. */
  private async courseSchoolId(courseId: string): Promise<string | undefined> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { school_id: true },
    });
    return course?.school_id ?? undefined;
  }

  private async userIdForStudent(studentId: string): Promise<string> {
    const data = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { user_profile_id: true },
    });

    if (!data?.user_profile_id) {
      throw new BadRequestException('This student has no account');
    }
    return data.user_profile_id;
  }

  /** The file a student handed in, for staff marking it. */
  async readSubmissionFile(
    userId: string,
    submissionId: string,
    requestedFileId?: string,
  ) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        activity_id: true,
        file_id: true,
        submission_file: {
          select: { file_id: true },
          orderBy: { sort_order: 'asc' },
        },
      },
    });

    const attachedFileIds =
      submission?.submission_file?.map(({ file_id }) => file_id) ?? [];
    if (submission?.file_id && attachedFileIds.length === 0) {
      attachedFileIds.push(submission.file_id);
    }
    // Files answering a quiz's file questions.
    if (submission && requestedFileId) {
      const answer = await this.prisma.quiz_answer.findFirst({
        where: { submission_id: submission.id, file_id: requestedFileId },
        select: { file_id: true },
      });
      if (answer?.file_id) attachedFileIds.push(answer.file_id);
    }
    const fileId = requestedFileId ?? attachedFileIds[0];
    if (!submission || !fileId || !attachedFileIds.includes(fileId)) {
      throw new NotFoundException('No file was handed in');
    }

    const courseId = await this.access.courseIdOfActivity(
      submission.activity_id,
    );
    await this.access.require(userId, courseId, STAFF_ROLES);

    return this.files.readContentForAuthorisedCaller(fileId);
  }

  async readSubmissionArchive(userId: string, submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        activity_id: true,
        file_id: true,
        activity: { select: { title: true, course_id: true } },
        student: { select: { first_name: true, last_name: true } },
        submission_file: {
          select: {
            file_id: true,
            file: { select: { name: true } },
          },
          orderBy: { sort_order: 'asc' },
        },
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');

    await this.access.require(
      userId,
      submission.activity.course_id,
      STAFF_ROLES,
    );

    const fileRows = submission.submission_file.length
      ? submission.submission_file
      : submission.file_id
        ? [{ file_id: submission.file_id, file: { name: 'submission' } }]
        : [];
    if (fileRows.length === 0) {
      throw new NotFoundException('No files were handed in');
    }

    const archive = new ZipArchive({ zlib: { level: 5 } });
    const usedNames = new Set<string>();
    for (const { file_id, file } of fileRows) {
      const content = await this.files.readStreamForAuthorisedCaller(file_id);
      const safeName =
        basename(file.name.replaceAll('\\', '/')).replace(/\p{Cc}/gu, '_') ||
        'submission-file';
      const extension = safeName.includes('.')
        ? safeName.slice(safeName.lastIndexOf('.'))
        : '';
      const stem = extension ? safeName.slice(0, -extension.length) : safeName;
      let entryName = safeName;
      let suffix = 2;
      while (usedNames.has(entryName.toLocaleLowerCase())) {
        entryName = `${stem} (${suffix++})${extension}`;
      }
      usedNames.add(entryName.toLocaleLowerCase());
      archive.append(content.body, { name: entryName });
    }

    const studentName =
      `${submission.student.first_name ?? ''} ${submission.student.last_name ?? ''}`.trim() ||
      'Student';
    const archiveName: string =
      `${studentName} - ${submission.activity.title}`
        .replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
        .slice(0, 180) + '.zip';
    void archive.finalize().catch((error: Error) => {
      this.logger.error(
        `Failed to generate submission archive: ${error.message}`,
      );
    });
    return { archive, archiveName };
  }

  /** Hand in an assignment: text, a file, or both. */
  async submitAssignment(
    studentId: string,
    activityId: string,
    input: { textBody?: string; fileId?: string },
  ) {
    const activity = await this.requireSubmittable(studentId, activityId);

    if (activity.kind !== 'assignment') {
      throw new BadRequestException('This is not an assignment');
    }
    if (activity.status !== 'published') {
      throw new ConflictException('This assignment is closed');
    }
    const draft = await this.ensureDraft(studentId, activityId);

    if (draft.status !== 'draft') {
      throw new ConflictException('You have already submitted this');
    }
    assertNotClosed(activity.effective_close_at, activity.effective_due_at);

    // A file attached earlier stays attached: handing in text as well must not
    // silently drop it.
    const fileId = input.fileId ?? draft.file_id ?? null;

    if (!input.textBody?.trim() && !fileId) {
      throw new BadRequestException('Add your work before submitting');
    }
    if (fileId && !activity.allow_file) {
      throw new BadRequestException('This assignment does not accept files');
    }
    if (input.textBody?.trim() && !activity.allow_text) {
      throw new BadRequestException('This assignment does not accept text');
    }

    // A client-supplied fileId must be the student's own finished upload;
    // otherwise any file id - a classmate's work included - could be handed in.
    if (input.fileId && input.fileId !== draft.file_id) {
      const owner = await this.userIdForStudent(studentId);
      const file = await this.prisma.file.findFirst({
        where: { id: input.fileId, owner_id: owner, status: 'ready' },
        select: { id: true },
      });
      if (!file) throw new BadRequestException('File not found');
    }

    let data;
    const actorId = await this.userIdForStudent(studentId);
    try {
      data = await this.prisma.$transaction(async (tx) => {
        const before = await tx.submission.findUnique({
          where: { id: draft.id },
          select: {
            id: true,
            status: true,
            text_body: true,
            file_id: true,
          },
        });
        const [submitted] = await tx.submission.updateManyAndReturn({
          // The status guards a second submit racing the first.
          where: { id: draft.id, status: 'draft' },
          data: {
            status: 'submitted',
            text_body: input.textBody?.trim() ?? null,
            file_id: fileId,
            submitted_at: new Date(),
            updated_at: new Date(),
          },
          select: { id: true, status: true, submitted_at: true },
        });
        if (submitted) {
          // Handed in after the due date (inside the late window): stamp how
          // late, and the penalty the mark will carry.
          await refreshLateness(tx, activityId, [studentId]);
          await this.auditLog?.record(
            tx,
            activity.school_id,
            { id: actorId },
            {
              entity: 'submission',
              entityId: submitted.id,
              action: 'update',
              changes: auditChanges(
                {
                  status: before?.status ?? null,
                  textBody: before?.text_body ?? null,
                  fileId: before?.file_id ?? null,
                },
                {
                  status: submitted.status,
                  textBody: input.textBody?.trim() ?? null,
                  fileId,
                },
              ),
            },
          );
        }
        return submitted;
      });
    } catch {
      data = undefined;
    }

    if (!data) {
      throw new ConflictException('You have already submitted this');
    }

    const handedIn = data;
    void this.webhooks?.emitForCourse(
      activity.course_id,
      'submission.handed_in',
      async (course) => ({
        submission: {
          id: handedIn.id,
          submittedAt: (handedIn.submitted_at ?? new Date()).toISOString(),
        },
        activity: toActivityRef(activity),
        course,
        student: await this.webhooks!.student(studentId),
      }),
    );

    return {
      id: data.id,
      status: data.status,
      submittedAt: ts(data.submitted_at),
    };
  }

  /**
   * Answer and submit a quiz. Scoring and marking happen inside submit_quiz,
   * which writes the score onto the submission - the one place a mark lives.
   */
  async submitQuiz(
    studentId: string,
    activityId: string,
    answers: AnswerInput[],
  ) {
    const activity = await this.requireSubmittable(studentId, activityId);
    if (activity.kind !== 'quiz') {
      throw new BadRequestException('This is not a quiz');
    }
    const draft = await this.ensureDraft(studentId, activityId);
    if (draft.graded_by) {
      throw new BadRequestException(
        'Your teacher has marked this quiz, so it cannot be retaken',
      );
    }
    if (activity.status !== 'published' && !draft.quiz_started_at) {
      throw new ConflictException('This quiz is closed');
    }
    if (!draft.quiz_started_at) {
      if (isPastDue(activity.effective_close_at)) {
        throw closedError(activity.effective_close_at, activity.effective_due_at);
      }
      throw new ConflictException('Start the quiz before submitting');
    }
    let rows: QuizScoredRow[];
    try {
      // The answers and the score that is worked out from them commit
      // together or not at all. The row lock is taken first, so a second
      // submit waits here and then sees the attempt this one used, and any
      // refusal inside submit_quiz rolls the new answers back with it.
      rows = await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<
          {
            attempt_count: number | null;
            graded_by: string | null;
            quiz_started_at: Date | null;
            quiz_expires_at: Date | null;
            expired: boolean;
          }[]
        >`
          select attempt_count, graded_by, quiz_started_at, quiz_expires_at,
                 quiz_expires_at is not null and quiz_expires_at <= now() as expired
          from grading.submission
          where id = ${draft.id}::uuid
          for update
        `;
        if (!locked) throw new NotFoundException('Activity not found');
        if (locked.graded_by) {
          throw new BadRequestException(
            'Your teacher has marked this quiz, so it cannot be retaken',
          );
        }
        if (
          activity.max_attempts !== null &&
          (locked.attempt_count ?? 0) >= activity.max_attempts
        ) {
          throw new ConflictException('You have no attempts left');
        }
        if (!locked.quiz_started_at) {
          if (isPastDue(activity.effective_close_at)) {
            throw closedError(
              activity.effective_close_at,
              activity.effective_due_at,
            );
          }
          throw new ConflictException('Start the quiz before submitting');
        }

        // Once time expires only server-saved answers count. A last request
        // from the client after the deadline must not extend the attempt.
        // The due date is checked here, under the row lock, so it cannot
        // race a save: an attempt with no expiry (one from before due dates
        // were enforced) ends at the due date. submit_quiz itself stays
        // date-blind, because the expiry sweep calls it after the deadline.
        const ended =
          locked.expired ||
          (!locked.quiz_expires_at && isPastDue(activity.effective_close_at));
        if (!ended) {
          const accepted = await this.validQuizAnswers(
            tx,
            activityId,
            draft.id,
            studentId,
            answers,
          );
          await tx.quiz_answer.deleteMany({
            where: { submission_id: draft.id },
          });
          if (accepted.length > 0) {
            await tx.quiz_answer.createMany({
              data: accepted.map((answer) =>
                this.quizAnswerRow(draft.id, answer),
              ),
            });
          }
        }

        const scored = await tx.$queryRaw<
          {
            score: Prisma.Decimal | null;
            points: Prisma.Decimal | null;
            attempts_used: number | null;
          }[]
        >`
          select * from grading.submit_quiz(${draft.id}::uuid, ${studentId}::uuid)
        `;
        return this.afterQuizScored(tx, activityId, studentId, draft.id, scored);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const detail = `${pgCode(error) ?? ''} ${raisedMessage(error)}`;
      if (detail.includes('no_attempts_left')) {
        throw new ConflictException('You have no attempts left');
      }
      if (detail.includes('already_marked')) {
        throw new BadRequestException(
          'Your teacher has marked this quiz, so it cannot be retaken',
        );
      }
      if (detail.includes('activity_not_open')) {
        throw new ConflictException('This quiz is closed');
      }
      if (detail.includes('quiz_attempt_not_started')) {
        throw new ConflictException('Start the quiz before submitting');
      }
      this.logger.error(`Quiz submission failed: ${(error as Error).message}`);
      throw new BadRequestException('Failed to submit quiz');
    }

    const row = rows[0];
    if (row) this.emitQuizCompleted(activity, studentId, draft.id, row);

    // A quiz with essay or file questions waits for the teacher: no score
    // until every one of those is marked.
    const needsMarking = row?.status === 'submitted';
    return {
      score:
        row?.score === undefined || needsMarking ? null : scoreOrNull(row.score),
      // A null points column is Number(null) = 0, as before.
      points: row?.points === undefined ? null : Number(row.points),
      needsMarking,
    };
  }

  // ── teacher side ──────────────────────────────────────────────────────────

  /**
   * Load an activity for marking: the caller must be staff in its course and
   * the work must have gone out. Marking a draft would put a score on
   * something students have never seen.
   */
  private async requireMarkable(userId: string, activityId: string) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        course_id: true,
        points: true,
        status: true,
        kind: true,
        lockdown_browser: true,
        due_at: true,
        late_until: true,
      },
    });

    if (!activity?.course_id) throw new NotFoundException('Activity not found');
    const { course } = await this.access.require(
      userId,
      activity.course_id,
      STAFF_ROLES,
    );
    return {
      ...activity,
      course_id: activity.course_id,
      school_id: course.school_id,
    };
  }

  /**
   * The student must be on the course's roster. Any status will do - a
   * dropped student's existing work can still be marked or excused, so the
   * record is right if they come back.
   */
  private async requireCourseStudent(courseId: string, studentId: string) {
    const data = await this.prisma.course_student.findFirst({
      where: { course_id: courseId, student_id: studentId },
      select: { student_id: true },
    });

    if (!data)
      throw new NotFoundException('That student is not in this course');
  }

  /**
   * Everyone who should have done the work, with their submission or lack of
   * one: the active and completed roster, plus anyone else who has a
   * submission (a student dropped after handing in keeps showing up).
   */
  async listForTeacher(userId: string, activityId: string) {
    const activity = await this.requireMarkable(userId, activityId);
    const roster = await this.prisma.course_student.findMany({
      where: { course_id: activity.course_id },
      select: { student_id: true, status: true },
    });

    const submissions = await this.prisma.submission.findMany({
      where: { activity_id: activityId },
      select: {
        id: true,
        student_id: true,
        status: true,
        text_body: true,
        file_id: true,
        score: true,
        feedback: true,
        excused: true,
        excused_reason: true,
        submitted_at: true,
        graded_at: true,
        attempt_count: true,
        quiz_started_at: true,
        quiz_expires_at: true,
        is_away: true,
        tab_switch_count: true,
        last_away_at: true,
        ...LATE_SELECT,
      },
    });

    const byStudent = new Map(submissions.map((s) => [s.student_id, s]));
    const statusOf = new Map<string, string>(
      roster.map((r) => [r.student_id, r.status]),
    );

    const studentIds = [
      ...new Set([
        ...roster
          .filter((r) => r.status !== 'dropped')
          .map((r) => r.student_id),
        ...byStudent.keys(),
      ]),
    ];

    const students = studentIds.length
      ? await this.prisma.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true, first_name: true, last_name: true },
        })
      : [];

    const filesBySubmission = await this.submissionFilesById(submissions);
    const extensions = await this.prisma.activity_extension.findMany({
      where: { activity_id: activityId },
      select: {
        student_id: true,
        due_at: true,
        reason: true,
        created_by: true,
        created_at: true,
        updated_at: true,
      },
    });
    const extensionOf = new Map(extensions.map((e) => [e.student_id, e]));
    const accommodationOf = await this.rosterAccommodations(
      activity,
      studentIds,
    );

    const now = Date.now();
    const rows = await Promise.all(
      students.map(async (s) => {
        const submission = byStudent.get(s.id);
        const extension = extensionOf.get(s.id);
        const accommodations = accommodationOf.get(s.id);
        const accommodation = accommodations?.effective ?? null;
        const dueAt = effectiveDueAt(activity.due_at, extension?.due_at);
        const closeAt = effectiveCloseAt(
          activity.due_at,
          activity.late_until,
          extension?.due_at,
        );
        const isActiveAttempt =
          activity.kind === 'quiz' &&
          submission?.status === 'draft' &&
          isQuizAttemptOpen(submission, closeAt, now);

        let isAway = false;
        let awayReason: string | null = null;
        // Only lockdown quizzes send presence; without it every attempt
        // would read as away once the heartbeat window passed. A student
        // exempt from Lockdown sends none either.
        if (
          isActiveAttempt &&
          lockdownFor(activity.lockdown_browser, accommodation)
        ) {
          const presence = (await this.cache?.get(
            `quiz:presence:${activityId}:${s.id}`,
          )) as
            | {
                isAway: boolean;
                reason?: string | null;
                lastPingAt?: string;
              }
            | null
            | undefined;

          if (presence) {
            const stale =
              !presence.lastPingAt ||
              now - new Date(presence.lastPingAt).getTime() > 25_000;
            isAway = presence.isAway || stale;
            awayReason = presence.reason ?? (stale ? 'no_heartbeat' : null);
          } else {
            const startedAtMs = submission.quiz_started_at?.getTime() ?? 0;
            const stale = now - startedAtMs > 20_000;
            isAway = submission.is_away || stale;
            awayReason = stale ? 'no_heartbeat' : null;
          }
        }

        return {
          studentId: s.id,
          name: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
          enrollmentStatus: (statusOf.get(s.id) ?? null) as
            | 'active'
            | 'dropped'
            | 'completed'
            | null,
          effectiveDueAt: ts(dueAt),
          closesAt: ts(closeAt),
          extension: extension
            ? {
                dueAt: ts(extension.due_at) as string,
                reason: extension.reason ?? null,
                createdBy: extension.created_by ?? null,
                createdAt: ts(extension.created_at) as string,
                updatedAt: ts(extension.updated_at) as string,
              }
            : null,
          // Staff only: never sent to students.
          accommodation: toAccommodationSummary(accommodation),
          // What applies if this quiz's own accommodation is removed.
          defaultAccommodation: toAccommodationSummary(
            accommodations?.schoolDefault ?? null,
          ),
          submission: submission
            ? {
                id: submission.id,
                status: submission.status,
                textBody: submission.text_body,
                fileId: filesBySubmission.get(submission.id)?.[0]?.id ?? null,
                fileName:
                  filesBySubmission.get(submission.id)?.[0]?.name ?? null,
                files: filesBySubmission.get(submission.id) ?? [],
                score:
                  submission.score === null
                    ? null
                    : roundScore(Number(submission.score)),
                feedback: submission.feedback,
                excused: !!submission.excused,
                excusedReason: submission.excused_reason ?? null,
                submittedAt: ts(submission.submitted_at),
                gradedAt: ts(submission.graded_at),
                attemptCount: submission.attempt_count ?? 0,
                quizStartedAt: ts(submission.quiz_started_at),
                quizExpiresAt: ts(submission.quiz_expires_at),
                isActiveAttempt,
                // A quiz waiting for its essay or file questions to be marked.
                needsMarking:
                  activity.kind === 'quiz' && submission.status === 'submitted',
                isAway,
                awayReason,
                tabSwitchCount: submission.tab_switch_count ?? 0,
                lastAwayAt: ts(submission.last_away_at),
                // Staff see the lateness, the policy's penalty and whether
                // it was waived; score is after the penalty.
                ...toLateness(submission),
              }
            : null,
        };
      }),
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Each roster student's effective quiz accommodation on a quiz, and their
   * school-wide default on its own.
   */
  private async rosterAccommodations(
    activity: { id: string; kind: string },
    studentIds: string[],
  ): Promise<
    Map<
      string,
      {
        effective: EffectiveAccommodation | null;
        schoolDefault: EffectiveAccommodation | null;
      }
    >
  > {
    if (activity.kind !== 'quiz' || studentIds.length === 0) return new Map();
    const [own, defaults] = await Promise.all([
      this.prisma.activity_accommodation.findMany({
        where: { activity_id: activity.id },
        select: {
          student_id: true,
          time_multiplier: true,
          extra_minutes: true,
          lockdown_exempt: true,
        },
      }),
      this.prisma.student_accommodation.findMany({
        where: { student_id: { in: studentIds } },
        select: {
          student_id: true,
          time_multiplier: true,
          extra_minutes: true,
          lockdown_exempt: true,
        },
      }),
    ]);
    const ownOf = new Map((own ?? []).map((r) => [r.student_id, r]));
    const defaultOf = new Map((defaults ?? []).map((r) => [r.student_id, r]));
    return new Map(
      studentIds.map((id) => [
        id,
        {
          effective: effectiveAccommodation(ownOf.get(id), defaultOf.get(id)),
          schoolDefault: effectiveAccommodation(null, defaultOf.get(id)),
        },
      ]),
    );
  }

  private toMarked(row: any) {
    return {
      id: row.id as string,
      studentId: row.student_id as string,
      status: row.status as 'draft' | 'submitted' | 'graded',
      score: scoreOrNull(row.score),
      feedback: (row.feedback as string | null) ?? null,
      excused: !!row.excused,
      excusedReason: (row.excused_reason as string | null) ?? null,
      gradedAt: ts(row.graded_at),
      ...toLateness(row),
    };
  }

  /** Apply the late policy to a fresh mark and read it back. */
  private async withLateness(
    tx: Prisma.TransactionClient,
    activityId: string,
    studentId: string,
    written?: ReturnType<SubmissionService['toMarked']>,
  ) {
    await refreshLateness(tx, activityId, [studentId]);
    const row = await tx.submission.findUnique({
      where: {
        activity_id_student_id: {
          activity_id: activityId,
          student_id: studentId,
        },
      },
      select: MARKED_SELECT,
    });
    if (!row) {
      if (written) return written;
      throw new NotFoundException('Submission not found');
    }
    return this.toMarked(row);
  }

  /**
   * Write to a student's submission, creating it when there is none.
   *
   * Offline work never has one until it is marked, and a student who never
   * handed in can still be given a mark (or excused), so marking cannot
   * assume the row exists. One upsert on the (activity, student) key keeps
   * that race-free and leaves the student's own text and file untouched.
   */
  private async writeSubmission(
    activityId: string,
    studentId: string,
    fields: Omit<
      Prisma.submissionUncheckedCreateInput,
      'activity_id' | 'student_id'
    >,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const now = new Date();
    let data;
    try {
      data = await db.submission.upsert({
        where: {
          activity_id_student_id: {
            activity_id: activityId,
            student_id: studentId,
          },
        },
        create: {
          activity_id: activityId,
          student_id: studentId,
          ...fields,
          updated_at: now,
        },
        update: { ...fields, updated_at: now },
        select: MARKED_SELECT,
      });
    } catch (error) {
      this.logger.error(
        `Failed to write submission: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to save the mark');
    }
    return this.toMarked(data);
  }

  /** Mark one student's work on an activity. The submission is the mark. */
  async grade(
    userId: string,
    activityId: string,
    studentId: string,
    input: { score: number; feedback?: string },
  ) {
    const activity = await this.requireMarkable(userId, activityId);

    if (activity.status === 'draft') {
      throw new ConflictException('Publish this before marking it');
    }
    await this.requireCourseStudent(activity.course_id, studentId);

    if (input.score < 0 || input.score > Number(activity.points)) {
      throw new BadRequestException(
        `Score must be between 0 and ${Number(activity.points)}`,
      );
    }

    let marked: ReturnType<SubmissionService['toMarked']>;
    try {
      marked = await this.prisma.$transaction(async (tx) => {
        // Pairs with the lock in ActivityService.update: the points cannot
        // be lowered between this check and the write. (The row was read a
        // moment ago; should it be gone the upsert fails on its key.)
        const [locked] = await tx.$queryRaw<{ points: Prisma.Decimal }[]>`
          select points from grading.activity
          where id = ${activityId}::uuid
          for share
        `;
        const max = Number(locked?.points ?? activity.points);
        if (input.score > max) {
          throw new BadRequestException(`Score must be between 0 and ${max}`);
        }

        const before = await tx.submission.findFirst({
          where: { activity_id: activityId, student_id: studentId },
          select: {
            id: true,
            status: true,
            score: true,
            feedback: true,
          },
        });
        const written = await this.writeSubmission(
          activityId,
          studentId,
          {
            status: 'graded',
            // The teacher's mark; score is it less any late penalty.
            raw_score: input.score,
            score: input.score,
            feedback: input.feedback ?? null,
            graded_at: new Date(),
            graded_by: userId,
          },
          tx,
        ).then((row) => this.withLateness(tx, activityId, studentId, row));
        // A bare score replaces any rubric marking: levels left behind would
        // show the student how a mark was reached that is no longer theirs.
        await tx.rubric_assessment.deleteMany({
          where: { submission_id: written.id },
        });
        await this.auditLog?.record(
          tx,
          activity.school_id,
          { id: userId },
          {
            entity: 'submission',
            entityId: written.id,
            action: before ? 'update' : 'create',
            changes: auditChanges(
              before
                ? {
                    status: before.status,
                    score: scoreOrNull(before.score),
                    feedback: before.feedback,
                  }
                : null,
              {
                status: written.status,
                score: written.score,
                feedback: written.feedback,
              },
            ),
          },
        );
        return written;
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to save the mark: ${(error as Error).message}`);
      throw new BadRequestException('Failed to save the mark');
    }
    this.emitGrade(activityId, marked, userId, 'teacher');
    return marked;
  }

  /**
   * Marking by submission id, for the marking screen that already holds one.
   * Resolves to the (activity, student) pair and marks it the same way.
   */
  async gradeSubmission(
    userId: string,
    submissionId: string,
    input: { score: number; feedback?: string },
  ) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, activity_id: true, student_id: true },
    });

    if (!submission) throw new NotFoundException('Submission not found');

    return this.grade(
      userId,
      submission.activity_id,
      submission.student_id,
      input,
    );
  }

  /**
   * Excuse a student from one piece of work, or take the excuse back.
   *
   * An excused mark is left out of the course total entirely - score and
   * points - for the student who was absent or sat a makeup. Any mark they
   * already have is kept, so un-excusing restores it. A student with no
   * submission gets one, marked graded with no score, so the to-do list stops
   * asking them for it.
   */
  async excuse(
    userId: string,
    activityId: string,
    studentId: string,
    input: { excused: boolean; reason?: string },
  ) {
    const activity = await this.requireMarkable(userId, activityId);

    if (activity.status === 'draft') {
      throw new ConflictException('Publish this before excusing anyone');
    }
    await this.requireCourseStudent(activity.course_id, studentId);

    const existing = await this.prisma.submission.findFirst({
      where: { activity_id: activityId, student_id: studentId },
      select: { id: true },
    });

    const fields: Parameters<SubmissionService['writeSubmission']>[2] = {
      excused: input.excused,
      // Dropping the reason when the excuse is lifted stops a stale note
      // reappearing the next time.
      excused_reason: input.excused ? input.reason?.trim() || null : null,
    };

    if (!existing) {
      if (!input.excused) {
        throw new NotFoundException('This student is not excused');
      }
      fields.status = 'graded';
      fields.graded_at = new Date();
      fields.graded_by = userId;
    }

    const marked = await this.prisma.$transaction(async (tx) => {
      const before = await tx.submission.findFirst({
        where: { activity_id: activityId, student_id: studentId },
        select: {
          id: true,
          status: true,
          score: true,
          feedback: true,
          excused: true,
          excused_reason: true,
        },
      });
      const updated = await this.writeSubmission(
        activityId,
        studentId,
        fields,
        tx,
      );
      await this.auditLog?.record(
        tx,
        activity.school_id,
        { id: userId },
        {
          entity: 'submission',
          entityId: updated.id,
          action: before ? 'update' : 'create',
          changes: auditChanges(
            before
              ? {
                  status: before.status,
                  score: scoreOrNull(before.score),
                  feedback: before.feedback,
                  excused: before.excused,
                  excusedReason: before.excused_reason,
                }
              : null,
            {
              status: updated.status,
              score: updated.score,
              feedback: updated.feedback,
              excused: updated.excused,
              excusedReason: updated.excusedReason,
            },
          ),
        },
      );
      return updated;
    });
    this.emitGrade(activityId, marked, userId, 'excuse');
    return marked;
  }

  /**
   * Waive one student's late penalty (or restore it). The mark goes back to
   * the raw score, or the penalty is applied again; audited.
   */
  async waiveLatePenalty(
    userId: string,
    activityId: string,
    studentId: string,
    waived: boolean,
  ) {
    const activity = await this.requireMarkable(userId, activityId);
    await this.requireCourseStudent(activity.course_id, studentId);
    const marked = await this.prisma.$transaction(async (tx) => {
      const before = await tx.submission.findUnique({
        where: {
          activity_id_student_id: {
            activity_id: activityId,
            student_id: studentId,
          },
        },
        select: { id: true, score: true, late_penalty_waived: true },
      });
      if (!before) {
        throw new NotFoundException('This student has handed nothing in');
      }
      await tx.submission.update({
        where: { id: before.id },
        data: { late_penalty_waived: waived, updated_at: new Date() },
      });
      const after = await this.withLateness(tx, activityId, studentId);
      await this.auditLog?.record(
        tx,
        activity.school_id,
        { id: userId },
        {
          entity: 'submission',
          entityId: before.id,
          action: 'update',
          changes: auditChanges(
            {
              latePenaltyWaived: before.late_penalty_waived,
              score: scoreOrNull(before.score),
            },
            { latePenaltyWaived: waived, score: after.score },
          ),
        },
      );
      return after;
    });
    if (marked.status === 'graded') {
      this.emitGrade(activityId, marked, userId, 'teacher');
    }
    return marked;
  }

  /**
   * One student's quiz answers for marking: the attempt's questions with
   * the answer key, what the student answered, the credit each earned, and
   * the teacher's marks on essay and file questions.
   */
  async quizAnswers(userId: string, activityId: string, studentId: string) {
    const activity = await this.requireMarkable(userId, activityId);
    if (activity.kind !== 'quiz') {
      throw new BadRequestException('This is not a quiz');
    }
    const submission = await this.prisma.submission.findFirst({
      where: { activity_id: activityId, student_id: studentId },
      select: { id: true, status: true, quiz_started_at: true, file_id: true },
    });
    if (!submission) throw new NotFoundException('This student has no attempt');

    const attempt = await this.attemptQuestions(this.prisma, submission.id);
    const where = attempt
      ? { id: { in: attempt.map((a) => a.question_id) } }
      : { activity_id: activityId };
    const [questions, answers] = await Promise.all([
      this.prisma.quiz_question.findMany({
        where,
        select: {
          id: true,
          prompt: true,
          kind: true,
          points: true,
          sort_order: true,
          numeric_answer: true,
          numeric_tolerance: true,
          partial_credit: true,
          rubric_id: true,
        },
        orderBy: { sort_order: 'asc' },
      }),
      this.prisma.quiz_answer.findMany({
        where: { submission_id: submission.id },
        select: {
          question_id: true,
          option_id: true,
          option_ids: true,
          matches: true,
          text_answer: true,
          numeric_answer: true,
          file_id: true,
          manual_points: true,
          manual_feedback: true,
          marked_at: true,
          file: { select: { id: true, name: true, content_type: true } },
        },
      }),
    ]);
    const ids = (questions ?? []).map((q) => q.id);
    const options = ids.length
      ? await this.prisma.quiz_option.findMany({
          where: { question_id: { in: ids } },
          select: { id: true, question_id: true, label: true, is_correct: true, match_label: true, sort_order: true },
          orderBy: { sort_order: 'asc' },
        })
      : [];
    const position = new Map((attempt ?? []).map((a) => [a.question_id, a.position]));
    const answerOf = new Map((answers ?? []).map((a) => [a.question_id, a]));
    const ordered = [...(questions ?? [])].sort(
      (a, b) =>
        (position.get(a.id) ?? a.sort_order) - (position.get(b.id) ?? b.sort_order),
    );

    return {
      submissionId: submission.id,
      status: submission.status,
      inProgress: !!submission.quiz_started_at,
      needsMarking: submission.status === 'submitted',
      questions: ordered.map((q) => {
        const own = (options ?? []).filter((o) => o.question_id === q.id);
        const a = answerOf.get(q.id);
        const stored = a
          ? {
              optionId: a.option_id,
              optionIds: a.option_ids,
              matches: (a.matches as Record<string, string> | null) ?? null,
              text: a.text_answer,
              numeric: a.numeric_answer === null ? null : Number(a.numeric_answer),
              fileId: a.file_id,
              manualPoints: a.manual_points === null ? null : Number(a.manual_points),
            }
          : null;
        const { credit, needsMarking } = questionCredit(
          {
            kind: q.kind,
            points: Number(q.points),
            numericAnswer: q.numeric_answer === null ? null : Number(q.numeric_answer),
            numericTolerance: Number(q.numeric_tolerance ?? 0),
            partialCredit: q.partial_credit,
            options: own.map((o) => ({
              id: o.id,
              label: o.label,
              isCorrect: o.is_correct,
              matchLabel: o.match_label,
            })),
          },
          stored,
        );
        return {
          id: q.id,
          prompt: q.prompt,
          kind: q.kind,
          points: Number(q.points),
          manual: isManualKind(q.kind),
          rubricId: q.rubric_id ?? null,
          scoring: q.partial_credit ? 'partial' : 'all_or_nothing',
          numericAnswer: q.numeric_answer === null ? null : Number(q.numeric_answer),
          numericTolerance: Number(q.numeric_tolerance ?? 0),
          options: own.map((o) => ({
            id: o.id,
            label: o.label,
            isCorrect: o.is_correct,
            matchLabel: o.match_label ?? null,
          })),
          answer: stored
            ? {
                ...toSavedAnswer({
                  question_id: q.id,
                  option_id: a!.option_id,
                  text_answer: a!.text_answer,
                  option_ids: a!.option_ids,
                  matches: a!.matches,
                  numeric_answer: a!.numeric_answer,
                  file_id: a!.file_id,
                }),
                file: a!.file
                  ? { id: a!.file.id, name: a!.file.name, contentType: a!.file.content_type }
                  : null,
              }
            : null,
          earned: roundScore(credit * Number(q.points)),
          needsMarking,
          mark:
            a?.manual_points === null || a?.manual_points === undefined
              ? null
              : {
                  points: roundScore(Number(a.manual_points)),
                  feedback: a.manual_feedback ?? null,
                  markedAt: ts(a.marked_at),
                },
        };
      }),
    };
  }

  /**
   * Mark one essay or file question. The quiz is scored again from its
   * answers (auto parts + marked parts), becomes graded once every answered
   * essay and file question is marked, and the late policy is applied.
   * Audited.
   */
  async markQuestion(
    userId: string,
    activityId: string,
    studentId: string,
    questionId: string,
    input: { points: number; feedback?: string },
  ) {
    const activity = await this.requireMarkable(userId, activityId);
    if (activity.kind !== 'quiz') {
      throw new BadRequestException('This is not a quiz');
    }
    const submission = await this.prisma.submission.findFirst({
      where: { activity_id: activityId, student_id: studentId },
      select: { id: true, quiz_started_at: true, graded_by: true, status: true },
    });
    if (!submission || (submission.status === 'draft' && !submission.quiz_started_at)) {
      throw new NotFoundException('This student has not handed this in');
    }
    if (submission.quiz_started_at) {
      throw new ConflictException('This student is still taking the quiz');
    }
    if (submission.graded_by) {
      throw new ConflictException(
        'This quiz has a mark entered by hand; change that mark instead',
      );
    }
    const attempt = await this.attemptQuestions(this.prisma, submission.id);
    const question = await this.prisma.quiz_question.findFirst({
      where: attempt
        ? { id: questionId, AND: [{ id: { in: attempt.map((a) => a.question_id) } }] }
        : { id: questionId, activity_id: activityId },
      select: { id: true, kind: true, points: true },
    });
    if (!question) throw new NotFoundException('Question not found');
    if (!isManualKind(question.kind)) {
      throw new BadRequestException('Only essay and file questions are marked by hand');
    }
    if (input.points < 0 || input.points > Number(question.points)) {
      throw new BadRequestException(
        `Points must be between 0 and ${Number(question.points)}`,
      );
    }

    const marked = await this.prisma.$transaction(async (tx) => {
      const before = await tx.quiz_answer.findUnique({
        where: {
          submission_id_question_id: { submission_id: submission.id, question_id: questionId },
        },
        select: { id: true, manual_points: true, manual_feedback: true },
      });
      const fields = {
        manual_points: input.points,
        manual_feedback: input.feedback?.trim() || null,
        marked_by: userId,
        marked_at: new Date(),
      };
      // An unanswered question can be marked too (it then has a row).
      await tx.quiz_answer.upsert({
        where: {
          submission_id_question_id: { submission_id: submission.id, question_id: questionId },
        },
        create: { submission_id: submission.id, question_id: questionId, ...fields },
        update: fields,
      });
      const [locked] = await tx.$queryRaw<{ points: Prisma.Decimal }[]>`
        select points from grading.activity
        where id = ${activityId}::uuid
        for share
      `;
      await rescoreQuizFromAnswers(
        tx,
        activityId,
        Number(locked?.points ?? activity.points),
        submission.id,
      );
      const after = await this.withLateness(tx, activityId, studentId);
      await this.auditLog?.record(
        tx,
        activity.school_id,
        { id: userId },
        {
          entity: 'quiz_answer',
          entityId: before?.id ?? submission.id,
          action: before ? 'update' : 'create',
          changes: auditChanges(
            before
              ? {
                  questionId,
                  points: scoreOrNull(before.manual_points),
                  feedback: before.manual_feedback,
                }
              : null,
            { questionId, points: input.points, feedback: fields.manual_feedback },
          ),
        },
      );
      return after;
    });
    if (marked.status === 'graded') {
      this.emitGrade(activityId, marked, userId, 'teacher');
    }
    return marked;
  }
}
