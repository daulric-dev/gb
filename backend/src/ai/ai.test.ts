import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { AuthGuard } from '@/auth/auth.guard';
import { STEP_UP_KEY } from '@/auth/step-up.guard';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { openSecret } from '@/account/secret-box';
import { AI_KEY_INFO, aiKeyAad } from './ai.constants';
import { AiOrgFeatureGuard } from './ai-feature.guard';
import { AiProviderService, resolveSchoolProvider, selectProvider } from './ai-provider.service';
import { AiService } from './ai.service';
import { AiDraftsService, toDraft } from './ai-drafts.service';
import { OrganisationAiController, CourseAiController } from './ai.controller';
import { AiGateway } from './ai-gateway';
import { redact, plainText } from './redact';
import { validateSchema, providerSchema, SchemaError } from './json-schema';
import { TEST_SCHEMA } from './prompts';

const rejected = async (p: Promise<unknown>) => (await expectRejection(p)) as Error;
const PROVIDER = '55555555-5555-4555-8555-555555555555';
const COURSE = '66666666-6666-4666-8666-666666666666';
const ACTIVITY = '77777777-7777-4777-8777-777777777777';
const STUDENT = '88888888-8888-4888-8888-888888888888';
const PAGE = '99999999-9999-4999-8999-999999999999';
const KEY = 'sk-ant-secret-value-ABCD';

/** A provider row as the service stores it (key sealed by a real create). */
async function storedProvider(prisma: MockPrisma, over: Record<string, unknown> = {}) {
  const providers = new AiProviderService(prisma as any);
  let row: any = null;
  prisma.ai_provider.count.mockResolvedValue(0);
  prisma.ai_provider.create.mockResolvedValue({ id: PROVIDER });
  prisma.ai_provider.update.mockImplementation(async ({ data }: any) => {
    row = {
      id: PROVIDER, name: 'Anthropic', kind: 'anthropic', base_url: null, model: 'claude-opus-5-5',
      api_key_enc: data.api_key_enc, api_key_last4: 'ABCD', monthly_cap: null, is_default: true,
      allow_private_network: false, available_to_schools: true, created_by: 'admin', created_at: new Date(), updated_at: new Date(), ...over,
    };
    return row;
  });
  await providers.create({ name: 'Anthropic', kind: 'anthropic', apiKey: KEY }, 'admin');
  return row;
}

/** An answering transport: the model's JSON text, as an OpenAI-compatible reply. */
function answering(content: unknown) {
  const calls: { body: any }[] = [];
  const fn = mock(async (_url: string, init: { body?: string }) => {
    calls.push({ body: JSON.parse(init.body ?? '{}') });
    return new Response(JSON.stringify({ model: 'm', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  });
  return { calls, fn };
}

describe('organisation routes', () => {
  test('flag off => 403 FEATURE_DISABLED; on => allowed', async () => {
    const prisma = createMockPrisma();
    prisma.organisation.findFirst.mockResolvedValue({ features: {} }); // off by default
    const off = new AiOrgFeatureGuard(new FeatureService(prisma as any, createMockCacheService() as any));
    const err = await rejected(off.canActivate());
    expect(err).toBeInstanceOf(FeatureDisabledException);
    expect(((err as FeatureDisabledException).getResponse() as { code: string }).code).toBe('FEATURE_DISABLED');
    prisma.organisation.findFirst.mockResolvedValue({ features: { ai_assistance: true } });
    const on = new AiOrgFeatureGuard(new FeatureService(prisma as any, createMockCacheService() as any));
    expect(await on.canActivate()).toBe(true);
  });

  test('organisation admins only, behind the feature guard; every write needs step-up', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, OrganisationAiController)).toEqual([AuthGuard, OrganisationAdminGuard, AiOrgFeatureGuard]);
    for (const m of ['create', 'update', 'remove', 'setDefault', 'updateSettings'] as const) {
      expect(Reflect.getMetadata(STEP_UP_KEY, OrganisationAiController.prototype[m])).toBe(true);
    }
    for (const m of ['list', 'settings', 'usage', 'test'] as const) {
      expect(Reflect.getMetadata(STEP_UP_KEY, OrganisationAiController.prototype[m])).toBeUndefined();
    }
  });

  test('teacher routes have no write method: drafts only', () => {
    const methods = Object.getOwnPropertyNames(CourseAiController.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['quiz', 'rubric', 'status', 'summary']);
  });
});

describe('AiProviderService', () => {
  let prisma: MockPrisma;
  beforeEach(() => {
    prisma = createMockPrisma();
  });

  test('the API key is encrypted at rest and never returned', async () => {
    const row = await storedProvider(prisma);
    expect(row.api_key_enc).not.toContain(KEY);
    expect(openSecret(AI_KEY_INFO, aiKeyAad(PROVIDER), row.api_key_enc)).toBe(KEY);
    // Bound to the provider id: another row cannot decrypt it.
    expect(openSecret(AI_KEY_INFO, aiKeyAad('other'), row.api_key_enc)).toBeNull();
    const service = new AiProviderService(prisma as any);
    prisma.ai_provider.findMany.mockResolvedValue([row]);
    const listed = await service.list();
    const json = JSON.stringify(listed);
    expect(json).not.toContain(KEY);
    expect(json).not.toContain(row.api_key_enc);
    expect(listed.providers[0]).toMatchObject({ hasKey: true, keyLast4: 'ABCD', keyUnreadable: false, isDefault: true });
    // The create audit never carries the key.
    expect(JSON.stringify(prisma.ai_provider.create.mock.calls)).not.toContain(KEY);
  });

  test('the first provider becomes the default; a new default unsets the old one', async () => {
    await storedProvider(prisma);
    expect(prisma.ai_provider.create.mock.calls[0][0].data.is_default).toBe(true);
    const service = new AiProviderService(prisma as any);
    prisma.ai_provider.count.mockResolvedValue(1);
    await service.create({ name: 'Local', kind: 'openai_compatible', baseUrl: 'https://llm.example.org/v1', model: 'llama3.3', apiKey: 'x', isDefault: true }, 'admin');
    expect(prisma.ai_provider.updateMany).toHaveBeenCalledWith({ where: { is_default: true }, data: { is_default: false } });
  });

  test('provider selection: the default, else the only one, else none', () => {
    expect(selectProvider([{ id: 'a', is_default: false }, { id: 'b', is_default: true }])?.id).toBe('b');
    expect(selectProvider([{ id: 'a', is_default: false }])?.id).toBe('a');
    expect(selectProvider([{ id: 'a', is_default: false }, { id: 'b', is_default: false }])).toBeNull();
    expect(selectProvider([])).toBeNull();
  });

  test('base URL rules: OpenAI-compatible needs one; https only; anthropic defaults its model', async () => {
    const service = new AiProviderService(prisma as any);
    const prev = process.env.WEBHOOK_ALLOW_PRIVATE;
    // The install-wide webhook switch no longer opens http for AI providers.
    process.env.WEBHOOK_ALLOW_PRIVATE = 'true';
    try {
      expect((await rejected(service.create({ name: 'X', kind: 'openai_compatible', model: 'm', apiKey: 'k' }, 'a'))).message).toContain('base URL');
      expect((await rejected(service.create({ name: 'X', kind: 'openai_compatible', baseUrl: 'http://localhost:11434/v1', model: 'm', apiKey: 'k' }, 'a'))).message).toContain('https');
    } finally {
      if (prev === undefined) delete process.env.WEBHOOK_ALLOW_PRIVATE;
      else process.env.WEBHOOK_ALLOW_PRIVATE = prev;
    }
    await storedProvider(prisma);
    expect(prisma.ai_provider.create.mock.calls.at(-1)![0].data.model).toBe('claude-opus-5-5');
  });

  test('a key change is audited as a flag only; turning keep-prompts off clears kept prompts', async () => {
    const audit = { record: mock(async () => {}) };
    const row = await storedProvider(prisma);
    const service = new AiProviderService(prisma as any, audit as any);
    prisma.ai_provider.findUnique.mockResolvedValue(row);
    await service.update(PROVIDER, { apiKey: 'sk-new-key-WXYZ' }, 'admin');
    const entry = JSON.stringify(audit.record.mock.calls[0]);
    expect(entry).toContain('api_key_changed');
    expect(entry).not.toContain('sk-new-key');

    prisma.ai_org_setting.findUnique.mockResolvedValue({ keep_prompts: true, user_hourly_limit: 30 });
    await service.updateOrgSettings({ keepPrompts: false }, 'admin');
    expect(prisma.ai_request.updateMany.mock.calls[0][0].data).toEqual({ prompt_text: null, response_text: null, prompt_expires_at: null });
  });
});

interface BuildOpts {
  feature?: boolean;
  allowWork?: boolean;
  role?: string;
  provider?: any;
  hourlyLimit?: number;
  recent?: number;
  monthUsed?: number;
  keepPrompts?: boolean;
}

async function build(content: unknown, opts: BuildOpts = {}) {
  const prisma = createMockPrisma();
  const provider = opts.provider === undefined
    ? await storedProvider(prisma, { kind: 'openai_compatible', base_url: 'https://llm.example.org/v1', model: 'gpt-5' })
    : opts.provider;
  prisma.ai_provider.findMany.mockResolvedValue(provider ? [provider] : []);
  prisma.ai_provider.findUnique.mockResolvedValue(provider);
  prisma.ai_org_setting.findUnique.mockResolvedValue({ keep_prompts: !!opts.keepPrompts, user_hourly_limit: opts.hourlyLimit ?? 30 });
  prisma.ai_school_setting.findUnique.mockResolvedValue({ allow_student_work: opts.allowWork ?? false });
  prisma.ai_request.create.mockResolvedValue({ id: 'req-1' });
  prisma.ai_request.count.mockImplementation(async ({ where }: any) => (where.user_id ? (opts.recent ?? 1) : (opts.monthUsed ?? 1)));
  prisma.course_student.findMany.mockResolvedValue([
    { student: { first_name: 'Amelia', last_name: 'Okafor' } },
    { student: { first_name: 'Ben', last_name: 'Ng' } },
  ]);
  const access = {
    require: async (_u: string, courseId: string, roles: readonly string[]) => {
      const role = opts.role ?? 'teacher';
      if (courseId !== COURSE) throw new NotFoundException('Course not found');
      if (!roles.includes(role)) throw new ForbiddenException('nope');
      return { course: { id: courseId, school_id: 'school-1' }, role };
    },
  };
  const features = {
    assertEnabled: async (_s: string | null, key: string) => {
      if (opts.feature === false) throw new FeatureDisabledException(key as never);
    },
  };
  const providers = new AiProviderService(prisma as any);
  const audit = { record: mock(async () => {}) };
  const ai = new AiService(prisma as any, providers, features as any, audit as any);
  const t = answering(content);
  ai.gateway = new AiGateway(t.fn as any);
  const drafts = new AiDraftsService(prisma as any, access as any, features as any, ai);
  return { prisma, drafts, ai, calls: t.calls, fetch: t.fn, audit };
}

const QUIZ_OUT = {
  questions: [
    { kind: 'multiple_choice', prompt: 'Capital of France?', points: 1, options: [{ label: 'Paris', isCorrect: true, matchLabel: '' }, { label: 'Lyon', isCorrect: false, matchLabel: '' }], numericAnswer: null, numericTolerance: 0, explanation: 'Paris is the capital.' },
    // Breaks the rules (two correct answers on multiple choice): dropped.
    { kind: 'multiple_choice', prompt: 'Bad', points: 1, options: [{ label: 'A', isCorrect: true, matchLabel: '' }, { label: 'B', isCorrect: true, matchLabel: '' }], numericAnswer: null, numericTolerance: 0, explanation: '' },
    { kind: 'numeric', prompt: '2 + 2 = ?', points: 1, options: [], numericAnswer: 4, numericTolerance: 0, explanation: '' },
  ],
};

describe('quiz question drafts', () => {
  test('returns validated drafts and writes nothing but the request log', async () => {
    const { drafts, prisma, calls } = await build(QUIZ_OUT);
    const out = await drafts.quizQuestions('teacher', COURSE, { text: 'France is a country. Its capital is Paris.', count: 3, kinds: ['multiple_choice', 'numeric'] });
    expect(out.drafts.map((d) => d.prompt)).toEqual(['Capital of France?', '2 + 2 = ?']);
    expect(out.rejected).toBe(1);
    expect(out.note).toContain('review before using');
    expect(out.drafts[1]).toMatchObject({ kind: 'numeric', numericAnswer: 4, options: [] });
    // Only kinds asked for are allowed by the schema sent.
    expect(calls[0].body.response_format.json_schema.schema.properties.questions.items.properties.kind.enum).toEqual(['multiple_choice', 'numeric']);
    expect(prisma.quiz_question.create).not.toHaveBeenCalled();
    expect(prisma.quiz_option.createMany).not.toHaveBeenCalled();
    expect(prisma.ai_request.update.mock.calls.at(-1)![0].data).toMatchObject({ status: 'ok', input_tokens: 10, output_tokens: 20 });
    // No prompt kept by default.
    expect(prisma.ai_request.update.mock.calls.at(-1)![0].data.prompt_text).toBeUndefined();
  });

  test('flag off for the school => 403 and nothing is sent', async () => {
    const { drafts, fetch } = await build(QUIZ_OUT, { feature: false });
    const err = await rejected(drafts.quizQuestions('teacher', COURSE, { text: 'x', count: 1, kinds: ['essay'] }));
    expect((err as HttpException).getStatus()).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a TA cannot draft questions; a stranger gets 404', async () => {
    const ta = await build(QUIZ_OUT, { role: 'ta' });
    expect((await rejected(ta.drafts.quizQuestions('ta', COURSE, { text: 'x', count: 1, kinds: ['essay'] }))).constructor).toBe(ForbiddenException);
    const other = await build(QUIZ_OUT);
    expect(await rejected(other.drafts.quizQuestions('t', 'another', { text: 'x', count: 1, kinds: ['essay'] }))).toBeInstanceOf(NotFoundException);
  });

  test('student names and emails are replaced before sending', async () => {
    const { drafts, calls, prisma } = await build(QUIZ_OUT);
    prisma.page.findFirst.mockResolvedValue({ title: 'Notes', body: 'Amelia Okafor (amelia@school.org) asked Ben about Paris.' });
    await drafts.quizQuestions('teacher', COURSE, { pageId: PAGE, count: 2, kinds: ['multiple_choice', 'numeric'] });
    const sent = JSON.stringify(calls[0].body);
    expect(sent).not.toContain('Amelia');
    expect(sent).not.toContain('Okafor');
    expect(sent).not.toContain('Ben ');
    expect(sent).not.toContain('amelia@school.org');
    expect(sent).toContain('[Classmate]');
    expect(sent).toContain('[email]');
    expect(sent).toContain('Paris');
  });

  test('no provider => 409 AI_NO_PROVIDER', async () => {
    const { drafts } = await build(QUIZ_OUT, { provider: null });
    const err = (await rejected(drafts.quizQuestions('t', COURSE, { text: 'x', count: 1, kinds: ['essay'] }))) as HttpException;
    expect(err.getStatus()).toBe(409);
    expect((err.getResponse() as { code: string }).code).toBe('AI_NO_PROVIDER');
  });

  test('per-user hourly limit and the monthly cap => 429, nothing sent', async () => {
    const limited = await build(QUIZ_OUT, { hourlyLimit: 5, recent: 6 });
    const err = (await rejected(limited.drafts.quizQuestions('t', COURSE, { text: 'x', count: 1, kinds: ['essay'] }))) as HttpException;
    expect(err.getStatus()).toBe(429);
    expect((err.getResponse() as { code: string }).code).toBe('AI_RATE_LIMITED');
    expect(limited.fetch).not.toHaveBeenCalled();
    expect(limited.prisma.ai_request.update.mock.calls[0][0].data).toEqual({ status: 'rate_limited' });

    const prisma = createMockPrisma();
    const capped = await build(QUIZ_OUT, { provider: { ...(await storedProvider(prisma, { kind: 'openai_compatible', base_url: 'https://llm.example.org/v1' })), monthly_cap: 100 }, monthUsed: 101 });
    const err2 = (await rejected(capped.drafts.quizQuestions('t', COURSE, { text: 'x', count: 1, kinds: ['essay'] }))) as HttpException;
    expect((err2.getResponse() as { code: string }).code).toBe('AI_CAP_REACHED');
    expect(capped.fetch).not.toHaveBeenCalled();
  });

  test('invalid output is logged and answered 502 AI_INVALID_OUTPUT', async () => {
    const { drafts, prisma } = await build({ questions: 'not a list' });
    const err = (await rejected(drafts.quizQuestions('t', COURSE, { text: 'x', count: 1, kinds: ['essay'] }))) as HttpException;
    expect(err.getStatus()).toBe(502);
    expect((err.getResponse() as { code: string }).code).toBe('AI_INVALID_OUTPUT');
    expect(prisma.ai_request.update.mock.calls.at(-1)![0].data.status).toBe('invalid_output');
  });

  test('keep prompts: the prompt and answer are stored with a 30-day expiry', async () => {
    const { drafts, prisma } = await build(QUIZ_OUT, { keepPrompts: true });
    await drafts.quizQuestions('t', COURSE, { text: 'Paris', count: 1, kinds: ['multiple_choice', 'numeric'] });
    const data = prisma.ai_request.update.mock.calls.at(-1)![0].data;
    expect(data.prompt_text).toContain('Paris');
    expect(data.response_text).toContain('Capital of France');
    const days = (data.prompt_expires_at.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  test('toDraft: never file upload, matching keeps pairs, HTML stripped', () => {
    expect(toDraft({ kind: 'file_upload' as never, prompt: 'p', points: 1, options: [], numericAnswer: null, numericTolerance: 0, explanation: '' }, ['essay'])).toBeNull();
    const m = toDraft(
      { kind: 'matching', prompt: '<b>Match</b>', points: 2, options: [{ label: 'a', isCorrect: true, matchLabel: '1' }, { label: 'b', isCorrect: true, matchLabel: '2' }], numericAnswer: null, numericTolerance: 0, explanation: '' },
      ['matching'],
    );
    expect(m).toMatchObject({ prompt: 'Match', options: [{ label: 'a', matchLabel: '1' }, { label: 'b', matchLabel: '2' }] });
  });
});

const RUBRIC = {
  title: 'Essay rubric',
  rubric_criterion: [
    { id: 'crit-1', title: 'Argument', description: null, points: 10, rubric_rating: [{ id: 'rat-1', label: 'Strong', description: null, points: 10 }, { id: 'rat-2', label: 'Weak', description: null, points: 4 }] },
    { id: 'crit-2', title: 'Style', description: null, points: 5, rubric_rating: [{ id: 'rat-3', label: 'Clear', description: null, points: 5 }] },
  ],
};

async function rubricSetup(content: unknown, opts: BuildOpts = {}) {
  const b = await build(content, opts);
  b.prisma.activity.findUnique.mockResolvedValue({ id: ACTIVITY, course_id: COURSE, title: 'Essay', instructions: 'Argue a case', rubric_id: 'rub-1' });
  b.prisma.rubric.findUnique.mockResolvedValue(RUBRIC);
  b.prisma.submission.findUnique.mockResolvedValue({
    text_body: 'My name is Amelia Okafor and I think Ben Ng is wrong. Mail me at a.okafor@example.com.',
    status: 'submitted',
    student: { first_name: 'Amelia', last_name: 'Okafor' },
  });
  return b;
}

describe('rubric feedback suggestions', () => {
  const OUT = {
    criteria: [
      { criterion: 'c1', level: 'c1-r1', comment: 'Strong case, [Student].' },
      // A level from another criterion is dropped.
      { criterion: 'c2', level: 'c1-r2', comment: 'Clear writing.' },
    ],
    feedback: 'Well done, [Student]. <img src=x onerror=alert(1)>Next: cite sources.',
  };

  test("the school's setting (off by default) blocks sending student work: 403, nothing read or sent", async () => {
    const { drafts, fetch, prisma } = await rubricSetup(OUT);
    const err = (await rejected(drafts.rubricFeedback('t', ACTIVITY, { studentId: STUDENT }))) as HttpException;
    expect(err.getStatus()).toBe(403);
    expect((err.getResponse() as { code: string }).code).toBe('AI_STUDENT_WORK_NOT_ALLOWED');
    expect(fetch).not.toHaveBeenCalled();
    expect(prisma.submission.findUnique).not.toHaveBeenCalled();
  });

  test('suggests levels and comments mapped back to ids; never saves a mark', async () => {
    const { drafts, calls, prisma } = await rubricSetup(OUT, { allowWork: true });
    const out = await drafts.rubricFeedback('t', ACTIVITY, { studentId: STUDENT });
    expect(out.suggestions).toEqual([
      { criterionId: 'crit-1', ratingId: 'rat-1', points: 10, comment: 'Strong case, Amelia.' },
      { criterionId: 'crit-2', ratingId: null, points: null, comment: 'Clear writing.' },
    ]);
    expect(out.feedback).toBe('Well done, Amelia. Next: cite sources.');
    expect(out.note).toContain('never applied');
    // The student's name and email, and a classmate's, never left.
    const sent = JSON.stringify(calls[0].body);
    for (const s of ['Amelia', 'Okafor', 'Ben Ng', 'a.okafor@example.com']) expect(sent).not.toContain(s);
    expect(sent).toContain('[Student]');
    expect(sent).toContain('[Classmate]');
    // Ids never sent: short references only.
    expect(sent).not.toContain('crit-1');
    expect(prisma.rubric_assessment.upsert).not.toHaveBeenCalled();
    expect(prisma.rubric_assessment.create).not.toHaveBeenCalled();
    expect(prisma.submission.update).not.toHaveBeenCalled();
  });

  test('flag off => 403 before anything else', async () => {
    const { drafts, fetch } = await rubricSetup(OUT, { allowWork: true, feature: false });
    expect(((await rejected(drafts.rubricFeedback('t', ACTIVITY, { studentId: STUDENT }))) as HttpException).getStatus()).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a student restricted from AI (no_ai): 403 AI_STUDENT_RESTRICTED, their work never read or sent", async () => {
    const { drafts, fetch, prisma } = await rubricSetup(OUT, { allowWork: true });
    prisma.student_restriction.findMany.mockResolvedValue([{ student_id: STUDENT }]);
    const err = (await rejected(drafts.rubricFeedback('t', ACTIVITY, { studentId: STUDENT }))) as HttpException;
    expect(err.getStatus()).toBe(403);
    expect((err.getResponse() as { code: string }).code).toBe('AI_STUDENT_RESTRICTED');
    expect(prisma.student_restriction.findMany.mock.calls[0][0].where).toMatchObject({
      student_id: { in: [STUDENT] },
      no_ai: true,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(prisma.submission.findUnique).not.toHaveBeenCalled();
  });

  test("staff and guardians' names are redacted too", async () => {
    const { drafts, calls, prisma } = await rubricSetup(OUT, { allowWork: true });
    prisma.submission.findUnique.mockResolvedValue({
      text_body: 'Mrs Priya Shah helped me, and my mum Carla Diaz read it.',
      status: 'submitted',
      student: { first_name: 'Amelia', last_name: 'Okafor' },
    });
    prisma.course_staff.findMany.mockResolvedValue([{ user_profile: { first_name: 'Priya', last_name: 'Shah' } }]);
    prisma.parent_student_link.findMany.mockResolvedValue([{ user_profile: { first_name: 'Carla', last_name: 'Diaz' } }]);
    await drafts.rubricFeedback('t', ACTIVITY, { studentId: STUDENT });
    const sent = JSON.stringify(calls[0].body);
    for (const s of ['Priya', 'Shah', 'Carla', 'Diaz']) expect(sent).not.toContain(s);
  });
});

describe('page summary', () => {
  test('returns plain text (no links, images or HTML) and writes nothing', async () => {
    const { drafts, prisma } = await build({ summary: 'Plants make food. ![x](https://evil.example/p.png) See [here](https://evil.example).', keyPoints: ['<script>x</script>Light matters'] });
    prisma.page.findFirst.mockResolvedValue({ title: 'Photosynthesis', body: 'Plants use light.' });
    const out = await drafts.pageSummary('t', COURSE, PAGE, {});
    expect(out.summary).toBe('Plants make food. x See here.');
    expect(out.keyPoints).toEqual(['xLight matters']);
    expect(prisma.page.update).not.toHaveBeenCalled();
  });
});

describe('model refusals', () => {
  test('a refusal is answered 422 AI_REFUSED with a clear message and logged as refused', async () => {
    const b = await build({});
    b.ai.gateway = new AiGateway(
      mock(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }))) as any,
    );
    const err = (await rejected(b.drafts.quizQuestions('t', COURSE, { text: 'x', count: 1, kinds: ['essay'] }))) as HttpException;
    expect(err.getStatus()).toBe(422);
    expect((err.getResponse() as { code: string; message: string }).code).toBe('AI_REFUSED');
    expect((err.getResponse() as { message: string }).message).toContain('declined');
    expect(b.prisma.ai_request.update.mock.calls.at(-1)![0].data.status).toBe('refused');
  });
});

describe('school settings', () => {
  test('default off; updating is audited', async () => {
    const { ai, prisma, audit } = await build({});
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
    prisma.ai_school_setting.findUnique.mockResolvedValue(null);
    const before = await ai.getSchoolSettings('admin');
    expect(before.allowStudentWork).toBe(false);
    expect(before.notice).toContain('placeholders');
    await ai.updateSchoolSettings('admin', { allowStudentWork: true });
    expect(prisma.ai_school_setting.upsert.mock.calls[0][0].create).toMatchObject({ allow_student_work: true });
    expect(audit.record).toHaveBeenCalled();
  });

  test('the sweep clears expired prompts and deletes year-old rows', async () => {
    const { ai, prisma } = await build({});
    await ai.sweep(new Date('2026-12-01T00:00:00Z'));
    expect(prisma.ai_request.updateMany.mock.calls[0][0].data).toEqual({ prompt_text: null, response_text: null, prompt_expires_at: null });
    expect(prisma.ai_request.deleteMany.mock.calls[0][0].where.created_at.lt.toISOString()).toBe('2025-12-01T00:00:00.000Z');
  });
});

describe('helpers', () => {
  test('redact: longest names first, case-insensitive, whole words, emails and numbers', () => {
    const s = redact('ann lee met Ann and Annabel; call +44 7700 900123 or ann@x.org', {
      student: { first_name: 'Ann', last_name: 'Lee' },
    });
    expect(s).toBe('[Student] met [Student] and Annabel; call [number] or [email]');
  });

  test('plainText strips tags, images and links', () => {
    expect(plainText('<b>a</b> ![i](u) [l](u)')).toBe('a i l');
  });

  test('schema validation and provider schema stripping', () => {
    const schema = { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: 2 } as const;
    expect(() => validateSchema(schema, [1, 2])).not.toThrow();
    expect(() => validateSchema(schema, [1, 2, 3])).toThrow(SchemaError);
    expect(() => validateSchema(schema, [0])).toThrow(SchemaError);
    expect(() => validateSchema(schema, [1.5])).toThrow(SchemaError);
    expect(providerSchema(schema)).toEqual({ type: 'array', items: { type: 'integer' } });
  });
});

describe('private-network providers (set per provider by the organisation)', () => {
  test('creating with allowPrivateNetwork permits an http local URL, stores both flags and audits them', async () => {
    const prisma = createMockPrisma();
    const audit = { record: mock(async () => {}) };
    const service = new AiProviderService(prisma as any, audit as any);
    prisma.ai_provider.count.mockResolvedValue(1);
    prisma.ai_provider.create.mockResolvedValue({ id: PROVIDER });
    prisma.ai_provider.update.mockImplementation(async ({ data }: any) => ({
      id: PROVIDER, name: 'Ollama', kind: 'openai_compatible', base_url: 'http://localhost:11434/v1', model: 'llama3.3',
      api_key_enc: data.api_key_enc, api_key_last4: 'none', monthly_cap: null, is_default: false,
      allow_private_network: true, available_to_schools: false, created_by: 'admin', created_at: new Date(), updated_at: new Date(),
    }));
    const view = await service.create(
      { name: 'Ollama', kind: 'openai_compatible', baseUrl: 'http://localhost:11434/v1', model: 'llama3.3', apiKey: 'none', allowPrivateNetwork: true, availableToSchools: false },
      'admin',
    );
    expect(prisma.ai_provider.create.mock.calls[0][0].data).toMatchObject({ allow_private_network: true, available_to_schools: false });
    expect(view).toMatchObject({ allowPrivateNetwork: true, availableToSchools: false });
    const [, schoolId, , entry] = audit.record.mock.calls[0] as any[];
    expect(schoolId).toBeNull();
    expect(entry).toMatchObject({ entity: 'ai_provider', action: 'create' });
    expect(entry.changes.allow_private_network).toEqual({ before: null, after: true });
    expect(entry.changes.available_to_schools).toEqual({ before: null, after: false });
  });

  test('turning the private network off is refused while the base URL is http; toggles are audited', async () => {
    const prisma = createMockPrisma();
    const audit = { record: mock(async () => {}) };
    const row = await storedProvider(prisma, {
      kind: 'openai_compatible', base_url: 'http://10.0.0.5:8000/v1', allow_private_network: true,
    });
    const service = new AiProviderService(prisma as any, audit as any);
    prisma.ai_provider.findUnique.mockResolvedValue(row);
    expect((await rejected(service.update(PROVIDER, { allowPrivateNetwork: false }, 'admin'))).message).toContain('https');
    prisma.ai_provider.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
    await service.update(PROVIDER, { availableToSchools: false }, 'admin');
    const entry = (audit.record.mock.calls.at(-1) as any[])[3];
    expect(entry.changes).toEqual({ available_to_schools: { before: true, after: false } });
  });

  test('the provider config carries the flag to the gateway, which passes allowPrivate to the transport', async () => {
    const prisma = createMockPrisma();
    const row = await storedProvider(prisma, { kind: 'openai_compatible', base_url: 'http://127.0.0.1:11434/v1', allow_private_network: true });
    const config = new AiProviderService(prisma as any).configFor(row);
    expect(config.allowPrivateNetwork).toBe(true);
    const t = answering({ ok: true });
    const seen: unknown[] = [];
    const transport = mock(async (url: string, init: any) => {
      seen.push(init.allowPrivate);
      return t.fn(url, init);
    });
    await new AiGateway(transport as any).generateStructured(config, { system: 's', user: 'u', name: 'n', schema: TEST_SCHEMA });
    expect(seen).toEqual([true]);
    seen.length = 0;
    // A provider without the flag sends an explicit false (never the env switch) and cannot use http.
    const publicConfig = { ...config, baseUrl: 'https://llm.example.org/v1', allowPrivateNetwork: false };
    await new AiGateway(transport as any).generateStructured(publicConfig, { system: 's', user: 'u', name: 'n', schema: TEST_SCHEMA });
    expect(seen).toEqual([false]);
  });
});

describe('school provider choice', () => {
  const ORG = { id: 'org-default', is_default: true, available_to_schools: true };
  const OTHER = { id: 'other', is_default: false, available_to_schools: true };
  const HIDDEN = { id: 'hidden', is_default: false, available_to_schools: false };

  test('resolution: the school choice if available, else the organisation default, else none', () => {
    expect(resolveSchoolProvider([ORG, OTHER], 'other')).toEqual({ provider: OTHER, source: 'school' });
    expect(resolveSchoolProvider([ORG, OTHER], null)).toEqual({ provider: ORG, source: 'organisation' });
    // A choice that is no longer available (or was deleted) falls back to the default.
    expect(resolveSchoolProvider([ORG, HIDDEN], 'hidden')).toEqual({ provider: ORG, source: 'organisation' });
    expect(resolveSchoolProvider([ORG], 'deleted')).toEqual({ provider: ORG, source: 'organisation' });
    // The default itself not available to schools: nothing (409 AI_NO_PROVIDER).
    expect(resolveSchoolProvider([{ ...ORG, available_to_schools: false }], null)).toEqual({ provider: null, source: null });
    expect(resolveSchoolProvider([], null).provider).toBeNull();
  });

  async function twoProviders() {
    const b = await build({ questions: [] });
    const second = {
      ...(await b.ai['providers'].require(PROVIDER)),
      id: 'second-provider', name: 'Local Llama', is_default: false, base_url: 'https://llama.school.example/v1', model: 'llama3.3',
    };
    const first = await b.ai['providers'].require(PROVIDER);
    b.prisma.ai_provider.findMany.mockResolvedValue([first, second]);
    b.prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
    return { ...b, first, second };
  }

  test('requests use the school\'s chosen provider; without a choice the organisation default', async () => {
    const b = await twoProviders();
    b.prisma.ai_school_setting.findUnique.mockResolvedValue({ allow_student_work: false, provider_id: 'second-provider' });
    expect((await b.ai.requireProvider('school-1')).id).toBe('second-provider');
    b.prisma.ai_school_setting.findUnique.mockResolvedValue({ allow_student_work: false, provider_id: null });
    expect((await b.ai.requireProvider('school-1')).id).toBe(PROVIDER);
    // Organisation-level calls (no school) use the default.
    expect((await b.ai.requireProvider(null)).id).toBe(PROVIDER);
  });

  test('no provider available to schools => 409 AI_NO_PROVIDER', async () => {
    const b = await twoProviders();
    b.prisma.ai_provider.findMany.mockResolvedValue([{ ...b.first, available_to_schools: false }]);
    const err = (await rejected(b.ai.requireProvider('school-1'))) as HttpException;
    expect(err.getStatus()).toBe(409);
    expect((err.getResponse() as { code: string }).code).toBe('AI_NO_PROVIDER');
  });

  test('settings list the organisation default and available providers; the notice names the chosen one', async () => {
    const b = await twoProviders();
    b.prisma.ai_provider.findMany.mockResolvedValue([b.first, b.second, { ...b.second, id: 'hidden', name: 'Hidden', available_to_schools: false }]);
    b.prisma.ai_school_setting.findUnique.mockResolvedValue({ allow_student_work: false, provider_id: 'second-provider' });
    const view = await b.ai.getSchoolSettings('admin');
    expect(view.providerId).toBe('second-provider');
    expect(view.choiceUnavailable).toBe(false);
    expect(view.organisationDefault?.id).toBe(PROVIDER);
    expect(view.availableProviders.map((p) => p.id)).toEqual([PROVIDER, 'second-provider']);
    expect(view.provider?.name).toBe('Local Llama');
    expect(view.notice).toContain('"Local Llama"');
    expect(JSON.stringify(view)).not.toContain('api_key');
  });

  test('choosing a provider is validated and audited; null goes back to the default', async () => {
    const b = await twoProviders();
    b.prisma.ai_school_setting.findUnique.mockResolvedValue({ allow_student_work: true, provider_id: null });
    b.prisma.ai_provider.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'second-provider' ? b.second : where.id === 'hidden' ? { ...b.second, id: 'hidden', available_to_schools: false } : null,
    );
    await b.ai.updateSchoolSettings('admin', { providerId: 'second-provider' });
    const upsert = b.prisma.ai_school_setting.upsert.mock.calls[0][0];
    expect(upsert.update).toMatchObject({ provider_id: 'second-provider', allow_student_work: true });
    const [, schoolId, actor, entry] = b.audit.record.mock.calls.at(-1) as any[];
    expect(schoolId).toBe('school-1');
    expect(actor).toEqual({ id: 'admin' });
    expect(entry).toMatchObject({ entity: 'ai_school_setting', entityId: 'school-1', action: 'update' });
    expect(entry.changes).toEqual({
      provider_id: { before: null, after: 'second-provider' },
      provider_name: { before: null, after: 'Local Llama' },
    });

    // Unavailable and unknown providers are refused (400) and nothing is saved.
    const calls = b.prisma.ai_school_setting.upsert.mock.calls.length;
    for (const providerId of ['hidden', '12345678-1234-4234-8234-123456789012']) {
      const err = (await rejected(b.ai.updateSchoolSettings('admin', { providerId }))) as HttpException;
      expect(err.getStatus()).toBe(400);
    }
    expect(b.prisma.ai_school_setting.upsert.mock.calls.length).toBe(calls);

    // Back to the organisation default.
    b.prisma.ai_school_setting.findUnique.mockResolvedValue({ allow_student_work: true, provider_id: 'second-provider' });
    await b.ai.updateSchoolSettings('admin', { providerId: null });
    expect(b.prisma.ai_school_setting.upsert.mock.calls.at(-1)![0].update.provider_id).toBeNull();
    const last = (b.audit.record.mock.calls.at(-1) as any[])[3];
    expect(last.changes.provider_name).toEqual({ before: 'Local Llama', after: null });
  });

  test('the switch alone leaves the provider choice unchanged', async () => {
    const b = await twoProviders();
    b.prisma.ai_school_setting.findUnique.mockResolvedValue({ allow_student_work: false, provider_id: 'second-provider' });
    await b.ai.updateSchoolSettings('admin', { allowStudentWork: true });
    expect(b.prisma.ai_school_setting.upsert.mock.calls[0][0].update).toMatchObject({ provider_id: 'second-provider', allow_student_work: true });
    expect((b.audit.record.mock.calls.at(-1) as any[])[3].changes).toEqual({ allow_student_work: { before: false, after: true } });
  });
});
