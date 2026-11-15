import { BadRequestException, ConflictException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { CourseAccessService, MANAGE_ROLES, STAFF_ROLES, type CourseRole, type CourseRow } from '@/course/access/course-access.service';
import { FeatureService } from '@/features/feature.service';
import { ModuleService } from '@/course/module.service';
import { PageService } from '@/course/page.service';
import { ActivityService } from '@/grading/activity.service';
import { AssignmentGroupService } from '@/grading/assignment-group.service';
import { validateRubricCriteria, type RubricInput } from '@/grading/rubric.service';
import { OutcomeService } from '@/mastery/outcome.service';
import {
  AI_DRAFT_NOTE,
  AI_FEATURE_MAX_TOKENS,
  AI_PLAN_MAX_ITEMS,
  type AiPlanItemKind,
  type AiSubmissionType,
} from './ai.constants';
import { AiService, aiHttpError } from './ai.service';
import { AiProviderError } from './adapters/types';
import { plainText, redact, safeMarkdown, suppliedUrls } from './redact';
import { coursePeople } from './course-people';
import {
  ANNOUNCEMENT_SCHEMA,
  ANNOUNCEMENT_SYSTEM,
  ASSIGNMENT_SCHEMA,
  ASSIGNMENT_SYSTEM,
  MODULE_ITEMS_SCHEMA,
  MODULE_ITEMS_SYSTEM,
  OUTCOMES_SCHEMA,
  OUTCOMES_SYSTEM,
  OUTLINE_SCHEMA,
  OUTLINE_SYSTEM,
  PAGE_CONTENT_SCHEMA,
  PAGE_CONTENT_SYSTEM,
  RUBRIC_DRAFT_SCHEMA,
  RUBRIC_DRAFT_SYSTEM,
} from './prompts';
import {
  cleanOutline,
  cleanPlanItem,
  dueDateFor,
  planGroupNames,
  startDateOf,
  submissionFlags,
  type ModelPlanItem,
  type ModelPlanModule,
  type PlanItem,
} from './course-plan';
import type {
  AnnouncementDraftDto,
  AssignmentDraftDto,
  CreatePlanDto,
  ModuleItemsDraftDto,
  OutcomeSuggestDto,
  OutlineDraftDto,
  PageContentDraftDto,
  PlanItemDto,
  RubricDraftDto,
} from './ai.dto';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n).trimEnd() : s);
const oneLine = (s: string, n: number) => clip(plainText(s.replace(/\s+/g, ' ')), n);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The message of a failed create, for the teacher's report (never a stack). */
function failure(err: unknown): string {
  if (err instanceof HttpException) {
    const body = err.getResponse() as { message?: string | string[] } | string;
    const msg = typeof body === 'string' ? body : body.message;
    return (Array.isArray(msg) ? msg.join('; ') : msg) || err.message;
  }
  return 'Could not be created';
}

const MIX_TEXT: Record<string, string> = {
  balanced: 'a balance of quizzes and assignments',
  more_quizzes: 'mostly quizzes, with some assignments',
  more_assignments: 'mostly assignments, with some quizzes',
  quizzes_only: 'quizzes only (no assignments)',
  assignments_only: 'assignments only (no quizzes)',
};

export type CreatedStatus = 'created' | 'failed' | 'not_added' | 'skipped';

export interface PlanItemResult {
  kind: AiPlanItemKind;
  title: string;
  status: CreatedStatus;
  /** The page or activity created. */
  id: string | null;
  error: string | null;
  dueAt: string | null;
  aligned: string[];
}

export interface PlanModuleResult {
  title: string;
  moduleId: string | null;
  status: 'created' | 'existing' | 'failed';
  error: string | null;
  items: PlanItemResult[];
}

/**
 * The AI course builder: drafts a course outline, module items, page
 * content, assignment instructions, rubrics, announcements and outcomes from
 * teacher material only (no student data is sent; the names of the course's
 * students, staff and guardians are read only to strip them), and creates a
 * plan the teacher reviewed through the existing services. Drafting writes
 * nothing but the AI request log; only `createFromPlan` creates anything,
 * and everything it creates starts unpublished.
 */
@Injectable()
export class AiCourseService {
  private readonly logger = new Logger(AiCourseService.name);
  /** Courses with a plan being created (one at a time per course and instance). */
  private readonly creating = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CourseAccessService,
    private readonly features: FeatureService,
    private readonly ai: AiService,
    private readonly modules: ModuleService,
    private readonly pages: PageService,
    private readonly activities: ActivityService,
    private readonly groups: AssignmentGroupService,
    private readonly outcomes: OutcomeService,
  ) {}

  /** The course, the caller's role checked (teachers and admins build; TAs do not), the flag on for its school. */
  private async course(userId: string, courseId: string, roles: readonly CourseRole[] = MANAGE_ROLES) {
    const { course } = await this.access.require(userId, courseId, roles);
    await this.features.assertEnabled(course.school_id, 'ai_assistance');
    return course;
  }

  /**
   * `redact()` with the names of the course's students, staff and the
   * students' guardians (full names only: this is teacher material, see
   * course-people.ts), for everything a draft sends.
   */
  private async scrubber(courseId: string): Promise<(text: string) => string> {
    const others = await coursePeople(this.prisma, courseId, { fullNamesOnly: true });
    return (text: string) => redact(text, { others });
  }

  /** Course name, code and description: teacher-written context, emails, numbers and people's names removed. */
  private context(course: CourseRow, scrub: (text: string) => string): string {
    return [
      `Course: ${scrub(course.name)}`,
      course.code ? `Course code: ${scrub(course.code)}` : '',
      course.description?.trim() ? `Course description: ${scrub(clip(course.description.trim(), 2000))}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async groupNames(courseId: string): Promise<string[]> {
    const rows = await this.prisma.assignment_group.findMany({
      where: { course_id: courseId },
      select: { name: true },
      orderBy: { position: 'asc' },
    });
    return rows.map((r) => r.name);
  }

  private async masteryOn(schoolId: string) {
    return this.features.isEnabled(schoolId, 'mastery');
  }

  private async courseStart(course: CourseRow): Promise<string | null> {
    const [term, year] = await Promise.all([
      course.term_id
        ? this.prisma.term.findUnique({ where: { id: course.term_id }, select: { start_date: true } })
        : null,
      course.academic_year_id
        ? this.prisma.academic_year.findUnique({ where: { id: course.academic_year_id }, select: { start_date: true } })
        : null,
    ]);
    return startDateOf(term?.start_date, year?.start_date);
  }

  private result<T extends object>(value: T, requestId: string, provider: string) {
    return { ...value, requestId, provider, note: AI_DRAFT_NOTE };
  }

  // ── 1. course outline ─────────────────────────────────────────────────

  async outline(userId: string, courseId: string, dto: OutlineDraftDto) {
    const course = await this.course(userId, courseId);
    const scrub = await this.scrubber(courseId);
    const [mastery, groups, startDate] = await Promise.all([
      this.masteryOn(course.school_id),
      this.groupNames(courseId),
      this.courseStart(course),
    ]);
    const withOutcomes = !!dto.outcomes && mastery;
    const provider = await this.ai.requireProvider(course.school_id);
    const length = dto.units
      ? `${dto.units} units (one module each)`
      : dto.weeks
        ? `${dto.weeks} weeks (about one module per week; fewer modules if a unit spans weeks)`
        : 'choose a sensible number of units';
    const user = [
      this.context(course, scrub),
      `Subject: ${scrub(dto.subject)}`,
      `Level: ${scrub(dto.level)}`,
      `Length: ${length}`,
      dto.assessments !== undefined ? `About ${dto.assessments} assessments (quizzes and assignments) in total.` : '',
      `Assessment mix: ${MIX_TEXT[dto.mix ?? 'balanced']}.`,
      dto.groups === false
        ? 'Assignment groups: none (group is always "").'
        : groups.length
          ? `Assignment groups already in the course (reuse these names where they fit): ${groups.map((g) => scrub(g)).join(', ')}`
          : 'Assignment groups: suggest a few short names.',
      withOutcomes ? 'Learning outcomes: yes, per module.' : 'Learning outcomes: no (outcomes are empty lists).',
      dto.goals?.trim() ? `\n<goals>\n${scrub(dto.goals.trim())}\n</goals>` : '',
      dto.syllabus?.trim() ? `\n<syllabus>\n${scrub(dto.syllabus.trim())}\n</syllabus>` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const out = await this.ai.run<{ modules: ModelPlanModule[] }>(
      { userId, schoolId: course.school_id, courseId, feature: 'course_outline' },
      provider,
      { system: OUTLINE_SYSTEM, user, schema: OUTLINE_SCHEMA, name: 'course_outline', maxTokens: AI_FEATURE_MAX_TOKENS.course_outline },
    );
    const modules = cleanOutline(out.value.modules, {
      allowedUrls: suppliedUrls(dto.goals, dto.syllabus),
      withOutcomes,
    });
    if (modules.length === 0) throw aiHttpError(new AiProviderError('invalid_output', 'The outline had no usable modules. Try again.'));
    return this.result(
      { plan: { modules }, masteryOn: mastery, startDate, existingGroups: groups },
      out.requestId,
      provider.name,
    );
  }

  // ── 2. module items ───────────────────────────────────────────────────

  async moduleItems(userId: string, courseId: string, moduleId: string, dto: ModuleItemsDraftDto) {
    const course = await this.course(userId, courseId);
    const scrub = await this.scrubber(courseId);
    const all = await this.modules.list(userId, courseId);
    const mod = all.find((m) => m.id === moduleId);
    if (!mod) throw new NotFoundException('Module not found');
    const groups = await this.groupNames(courseId);
    const provider = await this.ai.requireProvider(course.school_id);
    const count = dto.count ?? 5;
    const user = [
      this.context(course, scrub),
      dto.level?.trim() ? `Level: ${scrub(dto.level)}` : '',
      `Other modules: ${all.filter((m) => m.id !== moduleId).map((m) => scrub(m.title)).join('; ') || 'none'}`,
      `Module: ${scrub(mod.title)}`,
      `Already in it: ${mod.items.map((i) => scrub(i.title)).join('; ') || 'nothing yet'}`,
      groups.length ? `Assignment groups in the course: ${groups.map((g) => scrub(g)).join(', ')}` : 'No assignment groups yet.',
      `Suggest up to ${count} item${count === 1 ? '' : 's'}.`,
      dto.brief?.trim() ? `\n<request>\n${scrub(dto.brief.trim())}\n</request>` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const out = await this.ai.run<{ items: ModelPlanItem[] }>(
      { userId, schoolId: course.school_id, courseId, feature: 'module_items' },
      provider,
      { system: MODULE_ITEMS_SYSTEM, user, schema: MODULE_ITEMS_SCHEMA, name: 'module_items', maxTokens: AI_FEATURE_MAX_TOKENS.module_items },
    );
    const urls = suppliedUrls(dto.brief);
    const items = out.value.items
      .slice(0, Math.min(count, AI_PLAN_MAX_ITEMS))
      .map((i) => cleanPlanItem({ ...i, dueOffsetWeeks: null, outcomes: [] }, urls))
      .filter((i): i is PlanItem => i !== null);
    return this.result({ moduleId, moduleTitle: mod.title, items }, out.requestId, provider.name);
  }

  // ── 3. page content ───────────────────────────────────────────────────

  async pageContent(userId: string, courseId: string, dto: PageContentDraftDto) {
    const course = await this.course(userId, courseId);
    const scrub = await this.scrubber(courseId);
    const provider = await this.ai.requireProvider(course.school_id);
    const user = [
      this.context(course, scrub),
      dto.level?.trim() ? `Level: ${scrub(dto.level)}` : '',
      `Page title: ${scrub(dto.title)}`,
      dto.outline?.trim() ? `\n<outline>\n${scrub(dto.outline.trim())}\n</outline>` : 'No outline given: cover the title\'s topic.',
    ]
      .filter(Boolean)
      .join('\n');
    const out = await this.ai.run<{ markdown: string }>(
      { userId, schoolId: course.school_id, courseId, feature: 'page_content' },
      provider,
      { system: PAGE_CONTENT_SYSTEM, user, schema: PAGE_CONTENT_SCHEMA, name: 'page_content', maxTokens: AI_FEATURE_MAX_TOKENS.page_content },
    );
    const markdown = safeMarkdown(out.value.markdown, suppliedUrls(dto.outline));
    if (!markdown) throw aiHttpError(new AiProviderError('invalid_output', 'The page came back empty. Try again.'));
    return this.result({ markdown }, out.requestId, provider.name);
  }

  // ── 4. assignment instructions ────────────────────────────────────────

  async assignmentInstructions(userId: string, courseId: string, dto: AssignmentDraftDto) {
    const course = await this.course(userId, courseId);
    const scrub = await this.scrubber(courseId);
    const provider = await this.ai.requireProvider(course.school_id);
    const user = [
      this.context(course, scrub),
      dto.level?.trim() ? `Level: ${scrub(dto.level)}` : '',
      `Assignment title: ${scrub(dto.title)}`,
      dto.points !== undefined ? `Points: ${dto.points}` : '',
      dto.brief?.trim() ? `\n<brief>\n${scrub(dto.brief.trim())}\n</brief>` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const out = await this.ai.run<{ instructions: string; points: number; submission: AiSubmissionType }>(
      { userId, schoolId: course.school_id, courseId, feature: 'assignment_instructions' },
      provider,
      {
        system: ASSIGNMENT_SYSTEM,
        user,
        schema: ASSIGNMENT_SCHEMA,
        name: 'assignment_instructions',
        maxTokens: AI_FEATURE_MAX_TOKENS.assignment_instructions,
      },
    );
    const instructions = safeMarkdown(out.value.instructions, suppliedUrls(dto.brief));
    if (!instructions) throw aiHttpError(new AiProviderError('invalid_output', 'The instructions came back empty. Try again.'));
    return this.result(
      {
        instructions,
        points: round2(Math.min(Math.max(out.value.points, 0), 1000)),
        submission: out.value.submission,
        ...submissionFlags(out.value.submission),
      },
      out.requestId,
      provider.name,
    );
  }

  // ── 5. rubric draft ───────────────────────────────────────────────────

  async rubricDraft(userId: string, courseId: string, dto: RubricDraftDto) {
    const course = await this.course(userId, courseId);
    const scrub = await this.scrubber(courseId);
    const provider = await this.ai.requireProvider(course.school_id);
    const user = [
      this.context(course, scrub),
      dto.level?.trim() ? `Level: ${scrub(dto.level)}` : '',
      `Assignment: ${scrub(dto.title)}`,
      dto.totalPoints !== undefined ? `Total points: ${dto.totalPoints}` : '',
      dto.criteria !== undefined ? `Criteria: ${dto.criteria}` : 'Criteria: 3 to 5.',
      dto.instructions?.trim() ? `\n<instructions>\n${scrub(clip(dto.instructions.trim(), 10_000))}\n</instructions>` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const out = await this.ai.run<{
      title: string;
      criteria: { title: string; description: string; points: number; ratings: { label: string; description: string; points: number }[] }[];
    }>(
      { userId, schoolId: course.school_id, courseId, feature: 'rubric_draft' },
      provider,
      { system: RUBRIC_DRAFT_SYSTEM, user, schema: RUBRIC_DRAFT_SCHEMA, name: 'rubric_draft', maxTokens: AI_FEATURE_MAX_TOKENS.rubric_draft },
    );
    const { rubric, dropped } = cleanRubricDraft(out.value, dto.title);
    if (rubric.criteria.length === 0) {
      throw aiHttpError(new AiProviderError('invalid_output', "The rubric's levels did not fit its criteria. Try again."));
    }
    return this.result({ rubric, dropped }, out.requestId, provider.name);
  }

  // ── 6. announcement ───────────────────────────────────────────────────

  /** Course staff who may post announcements (TAs included) may draft one. */
  async announcement(userId: string, courseId: string, dto: AnnouncementDraftDto) {
    const course = await this.course(userId, courseId, STAFF_ROLES);
    const scrub = await this.scrubber(courseId);
    const provider = await this.ai.requireProvider(course.school_id);
    const user = [
      this.context(course, scrub),
      'Audience: the students of this course (their parents may also read it).',
      `\n<request>\n${scrub(dto.prompt.trim())}\n</request>`,
    ].join('\n');
    const out = await this.ai.run<{ title: string; body: string }>(
      { userId, schoolId: course.school_id, courseId, feature: 'announcement_draft' },
      provider,
      { system: ANNOUNCEMENT_SYSTEM, user, schema: ANNOUNCEMENT_SCHEMA, name: 'announcement_draft', maxTokens: AI_FEATURE_MAX_TOKENS.announcement_draft },
    );
    const title = oneLine(out.value.title, 200);
    const body = clip(safeMarkdown(out.value.body, suppliedUrls(dto.prompt)), 5000);
    if (!title || !body) throw aiHttpError(new AiProviderError('invalid_output', 'The announcement came back empty. Try again.'));
    return this.result({ title, body }, out.requestId, provider.name);
  }

  // ── 7. outcome suggestions ────────────────────────────────────────────

  async suggestOutcomes(userId: string, courseId: string, dto: OutcomeSuggestDto) {
    const course = await this.course(userId, courseId);
    const scrub = await this.scrubber(courseId);
    await this.features.assertEnabled(course.school_id, 'mastery');
    const [modules, pages, activities, existing] = await Promise.all([
      this.prisma.module.findMany({ where: { course_id: courseId }, select: { title: true }, orderBy: { position: 'asc' } }),
      this.prisma.page.findMany({ where: { course_id: courseId }, select: { title: true }, orderBy: { title: 'asc' }, take: 200 }),
      this.prisma.activity.findMany({ where: { course_id: courseId }, select: { title: true, kind: true }, orderBy: { created_at: 'asc' }, take: 200 }),
      this.prisma.outcome.findMany({ where: { course_id: courseId }, select: { code: true, title: true } }),
    ]);
    if (modules.length + pages.length + activities.length === 0) {
      throw new BadRequestException('Add some modules, pages or assignments first: outcomes are suggested from them.');
    }
    const provider = await this.ai.requireProvider(course.school_id);
    const count = dto.count ?? 6;
    const list = (rows: { title: string }[]) => rows.map((r) => `- ${scrub(r.title)}`).join('\n') || '- none';
    const user = [
      this.context(course, scrub),
      dto.level?.trim() ? `Level: ${scrub(dto.level)}` : '',
      `Suggest up to ${count} outcomes.`,
      `Existing outcome codes (do not reuse): ${existing.map((o) => scrub(o.code)).join(', ') || 'none'}`,
      `\n<content>\nModules:\n${list(modules)}\nPages:\n${list(pages)}\nAssessments:\n${list(activities)}\n</content>`,
      dto.brief?.trim() ? `\n<request>\n${scrub(dto.brief.trim())}\n</request>` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const out = await this.ai.run<{ outcomes: { code: string; title: string; description: string }[] }>(
      { userId, schoolId: course.school_id, courseId, feature: 'outcome_suggestions' },
      provider,
      { system: OUTCOMES_SYSTEM, user, schema: OUTCOMES_SCHEMA, name: 'outcome_suggestions', maxTokens: AI_FEATURE_MAX_TOKENS.outcome_suggestions },
    );
    const taken = new Set(existing.map((o) => o.code.trim().toLowerCase()));
    const outcomes: { code: string; title: string; description: string }[] = [];
    for (const o of out.value.outcomes.slice(0, count)) {
      const code = oneLine(o.code, 64);
      const title = oneLine(o.title, 500);
      if (!code || !title || taken.has(code.toLowerCase())) continue;
      taken.add(code.toLowerCase());
      outcomes.push({ code, title, description: oneLine(o.description, 1000) });
    }
    return this.result({ outcomes }, out.requestId, provider.name);
  }

  // ── creating a reviewed plan ──────────────────────────────────────────

  /**
   * Create the plan the teacher reviewed ("Create selected" / "Add
   * selected"). Nothing is created anywhere else. Everything goes through
   * the existing services (each write in its own audited transaction, with
   * their own permission checks), and starts unpublished: new modules are
   * unpublished, pages unpublished, activities drafts. Quizzes are created
   * empty (questions are only ever added when a teacher accepts a draft).
   * One failure never stops the rest: every module, item, group and outcome
   * is reported with its status.
   */
  async createFromPlan(userId: string, courseId: string, dto: CreatePlanDto) {
    const course = await this.course(userId, courseId);
    if (this.creating.has(courseId)) {
      throw new ConflictException('A plan is already being created for this course. Wait for it to finish.');
    }
    this.creating.add(courseId);
    try {
      return await this.create(userId, course, dto);
    } finally {
      this.creating.delete(courseId);
    }
  }

  private async create(userId: string, course: CourseRow, dto: CreatePlanDto) {
    const courseId = course.id;
    const startDate = dto.startDate ?? (await this.courseStart(course));
    const mastery = await this.masteryOn(course.school_id);
    const withOutcomes = mastery && dto.createOutcomes !== false;
    const notes: string[] = ['Everything was created unpublished: publish modules, pages and assignments when they are ready.'];

    // Items cleaned again: the teacher's edits are input like any other.
    const plan = dto.modules.map((m) => {
      const codes = new Set((m.outcomes ?? []).map((o) => o.code.trim().toLowerCase()));
      return {
        ...m,
        title: oneLine(m.title, 200),
        overview: oneLine(m.overview ?? '', 1000),
        items: m.items
          .map((i: PlanItemDto) =>
            cleanPlanItem(
              {
                kind: i.kind,
                title: i.title,
                description: i.description ?? '',
                points: i.points ?? null,
                dueOffsetWeeks: i.dueOffsetWeeks ?? null,
                questionCount: i.questionCount ?? null,
                group: i.group ?? '',
                submission: i.submission ?? '',
                outcomes: withOutcomes ? (i.outcomes ?? []) : [],
              },
              // The teacher sent this text: their links stay.
              suppliedUrls(i.description),
              codes,
            ),
          )
          .filter((i): i is PlanItem => i !== null),
      };
    });

    // Assignment groups: matched by name (case-insensitive), else created.
    const groupIds = new Map<string, string>();
    const groupReport: { name: string; id: string | null; status: 'existing' | 'created' | 'failed'; error: string | null }[] = [];
    const names = planGroupNames(plan);
    if (names.length) {
      const existing: { id: string; name: string }[] = await this.groups.list(userId, courseId);
      for (const name of names) {
        const match = existing.find((g) => g.name.trim().toLowerCase() === name.toLowerCase());
        if (match) {
          groupIds.set(name.toLowerCase(), match.id);
          groupReport.push({ name: match.name, id: match.id, status: 'existing', error: null });
          continue;
        }
        try {
          const g = await this.groups.create(userId, courseId, { name });
          groupIds.set(name.toLowerCase(), g.id);
          groupReport.push({ name, id: g.id, status: 'created', error: null });
        } catch (err) {
          groupReport.push({ name, id: null, status: 'failed', error: failure(err) });
        }
      }
    }

    // Outcomes (mastery on): course outcomes, matched by code if already there.
    const outcomeIds = new Map<string, string>();
    const outcomeReport: { code: string; title: string; id: string | null; status: 'existing' | 'created' | 'failed'; error: string | null }[] = [];
    const planOutcomes = plan.flatMap((m) => m.outcomes ?? []);
    if (withOutcomes && planOutcomes.length) {
      const existing = await this.prisma.outcome.findMany({ where: { course_id: courseId }, select: { id: true, code: true } });
      const byCode = new Map(existing.map((o) => [o.code.trim().toLowerCase(), o.id]));
      for (const o of planOutcomes) {
        const code = oneLine(o.code, 64);
        const title = oneLine(o.title, 500);
        const key = code.toLowerCase();
        if (!code || !title || outcomeIds.has(key)) continue;
        const found = byCode.get(key);
        if (found) {
          outcomeIds.set(key, found);
          outcomeReport.push({ code, title, id: found, status: 'existing', error: null });
          continue;
        }
        try {
          const created = await this.outcomes.createCourseOutcome(userId, courseId, { code, title });
          outcomeIds.set(key, created.id);
          outcomeReport.push({ code, title, id: created.id, status: 'created', error: null });
        } catch (err) {
          outcomeReport.push({ code, title, id: null, status: 'failed', error: failure(err) });
        }
      }
    } else if (!mastery && planOutcomes.length) {
      notes.push('Learning outcomes were not created: mastery is off for your school.');
    }

    const quizzes: { activityId: string; title: string; topic: string; questionCount: number | null }[] = [];
    const moduleReport: PlanModuleResult[] = [];
    for (const m of plan) {
      let moduleId: string | null = null;
      let status: PlanModuleResult['status'] = 'created';
      let error: string | null = null;
      try {
        if (m.existingModuleId) {
          const found = await this.prisma.module.findFirst({
            where: { id: m.existingModuleId, course_id: courseId },
            select: { id: true },
          });
          if (!found) throw new NotFoundException('Module not found');
          moduleId = found.id;
          status = 'existing';
        } else {
          moduleId = (await this.modules.create(userId, courseId, m.title)).id;
        }
      } catch (err) {
        status = 'failed';
        error = failure(err);
      }
      const items: PlanItemResult[] = [];
      if (moduleId === null) {
        for (const i of m.items) {
          items.push({ kind: i.kind, title: i.title, status: 'skipped', id: null, error: 'The module could not be created', dueAt: null, aligned: [] });
        }
        moduleReport.push({ title: m.title, moduleId, status, error, items });
        continue;
      }
      if (dto.overviewPages && !m.existingModuleId && m.overview) {
        items.push(await this.addPage(userId, courseId, moduleId, { kind: 'page', title: `${m.title}: overview`, description: m.overview }));
      }
      for (const i of m.items) {
        if (i.kind === 'page') {
          items.push(await this.addPage(userId, courseId, moduleId, i));
          continue;
        }
        const res = await this.addActivity(userId, courseId, moduleId, i, {
          startDate,
          groupId: i.group ? (groupIds.get(i.group.toLowerCase()) ?? null) : null,
          outcomeIds,
        });
        items.push(res);
        if (i.kind === 'quiz' && res.id) {
          quizzes.push({ activityId: res.id, title: i.title, topic: i.description, questionCount: i.questionCount });
        }
      }
      moduleReport.push({ title: m.title, moduleId, status, error, items });
    }

    if (quizzes.length) {
      notes.push(
        dto.draftQuestions
          ? 'Quizzes were created empty. Open each one and use "Draft questions with AI": its topic is filled in, and each question is added only when you accept it.'
          : 'Quizzes were created empty. "Draft questions with AI" is available in each quiz builder.',
      );
    }
    if (!startDate && plan.some((m) => m.items.some((i) => i.dueOffsetWeeks !== null))) {
      notes.push('No due dates were set: the course has no start date (set a term, or give a start date).');
    }
    const all = moduleReport.flatMap((m) => m.items);
    const failed =
      all.filter((i) => i.status !== 'created').length +
      moduleReport.filter((m) => m.status === 'failed').length +
      groupReport.filter((g) => g.status === 'failed').length +
      outcomeReport.filter((o) => o.status === 'failed').length;
    return {
      ok: failed === 0,
      created: {
        modules: moduleReport.filter((m) => m.status === 'created').length,
        items: all.filter((i) => i.status === 'created').length,
        groups: groupReport.filter((g) => g.status === 'created').length,
        outcomes: outcomeReport.filter((o) => o.status === 'created').length,
      },
      failed,
      startDate,
      modules: moduleReport,
      groups: groupReport,
      outcomes: outcomeReport,
      quizzes,
      draftQuestions: !!dto.draftQuestions,
      notes,
    };
  }

  /** An unpublished page with the item's outline as its starting text, added to the module. */
  private async addPage(
    userId: string,
    courseId: string,
    moduleId: string,
    i: Pick<PlanItem, 'kind' | 'title' | 'description'>,
  ): Promise<PlanItemResult> {
    const base = { kind: i.kind, title: i.title, dueAt: null, aligned: [] as string[] };
    let pageId: string;
    try {
      const page = await this.pages.create(userId, courseId, { title: i.title, body: i.description, isPublished: false });
      pageId = page.id;
    } catch (err) {
      return { ...base, status: 'failed', id: null, error: failure(err) };
    }
    try {
      await this.modules.createItem(userId, courseId, moduleId, { itemType: 'page', pageId });
    } catch (err) {
      return { ...base, status: 'not_added', id: pageId, error: `Created, but not added to the module: ${failure(err)}` };
    }
    return { ...base, status: 'created', id: pageId, error: null };
  }

  /** A draft assignment or (empty) quiz, added to the module and aligned to its outcomes. */
  private async addActivity(
    userId: string,
    courseId: string,
    moduleId: string,
    i: PlanItem,
    ctx: { startDate: string | null; groupId: string | null; outcomeIds: Map<string, string> },
  ): Promise<PlanItemResult> {
    const dueAt = dueDateFor(ctx.startDate, i.dueOffsetWeeks);
    const base = { kind: i.kind, title: i.title, dueAt };
    let activityId: string;
    try {
      const a = await this.activities.create(userId, courseId, {
        kind: i.kind === 'quiz' ? 'quiz' : 'assignment',
        title: i.title,
        instructions: i.description || undefined,
        points: i.points ?? 0,
        ...(dueAt ? { dueAt } : {}),
        ...(ctx.groupId ? { assignmentGroupId: ctx.groupId } : {}),
        ...(i.kind === 'assignment' ? submissionFlags(i.submission) : {}),
      });
      activityId = a.id;
    } catch (err) {
      return { ...base, status: 'failed', id: null, error: failure(err), aligned: [] };
    }
    const aligned: string[] = [];
    const alignErrors: string[] = [];
    for (const code of i.outcomes) {
      const outcomeId = ctx.outcomeIds.get(code.toLowerCase());
      if (!outcomeId) continue;
      try {
        await this.outcomes.align(userId, courseId, { outcomeId, activityId });
        aligned.push(code);
      } catch (err) {
        alignErrors.push(`${code}: ${failure(err)}`);
      }
    }
    try {
      await this.modules.createItem(userId, courseId, moduleId, { itemType: 'activity', activityId });
    } catch (err) {
      return { ...base, status: 'not_added', id: activityId, error: `Created, but not added to the module: ${failure(err)}`, aligned };
    }
    return {
      ...base,
      status: 'created',
      id: activityId,
      error: alignErrors.length ? `Not aligned to ${alignErrors.join('; ')}` : null,
      aligned,
    };
  }
}

/**
 * A model rubric made safe and valid: plain text, points rounded to two
 * decimals, each criterion checked with the rubric rules
 * (`validateRubricCriteria`); a criterion that breaks them is dropped and
 * counted. The result is in the shape `POST /courses/:id/rubrics` takes.
 */
export function cleanRubricDraft(
  raw: {
    title: string;
    criteria: { title: string; description: string; points: number; ratings: { label: string; description: string; points: number }[] }[];
  },
  fallbackTitle: string,
): { rubric: RubricInput & { criteria: { title: string; description: string | null; points: number; ratings: { label: string; description: string | null; points: number }[] }[] }; dropped: number } {
  const criteria: { title: string; description: string | null; points: number; ratings: { label: string; description: string | null; points: number }[] }[] = [];
  let dropped = 0;
  for (const c of raw.criteria) {
    const title = oneLine(c.title, 200);
    const ratings = c.ratings
      .map((r) => ({ label: oneLine(r.label, 100), description: oneLine(r.description, 1000) || null, points: round2(r.points) }))
      .filter((r) => r.label);
    const candidate = { title, description: oneLine(c.description, 2000) || null, points: round2(c.points), ratings };
    try {
      if (!title || ratings.length === 0) throw new Error('empty');
      validateRubricCriteria([candidate]);
      criteria.push(candidate);
    } catch {
      dropped++;
    }
  }
  return { rubric: { title: oneLine(raw.title, 200) || oneLine(`${fallbackTitle} rubric`, 200), criteria }, dropped };
}
