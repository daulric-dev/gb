import { describe, expect, mock, test } from 'bun:test';
import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { expectRejection } from '@/test/mocks';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { AiProviderService } from '../ai-provider.service';
import { AiService } from '../ai.service';
import { AiGateway } from '../ai-gateway';
import { AiFileGradingService } from './file-grading.service';
import { AiFileGradingController } from './file-grading.controller';
import { AiFileGradingQueueService } from './file-grading-queue.service';
import { makeDocx } from './zip-fixture';

const COURSE = '66666666-6666-4666-8666-666666666666';
const ACTIVITY = '77777777-7777-4777-8777-777777777777';
const STUDENT = '88888888-8888-4888-8888-888888888888';
const STUDENT2 = '99999999-9999-4999-8999-999999999999';
const PROVIDER = '55555555-5555-4555-8555-555555555555';
const SUBMITTED = new Date('2026-11-10T10:00:00Z');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const rejected = async (p: Promise<unknown>) => (await expectRejection(p)) as HttpException;
const code = (e: HttpException) => (e.getResponse() as { code?: string }).code;

const ESSAY = 'My name is Amelia Okafor. I argue that school should start later because teenagers need more sleep. Ben Ng disagrees. Email me at a.okafor@example.com.';

const SCORE_OUT = {
  score: 14,
  requirements: [
    { requirement: 'State a position', status: 'met', comment: 'Clear, [Student].', evidence: ['school should start later', 'an invented quote that is not there'] },
  ],
  feedback: 'Good work, [Student].',
  feedbackEvidence: ['teenagers need more sleep'],
};

interface Opts {
  allowWork?: boolean;
  allowFiles?: boolean;
  feature?: boolean;
  role?: string;
  restricted?: string[];
  kind?: string;
  rubric?: boolean;
  files?: { id: string; name: string; content_type: string; status?: string; size_bytes?: number; body?: Buffer }[];
  text?: string | null;
  answer?: unknown;
}

async function setup(opts: Opts = {}) {
  const prisma = createMockPrisma();
  // A provider row sealed by a real create.
  const providers = new AiProviderService(prisma as any);
  let provider: any = null;
  prisma.ai_provider.count.mockResolvedValue(0);
  prisma.ai_provider.create.mockResolvedValue({ id: PROVIDER });
  prisma.ai_provider.update.mockImplementation(async ({ data }: any) => {
    provider = {
      id: PROVIDER, name: 'Local LLM', kind: 'openai_compatible', base_url: 'https://llm.example.org/v1', model: 'llama3.3',
      api_key_enc: data.api_key_enc, api_key_last4: 'ABCD', monthly_cap: null, is_default: true,
      allow_private_network: false, available_to_schools: true, created_by: 'admin', created_at: new Date(), updated_at: new Date(),
    };
    return provider;
  });
  await providers.create({ name: 'Local LLM', kind: 'openai_compatible', baseUrl: 'https://llm.example.org/v1', model: 'llama3.3', apiKey: 'sk-test-ABCD' }, 'admin');
  prisma.ai_provider.findMany.mockResolvedValue([provider]);
  prisma.ai_provider.findUnique.mockResolvedValue(provider);
  prisma.ai_org_setting.findUnique.mockResolvedValue({ keep_prompts: false, user_hourly_limit: 30 });
  prisma.ai_school_setting.findUnique.mockResolvedValue({ allow_student_work: opts.allowWork ?? true, allow_student_files: opts.allowFiles ?? true, provider_id: null });
  prisma.ai_request.create.mockResolvedValue({ id: 'req-1' });
  prisma.ai_request.count.mockResolvedValue(1);
  prisma.activity.findUnique.mockResolvedValue({
    id: ACTIVITY, course_id: COURSE, title: 'Should school start later?', instructions: 'Argue a position with reasons.',
    points: 20, kind: opts.kind ?? 'assignment', rubric_id: opts.rubric ? 'rub-1' : null,
  });
  prisma.rubric.findUnique.mockResolvedValue({
    title: 'Essay',
    rubric_criterion: [
      { id: 'crit-1', title: 'Argument', description: null, points: 10, rubric_rating: [{ id: 'rat-1', label: 'Strong', description: null, points: 10 }, { id: 'rat-2', label: 'Weak', description: null, points: 4 }] },
    ],
  });
  prisma.student_restriction.findMany.mockImplementation(async ({ where }: any) =>
    (opts.restricted ?? []).filter((id) => where.student_id.in.includes(id)).map((student_id) => ({ student_id })),
  );
  const submission = (studentId: string) => ({
    id: `sub-${studentId.slice(0, 2)}`, student_id: studentId, status: 'submitted', text_body: opts.text === undefined ? null : opts.text,
    file_id: null, submitted_at: SUBMITTED, score: null, excused: false,
  });
  prisma.submission.findUnique.mockImplementation(async ({ where }: any) => submission(where.activity_id_student_id.student_id));
  const files = opts.files ?? [{ id: 'f1', name: 'essay.docx', content_type: DOCX, body: makeDocx([ESSAY]) }];
  const objects = new Map<string, Buffer>();
  const fileRows = files.map((f) => {
    if (f.body) objects.set(`file-manager/${f.id}`, f.body);
    return { id: f.id, name: f.name, content_type: f.content_type, size_bytes: f.size_bytes ?? f.body?.length ?? 10, status: f.status ?? 'ready', deleted_at: null, bucket: 'file-manager', storage_path: f.id };
  });
  prisma.submission_file.findMany.mockResolvedValue(fileRows.map((file) => ({ file, submission_id: 'sub-88' })));
  prisma.student.findUnique.mockResolvedValue({ first_name: 'Amelia', last_name: 'Okafor' });
  prisma.course_student.findMany.mockResolvedValue([
    { student: { first_name: 'Amelia', last_name: 'Okafor' } },
    { student: { first_name: 'Ben', last_name: 'Ng' } },
  ]);
  // The draft row: upsert creates it, updateMany changes it, findUnique reads it.
  let row: any = null;
  prisma.ai_grading_draft.upsert.mockImplementation(async ({ create }: any) => {
    row = { id: 'draft-1', ...create, suggestions: null, submission: { submitted_at: SUBMITTED } };
    return { id: 'draft-1' };
  });
  prisma.ai_grading_draft.updateMany.mockImplementation(async ({ data }: any) => {
    if (row) row = { ...row, ...data };
    return { count: 1 };
  });
  prisma.ai_grading_draft.findUnique.mockImplementation(async () => row);

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
  const ai = new AiService(prisma as any, providers, features as any);
  const calls: any[] = [];
  const fetch = mock(async (_url: string, init: { body?: string }) => {
    calls.push(JSON.parse(init.body ?? '{}'));
    return new Response(JSON.stringify({ model: 'llama3.3', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(opts.answer ?? SCORE_OUT) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  });
  ai.gateway = new AiGateway(fetch as any);
  const storage = { getBuffer: mock(async (key: string) => objects.get(key) ?? null) };
  const audit = { record: mock(async () => {}) };
  const service = new AiFileGradingService(prisma as any, access as any, features as any, ai, storage as any, audit as any);
  const enqueued: string[] = [];
  service.enqueue = async (id: string) => {
    enqueued.push(id);
  };
  return { prisma, service, calls, fetch, storage, audit, enqueued, row: () => row };
}

const sentText = (calls: any[]) => JSON.stringify(calls[0]);

describe('gates', () => {
  test('no write route: the controller only drafts, reads, discards and runs batches', () => {
    const methods = Object.getOwnPropertyNames(AiFileGradingController.prototype).filter((m) => m !== 'constructor');
    expect(methods.sort()).toEqual(['batch', 'cancel', 'discard', 'draft', 'get', 'overview', 'preview', 'start']);
  });

  test("the school's allow-student-work switch: 403 before any file is read or sent", async () => {
    const { service, fetch, storage, prisma } = await setup({ allowWork: false });
    const err = await rejected(service.draftOne('t', ACTIVITY, STUDENT));
    expect(err.getStatus()).toBe(403);
    expect(code(err)).toBe('AI_STUDENT_WORK_NOT_ALLOWED');
    expect(storage.getBuffer).not.toHaveBeenCalled();
    expect(prisma.submission.findUnique).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('the new allow-uploaded-files switch (off by default) is needed too', async () => {
    const { service, fetch, storage } = await setup({ allowFiles: false });
    const err = await rejected(service.draftOne('t', ACTIVITY, STUDENT));
    expect(code(err)).toBe('AI_STUDENT_FILES_NOT_ALLOWED');
    expect(storage.getBuffer).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const off = await setup();
    off.prisma.ai_school_setting.findUnique.mockResolvedValue(null);
    expect(code(await rejected(off.service.draftOne('t', ACTIVITY, STUDENT)))).toBe('AI_STUDENT_WORK_NOT_ALLOWED');
  });

  test('a student restricted from AI: 403, their files never read', async () => {
    const { service, fetch, storage } = await setup({ restricted: [STUDENT] });
    const err = await rejected(service.draftOne('t', ACTIVITY, STUDENT));
    expect(code(err)).toBe('AI_STUDENT_RESTRICTED');
    expect(storage.getBuffer).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('feature off => 403; not on the course => 404; quizzes refused', async () => {
    const off = await setup({ feature: false });
    expect((await rejected(off.service.draftOne('t', ACTIVITY, STUDENT))).getStatus()).toBe(403);
    const stranger = await setup();
    stranger.prisma.activity.findUnique.mockResolvedValue({ id: ACTIVITY, course_id: 'other', title: '', instructions: null, points: 1, kind: 'assignment', rubric_id: null });
    expect(await rejected(stranger.service.draftOne('t', ACTIVITY, STUDENT))).toBeInstanceOf(NotFoundException);
    const quiz = await setup({ kind: 'quiz' });
    expect(code(await rejected(quiz.service.draftOne('t', ACTIVITY, STUDENT)))).toBe('AI_NOT_ASSIGNMENT');
    expect(quiz.fetch).not.toHaveBeenCalled();
  });

  test('TAs (who may mark) can draft', async () => {
    const { service } = await setup({ role: 'ta' });
    expect((await service.draftOne('ta', ACTIVITY, STUDENT)).status).toBe('ready');
  });

  test('no provider => 409 AI_NO_PROVIDER', async () => {
    const { service, prisma } = await setup();
    prisma.ai_provider.findMany.mockResolvedValue([]);
    expect(code(await rejected(service.draftOne('t', ACTIVITY, STUDENT)))).toBe('AI_NO_PROVIDER');
  });
});

describe('one submission', () => {
  test('reads the .docx, redacts names and emails, sends text only, stores a score draft with checked evidence', async () => {
    const { service, calls, prisma } = await setup();
    const out = await service.draftOne('t', ACTIVITY, STUDENT);
    const sent = sentText(calls);
    for (const s of ['Amelia', 'Okafor', 'Ben Ng', 'a.okafor@example.com']) expect(sent).not.toContain(s);
    expect(sent).toContain('[Student]');
    expect(sent).toContain('[Classmate]');
    expect(sent).toContain('[email]');
    expect(sent).toContain('school should start later');
    expect(sent).toContain('<student_work>');
    expect(out.status).toBe('ready');
    expect(out.files).toEqual([{ fileId: 'f1', name: 'essay.docx', status: 'read', reason: null, chars: expect.any(Number), pages: null }]);
    expect(out.draft).toMatchObject({
      mode: 'score',
      score: 14,
      points: 20,
      requirements: [{ requirement: 'State a position', status: 'met', comment: 'Clear, Amelia.', evidence: ['school should start later'] }],
      feedback: 'Good work, Amelia.',
      feedbackEvidence: ['teenagers need more sleep'],
      evidenceDropped: 1,
    });
    expect(out.note).toContain('review before using');
    // Logged as one request; nothing about marks written.
    expect(prisma.ai_request.create.mock.calls[0][0].data.feature).toBe('ai_file_grading');
    expect(prisma.submission.update).not.toHaveBeenCalled();
    expect(prisma.submission.upsert).not.toHaveBeenCalled();
    expect(prisma.rubric_assessment.createMany).not.toHaveBeenCalled();
    // The extracted text is never stored on the draft.
    const stored = JSON.stringify(prisma.ai_grading_draft.updateMany.mock.calls.map((c: any) => c[0].data));
    expect(stored).not.toContain('teenagers need more sleep. Ben');
  });

  test('with a rubric: levels mapped back to ids, ids never sent', async () => {
    const answer = {
      criteria: [{ criterion: 'c1', level: 'c1-r1', comment: 'Strong.', evidence: ['teenagers need more sleep'] }],
      feedback: 'Fine.',
      feedbackEvidence: [],
    };
    const { service, calls } = await setup({ rubric: true, answer });
    const out = await service.draftOne('t', ACTIVITY, STUDENT);
    expect(sentText(calls)).not.toContain('crit-1');
    expect(out.draft).toMatchObject({ mode: 'rubric', suggestedTotal: 10, criteria: [{ criterionId: 'crit-1', ratingId: 'rat-1', points: 10, evidence: ['teenagers need more sleep'] }] });
  });

  test('images, scans, infected and unfinished files are reported and never fetched; nothing readable => failed, nothing sent', async () => {
    const { service, fetch, storage } = await setup({
      files: [
        { id: 'f1', name: 'photo.jpg', content_type: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff]) },
        { id: 'f2', name: 'virus.pdf', content_type: 'application/pdf', status: 'infected' },
        { id: 'f3', name: 'up.pdf', content_type: 'application/pdf', status: 'scanning' },
        { id: 'f4', name: 'huge.txt', content_type: 'text/plain', size_bytes: 50 * 1024 * 1024 },
      ],
    });
    const out = await service.draftOne('t', ACTIVITY, STUDENT);
    expect(out.status).toBe('failed');
    expect(out.errorCode).toBe('NOTHING_READABLE');
    expect(out.files.map((f) => [f.name, f.status])).toEqual([
      ['photo.jpg', 'unreadable'],
      ['virus.pdf', 'skipped'],
      ['up.pdf', 'skipped'],
      ['huge.txt', 'unreadable'],
    ]);
    expect(out.files[1].reason).toContain('malware');
    expect(storage.getBuffer).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test('long work is cut to AI_MAX_SUBMISSION_CHARS with a marker, and the file says truncated', async () => {
    process.env.AI_MAX_SUBMISSION_CHARS = '1000';
    try {
      const long = `${ESSAY} ${'More words about sleep and school. '.repeat(100)}`;
      const { service, calls } = await setup({ files: [{ id: 'f1', name: 'long.md', content_type: 'text/markdown', body: Buffer.from(long) }] });
      const out = await service.draftOne('t', ACTIVITY, STUDENT);
      expect(out.truncated).toBe(true);
      expect(out.files[0].status).toBe('truncated');
      expect(out.charsSent).toBeLessThanOrEqual(1000);
      expect(sentText(calls)).toContain('was cut here');
    } finally {
      delete process.env.AI_MAX_SUBMISSION_CHARS;
    }
  });

  test('a provider error is recorded on the draft and answered', async () => {
    const { service, row } = await setup({ answer: { nonsense: true } });
    const err = await rejected(service.draftOne('t', ACTIVITY, STUDENT));
    expect(code(err)).toBe('AI_INVALID_OUTPUT');
    expect(row()).toMatchObject({ status: 'failed', error_code: 'AI_INVALID_OUTPUT' });
  });

  test('discard deletes only that draft', async () => {
    const { service, prisma } = await setup();
    await service.discard('t', ACTIVITY, STUDENT);
    expect(prisma.ai_grading_draft.deleteMany.mock.calls[0][0]).toEqual({ where: { activity_id: ACTIVITY, student_id: STUDENT } });
  });
});

describe('batch', () => {
  function roster(prisma: MockPrisma) {
    prisma.submission.findMany.mockImplementation(async ({ select }: any) =>
      select.student
        ? [
            { id: 'sub-1', student_id: STUDENT, status: 'submitted', text_body: null, file_id: null, submitted_at: SUBMITTED, score: null, excused: false, student: { first_name: 'Amelia', last_name: 'Okafor' } },
            { id: 'sub-2', student_id: STUDENT2, status: 'submitted', text_body: 'typed', file_id: null, submitted_at: SUBMITTED, score: null, excused: false, student: { first_name: 'Ben', last_name: 'Ng' } },
            { id: 'sub-3', student_id: 'graded-one', status: 'graded', text_body: 'x', file_id: null, submitted_at: SUBMITTED, score: 5, excused: false, student: null },
            { id: 'sub-4', student_id: 'not-in', status: 'draft', text_body: 'x', file_id: null, submitted_at: null, score: null, excused: false, student: null },
          ]
        : [
            { id: 'sub-1', student_id: STUDENT, submitted_at: SUBMITTED },
            { id: 'sub-2', student_id: STUDENT2, submitted_at: SUBMITTED },
          ],
    );
    prisma.submission_file.findMany.mockResolvedValue([
      { submission_id: 'sub-1', file: { name: 'essay.pdf', content_type: 'application/pdf', size_bytes: 1000, status: 'ready', deleted_at: null } },
      { submission_id: 'sub-1', file: { name: 'photo.png', content_type: 'image/png', size_bytes: 1000, status: 'ready', deleted_at: null } },
    ]);
  }

  test('preview counts ungraded handed-in work, files and characters, and names the provider; restricted students skipped', async () => {
    const { service, prisma, fetch } = await setup({ restricted: [STUDENT2] });
    roster(prisma);
    const p = await service.batchPreview('t', ACTIVITY);
    expect(p.provider).toEqual({ name: 'Local LLM', model: 'llama3.3', host: 'llm.example.org' });
    expect(p.submissions).toBe(1);
    expect(p.files).toBe(1);
    expect(p.maxChars).toBe(1000);
    expect(p.alreadyGraded).toBe(1);
    expect(p.skipped).toEqual([{ studentId: STUDENT2, name: 'Ben Ng', code: 'AI_STUDENT_RESTRICTED', reason: expect.any(String) }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('start: one queued draft per submission, skipped rows for restricted students, audited, jobs enqueued', async () => {
    const { service, prisma, audit, enqueued } = await setup({ restricted: [STUDENT2] });
    roster(prisma);
    prisma.ai_grading_batch.findFirst.mockImplementation(async ({ where }: any) =>
      where.status === 'running' ? null : { id: 'batch-1', status: 'running', provider_name: 'Local LLM', model: 'llama3.3', total: 1, files: 1, created_at: new Date(), finished_at: null, cancelled_at: null },
    );
    prisma.ai_grading_batch.create.mockResolvedValue({ id: 'batch-1' });
    prisma.ai_grading_draft.findMany.mockImplementation(async ({ where }: any) => (where.batch_id ? [{ id: 'd-1' }] : []));
    prisma.ai_grading_draft.groupBy.mockResolvedValue([{ status: 'queued', _count: { _all: 1 } }, { status: 'skipped', _count: { _all: 1 } }]);
    const out = await service.startBatch('t', ACTIVITY, 1);
    const rows = prisma.ai_grading_draft.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => [r.student_id, r.status, r.error_code ?? null])).toEqual([
      [STUDENT, 'queued', null],
      [STUDENT2, 'skipped', 'AI_STUDENT_RESTRICTED'],
    ]);
    expect(enqueued).toEqual(['d-1']);
    expect((audit.record.mock.calls[0] as any)[3]).toMatchObject({ entity: 'ai_grading_batch', action: 'create' });
    expect(out.counts).toMatchObject({ queued: 1, skipped: 1 });
  });

  test('start refuses a changed count (409) and a second running batch (409)', async () => {
    const changed = await setup();
    roster(changed.prisma);
    expect(code(await rejected(changed.service.startBatch('t', ACTIVITY, 5)))).toBe('AI_BATCH_CHANGED');
    const running = await setup();
    roster(running.prisma);
    running.prisma.ai_grading_batch.findFirst.mockResolvedValue({ id: 'b' });
    expect(code(await rejected(running.service.startBatch('t', ACTIVITY, 2)))).toBe('AI_BATCH_RUNNING');
  });

  test('cancel: queued drafts cancelled, batch marked, audited', async () => {
    const { service, prisma, audit } = await setup();
    prisma.ai_grading_batch.findFirst.mockResolvedValue({ id: 'batch-1', status: 'running', provider_name: 'x', model: 'm', total: 2, files: 2, created_at: new Date(), finished_at: null, cancelled_at: null });
    prisma.ai_grading_draft.updateMany.mockResolvedValue({ count: 2 });
    await service.cancelBatch('t', ACTIVITY, 'batch-1');
    expect(prisma.ai_grading_draft.updateMany.mock.calls[0][0]).toMatchObject({ where: { batch_id: 'batch-1', status: 'queued' }, data: { status: 'cancelled' } });
    expect(prisma.ai_grading_batch.update.mock.calls[0][0].data).toMatchObject({ status: 'cancelled', cancelled_by: 't' });
    expect((audit.record.mock.calls[0] as any)[3]).toMatchObject({ entity: 'ai_grading_batch', action: 'update' });
  });

  test('a job: a cancelled draft is a no-op; a claimed draft in a cancelled batch is cancelled', async () => {
    const { service, prisma, fetch } = await setup();
    prisma.ai_grading_draft.updateMany.mockResolvedValueOnce({ count: 0 });
    await service.process('d-1');
    expect(fetch).not.toHaveBeenCalled();
    prisma.ai_grading_draft.updateMany.mockResolvedValue({ count: 1 });
    prisma.ai_grading_draft.findUnique.mockResolvedValue({ id: 'd-1', activity_id: ACTIVITY, student_id: STUDENT, batch_id: 'b', created_by: 't', batch: { status: 'cancelled' } });
    await service.process('d-1');
    expect(fetch).not.toHaveBeenCalled();
    expect(prisma.ai_grading_draft.updateMany.mock.calls.at(-1)![0].data.status).toBe('cancelled');
  });

  test('a job re-checks: a student restricted since, or work marked since, is skipped without sending', async () => {
    const { service, prisma, fetch } = await setup({ restricted: [STUDENT] });
    prisma.ai_grading_draft.findUnique.mockResolvedValue({ id: 'd-1', activity_id: ACTIVITY, student_id: STUDENT, batch_id: 'b', created_by: 't', batch: { status: 'running' } });
    await service.process('d-1');
    expect(prisma.ai_grading_draft.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ status: 'skipped', error_code: 'AI_STUDENT_RESTRICTED' });
    const graded = await setup();
    graded.prisma.ai_grading_draft.findUnique.mockResolvedValue({ id: 'd-1', activity_id: ACTIVITY, student_id: STUDENT, batch_id: null, created_by: 't', batch: null });
    graded.prisma.submission.findUnique.mockResolvedValue({ id: 's', student_id: STUDENT, status: 'graded', text_body: null, file_id: null, submitted_at: SUBMITTED, score: 3, excused: false });
    await graded.service.process('d-1');
    expect(graded.prisma.ai_grading_draft.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ status: 'skipped', error_code: 'ALREADY_GRADED' });
    expect(fetch).not.toHaveBeenCalled();
    expect(graded.fetch).not.toHaveBeenCalled();
  });

  test('the batch closes when no draft is left queued or running; stuck drafts are failed by the sweep', async () => {
    const { service, prisma } = await setup({ restricted: [STUDENT] });
    prisma.ai_grading_draft.findUnique.mockResolvedValue({ id: 'd-1', activity_id: ACTIVITY, student_id: STUDENT, batch_id: 'b', created_by: 't', batch: { status: 'running' } });
    prisma.ai_grading_draft.count.mockResolvedValue(0);
    await service.process('d-1');
    expect(prisma.ai_grading_batch.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'b', status: 'running' }, data: { status: 'done' } });
    prisma.ai_grading_draft.findMany.mockResolvedValue([{ id: 'x', batch_id: null }]);
    expect(await service.sweepStuck()).toBe(1);
    expect(prisma.ai_grading_draft.updateMany.mock.calls.at(-1)![0].data).toMatchObject({ status: 'failed', error_code: 'INTERRUPTED' });
  });

  test('inline queue runs jobs after the request, a few at a time', async () => {
    const processed: string[] = [];
    const grading = { process: mock(async (id: string) => void processed.push(id)) } as any;
    const q = new AiFileGradingQueueService(grading);
    q.onModuleInit();
    await grading.enqueue('a');
    await grading.enqueue('b');
    expect(processed).toEqual([]);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(processed.sort()).toEqual(['a', 'b']);
    expect(q.mode).toBe('inline');
  });
});
