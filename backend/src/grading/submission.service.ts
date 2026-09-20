import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';
import { FileManagerService } from '@/file-manager/file-manager.service';
import type { MultipartFile } from '@fastify/multipart';

@Injectable()
export class SubmissionService {
  private readonly logger = new Logger(SubmissionService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
    private readonly files: FileManagerService,
  ) {}

  private async invalidate(): Promise<void> {
    await this.cache.deleteByPrefix('calc:');
  }

  // ── student side ──────────────────────────────────────────────────────────

  /** Activities published to the classes this student is enrolled in. */
  async listForStudent(studentId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: enrolments } = await supabase
      .schema('student')
      .from('student_group_enrollment')
      .select('student_group_id')
      .eq('student_id', studentId);

    const classIds = [
      ...new Set(
        (enrolments ?? [])
          .map((e: any) => e.student_group_id as string | null)
          .filter(Boolean) as string[],
      ),
    ];

    if (classIds.length === 0) return [];

    // Drafts are the teacher's working copy; closed work stays visible so a
    // student can still see what they did and what it scored.
    const { data: activities } = await supabase
      .schema('grading')
      .from('activity')
      .select(
        'id, student_group_id, subject_id, kind, title, instructions, points, due_at, status, allow_file, allow_text, max_attempts',
      )
      .in('student_group_id', classIds)
      .in('status', ['published', 'closed'])
      .order('due_at', { ascending: true });

    const rows = (activities ?? []) as any[];
    if (rows.length === 0) return [];

    const { data: submissions } = await supabase
      .schema('grading')
      .from('submission')
      .select('id, activity_id, status, score, submitted_at, graded_at')
      .eq('student_id', studentId)
      .in(
        'activity_id',
        rows.map((a) => a.id as string),
      );

    const byActivity = new Map(
      (submissions ?? []).map((s: any) => [s.activity_id as string, s]),
    );

    const subjectIds = [...new Set(rows.map((a) => a.subject_id as string))];
    const { data: subjects } = subjectIds.length
      ? await supabase
          .from('subject')
          .select('id, name, code')
          .in('id', subjectIds)
      : { data: [] as any[] };
    const subjectById = new Map(
      (subjects ?? []).map((s: any) => [s.id as string, s]),
    );

    return rows.map((a) => {
      const submission = byActivity.get(a.id as string);
      const subject = subjectById.get(a.subject_id as string);

      return {
        id: a.id,
        kind: a.kind,
        title: a.title,
        instructions: a.instructions,
        points: Number(a.points),
        dueAt: a.due_at,
        status: a.status,
        allowFile: a.allow_file,
        allowText: a.allow_text,
        subject: subject
          ? { id: subject.id, name: subject.name, code: subject.code }
          : null,
        submission: submission
          ? {
              id: submission.id,
              status: submission.status,
              score:
                submission.score === null ? null : Number(submission.score),
              submittedAt: submission.submitted_at,
              gradedAt: submission.graded_at,
            }
          : null,
      };
    });
  }

  /** The activity itself, with questions but never the correct answers. */
  async getForStudent(studentId: string, activityId: string) {
    const supabase = this.supabaseService.getServiceClient();
    const activity = await this.requireAssignedActivity(studentId, activityId);

    const { data: submission } = await supabase
      .schema('grading')
      .from('submission')
      .select(
        'id, status, text_body, file_id, score, feedback, submitted_at, graded_at, attempt_count',
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

    return {
      id: activity.id,
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
            score: submission.score === null ? null : Number(submission.score),
            feedback: submission.feedback,
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

  /** An activity is only this student's if it is set for a class they are in. */
  private async requireAssignedActivity(studentId: string, activityId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: activity } = await supabase
      .schema('grading')
      .from('activity')
      .select(
        'id, student_group_id, subject_id, kind, title, instructions, points, due_at, status, allow_file, allow_text, max_attempts',
      )
      .eq('id', activityId)
      .maybeSingle();

    if (
      !activity ||
      !['published', 'closed'].includes(activity.status as string)
    ) {
      throw new NotFoundException('Activity not found');
    }

    const { data: enrolment } = await supabase
      .schema('student')
      .from('student_group_enrollment')
      .select('id')
      .eq('student_id', studentId)
      .eq('student_group_id', activity.student_group_id)
      .maybeSingle();

    if (!enrolment) {
      throw new NotFoundException('Activity not found');
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
    const activity = await this.requireAssignedActivity(studentId, activityId);

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
  ) {
    const activity = await this.requireAssignedActivity(studentId, activityId);

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
    const activity = await this.requireAssignedActivity(studentId, activityId);

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

  async readSubmissionFile(userId: string, submissionId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: submission } = await supabase
      .schema('grading')
      .from('submission')
      .select('id, activity_id, file_id')
      .eq('id', submissionId)
      .maybeSingle();

    if (!submission?.file_id) {
      throw new NotFoundException('No file was handed in');
    }

    const { data: activity } = await supabase
      .schema('grading')
      .from('activity')
      .select('student_group_id')
      .eq('id', submission.activity_id)
      .maybeSingle();

    if (!activity) throw new NotFoundException('Activity not found');
    await this.requireClassOwnership(
      userId,
      activity.student_group_id as string,
    );

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
    const activity = await this.requireAssignedActivity(studentId, activityId);

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
   * Answer and submit a quiz. Scoring, marking and the gradebook write all
   * happen inside submit_quiz so a scored attempt always has a grade.
   */
  async submitQuiz(
    studentId: string,
    activityId: string,
    answers: { questionId: string; optionId?: string; text?: string }[],
  ) {
    const activity = await this.requireAssignedActivity(studentId, activityId);

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
    const accepted = answers.filter((a) => kindById.has(a.questionId));

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
    await this.invalidate();

    return {
      score: row?.score === undefined ? null : Number(row.score),
      points: row?.points === undefined ? null : Number(row.points),
    };
  }

  // ── teacher side ──────────────────────────────────────────────────────────

  /** Every submission for an activity, with who has not handed in. */
  async listForTeacher(userId: string, activityId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: activity } = await supabase
      .schema('grading')
      .from('activity')
      .select('id, student_group_id, points, kind')
      .eq('id', activityId)
      .maybeSingle();

    if (!activity) throw new NotFoundException('Activity not found');
    await this.requireClassOwnership(
      userId,
      activity.student_group_id as string,
    );

    const { data: enrolments } = await supabase
      .schema('student')
      .from('student_group_enrollment')
      .select('student_id')
      .eq('student_group_id', activity.student_group_id);

    const studentIds = (enrolments ?? [])
      .map((e: any) => e.student_id as string | null)
      .filter(Boolean) as string[];

    const { data: students } = studentIds.length
      ? await supabase
          .schema('student')
          .from('student')
          .select('id, first_name, last_name')
          .in('id', studentIds)
      : { data: [] as any[] };

    const { data: submissions } = studentIds.length
      ? await supabase
          .schema('grading')
          .from('submission')
          .select(
            'id, student_id, status, text_body, file_id, score, feedback, submitted_at, graded_at, attempt_count',
          )
          .eq('activity_id', activityId)
      : { data: [] as any[] };

    const byStudent = new Map(
      (submissions ?? []).map((s: any) => [s.student_id as string, s]),
    );

    const names = await this.fileNames(
      (submissions ?? []).map((s: any) => s.file_id as string),
    );

    return (students ?? [])
      .map((s: any) => {
        const submission = byStudent.get(s.id as string);
        return {
          studentId: s.id,
          name: `${s.first_name ?? ''} ${s.last_name ?? ''}`.trim(),
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
                submittedAt: submission.submitted_at,
                gradedAt: submission.graded_at,
                attemptCount: submission.attempt_count ?? 0,
              }
            : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async requireClassOwnership(userId: string, classId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: profile } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .maybeSingle();

    if (!profile?.school_id) {
      throw new BadRequestException('You are not assigned to a school');
    }

    const { data } = await supabase
      .from('student_group')
      .select('id, academic_year:academic_year_id(school_id)')
      .eq('id', classId)
      .maybeSingle();

    const owner = (data?.academic_year as { school_id?: string } | null)
      ?.school_id;

    if (!data || owner !== profile.school_id) {
      throw new NotFoundException('Activity not found');
    }
  }

  /** Mark a submission and write the result through to the gradebook. */
  async grade(
    userId: string,
    submissionId: string,
    input: { score: number; feedback?: string },
  ) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: submission } = await supabase
      .schema('grading')
      .from('submission')
      .select('id, activity_id, student_id, status')
      .eq('id', submissionId)
      .maybeSingle();

    if (!submission) throw new NotFoundException('Submission not found');

    const { data: activity } = await supabase
      .schema('grading')
      .from('activity')
      .select('id, student_group_id, assessment_id, points')
      .eq('id', submission.activity_id)
      .maybeSingle();

    if (!activity) throw new NotFoundException('Activity not found');
    await this.requireClassOwnership(
      userId,
      activity.student_group_id as string,
    );

    if (input.score < 0 || input.score > Number(activity.points)) {
      throw new BadRequestException(
        `Score must be between 0 and ${Number(activity.points)}`,
      );
    }

    const { error } = await supabase
      .schema('grading')
      .from('submission')
      .update({
        status: 'graded',
        score: input.score,
        feedback: input.feedback ?? null,
        graded_at: new Date().toISOString(),
        graded_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', submissionId);

    if (error) {
      this.logger.error(`Failed to grade submission: ${error.message}`);
      throw new BadRequestException('Failed to save the mark');
    }

    // Without this the mark lives only on the submission and never reaches a
    // report, which is the whole point of linking an activity to an assessment.
    if (activity.assessment_id) {
      const { error: gradeError } = await supabase
        .schema('grading')
        .from('grade')
        .upsert(
          {
            assessment_id: activity.assessment_id,
            student_id: submission.student_id,
            score: input.score,
          },
          { onConflict: 'assessment_id,student_id' },
        );

      if (gradeError) {
        this.logger.error(
          `Marked submission ${submissionId} but failed to write the grade: ${gradeError.message}`,
        );
        throw new BadRequestException(
          'The mark was saved but did not reach the gradebook',
        );
      }
    }

    await this.invalidate();
    return { id: submissionId, score: input.score };
  }
}
