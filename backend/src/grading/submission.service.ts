import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { FileManagerService } from '@/file-manager/file-manager.service';
import {
  CourseAccessService,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import type { MultipartFile } from '@fastify/multipart';
import { ACTIVITY_COLUMNS, toPortalActivity } from './activity.mapper';

const STUDENT_ACTIVITY_COLUMNS =
  'id, course_id, kind, title, instructions, points, due_at, status, allow_file, allow_text, max_attempts';

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
    private readonly supabaseService: SupabaseService,
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
    const supabase = this.supabaseService.getServiceClient();

    const { data: enrolments } = await supabase
      .schema('course')
      .from('course_student')
      .select('course_id')
      .eq('student_id', studentId)
      .in('status', ['active', 'completed']);

    const courseIds = [
      ...new Set((enrolments ?? []).map((e: any) => e.course_id as string)),
    ];
    if (courseIds.length === 0) return new Map();

    const { data: courses } = await supabase
      .schema('course')
      .from('course')
      .select('id, name')
      .in('id', courseIds)
      .in('status', ['published', 'archived']);

    return new Map(
      (courses ?? []).map((c: any) => [c.id as string, c.name as string]),
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

    const supabase = this.supabaseService.getServiceClient();

    const { data: activities } = await supabase
      .schema('grading')
      .from('activity')
      .select(STUDENT_ACTIVITY_COLUMNS)
      .in('course_id', [...courses.keys()])
      .in('status', ['published', 'closed'])
      .order('due_at', { ascending: true, nullsFirst: false });

    const rows = (activities ?? []) as any[];
    if (rows.length === 0) return [];

    const { data: submissions } = await supabase
      .schema('grading')
      .from('submission')
      .select(
        'id, activity_id, status, score, excused, submitted_at, graded_at',
      )
      .eq('student_id', studentId)
      .in(
        'activity_id',
        rows.map((a) => a.id as string),
      );

    const byActivity = new Map(
      (submissions ?? []).map((s: any) => [s.activity_id as string, s]),
    );

    return rows.map((a) => {
      const submission = byActivity.get(a.id as string);
      const graded = submission?.status === 'graded';

      return {
        id: a.id,
        courseId: a.course_id,
        courseName: courses.get(a.course_id as string) ?? null,
        kind: a.kind,
        title: a.title,
        instructions: a.instructions,
        points: Number(a.points),
        dueAt: a.due_at,
        status: a.status,
        allowFile: a.allow_file,
        allowText: a.allow_text,
        submission: submission
          ? {
              id: submission.id,
              status: submission.status,
              score:
                graded && submission.score !== null
                  ? Number(submission.score)
                  : null,
              excused: !!submission.excused,
              submittedAt: submission.submitted_at,
              gradedAt: submission.graded_at,
            }
          : null,
      };
    });
  }

  /** One course's published and closed work, with the student's state on each. */
  async listCourseForStudent(studentId: string, courseId: string) {
    await this.access.requireStudent(studentId, courseId);
    const supabase = this.supabaseService.getServiceClient();

    const { data: activities } = await supabase
      .schema('grading')
      .from('activity')
      .select(ACTIVITY_COLUMNS)
      .eq('course_id', courseId)
      .in('status', ['published', 'closed'])
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    const rows = (activities ?? []) as any[];
    if (rows.length === 0) return [];

    const { data: submissions } = await supabase
      .schema('grading')
      .from('submission')
      .select(
        'activity_id, status, score, excused, feedback, submitted_at, attempt_count',
      )
      .eq('student_id', studentId)
      .in(
        'activity_id',
        rows.map((a) => a.id as string),
      );

    const byActivity = new Map(
      (submissions ?? []).map((s: any) => [s.activity_id as string, s]),
    );

    return rows.map((a) => toPortalActivity(a, byActivity.get(a.id)));
  }

  /** The activity itself, with questions but never the correct answers. */
  async getForStudent(studentId: string, activityId: string) {
    const supabase = this.supabaseService.getServiceClient();
    const activity = await this.requireAssignedActivity(studentId, activityId);

    const { data: submission } = await supabase
      .schema('grading')
      .from('submission')
      .select(
        'id, status, text_body, file_id, score, feedback, excused, submitted_at, graded_at, attempt_count',
      )
      .eq('activity_id', activityId)
      .eq('student_id', studentId)
      .maybeSingle();

    let questions: any[] = [];

    if (activity.kind === 'quiz') {
      const { data: qs } = await supabase
        .schema('grading')
        .from('quiz_question')
        .select('id, prompt, kind, points, sort_order')
        .eq('activity_id', activityId)
        .order('sort_order', { ascending: true });

      const questionIds = (qs ?? []).map((q: any) => q.id as string);

      const { data: options } = questionIds.length
        ? await supabase
            .schema('grading')
            .from('quiz_option')
            .select('id, question_id, label, sort_order')
            .in('question_id', questionIds)
            .order('sort_order', { ascending: true })
        : { data: [] as any[] };

      // is_correct is deliberately not selected: the answer key must not reach
      // the student's browser, where it is one devtools tab from being read.
      // A short answer goes further and sends no options at all - there its
      // labels are the accepted wordings, so the labels are the answer key.
      questions = (qs ?? []).map((q: any) => ({
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        points: Number(q.points),
        options:
          q.kind === 'short_answer'
            ? []
            : (options ?? [])
                .filter((o: any) => o.question_id === q.id)
                .map((o: any) => ({ id: o.id, label: o.label })),
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
      dueAt: activity.due_at,
      status: activity.status,
      allowFile: activity.allow_file,
      allowText: activity.allow_text,
      // 0 means unlimited, matching the teacher's editor.
      maxAttempts: (activity.max_attempts as number | null) ?? 0,
      attemptsUsed: (submission?.attempt_count as number) ?? 0,
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
                ? Number(submission.score)
                : null,
            feedback: graded ? submission.feedback : null,
            excused: !!submission.excused,
            submittedAt: submission.submitted_at,
            gradedAt: submission.graded_at,
            attemptCount: submission.attempt_count ?? 0,
          }
        : null,
    };
  }

  /** Display names for attached files, so the UI can label a download. */
  private async fileNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return new Map();

    const { data } = await this.supabaseService
      .getServiceClient()
      .schema('file_manager')
      .from('file')
      .select('id, name')
      .in('id', unique);

    return new Map(
      (data ?? []).map((f: any) => [f.id as string, f.name as string]),
    );
  }

  /**
   * An activity is only this student's if it is published (or closed) in a
   * course they are enrolled in and can see. Anything else is reported as
   * missing, so ids from other courses reveal nothing.
   */
  private async requireAssignedActivity(studentId: string, activityId: string) {
    const { data: activity } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('activity')
      .select(STUDENT_ACTIVITY_COLUMNS)
      .eq('id', activityId)
      .maybeSingle();

    if (
      !activity?.course_id ||
      !['published', 'closed'].includes(activity.status as string)
    ) {
      throw new NotFoundException('Activity not found');
    }

    try {
      await this.access.requireStudent(studentId, activity.course_id as string);
    } catch {
      throw new NotFoundException('Activity not found');
    }

    return activity as any;
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
      await this.access.requireStudent(studentId, activity.course_id as string, {
        allowArchived: false,
      });
    } catch {
      throw new ConflictException('This course is closed to new work');
    }
    return activity;
  }

  /** The draft a student works in; created on first touch. */
  private async ensureDraft(studentId: string, activityId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: existing } = await supabase
      .schema('grading')
      .from('submission')
      .select('id, status, file_id, attempt_count')
      .eq('activity_id', activityId)
      .eq('student_id', studentId)
      .maybeSingle();

    if (existing) return existing;

    const { data, error } = await supabase
      .schema('grading')
      .from('submission')
      .insert({
        activity_id: activityId,
        student_id: studentId,
        status: 'draft',
      })
      .select('id, status, file_id, attempt_count')
      .single();

    if (error || !data) {
      this.logger.error(`Failed to open submission: ${error?.message}`);
      throw new BadRequestException('Failed to start this work');
    }
    return data;
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

    const supabase = this.supabaseService.getServiceClient();
    const { error } = await supabase
      .schema('grading')
      .from('submission')
      .update({ file_id: uploaded.id, updated_at: new Date().toISOString() })
      .eq('id', draft.id);

    if (error) {
      this.logger.error(`Failed to attach file: ${error.message}`);
      throw new BadRequestException('Failed to attach the file');
    }

    return { fileId: uploaded.id, name: uploaded.name };
  }

  async createUploadTicket(
    studentId: string,
    activityId: string,
    input: { name: string; sizeBytes: number; contentType: string },
    requestHost?: string,
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
    return this.files.createUploadTicket(owner, input, requestHost);
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

    const { error } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('submission')
      .update({ file_id: file.id, updated_at: new Date().toISOString() })
      .eq('id', draft.id);

    if (error) {
      this.logger.error(`Failed to attach file: ${error.message}`);
      throw new BadRequestException('Failed to attach the file');
    }

    return { fileId: file.id, name: file.name };
  }

  /** The login behind a student record, which owns anything they upload. */
  private async userIdForStudent(studentId: string): Promise<string> {
    const supabase = this.supabaseService.getServiceClient();
    const { data } = await supabase
      .schema('student')
      .from('student')
      .select('user_profile_id')
      .eq('id', studentId)
      .maybeSingle();

    if (!data?.user_profile_id) {
      throw new BadRequestException('This student has no account');
    }
    return data.user_profile_id;
  }

  /** The file a student handed in, for staff marking it. */
  async readSubmissionFile(userId: string, submissionId: string) {
    const { data: submission } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('submission')
      .select('id, activity_id, file_id')
      .eq('id', submissionId)
      .maybeSingle();

    if (!submission?.file_id) {
      throw new NotFoundException('No file was handed in');
    }

    const courseId = await this.access.courseIdOfActivity(
      submission.activity_id as string,
    );
    await this.access.require(userId, courseId, STAFF_ROLES);

    return this.files.readContentForAuthorisedCaller(
      submission.file_id as string,
    );
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
    const fileId = (input.fileId ?? draft.file_id ?? null) as string | null;

    if (!input.textBody?.trim() && !fileId) {
      throw new BadRequestException('Add your work before submitting');
    }
    if (fileId && !activity.allow_file) {
      throw new BadRequestException('This assignment does not accept files');
    }
    if (input.textBody?.trim() && !activity.allow_text) {
      throw new BadRequestException('This assignment does not accept text');
    }

    const supabase = this.supabaseService.getServiceClient();

    // A client-supplied fileId must be the student's own finished upload;
    // otherwise any file id - a classmate's work included - could be handed in.
    if (input.fileId && input.fileId !== draft.file_id) {
      const owner = await this.userIdForStudent(studentId);
      const { data: file } = await supabase
        .schema('file_manager')
        .from('file')
        .select('id')
        .eq('id', input.fileId)
        .eq('owner_id', owner)
        .eq('status', 'ready')
        .maybeSingle();
      if (!file) throw new BadRequestException('File not found');
    }

    const { data, error } = await supabase
      .schema('grading')
      .from('submission')
      .update({
        status: 'submitted',
        text_body: input.textBody?.trim() ?? null,
        file_id: fileId,
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', draft.id)
      // Guards a second submit racing the first.
      .eq('status', 'draft')
      .select('id, status, submitted_at')
      .maybeSingle();

    if (error || !data) {
      throw new ConflictException('You have already submitted this');
    }

    return { id: data.id, status: data.status, submittedAt: data.submitted_at };
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
    const limit = activity.max_attempts as number | null;
    const used = (draft.attempt_count as number) ?? 0;

    if (limit !== null && used >= limit) {
      throw new ConflictException(
        used === 1
          ? 'You have already submitted this quiz'
          : `You have used all ${limit} attempts`,
      );
    }

    const supabase = this.supabaseService.getServiceClient();

    // Only answers belonging to this quiz count; anything else is ignored
    // rather than trusted.
    const { data: questions } = await supabase
      .schema('grading')
      .from('quiz_question')
      .select('id, kind')
      .eq('activity_id', activityId);

    // An answer is stored in the shape its question is marked in, whatever the
    // client sent: text for a short answer, an option for the choice kinds.
    const kindById = new Map(
      (questions ?? []).map((q: any) => [q.id as string, q.kind as string]),
    );

    // An option id is only an answer to the question it belongs to. Without
    // this, one option id known to be correct - learned on a retake of any
    // quiz - could be sent as the answer to every question everywhere.
    const questionIds = [...kindById.keys()];
    const { data: options } = questionIds.length
      ? await supabase
          .schema('grading')
          .from('quiz_option')
          .select('id, question_id')
          .in('question_id', questionIds)
      : { data: [] as any[] };
    const questionOfOption = new Map(
      (options ?? []).map((o: any) => [o.id as string, o.question_id as string]),
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
      await supabase
        .schema('grading')
        .from('quiz_answer')
        .delete()
        .eq('submission_id', draft.id);
    }

    if (accepted.length > 0) {
      const { error } = await supabase
        .schema('grading')
        .from('quiz_answer')
        .upsert(
          accepted.map((a) => {
            const isText = kindById.get(a.questionId) === 'short_answer';
            return {
              submission_id: draft.id,
              question_id: a.questionId,
              option_id: isText ? null : (a.optionId ?? null),
              text_answer: isText ? (a.text?.trim() ?? null) : null,
            };
          }),
          { onConflict: 'submission_id,question_id' },
        );

      if (error) {
        this.logger.error(`Failed to record answers: ${error.message}`);
        throw new BadRequestException('Failed to record your answers');
      }
    }

    const { data, error } = await supabase
      .schema('grading')
      .rpc('submit_quiz', {
        p_submission_id: draft.id,
        p_student_id: studentId,
      });

    if (error) {
      const detail = `${error.code ?? ''} ${error.message ?? ''}`;
      if (detail.includes('no_attempts_left')) {
        throw new ConflictException('You have no attempts left');
      }
      if (detail.includes('activity_not_open')) {
        throw new ConflictException('This quiz is closed');
      }
      this.logger.error(`Quiz submission failed: ${error.message}`);
      throw new BadRequestException('Failed to submit quiz');
    }

    const row = Array.isArray(data) ? data[0] : data;

    return {
      score: row?.score === undefined ? null : Number(row.score),
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
    const { data: activity } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('activity')
      .select('id, course_id, points, status, kind')
      .eq('id', activityId)
      .maybeSingle();

    if (!activity?.course_id) throw new NotFoundException('Activity not found');
    await this.access.require(
      userId,
      activity.course_id as string,
      STAFF_ROLES,
    );
    return activity as any;
  }

  /**
   * The student must be on the course's roster. Any status will do - a
   * dropped student's existing work can still be marked or excused, so the
   * record is right if they come back.
   */
  private async requireCourseStudent(courseId: string, studentId: string) {
    const { data } = await this.supabaseService
      .getServiceClient()
      .schema('course')
      .from('course_student')
      .select('student_id')
      .eq('course_id', courseId)
      .eq('student_id', studentId)
      .maybeSingle();

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
    const supabase = this.supabaseService.getServiceClient();

    const { data: roster } = await supabase
      .schema('course')
      .from('course_student')
      .select('student_id, status')
      .eq('course_id', activity.course_id);

    const { data: submissions } = await supabase
      .schema('grading')
      .from('submission')
      .select(
        'id, student_id, status, text_body, file_id, score, feedback, excused, excused_reason, submitted_at, graded_at, attempt_count',
      )
      .eq('activity_id', activityId);

    const byStudent = new Map(
      (submissions ?? []).map((s: any) => [s.student_id as string, s]),
    );
    const statusOf = new Map(
      (roster ?? []).map((r: any) => [r.student_id as string, r.status]),
    );

    const studentIds = [
      ...new Set([
        ...(roster ?? [])
          .filter((r: any) => r.status !== 'dropped')
          .map((r: any) => r.student_id as string),
        ...byStudent.keys(),
      ]),
    ];

    const { data: students } = studentIds.length
      ? await supabase
          .schema('student')
          .from('student')
          .select('id, first_name, last_name')
          .in('id', studentIds)
      : { data: [] as any[] };

    const names = await this.fileNames(
      (submissions ?? []).map((s: any) => s.file_id as string),
    );

    return (students ?? [])
      .map((s: any) => {
        const submission = byStudent.get(s.id as string);
        return {
          studentId: s.id as string,
          name: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
          enrollmentStatus: (statusOf.get(s.id as string) ?? null) as
            'active' | 'dropped' | 'completed' | null,
          submission: submission
            ? {
                id: submission.id,
                status: submission.status,
                textBody: submission.text_body,
                fileId: submission.file_id,
                fileName: names.get(submission.file_id as string) ?? null,
                score:
                  submission.score === null ? null : Number(submission.score),
                feedback: submission.feedback,
                excused: !!submission.excused,
                excusedReason: submission.excused_reason ?? null,
                submittedAt: submission.submitted_at,
                gradedAt: submission.graded_at,
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
      score: row.score === null ? null : Number(row.score),
      feedback: (row.feedback as string | null) ?? null,
      excused: !!row.excused,
      excusedReason: (row.excused_reason as string | null) ?? null,
      gradedAt: (row.graded_at as string | null) ?? null,
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
    fields: Record<string, unknown>,
  ) {
    const { data, error } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('submission')
      .upsert(
        {
          activity_id: activityId,
          student_id: studentId,
          ...fields,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'activity_id,student_id' },
      )
      .select(
        'id, student_id, status, score, feedback, excused, excused_reason, graded_at',
      )
      .single();

    if (error || !data) {
      this.logger.error(`Failed to write submission: ${error?.message}`);
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
    await this.requireCourseStudent(activity.course_id as string, studentId);

    if (input.score < 0 || input.score > Number(activity.points)) {
      throw new BadRequestException(
        `Score must be between 0 and ${Number(activity.points)}`,
      );
    }

    return this.writeSubmission(activityId, studentId, {
      status: 'graded',
      score: input.score,
      feedback: input.feedback ?? null,
      graded_at: new Date().toISOString(),
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
    const { data: submission } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('submission')
      .select('id, activity_id, student_id')
      .eq('id', submissionId)
      .maybeSingle();

    if (!submission) throw new NotFoundException('Submission not found');

    return this.grade(
      userId,
      submission.activity_id as string,
      submission.student_id as string,
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
    await this.requireCourseStudent(activity.course_id as string, studentId);

    const supabase = this.supabaseService.getServiceClient();
    const { data: existing } = await supabase
      .schema('grading')
      .from('submission')
      .select('id')
      .eq('activity_id', activityId)
      .eq('student_id', studentId)
      .maybeSingle();

    const fields: Record<string, unknown> = {
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
      fields.graded_at = new Date().toISOString();
      fields.graded_by = userId;
    }

    return this.writeSubmission(activityId, studentId, fields);
  }
}
