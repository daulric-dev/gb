import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import {
  CourseAccessService,
  CourseRole,
  MANAGE_ROLES,
  STAFF_ROLES,
} from '@/course/access/course-access.service';
import { ACTIVITY_COLUMNS, ActivityKind, toActivity } from './activity.mapper';

type QuestionKind = 'multiple_choice' | 'true_false' | 'short_answer';

/**
 * Quizzes, assignments and offline work inside a course.
 *
 * Every method starts from the course: either the one in the route, or the
 * one the activity belongs to. Course roles decide the rest - teachers (and
 * school admins) build and change work, TAs read it - so a teacher runs their
 * own course without any school-wide grant.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly access: CourseAccessService,
  ) {}

  /**
   * Load an activity and prove the caller holds one of `roles` in its
   * course. An activity in a course they cannot see is reported as missing.
   */
  private async requireActivity(
    userId: string,
    activityId: string,
    roles: readonly CourseRole[] = MANAGE_ROLES,
  ) {
    const { data } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('activity')
      .select(ACTIVITY_COLUMNS)
      .eq('id', activityId)
      .maybeSingle();

    if (!data?.course_id) {
      throw new NotFoundException('Activity not found');
    }

    await this.access.require(userId, data.course_id as string, roles);
    return data as any;
  }

  /**
   * A group named on an activity must be one of this course's own, or the
   * activity would count toward a total it does not belong to.
   */
  private async requireGroupInCourse(courseId: string, groupId: string) {
    const { data } = await this.supabaseService
      .getServiceClient()
      .schema('course')
      .from('assignment_group')
      .select('id')
      .eq('id', groupId)
      .eq('course_id', courseId)
      .maybeSingle();

    if (!data) throw new NotFoundException('Assignment group not found');
  }

  /** Every activity in a course, drafts included; soonest due first. */
  async listForCourse(userId: string, courseId: string) {
    await this.access.require(userId, courseId, STAFF_ROLES);

    const { data, error } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('activity')
      .select(ACTIVITY_COLUMNS)
      .eq('course_id', courseId)
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error(`Failed to list activities: ${error.message}`);
      throw new BadRequestException('Failed to load activities');
    }

    return (data ?? []).map((a: any) => toActivity(a));
  }

  /** One activity, with its questions when it is a quiz. */
  async get(userId: string, activityId: string, includeAnswers = true) {
    const activity = await this.requireActivity(
      userId,
      activityId,
      STAFF_ROLES,
    );
    const supabase = this.supabaseService.getServiceClient();

    if (activity.kind !== 'quiz') {
      return { ...toActivity(activity), questions: [] };
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
      ...toActivity(activity),
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
            ...(includeAnswers ? { isCorrect: o.is_correct } : {}),
          })),
      })),
    };
  }

  async create(
    userId: string,
    courseId: string,
    input: {
      kind: ActivityKind;
      title: string;
      instructions?: string;
      points: number;
      dueAt?: string;
      assignmentGroupId?: string;
      allowFile?: boolean;
      allowText?: boolean;
      maxAttempts?: number;
    },
  ) {
    await this.access.require(userId, courseId, MANAGE_ROLES);

    const title = input.title.trim();
    if (!title) throw new BadRequestException('Give the activity a title');

    // The database rejects an assignment accepting nothing, but saying so here
    // is more use than a constraint name.
    if (input.kind === 'assignment' && !input.allowFile && !input.allowText) {
      throw new BadRequestException(
        'An assignment must accept a file, text, or both',
      );
    }

    if (input.assignmentGroupId) {
      await this.requireGroupInCourse(courseId, input.assignmentGroupId);
    }

    // Offline work is never handed in online, so it accepts nothing.
    const online = input.kind === 'assignment';

    const { data, error } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('activity')
      .insert({
        course_id: courseId,
        assignment_group_id: input.assignmentGroupId ?? null,
        max_attempts: input.maxAttempts === 0 ? null : (input.maxAttempts ?? 1),
        kind: input.kind,
        title,
        instructions: input.instructions ?? null,
        points: input.points,
        due_at: input.dueAt ?? null,
        allow_file: online ? (input.allowFile ?? false) : false,
        allow_text: online ? (input.allowText ?? false) : false,
        created_by: userId,
      })
      .select(ACTIVITY_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to create activity: ${error?.message}`);
      throw new BadRequestException('Failed to create activity');
    }

    return toActivity(data);
  }

  async update(
    userId: string,
    activityId: string,
    patch: {
      title?: string;
      instructions?: string | null;
      points?: number;
      dueAt?: string | null;
      assignmentGroupId?: string | null;
      omitFromFinalGrade?: boolean;
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
    if (patch.assignmentGroupId !== undefined) {
      if (patch.assignmentGroupId) {
        await this.requireGroupInCourse(
          activity.course_id as string,
          patch.assignmentGroupId,
        );
      }
      changes.assignment_group_id = patch.assignmentGroupId;
    }
    if (patch.omitFromFinalGrade !== undefined) {
      changes.omit_from_final_grade = patch.omitFromFinalGrade;
    }
    if (activity.kind === 'assignment') {
      if (patch.allowFile !== undefined) changes.allow_file = patch.allowFile;
      if (patch.allowText !== undefined) changes.allow_text = patch.allowText;
    }
    if (patch.maxAttempts !== undefined) {
      changes.max_attempts = patch.maxAttempts === 0 ? null : patch.maxAttempts;
    }

    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
    changes.updated_at = new Date().toISOString();

    const { data, error } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('activity')
      .update(changes)
      .eq('id', activityId)
      .select(ACTIVITY_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to update activity: ${error?.message}`);
      throw new BadRequestException('Failed to update activity');
    }

    return toActivity(data);
  }

  /**
   * Open the activity to students. The submission is the mark now, so there
   * is no gradebook row to create first - publishing is just the status.
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

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .schema('grading')
      .from('activity')
      .update({
        status: 'published',
        // Reopening closed work keeps the date it first went out.
        published_at: activity.published_at ?? now,
        updated_at: now,
      })
      .eq('id', activityId)
      .select(ACTIVITY_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error(`Failed to publish activity: ${error?.message}`);
      throw new BadRequestException('Failed to publish activity');
    }

    return toActivity(data);
  }

  /** Stop accepting submissions without hiding what was already set. */
  async close(userId: string, activityId: string) {
    await this.requireActivity(userId, activityId);

    const { data, error } = await this.supabaseService
      .getServiceClient()
      .schema('grading')
      .from('activity')
      .update({ status: 'closed', updated_at: new Date().toISOString() })
      .eq('id', activityId)
      .select(ACTIVITY_COLUMNS)
      .single();

    if (error || !data) {
      throw new BadRequestException('Failed to close activity');
    }
    return toActivity(data);
  }

  /**
   * Deleting takes the submissions - and so the marks - with it, so an
   * activity with work against it is refused; closing it, or omitting it from
   * the final grade, is what a teacher usually wants.
   */
  async remove(userId: string, activityId: string) {
    await this.requireActivity(userId, activityId);
    const supabase = this.supabaseService.getServiceClient();

    const { count } = await supabase
      .schema('grading')
      .from('submission')
      .select('id', { count: 'exact', head: true })
      .eq('activity_id', activityId);

    if ((count ?? 0) > 0) {
      throw new ConflictException(
        'Students have work or marks on this; close it instead of deleting',
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
  }

  // ── quiz questions ────────────────────────────────────────────────────────

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
}
