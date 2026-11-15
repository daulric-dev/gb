import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CourseAccessService, MANAGE_ROLES, STAFF_ROLES } from '@/course/access/course-access.service';
import { FeatureService } from '@/features/feature.service';
import { validateQuestion } from '@/grading/quiz-questions';
import {
  AI_DRAFT_NOTE,
  AI_MAX_SOURCE_CHARS,
  AI_MAX_SUBMISSION_CHARS,
  type AiQuestionKind,
} from './ai.constants';
import { AiService } from './ai.service';
import { plainText, redact, STUDENT_PLACEHOLDER, type PersonNames } from './redact';
import { coursePeople } from './course-people';
import {
  AI_STUDENT_RESTRICTED,
  AI_STUDENT_RESTRICTED_MESSAGE,
  isRestricted,
} from '@/student-restriction/restriction';
import { QUIZ_SYSTEM, RUBRIC_SYSTEM, SUMMARY_SCHEMA, SUMMARY_SYSTEM, quizSchema, rubricSchema } from './prompts';
import type { PageSummaryDto, QuizDraftDto, RubricFeedbackDto } from './ai.dto';

interface ModelQuestion {
  kind: AiQuestionKind;
  prompt: string;
  points: number;
  options: { label: string; isCorrect: boolean; matchLabel: string }[];
  numericAnswer: number | null;
  numericTolerance: number;
  explanation: string;
}

/** A question draft in the shape `POST /activities/:id/questions` takes, plus a teacher-only explanation. */
export interface QuestionDraft {
  kind: AiQuestionKind;
  prompt: string;
  points: number;
  options: { label: string; isCorrect: boolean; matchLabel: string | null }[];
  numericAnswer: number | null;
  numericTolerance: number;
  scoring: 'all_or_nothing';
  explanation: string;
}

interface ModelRubric {
  criteria: { criterion: string; level: string; comment: string }[];
  feedback: string;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/**
 * The three AI features. All teacher-initiated and draft-only: each returns
 * suggestions and writes nothing but the request log. A teacher accepts a
 * draft through the normal routes (adding a question, saving a rubric mark,
 * saving the page), so nothing reaches students without that step. Every
 * request is refused while `ai_assistance` is off for the course's school.
 */
@Injectable()
export class AiDraftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly features: FeatureService,
    private readonly ai: AiService,
  ) {}

  /** Names of the course's students, staff and guardians (redacted from anything sent). */
  private async courseStudents(courseId: string): Promise<PersonNames[]> {
    return coursePeople(this.prisma, courseId);
  }

  private async course(userId: string, courseId: string, roles: typeof STAFF_ROLES) {
    const { course } = await this.access.require(userId, courseId, roles);
    await this.features.assertEnabled(course.school_id, 'ai_assistance');
    return course;
  }

  /** The AI status for a course's staff: provider, data notice, the school's switch. */
  async status(userId: string, courseId: string) {
    const course = await this.course(userId, courseId, STAFF_ROLES);
    return { ...(await this.ai.statusFor(course.school_id)), note: AI_DRAFT_NOTE };
  }

  // ── 1. quiz questions ─────────────────────────────────────────────────

  async quizQuestions(userId: string, courseId: string, dto: QuizDraftDto) {
    const course = await this.course(userId, courseId, MANAGE_ROLES);
    if (!!dto.pageId === !!dto.text?.trim()) {
      throw new BadRequestException('Choose a course page or paste some text (one of them)');
    }
    let source: string;
    let title = '';
    if (dto.pageId) {
      const page = await this.prisma.page.findFirst({
        where: { id: dto.pageId, course_id: courseId },
        select: { title: true, body: true },
      });
      if (!page) throw new NotFoundException('Page not found');
      source = page.body;
      title = page.title;
    } else {
      source = dto.text!;
    }
    if (!source.trim()) throw new BadRequestException('There is no text to write questions from');
    if (source.length > AI_MAX_SOURCE_CHARS) {
      throw new BadRequestException(`The text is too long (over ${AI_MAX_SOURCE_CHARS.toLocaleString('en')} characters). Use a shorter part.`);
    }
    const kinds = [...new Set(dto.kinds)];
    const provider = await this.ai.requireProvider(course.school_id);
    const others = await this.courseStudents(courseId);
    const material = redact(source, { others });
    const user = [
      `Write ${dto.count} quiz question${dto.count === 1 ? '' : 's'}.`,
      `Allowed question kinds: ${kinds.join(', ')}. Use a mix of them where the material allows.`,
      title ? `The material is a course page titled: ${redact(title, { others })}` : 'The material was pasted by the teacher.',
      '',
      '<material>',
      material,
      '</material>',
    ].join('\n');
    const out = await this.ai.run<{ questions: ModelQuestion[] }>(
      { userId, schoolId: course.school_id, courseId, feature: 'quiz_questions' },
      provider,
      { system: QUIZ_SYSTEM, user, schema: quizSchema(kinds), name: 'quiz_questions' },
    );
    const drafts: QuestionDraft[] = [];
    let rejected = 0;
    for (const q of out.value.questions.slice(0, dto.count)) {
      const draft = toDraft(q, kinds);
      if (draft) drafts.push(draft);
      else rejected++;
    }
    return { drafts, rejected, requestId: out.requestId, provider: provider.name, note: AI_DRAFT_NOTE };
  }

  // ── 2. rubric feedback ────────────────────────────────────────────────

  async rubricFeedback(userId: string, activityId: string, dto: RubricFeedbackDto) {
    const activity = await this.prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true, course_id: true, title: true, instructions: true, rubric_id: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    const course = await this.course(userId, activity.course_id, STAFF_ROLES);
    if (!activity.rubric_id) throw new BadRequestException('This activity has no rubric');
    // The school decides whether students' work may leave the platform; checked before anything is read or sent.
    if (!(await this.ai.allowStudentWork(course.school_id))) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'AI_STUDENT_WORK_NOT_ALLOWED',
        message: "Your school does not allow sending students' work to the AI provider. A school admin can change this in Settings.",
      });
    }
    // So may the student (or their parent): an objection recorded on the student's page.
    if (await isRestricted(this.prisma, 'no_ai', dto.studentId)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: AI_STUDENT_RESTRICTED,
        message: AI_STUDENT_RESTRICTED_MESSAGE,
      });
    }
    const [rubric, submission] = await Promise.all([
      this.prisma.rubric.findUnique({
        where: { id: activity.rubric_id },
        select: {
          title: true,
          rubric_criterion: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              title: true,
              description: true,
              points: true,
              rubric_rating: {
                orderBy: { position: 'asc' },
                select: { id: true, label: true, description: true, points: true },
              },
            },
          },
        },
      }),
      this.prisma.submission.findUnique({
        where: { activity_id_student_id: { activity_id: activityId, student_id: dto.studentId } },
        select: {
          text_body: true,
          status: true,
          student: { select: { first_name: true, last_name: true } },
        },
      }),
    ]);
    if (!rubric || rubric.rubric_criterion.length === 0) throw new BadRequestException('The rubric has no criteria');
    const text = submission?.text_body?.trim();
    if (!submission || !text || submission.status === 'draft') {
      throw new BadRequestException('This student has handed in no text to read (files are never sent)');
    }
    if (text.length > AI_MAX_SUBMISSION_CHARS) {
      throw new BadRequestException('The submission is too long to send');
    }
    const provider = await this.ai.requireProvider(course.school_id);
    const student = submission.student;
    const others = (await this.courseStudents(activity.course_id)).filter(
      (o) => !(o.first_name === student?.first_name && o.last_name === student?.last_name),
    );
    const scrub = (s: string) => redact(s, { student, others });

    // Short references instead of ids: c1, c1-r1, ...
    const criterionRef = new Map<string, (typeof rubric.rubric_criterion)[number]>();
    const levelRef = new Map<string, { criterionId: string; id: string; points: number }>();
    const lines: string[] = [`Rubric: ${scrub(rubric.title)}`];
    rubric.rubric_criterion.forEach((c, i) => {
      const ref = `c${i + 1}`;
      criterionRef.set(ref, c);
      lines.push(`${ref}. ${scrub(c.title)} (${c.points.toString()} points)${c.description ? `: ${scrub(c.description)}` : ''}`);
      c.rubric_rating.forEach((r, j) => {
        const lref = `${ref}-r${j + 1}`;
        levelRef.set(lref, { criterionId: c.id, id: r.id, points: Number(r.points) });
        lines.push(`  ${lref}. ${scrub(r.label)} (${r.points.toString()} points)${r.description ? `: ${scrub(r.description)}` : ''}`);
      });
    });
    const user = [
      `Activity: ${scrub(activity.title)}`,
      activity.instructions ? `Instructions:\n${scrub(activity.instructions)}` : '',
      '',
      lines.join('\n'),
      '',
      '<student_work>',
      scrub(text),
      '</student_work>',
    ].join('\n');

    const out = await this.ai.run<ModelRubric>(
      { userId, schoolId: course.school_id, courseId: activity.course_id, feature: 'rubric_feedback' },
      provider,
      {
        system: RUBRIC_SYSTEM,
        user,
        schema: rubricSchema([...criterionRef.keys()], [...levelRef.keys()]),
        name: 'rubric_feedback',
      },
    );
    // Placeholders back to the student's first name, for the teacher's draft only.
    const restore = (s: string) => {
      const clean = plainText(s);
      return student?.first_name ? clean.split(STUDENT_PLACEHOLDER).join(student.first_name) : clean;
    };
    const seen = new Set<string>();
    const suggestions: { criterionId: string; ratingId: string | null; points: number | null; comment: string }[] = [];
    for (const s of out.value.criteria) {
      const c = criterionRef.get(s.criterion);
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      const level = s.level ? levelRef.get(s.level) : undefined;
      // A level from another criterion is dropped, not moved.
      const valid = level && level.criterionId === c.id ? level : null;
      suggestions.push({
        criterionId: c.id,
        ratingId: valid?.id ?? null,
        points: valid?.points ?? null,
        comment: restore(s.comment),
      });
    }
    return {
      suggestions,
      feedback: restore(out.value.feedback),
      requestId: out.requestId,
      provider: provider.name,
      note: `${AI_DRAFT_NOTE} The suggested levels are never applied to the mark on their own.`,
    };
  }

  // ── 3. page summary ───────────────────────────────────────────────────

  async pageSummary(userId: string, courseId: string, pageId: string, dto: PageSummaryDto) {
    const course = await this.course(userId, courseId, MANAGE_ROLES);
    const page = await this.prisma.page.findFirst({
      where: { id: pageId, course_id: courseId },
      select: { title: true, body: true },
    });
    if (!page) throw new NotFoundException('Page not found');
    // The editor's unsaved text when given, else the saved page.
    const body = dto.text ?? page.body;
    if (!body.trim()) throw new BadRequestException('The page is empty');
    if (body.length > AI_MAX_SOURCE_CHARS) throw new BadRequestException('The page is too long to summarise in one go');
    const provider = await this.ai.requireProvider(course.school_id);
    const others = await this.courseStudents(courseId);
    const user = [
      `Page title: ${redact(page.title, { others })}`,
      '',
      '<page>',
      redact(body, { others }),
      '</page>',
    ].join('\n');
    const out = await this.ai.run<{ summary: string; keyPoints: string[] }>(
      { userId, schoolId: course.school_id, courseId, feature: 'page_summary' },
      provider,
      { system: SUMMARY_SYSTEM, user, schema: SUMMARY_SCHEMA, name: 'page_summary' },
    );
    return {
      summary: plainText(out.value.summary),
      keyPoints: out.value.keyPoints.map(plainText).filter(Boolean),
      requestId: out.requestId,
      provider: provider.name,
      note: AI_DRAFT_NOTE,
    };
  }
}

/** A model question as a draft the quiz builder can show, or null when it breaks the question rules. */
export function toDraft(q: ModelQuestion, allowed: readonly AiQuestionKind[]): QuestionDraft | null {
  if (!allowed.includes(q.kind)) return null;
  const prompt = clip(plainText(q.prompt), 2000);
  if (!prompt) return null;
  const optionKinds = q.kind !== 'numeric' && q.kind !== 'essay';
  const rawOptions = optionKinds
    ? q.options.map((o) => ({
        label: clip(plainText(o.label), 300),
        isCorrect: o.isCorrect,
        matchLabel: q.kind === 'matching' ? clip(plainText(o.matchLabel), 300) || null : null,
      }))
    : [];
  try {
    const { options, columns } = validateQuestion(q.kind, rawOptions, {
      numericAnswer: q.kind === 'numeric' ? q.numericAnswer : null,
      numericTolerance: q.kind === 'numeric' ? q.numericTolerance : 0,
      scoring: 'all_or_nothing',
    });
    return {
      kind: q.kind,
      prompt,
      points: Math.round(Math.min(Math.max(q.points, 0.01), 100) * 100) / 100,
      options,
      numericAnswer: columns.numeric_answer,
      numericTolerance: columns.numeric_tolerance,
      scoring: 'all_or_nothing',
      explanation: clip(plainText(q.explanation), 1000),
    };
  } catch {
    return null;
  }
}
