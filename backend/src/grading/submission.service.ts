import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { pgCode, raisedMessage } from '@/common/db-values';
import { roundScore, scoreOrNull } from './round';
import { FileManagerService } from '@/file-manager/file-manager.service';
import {
  CourseAccessService,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import type { MultipartFile } from '@fastify/multipart';
import {
  ACTIVITY_ORDER,
  ACTIVITY_SELECT,
  toPortalActivity,
  ts,
} from './activity.mapper';

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
  allow_text: true,
  max_attempts: true,
} satisfies Prisma.activitySelect;

const DRAFT_SELECT = {
  id: true,
  status: true,
  file_id: true,
  attempt_count: true,
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
} satisfies Prisma.submissionSelect;

/**
 * Submissions: a student's work on an activity, and the mark on it.
 *
 * Since the move to courses the submission is the only place a mark lives
 * (the Canvas model). Nothing here writes grading.grade any more; the course
 * gradebook reads submissions directly.
 */
@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileManagerService,
    private readonly access: CourseAccessService,
  ) {}

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
      where: { id: { in: courseIds }, status: { in: ['published', 'archived'] } },
      select: { id: true, name: true },
    });

    return new Map(courses.map((c) => [c.id, c.name]));
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

    const submissions = await this.prisma.submission.findMany({
      where: {
        student_id: studentId,
        activity_id: { in: rows.map((a) => a.id) },
      },
      select: {
        id: true,
        activity_id: true,
        status: true,
        score: true,
        excused: true,
        submitted_at: true,
        graded_at: true,
      },
    });

    const byActivity = new Map(submissions.map((s) => [s.activity_id, s]));

    return rows.map((a) => {
      const submission = byActivity.get(a.id);
      const graded = submission?.status === 'graded';

      return {
        id: a.id,
        courseId: a.course_id,
        courseName: courses.get(a.course_id as string) ?? null,
        kind: a.kind,
        title: a.title,
        instructions: a.instructions,
        points: Number(a.points),
        dueAt: ts(a.due_at),
        status: a.status,
        allowFile: a.allow_file,
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
            }
          : null,
      };
    });
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

    const submissions = await this.prisma.submission.findMany({
      where: {
        student_id: studentId,
        activity_id: { in: rows.map((a) => a.id) },
      },
      select: {
        activity_id: true,
        status: true,
        score: true,
        excused: true,
        feedback: true,
        submitted_at: true,
        attempt_count: true,
      },
    });

    const byActivity = new Map(submissions.map((s) => [s.activity_id, s]));

    return rows.map((a) => toPortalActivity(a, byActivity.get(a.id)));
  }

  /** The activity itself, with questions but never the correct answers. */
  async getForStudent(studentId: string, activityId: string) {
    const activity = await this.requireAssignedActivity(studentId, activityId);

    const submission = await this.prisma.submission.findFirst({
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
      },
    });

    let questions: any[] = [];

    if (activity.kind === 'quiz') {
      const qs = await this.prisma.quiz_question.findMany({
        where: { activity_id: activityId },
        select: { id: true, prompt: true, kind: true, points: true, sort_order: true },
        orderBy: { sort_order: 'asc' },
      });

      const questionIds = qs.map((q) => q.id);

      const options = questionIds.length
        ? await this.prisma.quiz_option.findMany({
            where: { question_id: { in: questionIds } },
            select: { id: true, question_id: true, label: true, sort_order: true },
            orderBy: { sort_order: 'asc' },
          })
        : [];

      // is_correct is deliberately not selected: the answer key must not reach
      // the student's browser, where it is one devtools tab from being read.
      // A short answer goes further and sends no options at all - there its
      // labels are the accepted wordings, so the labels are the answer key.
      questions = qs.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        points: Number(q.points),
        options:
          q.kind === 'short_answer'
            ? []
            : options
                .filter((o) => o.question_id === q.id)
                .map((o) => ({ id: o.id, label: o.label })),
      }));
    }

    const names = await this.fileNames([submission?.file_id as string]);
    const graded = submission?.status === 'graded';

    return {
      id: activity.id,
      courseId: activity.course_id,
      kind: activity.kind,
      title: activity.title,
      instructions: activity.instructions,
      points: Number(activity.points),
      dueAt: ts(activity.due_at),
      status: activity.status,
      allowFile: activity.allow_file,
      allowText: activity.allow_text,
      // 0 means unlimited, matching the teacher's editor.
      maxAttempts: activity.max_attempts ?? 0,
      attemptsUsed: submission?.attempt_count ?? 0,
      questions,
      submission: submission
        ? {
            id: submission.id,
            status: submission.status,
            textBody: submission.text_body,
            fileId: submission.file_id,
            fileName: names.get(submission.file_id as string) ?? null,
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
          }
        : null,
    };
  }

  /** Display names for attached files, so the UI can label a download. */
  private async fileNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const data = await this.prisma.file.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });

    return new Map(data.map((f) => [f.id, f.name]));
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

    try {
      await this.access.requireStudent(studentId, activity.course_id);
    } catch {
      throw new NotFoundException('Activity not found');
    }

    return activity as typeof activity & { course_id: string };
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
      await this.access.requireStudent(
        studentId,
        activity.course_id,
        {
          allowArchived: false,
        },
      );
    } catch {
      throw new ConflictException('This course is closed to new work');
    }
    return activity;
  }

  /** The draft a student works in; created on first touch. */
  private async ensureDraft(studentId: string, activityId: string) {
    const existing = await this.prisma.submission.findFirst({
      where: { activity_id: activityId, student_id: studentId },
      select: DRAFT_SELECT,
    });

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
      this.logger.error(
        `Failed to open submission: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to start this work');
    }
  }

  /**
   * Attach a file to the draft, uploading it as the student's own.
   *
   * Students hold no catalog permissions, so they cannot reach the file
   * manager's own endpoints; this is the one way in, and it only ever writes
   * to their own draft for an activity set to their class.
   */
  async attachFile(studentId: string, activityId: string, file: MultipartFile) {
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

    // Uploading as the student's own user means the usual scanning, quotas and
    // ownership all apply; nothing here bypasses the file manager.
    const owner = await this.userIdForStudent(studentId);
    const uploaded = await this.files.uploadManual(owner, file);

    try {
      await this.prisma.submission.updateMany({
        where: { id: draft.id },
        data: { file_id: uploaded.id, updated_at: new Date() },
      });
    } catch (error) {
      this.logger.error(`Failed to attach file: ${(error as Error).message}`);
      throw new BadRequestException('Failed to attach the file');
    }

    return { fileId: uploaded.id, name: uploaded.name };
  }

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

    const owner = await this.userIdForStudent(studentId);
    return this.files.createUploadTicket(owner, input);
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

    const draft = await this.ensureDraft(studentId, activityId);
    if (draft.status !== 'draft') {
      throw new ConflictException('You have already submitted this');
    }

    const owner = await this.userIdForStudent(studentId);
    const file = await this.files.finaliseUpload(owner, fileId);

    try {
      await this.prisma.submission.updateMany({
        where: { id: draft.id },
        data: { file_id: file.id, updated_at: new Date() },
      });
    } catch (error) {
      this.logger.error(`Failed to attach file: ${(error as Error).message}`);
      throw new BadRequestException('Failed to attach the file');
    }

    return { fileId: file.id, name: file.name };
  }

  /** The login behind a student record, which owns anything they upload. */
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
  async readSubmissionFile(userId: string, submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { id: true, activity_id: true, file_id: true },
    });

    if (!submission?.file_id) {
      throw new NotFoundException('No file was handed in');
    }

    const courseId = await this.access.courseIdOfActivity(
      submission.activity_id,
    );
    await this.access.require(userId, courseId, STAFF_ROLES);

    return this.files.readContentForAuthorisedCaller(submission.file_id);
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

    // A file attached earlier stays attached: handing in text as well must not
    // silently drop it.
    const fileId = (input.fileId ?? draft.file_id ?? null);

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
    try {
      [data] = await this.prisma.submission.updateManyAndReturn({
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
    } catch {
      data = undefined;
    }

    if (!data) {
      throw new ConflictException('You have already submitted this');
    }

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
    answers: { questionId: string; optionId?: string; text?: string }[],
  ) {
    const activity = await this.requireSubmittable(studentId, activityId);

    if (activity.kind !== 'quiz') {
      throw new BadRequestException('This is not a quiz');
    }
    if (activity.status !== 'published') {
      throw new ConflictException('This quiz is closed');
    }

    const draft = await this.ensureDraft(studentId, activityId);

    // A retake is allowed while attempts remain, so a graded submission is not
    // automatically the end of it. The limit is enforced again inside
    // submit_quiz, which holds the row lock while it counts.
    const limit = activity.max_attempts;
    const used = draft.attempt_count ?? 0;

    if (limit !== null && used >= limit) {
      throw new ConflictException(
        used === 1
          ? 'You have already submitted this quiz'
          : `You have used all ${limit} attempts`,
      );
    }

    // Only answers belonging to this quiz count; anything else is ignored
    // rather than trusted.
    const questions = await this.prisma.quiz_question.findMany({
      where: { activity_id: activityId },
      select: { id: true, kind: true },
    });

    // An answer is stored in the shape its question is marked in, whatever the
    // client sent: text for a short answer, an option for the choice kinds.
    const kindById = new Map<string, string>(
      questions.map((q) => [q.id, q.kind]),
    );

    // An option id is only an answer to the question it belongs to. Without
    // this, one option id known to be correct - learned on a retake of any
    // quiz - could be sent as the answer to every question everywhere.
    const questionIds = [...kindById.keys()];
    const options = questionIds.length
      ? await this.prisma.quiz_option.findMany({
          where: { question_id: { in: questionIds } },
          select: { id: true, question_id: true },
        })
      : [];
    const questionOfOption = new Map(
      options.map((o) => [o.id, o.question_id]),
    );

    const accepted = answers.filter(
      (a) =>
        kindById.has(a.questionId) &&
        (kindById.get(a.questionId) === 'short_answer' ||
          !a.optionId ||
          questionOfOption.get(a.optionId) === a.questionId),
    );

    // Clear the previous attempt first: upserting alone would leave answers to
    // questions this attempt skipped, silently scoring them again.
    if (used > 0) {
      await this.prisma.quiz_answer.deleteMany({
        where: { submission_id: draft.id },
      });
    }

    if (accepted.length > 0) {
      // An upsert on (submission, question): replace any answer already
      // stored for these questions, in one transaction.
      try {
        await this.prisma.$transaction([
          this.prisma.quiz_answer.deleteMany({
            where: {
              submission_id: draft.id,
              question_id: { in: accepted.map((a) => a.questionId) },
            },
          }),
          this.prisma.quiz_answer.createMany({
            data: accepted.map((a) => {
              const isText = kindById.get(a.questionId) === 'short_answer';
              return {
                submission_id: draft.id,
                question_id: a.questionId,
                option_id: isText ? null : (a.optionId ?? null),
                text_answer: isText ? (a.text?.trim() ?? null) : null,
              };
            }),
          }),
        ]);
      } catch (error) {
        this.logger.error(
          `Failed to record answers: ${(error as Error).message}`,
        );
        throw new BadRequestException('Failed to record your answers');
      }
    }

    let data: {
      score: Prisma.Decimal | null;
      points: Prisma.Decimal | null;
      attempts_used: number | null;
    }[];
    try {
      data = await this.prisma.$queryRaw`
        select * from grading.submit_quiz(${draft.id}::uuid, ${studentId}::uuid)
      `;
    } catch (error) {
      const detail = `${pgCode(error) ?? ''} ${raisedMessage(error)}`;
      if (detail.includes('no_attempts_left')) {
        throw new ConflictException('You have no attempts left');
      }
      if (detail.includes('activity_not_open')) {
        throw new ConflictException('This quiz is closed');
      }
      this.logger.error(
        `Quiz submission failed: ${(error as Error).message}`,
      );
      throw new BadRequestException('Failed to submit quiz');
    }

    const row = data[0];

    return {
      score: row?.score === undefined ? null : scoreOrNull(row.score),
      // A null points column is Number(null) = 0, as before.
      points: row?.points === undefined ? null : Number(row.points),
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
      select: { id: true, course_id: true, points: true, status: true, kind: true },
    });

    if (!activity?.course_id) throw new NotFoundException('Activity not found');
    await this.access.require(userId, activity.course_id, STAFF_ROLES);
    return activity as typeof activity & { course_id: string };
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

    const names = await this.fileNames(
      submissions.map((s) => s.file_id as string),
    );

    return students
      .map((s) => {
        const submission = byStudent.get(s.id);
        return {
          studentId: s.id,
          name: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
          enrollmentStatus: (statusOf.get(s.id) ?? null) as
            'active' | 'dropped' | 'completed' | null,
          submission: submission
            ? {
                id: submission.id,
                status: submission.status,
                textBody: submission.text_body,
                fileId: submission.file_id,
                fileName: names.get(submission.file_id as string) ?? null,
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
              }
            : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
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
    };
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
  ) {
    const now = new Date();
    let data;
    try {
      data = await this.prisma.submission.upsert({
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

    return this.writeSubmission(activityId, studentId, {
      status: 'graded',
      score: input.score,
      feedback: input.feedback ?? null,
      graded_at: new Date(),
      graded_by: userId,
    });
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

    return this.writeSubmission(activityId, studentId, fields);
  }
}
