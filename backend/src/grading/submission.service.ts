import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ZipArchive } from 'archiver';
import { basename } from 'node:path';
import { PrismaService } from '@/prisma/prisma.service';
import type { Prisma } from '@/generated/prisma/client';
import { pgCode, raisedMessage } from '@/common/db-values';
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
  rubric_id: true,
} satisfies Prisma.activitySelect;

const DRAFT_SELECT = {
  id: true,
  status: true,
  file_id: true,
  attempt_count: true,
  graded_by: true,
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

const MAX_SUBMISSION_FILES = 20;

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
        courseName: courses.get(a.course_id) ?? null,
        kind: a.kind,
        title: a.title,
        instructions: a.instructions,
        points: Number(a.points),
        dueAt: ts(a.due_at),
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
      status: activity.status,
      allowFile: activity.allow_file,
      allowMultipleFiles: activity.allow_multiple_files,
      allowText: activity.allow_text,
      // 0 means unlimited, matching the teacher's editor.
      maxAttempts: activity.max_attempts ?? 0,
      attemptsUsed: submission?.attempt_count ?? 0,
      questions,
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
        submission_file: { select: { file_id: true }, orderBy: { sort_order: 'asc' } },
      },
    });

    const attachedFileIds = submission?.submission_file?.map(
      ({ file_id }) => file_id,
    ) ?? [];
    if (submission?.file_id && attachedFileIds.length === 0) {
      attachedFileIds.push(submission.file_id);
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
      this.logger.error(`Failed to generate submission archive: ${error.message}`);
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

    // A mark a teacher entered or imported is final; a retake would replace it
    // with the automatic score. submit_quiz checks this again under its lock.
    if (draft.graded_by) {
      throw new BadRequestException(
        'Your teacher has marked this quiz, so it cannot be retaken',
      );
    }

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
      if (detail.includes('already_marked')) {
        throw new BadRequestException(
          'Your teacher has marked this quiz, so it cannot be retaken',
        );
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

    const filesBySubmission = await this.submissionFilesById(submissions);

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
