import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { CacheService } from '@/cache/cache.service';

type ActivityKind = 'quiz' | 'assignment';
type QuestionKind = 'multiple_choice' | 'true_false' | 'short_answer';
type ActivityStatus = 'draft' | 'published' | 'closed';

const ACTIVITY_COLUMNS =
  'id, student_group_id, subject_id, term_id, grading_group_id, assessment_id, kind, title, instructions, points, due_at, status, published_at, allow_file, allow_text, max_attempts, created_by, created_at';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  private async invalidate(): Promise<void> {
    await this.cache.deleteByPrefix('calc:');
  }

  private async requireSchool(userId: string): Promise<string> {
    const supabase = this.supabaseService.getServiceClient();
    const { data } = await supabase
      .from('user_profile')
      .select('school_id')
      .eq('id', userId)
      .maybeSingle();

    if (!data?.school_id) {
      throw new BadRequestException('You are not assigned to a school');
    }
    return data.school_id;
  }

  /** A class belongs to a school through its academic year. */
  private async requireClass(userId: string, classId: string): Promise<void> {
    const schoolId = await this.requireSchool(userId);
    const supabase = this.supabaseService.getServiceClient();

    const { data } = await supabase
      .from('student_group')
      .select('id, academic_year:academic_year_id(school_id)')
      .eq('id', classId)
      .maybeSingle();

    const owner = (data?.academic_year as { school_id?: string } | null)
      ?.school_id;

    if (!data || owner !== schoolId) {
      throw new NotFoundException('Class not found');
    }
  }

  /** Loads an activity and proves the caller's school owns its class. */
  private async requireActivity(userId: string, activityId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data } = await supabase
      .schema('grading')
      .from('activity')
      .select(ACTIVITY_COLUMNS)
      .eq('id', activityId)
      .maybeSingle();

    if (!data) {
      throw new NotFoundException('Activity not found');
    }

    await this.requireClass(userId, data.student_group_id as string);
    return data;
  }

  async list(
    userId: string,
    filters: { classId?: string; termId?: string; subjectId?: string },
  ) {
    const schoolId = await this.requireSchool(userId);
    const supabase = this.supabaseService.getServiceClient();

    // Scope by the school's classes; a bare filter would otherwise leak
    // another school's activities to anyone who guessed an id.
    const { data: classes } = await supabase
      .from('student_group')
      .select('id, name, academic_year:academic_year_id(school_id)')
      .order('name', { ascending: true });

    const ownClassIds = (classes ?? [])
      .filter(
        (c: any) =>
          (c.academic_year as { school_id?: string } | null)?.school_id ===
          schoolId,
      )
      .map((c: any) => c.id as string);

    if (ownClassIds.length === 0) return [];

    let query = supabase
      .schema('grading')
      .from('activity')
      .select(ACTIVITY_COLUMNS)
      .in('student_group_id', filters.classId ? [filters.classId] : ownClassIds)
      .order('created_at', { ascending: false });

    if (filters.termId) query = query.eq('term_id', filters.termId);
    if (filters.subjectId) query = query.eq('subject_id', filters.subjectId);

    const { data, error } = await query;

    if (error) {
      this.logger.error(`Failed to list activities: ${error.message}`);
      throw new BadRequestException('Failed to load activities');
    }

    // A classId filter is only honoured if it is one of theirs.
    const rows = (data ?? []).filter((a: any) =>
      ownClassIds.includes(a.student_group_id as string),
    );

    return rows.map((a: any) => this.toActivity(a));
  }

  /** One activity, with its questions when it is a quiz. */
  async get(userId: string, activityId: string, includeAnswers = true) {
    const activity = await this.requireActivity(userId, activityId);
    const supabase = this.supabaseService.getServiceClient();

    const isExcluded = await this.isExcluded(
      activity.assessment_id as string | null,
    );

    if (activity.kind !== 'quiz') {
      return { ...this.toActivity(activity), isExcluded, questions: [] };
    }

    const { data: questions } = await supabase
      .schema('grading')
      .from('quiz_question')
      .select('id, prompt, kind, points, sort_order')
      .eq('activity_id', activityId)
      .order('sort_order', { ascending: true });

    const questionIds = (questions ?? []).map((q: any) => q.id as string);

    const { data: options } = questionIds.length
      ? await supabase
          .schema('grading')
          .from('quiz_option')
          .select('id, question_id, label, is_correct, sort_order')
          .in('question_id', questionIds)
          .order('sort_order', { ascending: true })
      : { data: [] as any[] };

    return {
      ...this.toActivity(activity),
      isExcluded,
      questions: (questions ?? []).map((q: any) => ({
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        points: Number(q.points),
        sortOrder: q.sort_order,
        options: (options ?? [])
          .filter((o: any) => o.question_id === q.id)
          .map((o: any) => ({
            id: o.id,
            label: o.label,
            sortOrder: o.sort_order,
            // Withheld when a student is the audience.
            ...(includeAnswers ? { isCorrect: o.is_correct } : {}),
          })),
      })),
    };
  }

  async create(
    userId: string,
    input: {
      classId: string;
      subjectId: string;
      termId: string;
      gradingGroupId?: string;
      kind: ActivityKind;
      title: string;
      instructions?: string;
      points: number;
      dueAt?: string;
      allowFile?: boolean;
      allowText?: boolean;
      maxAttempts?: number;
    },
  ) {
    await this.requireClass(userId, input.classId);

    const title = input.title.trim();
    if (!title) throw new BadRequestException('Give the activity a title');

    // The database rejects an assignment accepting nothing, but saying so here
    // is more use than a constraint name.
    if (input.kind === 'assignment' && !input.allowFile && !input.allowText) {
      throw new BadRequestException(
        'An assignment must accept a file, text, or both',
      );
    }

    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .schema('grading')
      .from('activity')
      .insert({
        student_group_id: input.classId,
        subject_id: input.subjectId,
        term_id: input.termId,
        grading_group_id: input.gradingGroupId ?? null,
        max_attempts: input.maxAttempts === 0 ? null : (input.maxAttempts ?? 1),
        kind: input.kind,
        title,
        instructions: input.instructions ?? null,
        points: input.points,
        due_at: input.dueAt ?? null,
        allow_file: input.allowFile ?? false,
        allow_text: input.allowText ?? false,
        created_by: userId,
      })
      .select(ACTIVITY_COLUMNS)
      .single();

    if (error) {
      this.logger.error(`Failed to create activity: ${error.message}`);
      throw new BadRequestException('Failed to create activity');
    }

    return this.toActivity(data);
  }

  async update(
    userId: string,
    activityId: string,
    patch: {
      title?: string;
      instructions?: string | null;
      points?: number;
      dueAt?: string | null;
      gradingGroupId?: string | null;
      allowFile?: boolean;
      allowText?: boolean;
      maxAttempts?: number;
    },
  ) {
    const activity = await this.requireActivity(userId, activityId);

    const changes: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) throw new BadRequestException('Give the activity a title');
      changes.title = title;
    }
    if (patch.instructions !== undefined)
      changes.instructions = patch.instructions;
    if (patch.points !== undefined) changes.points = patch.points;
    if (patch.dueAt !== undefined) changes.due_at = patch.dueAt;
    if (patch.gradingGroupId !== undefined)
      changes.grading_group_id = patch.gradingGroupId;
    if (patch.allowFile !== undefined) changes.allow_file = patch.allowFile;
    if (patch.allowText !== undefined) changes.allow_text = patch.allowText;
    if (patch.maxAttempts !== undefined) {
      changes.max_attempts = patch.maxAttempts === 0 ? null : patch.maxAttempts;
    }

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
    changes.updated_at = new Date().toISOString();

    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .schema('grading')
      .from('activity')
      .update(changes)
      .eq('id', activityId)
      .select(ACTIVITY_COLUMNS)
      .single();

    if (error) {
      this.logger.error(`Failed to update activity: ${error.message}`);
      throw new BadRequestException('Failed to update activity');
    }

    // Publishing copies the title and points onto the assessment, so a later
    // edit has to follow or the gradebook keeps showing the old ones.
    if (activity.assessment_id) {
      const mirrored: Record<string, unknown> = {};
      if (patch.points !== undefined) mirrored.max_score = patch.points;
      if (changes.title !== undefined) mirrored.title = changes.title;

      if (Object.keys(mirrored).length > 0) {
        await supabase
          .schema('grading')
          .from('assessment')
          .update(mirrored)
          .eq('id', activity.assessment_id);
        await this.invalidate();
      }
    }

    return this.toActivity(data);
  }

  /**
   * Publish: create the gradebook row this activity feeds, then open it to
   * students. Without an assessment the marks would have nowhere to land and
   * the activity would never reach a report.
   */
  async publish(userId: string, activityId: string) {
    const activity = await this.requireActivity(userId, activityId);

    if (activity.status === 'published') {
      throw new ConflictException('This activity is already published');
    }

    const supabase = this.supabaseService.getServiceClient();

    if (activity.kind === 'quiz') {
      const { count } = await supabase
        .schema('grading')
        .from('quiz_question')
        .select('id', { count: 'exact', head: true })
        .eq('activity_id', activityId);

      if ((count ?? 0) === 0) {
        throw new BadRequestException('Add a question before publishing');
      }
    }

    let assessmentId = activity.assessment_id as string | null;

    if (!assessmentId) {
      // The legacy type still matters to anything not yet reading groups.
      let isExam = false;
      if (activity.grading_group_id) {
        const { data: group } = await supabase
          .schema('grading')
          .from('grading_group')
          .select('is_exam')
          .eq('id', activity.grading_group_id)
          .maybeSingle();
        isExam = group?.is_exam ?? false;
      }

      const { data: created, error } = await supabase
        .schema('grading')
        .from('assessment')
        .insert({
          subject_id: activity.subject_id,
          term_id: activity.term_id,
          title: activity.title,
          assessment_type: isExam ? 'exam' : 'coursework',
          grading_group_id: activity.grading_group_id,
          max_score: activity.points,
          weight: 1,
          sort_order: 0,
        })
        .select('id')
        .single();

      if (error || !created) {
        this.logger.error(
          `Failed to create assessment for activity ${activityId}: ${error?.message}`,
        );
        throw new BadRequestException('Failed to publish activity');
      }
      assessmentId = created.id;
    }

    const { data, error } = await supabase
      .schema('grading')
      .from('activity')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        assessment_id: assessmentId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activityId)
      .select(ACTIVITY_COLUMNS)
      .single();

    if (error) {
      this.logger.error(`Failed to publish activity: ${error.message}`);
      throw new BadRequestException('Failed to publish activity');
    }

    await this.invalidate();
    return this.toActivity(data);
  }

  /** Stop accepting submissions without hiding what was already set. */
  async close(userId: string, activityId: string) {
    await this.requireActivity(userId, activityId);
    const supabase = this.supabaseService.getServiceClient();

    const { data, error } = await supabase
      .schema('grading')
      .from('activity')
      .update({ status: 'closed', updated_at: new Date().toISOString() })
      .eq('id', activityId)
      .select(ACTIVITY_COLUMNS)
      .single();

    if (error) {
      throw new BadRequestException('Failed to close activity');
    }
    return this.toActivity(data);
  }

  /**
   * Deleting takes the submissions with it, so a published activity with work
   * against it is refused - closing is what a teacher usually wants.
   */
  async remove(userId: string, activityId: string) {
    const activity = await this.requireActivity(userId, activityId);
    const supabase = this.supabaseService.getServiceClient();

    const { count } = await supabase
      .schema('grading')
      .from('submission')
      .select('id', { count: 'exact', head: true })
      .eq('activity_id', activityId);

    if ((count ?? 0) > 0) {
      throw new ConflictException(
        'Students have already submitted; close it instead of deleting',
      );
    }

    const { error } = await supabase
      .schema('grading')
      .from('activity')
      .delete()
      .eq('id', activityId);

    if (error) {
      throw new BadRequestException('Failed to delete activity');
    }

    // The assessment outlives the activity by design if grades exist; remove
    // it only when it was created for this activity and never marked.
    if (activity.assessment_id) {
      const { count: graded } = await supabase
        .schema('grading')
        .from('grade')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_id', activity.assessment_id);

      if ((graded ?? 0) === 0) {
        await supabase
          .schema('grading')
          .from('assessment')
          .delete()
          .eq('id', activity.assessment_id);
      }
    }

    await this.invalidate();
  }

  // ── quiz questions ────────────────────────────────────────────────────────

  /**
   * Whether the gradebook is currently ignoring this activity. Exclusion lives
   * on the assessment, which is where the calculation engine reads it, so an
   * unpublished activity has nothing to exclude yet.
   */
  private async isExcluded(assessmentId: string | null): Promise<boolean> {
    if (!assessmentId) return false;

    const { data } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('assessment')
      .select('is_excluded')
      .eq('id', assessmentId)
      .maybeSingle();

    return !!data?.is_excluded;
  }

  /**
   * Leave an activity out of the calculation without deleting it.
   *
   * The escape hatch for work that went wrong - a test with a bad question, a
   * quiz nobody could sit. Deleting the activity would take the submissions
   * with it, so the marks stay and only their effect on the term is dropped.
   */
  async setExcluded(userId: string, activityId: string, excluded: boolean) {
    const activity = await this.requireActivity(userId, activityId);

    if (!activity.assessment_id) {
      throw new ConflictException(
        'Publish this before excluding it; nothing is counted yet',
      );
    }

    const { error } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('assessment')
      .update({ is_excluded: excluded })
      .eq('id', activity.assessment_id);

    if (error) {
      this.logger.error(`Failed to set exclusion: ${error.message}`);
      throw new BadRequestException('Failed to update this activity');
    }

    await this.invalidate();

    return { ...this.toActivity(activity), isExcluded: excluded };
  }

  /**
   * The quiz a question belongs to, checked to be the caller's and still a
   * draft.
   *
   * Questions stop being editable at publish: submit_quiz scores an answer
   * against the option the student picked, so changing prompts, points or the
   * answer key afterwards would silently rescore work already handed in.
   */
  private async requireDraftQuiz(userId: string, activityId: string) {
    const activity = await this.requireActivity(userId, activityId);

    if (activity.kind !== 'quiz') {
      throw new BadRequestException('Only quizzes have questions');
    }
    if (activity.status !== 'draft') {
      throw new ConflictException(
        'This quiz is published; questions can only change while it is a draft',
      );
    }

    return activity;
  }

  /**
   * Shared by adding and editing. What counts as valid depends on the kind:
   * the choice kinds need several options with exactly one right, while a
   * short answer needs at least one accepted wording and every one of them
   * counts as right.
   */
  private validateOptions(
    kind: QuestionKind,
    options: { label: string; isCorrect: boolean }[],
  ) {
    if (options.some((o) => !o.label.trim())) {
      throw new BadRequestException('Give every option a label');
    }

    if (kind === 'short_answer') {
      if (options.length < 1) {
        throw new BadRequestException('Add at least one accepted answer');
      }
      return;
    }

    if (options.length < 2) {
      throw new BadRequestException('A question needs at least two options');
    }
    if (!options.some((o) => o.isCorrect)) {
      throw new BadRequestException('Mark one option as correct');
    }
    // Auto-grading picks a single option, so several correct ones would make
    // the score ambiguous rather than generous.
    if (options.filter((o) => o.isCorrect).length > 1) {
      throw new BadRequestException('Only one option can be correct');
    }
  }

  async addQuestion(
    userId: string,
    activityId: string,
    input: {
      prompt: string;
      kind: QuestionKind;
      points?: number;
      options: { label: string; isCorrect: boolean }[];
    },
  ) {
    await this.requireDraftQuiz(userId, activityId);

    const prompt = input.prompt.trim();
    if (!prompt) throw new BadRequestException('Give the question a prompt');

    // Every accepted wording of a short answer is a right answer, so the
    // editor need not flag them one by one.
    const options =
      input.kind === 'short_answer'
        ? input.options.map((o) => ({ ...o, isCorrect: true }))
        : input.options;

    this.validateOptions(input.kind, options);

    const supabase = this.supabaseService.getServiceClient();

    const { data: siblings } = await supabase
      .schema('grading')
      .from('quiz_question')
      .select('sort_order')
      .eq('activity_id', activityId)
      .order('sort_order', { ascending: false })
      .limit(1);

    const { data: question, error } = await supabase
      .schema('grading')
      .from('quiz_question')
      .insert({
        activity_id: activityId,
        prompt,
        kind: input.kind,
        points: input.points ?? 1,
        sort_order: ((siblings?.[0]?.sort_order as number) ?? -1) + 1,
      })
      .select('id, prompt, kind, points, sort_order')
      .single();

    if (error || !question) {
      this.logger.error(`Failed to add question: ${error?.message}`);
      throw new BadRequestException('Failed to add question');
    }

    const { error: optionError } = await supabase
      .schema('grading')
      .from('quiz_option')
      .insert(
        options.map((o, i) => ({
          question_id: question.id,
          label: o.label,
          is_correct: o.isCorrect,
          sort_order: i,
        })),
      );

    if (optionError) {
      // Leaving a question with no options would make the quiz unanswerable.
      await supabase
        .schema('grading')
        .from('quiz_question')
        .delete()
        .eq('id', question.id);
      throw new BadRequestException('Failed to add question options');
    }

    return {
      id: question.id,
      prompt: question.prompt,
      kind: question.kind,
      points: Number(question.points),
      sortOrder: question.sort_order,
    };
  }

  /**
   * Edit a question in place. Options are replaced wholesale rather than
   * patched one by one: the editor hands back the whole list, and a draft has
   * no answers pointing at the old rows.
   */
  async updateQuestion(
    userId: string,
    activityId: string,
    questionId: string,
    patch: {
      prompt?: string;
      points?: number;
      options?: { label: string; isCorrect: boolean }[];
    },
  ) {
    await this.requireDraftQuiz(userId, activityId);
    const supabase = this.supabaseService.getServiceClient();

    const { data: existing } = await supabase
      .schema('grading')
      .from('quiz_question')
      .select('id, prompt, kind, points, sort_order')
      .eq('id', questionId)
      .eq('activity_id', activityId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundException('Question not found');
    }

    const changes: Record<string, unknown> = {};
    if (patch.prompt !== undefined) {
      const prompt = patch.prompt.trim();
      if (!prompt) throw new BadRequestException('Give the question a prompt');
      changes.prompt = prompt;
    }
    if (patch.points !== undefined) changes.points = patch.points;

    const kind = existing.kind as QuestionKind;
    const options =
      patch.options && kind === 'short_answer'
        ? patch.options.map((o) => ({ ...o, isCorrect: true }))
        : patch.options;

    if (options) {
      this.validateOptions(kind, options);
    }

    if (Object.keys(changes).length === 0 && !options) {
      throw new BadRequestException('Nothing to update');
    }

    if (Object.keys(changes).length > 0) {
      const { error } = await supabase
        .schema('grading')
        .from('quiz_question')
        .update(changes)
        .eq('id', questionId);

      if (error) {
        this.logger.error(`Failed to update question: ${error.message}`);
        throw new BadRequestException('Failed to save the question');
      }
    }

    if (options) {
      const { error: clearError } = await supabase
        .schema('grading')
        .from('quiz_option')
        .delete()
        .eq('question_id', questionId);

      if (clearError) {
        this.logger.error(`Failed to clear options: ${clearError.message}`);
        throw new BadRequestException('Failed to save the options');
      }

      const { error: insertError } = await supabase
        .schema('grading')
        .from('quiz_option')
        .insert(
          options.map((o, i) => ({
            question_id: questionId,
            label: o.label.trim(),
            is_correct: o.isCorrect,
            sort_order: i,
          })),
        );

      if (insertError) {
        // A question with no options is unanswerable, so say so loudly rather
        // than leaving the quiz quietly broken.
        this.logger.error(
          `Question ${questionId} left without options: ${insertError.message}`,
        );
        throw new BadRequestException('Failed to save the options');
      }
    }

    return this.getQuestion(activityId, questionId);
  }

  /** One question with its options, as the editor redraws it after a save. */
  private async getQuestion(activityId: string, questionId: string) {
    const supabase = this.supabaseService.getServiceClient();

    const { data: question } = await supabase
      .schema('grading')
      .from('quiz_question')
      .select('id, prompt, kind, points, sort_order')
      .eq('id', questionId)
      .eq('activity_id', activityId)
      .single();

    const { data: options } = await supabase
      .schema('grading')
      .from('quiz_option')
      .select('id, label, is_correct, sort_order')
      .eq('question_id', questionId)
      .order('sort_order', { ascending: true });

    return {
      id: question!.id,
      prompt: question!.prompt,
      kind: question!.kind,
      points: Number(question!.points),
      sortOrder: question!.sort_order,
      options: (options ?? []).map((o: any) => ({
        id: o.id,
        label: o.label,
        isCorrect: o.is_correct,
      })),
    };
  }

  async removeQuestion(userId: string, activityId: string, questionId: string) {
    await this.requireDraftQuiz(userId, activityId);
    const supabase = this.supabaseService.getServiceClient();

    const { error } = await supabase
      .schema('grading')
      .from('quiz_question')
      .delete()
      .eq('id', questionId)
      .eq('activity_id', activityId);

    if (error) {
      throw new BadRequestException('Failed to remove question');
    }
  }

  private toActivity(a: any) {
    return {
      id: a.id,
      classId: a.student_group_id,
      subjectId: a.subject_id,
      termId: a.term_id,
      gradingGroupId: a.grading_group_id,
      assessmentId: a.assessment_id,
      kind: a.kind as ActivityKind,
      title: a.title,
      instructions: a.instructions,
      points: Number(a.points),
      dueAt: a.due_at,
      status: a.status as ActivityStatus,
      publishedAt: a.published_at,
      allowFile: a.allow_file,
      allowText: a.allow_text,
      // 0 rather than null over the wire: the editor shows a number, and
      // "unlimited" reads better as 0 than as an empty box.
      maxAttempts: a.max_attempts ?? 0,
      createdAt: a.created_at,
    };
  }
}
