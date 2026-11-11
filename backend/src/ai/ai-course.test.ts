import { describe, expect, mock, test } from 'bun:test';
import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { expectRejection } from '@/test/mocks';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { AiProviderService } from './ai-provider.service';
import { AiService } from './ai.service';
import { AiGateway } from './ai-gateway';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { AiCourseService, cleanRubricDraft } from './ai-course.service';
import { CourseBuilderAiController } from './ai.controller';
import { cleanOutline, cleanPlanItem, dueDateFor, planGroupNames, startDateOf, submissionFlags } from './course-plan';
import { OUTLINE_SCHEMA, MODULE_ITEMS_SCHEMA, RUBRIC_DRAFT_SCHEMA } from './prompts';
import { SchemaError, validateSchema } from './json-schema';
import { safeMarkdown, suppliedUrls } from './redact';
import { AI_PLAN_MAX_ITEMS, AI_PLAN_MAX_MODULES } from './ai.constants';
import type { CreatePlanDto } from './ai.dto';

const rejected = async (p: Promise<unknown>) => (await expectRejection(p)) as Error;
const PROVIDER = '55555555-5555-4555-8555-555555555555';
const COURSE = '66666666-6666-4666-8666-666666666666';
const MODULE = '77777777-7777-4777-8777-777777777777';
const KEY = 'sk-test-secret-value-ABCD';

async function storedProvider(prisma: MockPrisma) {
  const providers = new AiProviderService(prisma as any);
  let row: any = null;
  prisma.ai_provider.count.mockResolvedValue(0);
  prisma.ai_provider.create.mockResolvedValue({ id: PROVIDER });
  prisma.ai_provider.update.mockImplementation(async ({ data }: any) => {
    row = {
      id: PROVIDER, name: 'Org LLM', kind: 'openai_compatible', base_url: 'https://llm.example.org/v1', model: 'gpt-5',
      api_key_enc: data.api_key_enc, api_key_last4: 'ABCD', monthly_cap: null, is_default: true,
      allow_private_network: false, available_to_schools: true, created_by: 'admin', created_at: new Date(), updated_at: new Date(),
    };
    return row;
  });
  await providers.create({ name: 'Org LLM', kind: 'openai_compatible', baseUrl: 'https://llm.example.org/v1', model: 'gpt-5', apiKey: KEY }, 'admin');
  return row;
}

function answering(content: unknown) {
  const calls: { body: any }[] = [];
  const fn = mock(async (_url: string, init: { body?: string }) => {
    calls.push({ body: JSON.parse(init.body ?? '{}') });
    return new Response(JSON.stringify({ model: 'm', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  });
  return { calls, fn };
}

interface Opts {
  role?: 'teacher' | 'admin' | 'ta';
  feature?: boolean;
  mastery?: boolean;
  course?: Record<string, unknown>;
  hourlyLimit?: number;
  recent?: number;
}

/** The builder with real AI plumbing (mock transport) and mocked course/grading/mastery services. */
async function build(content: unknown, opts: Opts = {}) {
  const prisma = createMockPrisma();
  const provider = await storedProvider(prisma);
  prisma.ai_provider.findMany.mockResolvedValue([provider]);
  prisma.ai_provider.findUnique.mockResolvedValue(provider);
  prisma.ai_org_setting.findUnique.mockResolvedValue({ keep_prompts: false, user_hourly_limit: opts.hourlyLimit ?? 30 });
  prisma.ai_request.create.mockResolvedValue({ id: 'req-1' });
  prisma.ai_request.count.mockImplementation(async ({ where }: any) => (where.user_id ? (opts.recent ?? 1) : 1));
  const course = {
    id: COURSE, school_id: 'school-1', name: 'Biology 9', code: 'BIO9', description: 'Cells and living things. Contact office@school.org',
    term_id: null, academic_year_id: null, ...opts.course,
  };
  const access = {
    require: mock(async (_u: string, courseId: string, roles: readonly string[]) => {
      const role = opts.role ?? 'teacher';
      if (courseId !== COURSE) throw new NotFoundException('Course not found');
      if (!roles.includes(role)) throw new ForbiddenException('nope');
      return { course: { ...course, id: courseId }, role };
    }),
  };
  const features = {
    assertEnabled: mock(async (_s: string | null, key: string) => {
      if (key === 'ai_assistance' && opts.feature === false) throw new FeatureDisabledException(key as never);
      if (key === 'mastery' && !opts.mastery) throw new FeatureDisabledException(key as never);
    }),
    isEnabled: mock(async (_s: string | null, key: string) => (key === 'mastery' ? !!opts.mastery : opts.feature !== false)),
  };
  const providers = new AiProviderService(prisma as any);
  const ai = new AiService(prisma as any, providers, features as any, { record: mock(async () => {}) } as any);
  const t = answering(content);
  ai.gateway = new AiGateway(t.fn as any);

  let n = 0;
  const id = (p: string) => `${p}-${++n}`;
  const modules = {
    list: mock(async () => [
      { id: MODULE, title: 'Cells', items: [{ title: 'What is a cell?' }] },
      { id: 'm-other', title: 'Genetics', items: [] },
    ]),
    create: mock(async (_u: string, _c: string, title: string) => ({ id: id('module'), title, isPublished: false, items: [] })),
    createItem: mock(async (_u: string, _c: string, _m: string, _input: unknown) => ({ id: id('item') })),
    update: mock(async () => ({})),
  };
  const pages = { create: mock(async (_u: string, _c: string, input: any) => ({ id: id('page'), ...input })) };
  const activities = {
    create: mock(async (_u: string, _c: string, input: any) => ({ id: id(input.kind), status: 'draft', ...input })),
    publish: mock(async () => ({})),
    addQuestion: mock(async () => ({})),
  };
  const groups = {
    list: mock(async () => [{ id: 'g-hw', name: 'Homework' }]),
    create: mock(async (_u: string, _c: string, input: any) => ({ id: id('group'), name: input.name })),
  };
  const outcomes = {
    createCourseOutcome: mock(async (_u: string, _c: string, dto: any) => ({ id: id('outcome'), code: dto.code })),
    align: mock(async () => []),
  };
  const builder = new AiCourseService(
    prisma as any, access as any, features as any, ai, modules as any, pages as any, activities as any, groups as any, outcomes as any,
  );
  return { prisma, builder, calls: t.calls, fetch: t.fn, modules, pages, activities, groups, outcomes, access };
}

const item = (over: Record<string, unknown> = {}) => ({
  kind: 'assignment', title: 'Cell diagram', description: 'Draw and label a plant cell.', points: 20, dueOffsetWeeks: 1,
  questionCount: null, group: 'Homework', submission: 'file', outcomes: [], ...over,
});

const OUTLINE_OUT = {
  modules: [
    {
      title: 'Cells', overview: 'What cells are.',
      items: [
        item({ kind: 'page', title: 'Inside a cell', description: '- nucleus\n- membrane\n![x](https://evil.example/x.png) [click](https://evil.example)', points: 50, dueOffsetWeeks: 3, group: 'Nope', submission: 'text' }),
        item({ outcomes: ['U1.1', 'NOPE'] }),
        item({ kind: 'quiz', title: 'Cells quiz', description: 'Cell parts', points: null, questionCount: 6, group: 'Quizzes', submission: '' }),
      ],
      outcomes: [{ code: 'U1.1', title: 'Describe the parts of a cell' }],
    },
  ],
};

describe('outline schema', () => {
  test('accepts a good outline; rejects bad shapes and over-limit plans', () => {
    expect(() => validateSchema(OUTLINE_SCHEMA, OUTLINE_OUT)).not.toThrow();
    const bad = (v: unknown) => expect(() => validateSchema(OUTLINE_SCHEMA, v)).toThrow(SchemaError);
    bad({ modules: [] });
    bad({ modules: 'x' });
    bad({ modules: [{ ...OUTLINE_OUT.modules[0], extra: 1 }] });
    bad({ modules: [{ ...OUTLINE_OUT.modules[0], items: [item({ kind: 'video' })] }] });
    bad({ modules: [{ ...OUTLINE_OUT.modules[0], items: [item({ points: -1 })] }] });
    bad({ modules: [{ ...OUTLINE_OUT.modules[0], items: [item({ dueOffsetWeeks: 1.5 })] }] });
    bad({ modules: [{ ...OUTLINE_OUT.modules[0], items: [item({ questionCount: 50 })] }] });
    bad({ modules: [{ ...OUTLINE_OUT.modules[0], items: [item({ title: '' })] }] });
    bad({ modules: [{ ...OUTLINE_OUT.modules[0], items: [{ ...item(), group: undefined }] }] });
    bad({ modules: Array.from({ length: AI_PLAN_MAX_MODULES + 1 }, () => OUTLINE_OUT.modules[0]) });
    bad({ modules: [{ ...OUTLINE_OUT.modules[0], items: Array.from({ length: AI_PLAN_MAX_ITEMS + 1 }, () => item()) }] });
    expect(() => validateSchema(MODULE_ITEMS_SCHEMA, { items: [item()] })).not.toThrow();
    expect(() => validateSchema(RUBRIC_DRAFT_SCHEMA, { title: 'R', criteria: [] })).toThrow(SchemaError);
  });

  test('cleanOutline: kind rules, links stripped, outcome codes limited to the module, outcomes dropped when off', () => {
    const [m] = cleanOutline(OUTLINE_OUT.modules as any, { withOutcomes: true });
    const [page, assignment, quiz] = m.items;
    expect(page).toMatchObject({ kind: 'page', points: null, dueOffsetWeeks: null, group: '', submission: null, questionCount: null });
    expect(page.description).not.toContain('evil.example');
    expect(page.description).toContain('click');
    expect(assignment).toMatchObject({ points: 20, submission: 'file', outcomes: ['U1.1'] });
    expect(quiz).toMatchObject({ points: 6, questionCount: 6, submission: null, group: 'Quizzes' });
    expect(m.outcomes).toEqual([{ code: 'U1.1', title: 'Describe the parts of a cell' }]);
    const [off] = cleanOutline(OUTLINE_OUT.modules as any, { withOutcomes: false });
    expect(off.outcomes).toEqual([]);
    expect(off.items[1].outcomes).toEqual([]);
  });
});

describe('course outline drafting', () => {
  test('returns an editable plan and creates nothing; no student data read or sent', async () => {
    const b = await build(OUTLINE_OUT, { mastery: true });
    const out = await b.builder.outline('teacher', COURSE, { subject: 'Biology', level: 'Year 9', weeks: 6, outcomes: true, syllabus: 'Cells, then genetics. Ask Jo at 0123 456 7890.' });
    expect(out.plan.modules[0].items).toHaveLength(3);
    expect(out.note).toContain('review before using');
    expect(out.masteryOn).toBe(true);
    for (const svc of [b.modules.create, b.modules.createItem, b.pages.create, b.activities.create, b.groups.create, b.outcomes.createCourseOutcome, b.outcomes.align]) {
      expect(svc).not.toHaveBeenCalled();
    }
    // No student work is read for course building; the roster is read for names only, to strip them.
    for (const [call] of b.prisma.course_student.findMany.mock.calls) {
      expect(Object.keys(call.select)).toEqual(['student_id', 'student']);
      expect(call.select.student.select).toEqual({ first_name: true, last_name: true });
    }
    expect(b.prisma.submission.findUnique).not.toHaveBeenCalled();
    expect(b.prisma.student.findMany).not.toHaveBeenCalled();
    const sent = JSON.stringify(b.calls[0].body);
    expect(sent).toContain('Biology 9');
    expect(sent).not.toContain('office@school.org');
    expect(sent).not.toContain('0123 456 7890');
    // The fixed system prompt carries no ids.
    expect(b.calls[0].body.messages[0].content).not.toContain(COURSE);
    // One logged request, ok.
    expect(b.prisma.ai_request.create).toHaveBeenCalledTimes(1);
    expect(b.prisma.ai_request.create.mock.calls[0][0].data.feature).toBe('course_outline');
  });

  test('flag off => 403 and nothing sent; TA refused; another course 404', async () => {
    const off = await build(OUTLINE_OUT, { feature: false });
    const err = (await rejected(off.builder.outline('t', COURSE, { subject: 'x', level: 'y' }))) as HttpException;
    expect(err.getStatus()).toBe(403);
    expect(off.fetch).not.toHaveBeenCalled();
    const ta = await build(OUTLINE_OUT, { role: 'ta' });
    expect(await rejected(ta.builder.outline('ta', COURSE, { subject: 'x', level: 'y' }))).toBeInstanceOf(ForbiddenException);
    expect(ta.fetch).not.toHaveBeenCalled();
    const other = await build(OUTLINE_OUT);
    expect(await rejected(other.builder.outline('t', 'another', { subject: 'x', level: 'y' }))).toBeInstanceOf(NotFoundException);
  });

  test('outcomes are asked for only while mastery is on', async () => {
    const b = await build(OUTLINE_OUT, { mastery: false });
    const out = await b.builder.outline('t', COURSE, { subject: 'x', level: 'y', outcomes: true });
    expect(out.plan.modules[0].outcomes).toEqual([]);
    expect(JSON.stringify(b.calls[0].body)).toContain('Learning outcomes: no');
  });

  test('invalid output => 502 AI_INVALID_OUTPUT; counts once toward the hourly limit', async () => {
    const b = await build({ modules: [{ title: 'x' }] });
    const err = (await rejected(b.builder.outline('t', COURSE, { subject: 'x', level: 'y' }))) as HttpException;
    expect(err.getStatus()).toBe(502);
    expect((err.getResponse() as { code: string }).code).toBe('AI_INVALID_OUTPUT');
    expect(b.prisma.ai_request.create).toHaveBeenCalledTimes(1);
    const limited = await build(OUTLINE_OUT, { hourlyLimit: 5, recent: 6 });
    const e2 = (await rejected(limited.builder.outline('t', COURSE, { subject: 'x', level: 'y' }))) as HttpException;
    expect((e2.getResponse() as { code: string }).code).toBe('AI_RATE_LIMITED');
    expect(limited.fetch).not.toHaveBeenCalled();
  });

  test('the outline gets the largest output budget (Anthropic max_tokens), the others less', async () => {
    const a = new AnthropicAdapter({ kind: 'anthropic', baseUrl: null, model: 'claude-opus-5-5', apiKey: 'k' }, { fetch: (async () => new Response('{}')) as any, timeoutMs: 1000 });
    expect(a.params({ system: 's', user: 'u', name: 'n', schema: OUTLINE_SCHEMA, maxTokens: 16_000 }).max_tokens).toBe(16_000);
    expect(a.params({ system: 's', user: 'u', name: 'n', schema: OUTLINE_SCHEMA, maxTokens: 4_000 }).max_tokens).toBe(4_000);
    expect(a.params({ system: 's', user: 'u', name: 'n', schema: OUTLINE_SCHEMA, maxTokens: 99_000 }).max_tokens).toBe(16_000);
    expect(a.params({ system: 's', user: 'u', name: 'n', schema: OUTLINE_SCHEMA }).max_tokens).toBe(16_000);
  });
});

const plan = (over: Partial<CreatePlanDto> = {}): CreatePlanDto => ({
  modules: [
    {
      title: 'Cells',
      overview: 'What cells are.',
      items: [
        { kind: 'page', title: 'Inside a cell', description: '- nucleus' },
        { kind: 'assignment', title: 'Cell diagram', description: 'Draw it.', points: 20, dueOffsetWeeks: 2, group: 'homework', submission: 'file', outcomes: ['U1.1'] },
        { kind: 'quiz', title: 'Cells quiz', description: 'Cell parts', questionCount: 5, dueOffsetWeeks: 3, group: 'Quizzes' },
      ],
      outcomes: [{ code: 'U1.1', title: 'Describe the parts of a cell' }],
    },
  ],
  ...over,
});

describe('creating a reviewed plan', () => {
  test('creates unpublished drafts through the existing services; groups matched or created; no AI call', async () => {
    const b = await build({});
    const out = await b.builder.createFromPlan('teacher', COURSE, plan({ startDate: '2027-01-11' }));
    expect(b.fetch).not.toHaveBeenCalled();
    expect(b.modules.create).toHaveBeenCalledTimes(1);
    expect(b.modules.create.mock.calls[0][2]).toBe('Cells');
    // Pages unpublished; activities created as drafts (never published).
    expect(b.pages.create.mock.calls[0][2]).toEqual({ title: 'Inside a cell', body: '- nucleus', isPublished: false });
    expect(b.activities.create).toHaveBeenCalledTimes(2);
    for (const call of b.activities.create.mock.calls as any[]) expect(call[2].status).toBeUndefined();
    expect(b.activities.publish).not.toHaveBeenCalled();
    expect(b.modules.update).not.toHaveBeenCalled();
    // Quizzes are created empty: no question is ever added.
    expect(b.activities.addQuestion).not.toHaveBeenCalled();
    const [assignment, quiz] = b.activities.create.mock.calls.map((c: any) => c[2]);
    expect(assignment).toMatchObject({ kind: 'assignment', points: 20, allowFile: true, allowText: false, assignmentGroupId: 'g-hw', dueAt: '2027-01-25T23:59:00.000Z' });
    expect(quiz).toMatchObject({ kind: 'quiz', points: 5, instructions: 'Cell parts', dueAt: '2027-02-01T23:59:00.000Z' });
    // "homework" matched the existing "Homework"; "Quizzes" created.
    expect(b.groups.create).toHaveBeenCalledTimes(1);
    expect(b.groups.create.mock.calls[0][2]).toEqual({ name: 'Quizzes' });
    expect(out.groups.map((g) => g.status)).toEqual(['existing', 'created']);
    // Each item added to the module.
    expect(b.modules.createItem).toHaveBeenCalledTimes(3);
    expect(out.ok).toBe(true);
    expect(out.created).toMatchObject({ modules: 1, items: 3, groups: 1, outcomes: 0 });
    expect(out.quizzes).toHaveLength(1);
    expect(out.notes.join(' ')).toContain('unpublished');
    // Mastery off: no outcomes created or aligned.
    expect(b.outcomes.createCourseOutcome).not.toHaveBeenCalled();
    expect(b.outcomes.align).not.toHaveBeenCalled();
    expect(out.notes.join(' ')).toContain('mastery is off');
  });

  test('outcomes are created and aligned only while mastery is on (and kept)', async () => {
    const on = await build({}, { mastery: true });
    const out = await on.builder.createFromPlan('t', COURSE, plan());
    expect(on.outcomes.createCourseOutcome).toHaveBeenCalledTimes(1);
    expect(on.outcomes.createCourseOutcome.mock.calls[0][2]).toEqual({ code: 'U1.1', title: 'Describe the parts of a cell' });
    expect(on.outcomes.align).toHaveBeenCalledTimes(1);
    expect((on.outcomes.align.mock.calls[0] as any)[2]).toMatchObject({ activityId: expect.stringMatching(/^assignment-/) });
    expect(out.modules[0].items[1].aligned).toEqual(['U1.1']);

    const declined = await build({}, { mastery: true });
    await declined.builder.createFromPlan('t', COURSE, plan({ createOutcomes: false }));
    expect(declined.outcomes.createCourseOutcome).not.toHaveBeenCalled();
    expect(declined.outcomes.align).not.toHaveBeenCalled();
  });

  test('due dates: from the term start, else none', async () => {
    const termed = await build({}, { course: { term_id: 'term-1' } });
    termed.prisma.term.findUnique.mockResolvedValue({ start_date: new Date('2027-09-06T00:00:00Z') });
    const out = await termed.builder.createFromPlan('t', COURSE, plan());
    expect(out.startDate).toBe('2027-09-06');
    expect(termed.activities.create.mock.calls[0][2].dueAt).toBe('2027-09-20T23:59:00.000Z');

    const undated = await build({});
    const out2 = await undated.builder.createFromPlan('t', COURSE, plan());
    expect(out2.startDate).toBeNull();
    for (const call of undated.activities.create.mock.calls as any[]) expect(call[2].dueAt).toBeUndefined();
    expect(out2.notes.join(' ')).toContain('No due dates');
  });

  test('partial failures are reported and the rest is still created', async () => {
    const b = await build({});
    b.activities.create.mockImplementationOnce(async () => {
      throw new BadRequestException('Failed to create activity');
    });
    b.modules.createItem.mockImplementationOnce(async () => {
      throw new BadRequestException('Failed to add to the module');
    });
    const two = plan();
    two.modules.push({ title: 'Broken', items: [{ kind: 'page', title: 'Never' }] });
    b.modules.create.mockImplementation(async (_u: string, _c: string, title: string) => {
      if (title === 'Broken') throw new BadRequestException('Failed to create the module');
      return { id: 'module-ok', title, isPublished: false, items: [] };
    });
    const out = await b.builder.createFromPlan('t', COURSE, two);
    expect(out.ok).toBe(false);
    const [page, assignment, quiz] = out.modules[0].items;
    expect(page).toMatchObject({ status: 'not_added', error: expect.stringContaining('not added to the module') });
    expect(assignment).toMatchObject({ status: 'failed', error: 'Failed to create activity', id: null });
    expect(quiz.status).toBe('created');
    expect(out.modules[1]).toMatchObject({ status: 'failed', error: 'Failed to create the module' });
    expect(out.modules[1].items[0]).toMatchObject({ status: 'skipped' });
    expect(out.failed).toBe(4);
  });

  test('add selected to an existing module: no module created; another course\'s module refused', async () => {
    const b = await build({});
    b.prisma.module.findFirst.mockImplementation(async ({ where }: any) => (where.id === MODULE && where.course_id === COURSE ? { id: MODULE } : null));
    const out = await b.builder.createFromPlan('t', COURSE, { modules: [{ title: 'Cells', existingModuleId: MODULE, items: [{ kind: 'page', title: 'More' }] }] });
    expect(b.modules.create).not.toHaveBeenCalled();
    expect(out.modules[0]).toMatchObject({ status: 'existing', moduleId: MODULE });
    expect(b.modules.createItem.mock.calls[0][2]).toBe(MODULE);
    const out2 = await b.builder.createFromPlan('t', COURSE, { modules: [{ title: 'X', existingModuleId: '11111111-1111-4111-8111-111111111111', items: [{ kind: 'page', title: 'More' }] }] });
    expect(out2.modules[0]).toMatchObject({ status: 'failed', error: 'Module not found' });
    expect(b.pages.create).toHaveBeenCalledTimes(1);
  });

  test('permissions: TA refused, other course 404, flag off 403 — nothing created', async () => {
    for (const [opts, courseId, type] of [
      [{ role: 'ta' }, COURSE, ForbiddenException],
      [{}, 'another', NotFoundException],
      [{ feature: false }, COURSE, FeatureDisabledException],
    ] as const) {
      const b = await build({}, opts as Opts);
      expect(await rejected(b.builder.createFromPlan('u', courseId, plan()))).toBeInstanceOf(type);
      expect(b.modules.create).not.toHaveBeenCalled();
      expect(b.pages.create).not.toHaveBeenCalled();
      expect(b.activities.create).not.toHaveBeenCalled();
    }
  });

  test('the teacher plan is cleaned again: HTML and invented links removed, kind rules applied', async () => {
    const b = await build({});
    await b.builder.createFromPlan('t', COURSE, {
      modules: [{ title: '<b>Cells</b>', items: [{ kind: 'page', title: 'P', description: '<script>x</script>See https://teacher.example/a', points: 9, group: 'G' }] }],
    });
    expect(b.modules.create.mock.calls[0][2]).toBe('Cells');
    expect(b.pages.create.mock.calls[0][2].body).toBe('xSee https://teacher.example/a');
    // A page in a group creates no group.
    expect(b.groups.list).not.toHaveBeenCalled();
  });

  test('the controller has exactly one creating route', () => {
    const methods = Object.getOwnPropertyNames(CourseBuilderAiController.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['announcement', 'assignment', 'createPlan', 'moduleItems', 'outcomes', 'outline', 'pageContent', 'rubric']);
  });
});

describe('item helpers return drafts only', () => {
  test('module items: suggestions for one module, nothing added', async () => {
    const b = await build({ items: [item(), item({ kind: 'page', title: 'Organelles' })] });
    const out = await b.builder.moduleItems('t', COURSE, MODULE, { count: 2 });
    expect(out.items.map((i) => i.title)).toEqual(['Cell diagram', 'Organelles']);
    expect(out.items[0].dueOffsetWeeks).toBeNull();
    expect(JSON.stringify(b.calls[0].body)).toContain('What is a cell?');
    expect(b.modules.createItem).not.toHaveBeenCalled();
    expect(b.prisma.ai_request.create.mock.calls[0][0].data.feature).toBe('module_items');
    expect(await rejected(b.builder.moduleItems('t', COURSE, '11111111-1111-4111-8111-111111111111', {}))).toBeInstanceOf(NotFoundException);
  });

  test('page content: safe Markdown (no HTML, no invented links or images), nothing saved', async () => {
    const b = await build({ markdown: '## Cells\n\n<iframe src="x"></iframe>Cells are small. ![img](https://evil.example/i.png)\n\n[source](https://evil.example) and [ours](https://teacher.example/notes)' });
    const out = await b.builder.pageContent('t', COURSE, { title: 'Cells', outline: 'Use https://teacher.example/notes' });
    expect(out.markdown).toBe('## Cells\n\nCells are small. img\n\nsource and [ours](https://teacher.example/notes)');
    expect(b.pages.create).not.toHaveBeenCalled();
    expect(b.prisma.page.update).not.toHaveBeenCalled();
  });

  test('assignment instructions: instructions, points and submission flags; nothing saved', async () => {
    const b = await build({ instructions: 'Write 300 words.', points: 25.555, submission: 'text_and_file' });
    const out = await b.builder.assignmentInstructions('t', COURSE, { title: 'Essay' });
    expect(out).toMatchObject({ instructions: 'Write 300 words.', points: 25.56, allowText: true, allowFile: true });
    expect(b.activities.create).not.toHaveBeenCalled();
  });

  test('rubric draft: validated with the rubric rules, bad criteria dropped, nothing saved', async () => {
    const b = await build({
      title: 'Essay rubric',
      criteria: [
        { title: 'Argument', description: 'Clear claim.', points: 10, ratings: [{ label: 'Excellent', description: '', points: 10 }, { label: 'Beginning', description: '', points: 0 }] },
        // A level worth more than its criterion breaks the rubric rules: dropped.
        { title: 'Style', description: '', points: 5, ratings: [{ label: 'Great', description: '', points: 8 }] },
      ],
    });
    const out = await b.builder.rubricDraft('t', COURSE, { title: 'Essay', totalPoints: 15 });
    expect(out.rubric.criteria.map((c) => c.title)).toEqual(['Argument']);
    expect(out.dropped).toBe(1);
    expect(b.prisma.rubric.create).not.toHaveBeenCalled();
    const all = await build({ title: 'R', criteria: [{ title: 'S', description: '', points: 1, ratings: [{ label: 'x', description: '', points: 2 }] }] });
    const err = (await rejected(all.builder.rubricDraft('t', COURSE, { title: 'E' }))) as HttpException;
    expect((err.getResponse() as { code: string }).code).toBe('AI_INVALID_OUTPUT');
    expect(cleanRubricDraft({ title: '', criteria: [] }, 'Essay').rubric.title).toBe('Essay rubric');
  });

  test('announcement: follows announcement permissions (TAs may draft); draft only', async () => {
    const b = await build({ title: 'Trip on Friday', body: 'Bring a packed lunch. <img src=x onerror=alert(1)>' }, { role: 'ta' });
    const out = await b.builder.announcement('ta', COURSE, { prompt: 'museum trip friday, bring lunch' });
    expect(out).toMatchObject({ title: 'Trip on Friday', body: 'Bring a packed lunch.' });
    expect(b.prisma.announcement.create).not.toHaveBeenCalled();
    // TAs cannot use the course-building features.
    expect(await rejected(b.builder.pageContent('ta', COURSE, { title: 'x' }))).toBeInstanceOf(ForbiddenException);
    expect(await rejected(b.builder.assignmentInstructions('ta', COURSE, { title: 'x' }))).toBeInstanceOf(ForbiddenException);
    expect(await rejected(b.builder.rubricDraft('ta', COURSE, { title: 'x' }))).toBeInstanceOf(ForbiddenException);
    expect(await rejected(b.builder.moduleItems('ta', COURSE, MODULE, {}))).toBeInstanceOf(ForbiddenException);
  });

  test('outcome suggestions: mastery on only; from content titles; existing codes skipped; nothing saved', async () => {
    const off = await build({ outcomes: [] });
    expect(await rejected(off.builder.suggestOutcomes('t', COURSE, {}))).toBeInstanceOf(FeatureDisabledException);
    expect(off.fetch).not.toHaveBeenCalled();
    const b = await build({ outcomes: [{ code: 'C1', title: 'Old', description: '' }, { code: 'C2', title: 'Explain cells', description: 'Uses terms.' }] }, { mastery: true });
    b.prisma.module.findMany.mockResolvedValue([{ title: 'Cells' }]);
    b.prisma.outcome.findMany.mockResolvedValue([{ code: 'c1', title: 'Existing' }]);
    const out = await b.builder.suggestOutcomes('t', COURSE, {});
    expect(out.outcomes).toEqual([{ code: 'C2', title: 'Explain cells', description: 'Uses terms.' }]);
    expect(JSON.stringify(b.calls[0].body)).toContain('Cells');
    expect(b.outcomes.createCourseOutcome).not.toHaveBeenCalled();
    expect(b.prisma.submission.findUnique).not.toHaveBeenCalled();
  });

  test("the roster's, staff's and guardians' full names are stripped from what a draft sends", async () => {
    const b = await build(OUTLINE_OUT, { mastery: true });
    b.prisma.course_student.findMany.mockResolvedValue([
      { student_id: 's1', student: { first_name: 'Amelia', last_name: 'Okafor' } },
      // A first name that is also a word: only the full name is matched here.
      { student_id: 's2', student: { first_name: 'Mark', last_name: 'Bell' } },
    ]);
    b.prisma.course_staff.findMany.mockResolvedValue([{ user_profile: { first_name: 'Priya', last_name: 'Shah' } }]);
    b.prisma.parent_student_link.findMany.mockResolvedValue([{ user_profile: { first_name: 'Carla', last_name: 'Diaz' } }]);
    await b.builder.outline('teacher', COURSE, {
      subject: 'Biology',
      level: 'Year 9',
      weeks: 6,
      syllabus: 'Groups: Amelia Okafor and Mark Bell; ask Priya Shah. Carla Diaz volunteers. Mark scheme attached.',
    });
    const sent = JSON.stringify(b.calls[0].body);
    for (const name of ['Amelia Okafor', 'Mark Bell', 'Priya Shah', 'Carla Diaz']) expect(sent).not.toContain(name);
    expect(sent).toContain('[Classmate]');
    expect(sent).toContain('Mark scheme');
  });
});

describe('plan helpers', () => {
  test('dueDateFor: start + whole weeks at 23:59 UTC; none without a start or offset', () => {
    expect(dueDateFor('2027-01-11', 0)).toBe('2027-01-11T23:59:00.000Z');
    expect(dueDateFor('2027-01-11', 3)).toBe('2027-02-01T23:59:00.000Z');
    expect(dueDateFor('2027-12-27', 1)).toBe('2028-01-03T23:59:00.000Z');
    expect(dueDateFor(null, 2)).toBeNull();
    expect(dueDateFor('2027-01-11', null)).toBeNull();
    expect(startDateOf(null, new Date('2026-09-01T00:00:00Z'))).toBe('2026-09-01');
    expect(startDateOf(null, undefined)).toBeNull();
  });

  test('group names, submission flags, item cleaning', () => {
    expect(planGroupNames([{ items: [{ kind: 'quiz', group: 'Quizzes' }, { kind: 'assignment', group: 'quizzes' }, { kind: 'page', group: 'Pages' }] }])).toEqual(['Quizzes']);
    expect(submissionFlags('file')).toEqual({ allowText: false, allowFile: true });
    expect(submissionFlags(null)).toEqual({ allowText: true, allowFile: false });
    expect(cleanPlanItem({ kind: 'assignment', title: '  ' })).toBeNull();
    expect(cleanPlanItem({ kind: 'quiz', title: 'Q', questionCount: 99, points: null })).toMatchObject({ questionCount: 10, points: 10 });
  });

  test('safeMarkdown keeps structure and teacher links only', () => {
    const allowed = suppliedUrls('see https://ok.example/a.');
    expect(safeMarkdown('# T\n\n- a\n- b\n\nhttps://bad.example/x and https://ok.example/a', allowed)).toBe('# T\n\n- a\n- b\n\n and https://ok.example/a');
    expect(safeMarkdown('[ref]: https://bad.example\ntext')).toBe('text');
  });
});
