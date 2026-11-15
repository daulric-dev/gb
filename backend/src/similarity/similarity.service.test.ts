import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SimilarityService, matchingOnly } from './similarity.service';
import { fingerprint } from './fingerprint';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const ESSAY = Array.from({ length: 80 }, (_, i) => `word${i % 37} token${i}`).join(' ');

interface Options {
  role?: string | null;
  feature?: boolean;
  /** Course ids the caller is staff in (default: course-1 only). */
  staffIn?: string[];
}

function build(setup: (prisma: MockPrisma) => void = () => {}, opts: Options = {}) {
  const role = opts.role === undefined ? 'teacher' : opts.role;
  const staffIn = opts.staffIn ?? ['course-1'];
  const prisma = createMockPrisma();
  prisma.activity.findUnique.mockResolvedValue({
    id: 'act-1',
    course_id: 'course-1',
    title: 'Essay',
    instructions: null,
  });
  setup(prisma);
  const access = {
    require: async (_u: string, courseId: string, roles: readonly string[]) => {
      if (!role || !staffIn.includes(courseId)) throw new NotFoundException('Course not found');
      if (!roles.includes(role)) throw new ForbiddenException('nope');
      return { course: { id: courseId, school_id: 'school-1' }, role };
    },
  };
  const features = {
    assertEnabled: async () => {
      if (opts.feature === false) throw new ForbiddenException('FEATURE_DISABLED');
    },
    isEnabled: async () => opts.feature !== false,
  };
  const service = new SimilarityService(prisma as any, access as any, features as any);
  return { service, prisma };
}

const SUBMISSION = {
  id: 'sub-1',
  activity_id: 'act-1',
  student_id: 'stu-1',
  text_body: ESSAY,
  submitted_at: new Date(),
  status: 'submitted',
  activity: {
    kind: 'assignment',
    instructions: 'Write an essay',
    course_id: 'course-1',
    course: { school_id: 'school-1', term_id: null },
  },
};

describe('the check job', () => {
  test('fingerprints the text and records matches both ways, only above the floor', async () => {
    const { service, prisma } = build((p) => {
      p.submission.findUnique.mockResolvedValue(SUBMISSION);
      p.similarity_fingerprint.upsert.mockResolvedValue({ id: 'fp-1' });
      p.similarity_fingerprint.findMany.mockResolvedValue([
        { id: 'fp-2', hashes: fingerprint(ESSAY, ['Write an essay'])!.hashes.map((hash) => ({ hash })) },
      ]);
    });
    const out = await service.process('sub-1');
    expect(out).toEqual({ parts: 1, computed: 1 });
    const data = prisma.similarity_match.createMany.mock.calls[0][0].data;
    expect(data).toEqual([
      expect.objectContaining({ fingerprint_id: 'fp-1', other_id: 'fp-2', score: 100 }),
      expect.objectContaining({ fingerprint_id: 'fp-2', other_id: 'fp-1', score: 100 }),
    ]);
    // Candidates are limited to the school, never the same student.
    const where = prisma.similarity_fingerprint.findMany.mock.calls[0][0].where;
    expect(where.school_id).toBe('school-1');
    expect(where.submission.student_id).toEqual({ not: 'stu-1' });
    expect(where.hashes.some.hash.in.length).toBeGreaterThan(0);
  });

  test('is idempotent: an unchanged text is not recomputed', async () => {
    const fp = fingerprint(ESSAY, ['Write an essay'])!;
    const { service, prisma } = build((p) => {
      p.submission.findUnique.mockResolvedValue(SUBMISSION);
      p.similarity_fingerprint.findUnique.mockResolvedValue({ id: 'fp-1', text_hash: fp.textHash });
    });
    expect(await service.process('sub-1')).toEqual({ parts: 1, computed: 0 });
    expect(prisma.similarity_fingerprint.upsert).not.toHaveBeenCalled();
  });

  test('a short text is skipped and loses any old fingerprint', async () => {
    const { service, prisma } = build((p) => {
      p.submission.findUnique.mockResolvedValue({ ...SUBMISSION, text_body: 'Too short to matter.' });
    });
    expect(await service.process('sub-1')).toEqual({ parts: 0, computed: 0 });
    expect(prisma.similarity_fingerprint.deleteMany.mock.calls[0][0].where).toEqual({
      submission_id: 'sub-1',
      part: { notIn: [] },
    });
  });

  test('a student restricted from the check (no_similarity) is not fingerprinted, and loses old fingerprints', async () => {
    const { service, prisma } = build((p) => {
      p.submission.findUnique.mockResolvedValue(SUBMISSION);
      p.student_restriction.findMany.mockResolvedValue([{ student_id: 'stu-1' }]);
    });
    expect(await service.process('sub-1')).toEqual({ parts: 0, computed: 0 });
    expect(prisma.student_restriction.findMany.mock.calls[0][0].where).toMatchObject({
      student_id: { in: ['stu-1'] },
      no_similarity: true,
    });
    expect(prisma.similarity_fingerprint.upsert).not.toHaveBeenCalled();
    expect(prisma.similarity_fingerprint.deleteMany.mock.calls[0][0].where).toEqual({
      submission_id: 'sub-1',
      part: { notIn: [] },
    });
  });

  test('does nothing while the feature is off for the school', async () => {
    const { service, prisma } = build((p) => p.submission.findUnique.mockResolvedValue(SUBMISSION), {
      feature: false,
    });
    expect(await service.process('sub-1')).toEqual({ parts: 0, computed: 0 });
    expect(prisma.similarity_fingerprint.upsert).not.toHaveBeenCalled();
  });
});

describe('teacher views', () => {
  test('roster markers use the school threshold and stay inside the school', async () => {
    const { service, prisma } = build((p) => {
      p.similarity_setting.findUnique.mockResolvedValue({ pool: 'activity', pool_terms: 2, threshold: 60 });
      p.similarity_match.findMany.mockResolvedValue([
        { score: 72.4, other_id: 'fp-2', fingerprint: { submission_id: 'sub-1', submission: { student_id: 'stu-1' } } },
        { score: 65, other_id: 'fp-3', fingerprint: { submission_id: 'sub-1', submission: { student_id: 'stu-1' } } },
      ]);
    });
    const out = await service.activityFlags('teacher-1', 'act-1');
    expect(out.threshold).toBe(60);
    expect(out.flags).toEqual([{ submissionId: 'sub-1', studentId: 'stu-1', count: 2, maxScore: 72 }]);
    const where = prisma.similarity_match.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      score: { gte: 60 },
      fingerprint: { activity_id: 'act-1', school_id: 'school-1' },
      other: { school_id: 'school-1' },
    });
    expect(out.note).toContain('not proof');
  });

  test('the default threshold is 40%', async () => {
    const { service, prisma } = build();
    await service.activityFlags('teacher-1', 'act-1');
    expect(prisma.similarity_match.findMany.mock.calls[0][0].where.score).toEqual({ gte: 40 });
  });

  test('a student (no staff role) gets a 404; the feature off is a 403', async () => {
    await expect(build(() => {}, { role: null }).service.activityFlags('stu-user', 'act-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(build(() => {}, { feature: false }).service.activityFlags('t', 'act-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  test('a match reaching into another school is refused', async () => {
    const { service } = build((p) => {
      p.similarity_match.findUnique.mockResolvedValue({
        score: 90,
        fingerprint: { activity_id: 'act-1', school_id: 'school-1', submission_id: 'sub-1', part: '' },
        other: { school_id: 'school-2', submission_id: 'sub-9', part: '', course_id: 'course-9' },
      });
    });
    await expect(service.compare('t', 'act-1', 'fp-1', 'fp-9')).rejects.toBeInstanceOf(NotFoundException);
  });

  test('a match from another activity cannot be opened through this one', async () => {
    const { service } = build((p) => {
      p.similarity_match.findUnique.mockResolvedValue({
        score: 90,
        fingerprint: { activity_id: 'act-2', school_id: 'school-1', submission_id: 'sub-1', part: '' },
        other: { school_id: 'school-1', submission_id: 'sub-2', part: '', course_id: 'course-1' },
      });
    });
    await expect(service.compare('t', 'act-1', 'fp-1', 'fp-2')).rejects.toBeInstanceOf(NotFoundException);
  });

  test("another course's work shows only the shared passages, with no name", async () => {
    const { service } = build((p) => {
      p.similarity_match.findUnique.mockResolvedValue({
        score: 80,
        fingerprint: { activity_id: 'act-1', school_id: 'school-1', submission_id: 'sub-1', part: '' },
        other: { school_id: 'school-1', submission_id: 'sub-2', part: '', course_id: 'course-2' },
      });
      p.submission.findUnique.mockImplementation(async ({ where }: any) => ({
        text_body: where.id === 'sub-1' ? `Mine first. ${ESSAY}` : `Private words here. ${ESSAY}`,
        student: { first_name: where.id === 'sub-1' ? 'Ada' : 'Other', last_name: 'Kid' },
        activity: { title: 'Essay', instructions: null, course: { name: 'History' } },
      }));
    });
    const out = await service.compare('t', 'act-1', 'fp-1', 'fp-2');
    expect(out.left.studentName).toBe('Ada Kid');
    expect(out.right.studentName).toBeNull();
    expect(out.right.canView).toBe(false);
    expect(JSON.stringify(out.right)).not.toContain('Private words');
  });
});

test('matchingOnly keeps shared passages and elides the rest', () => {
  expect(
    matchingOnly([
      { text: 'secret ', match: false },
      { text: 'shared', match: true },
      { text: ' more secret', match: false },
    ]),
  ).toEqual([
    { text: ' … ', match: false },
    { text: 'shared', match: true },
    { text: ' … ', match: false },
  ]);
});

test('no student route reaches similarity data', () => {
  // Student-facing code (portal, parent portal, peer review's portal
  // controller, the grading mappers students read) never touches it.
  const root = join(__dirname, '..');
  const files = [
    ...readdirSync(join(root, 'student-portal')).map((f) => join(root, 'student-portal', f)),
    ...readdirSync(join(root, 'parent-portal'), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(root, 'parent-portal', f)),
    join(root, 'peer-review', 'portal-peer-review.controller.ts'),
    join(root, 'peer-review', 'peer-review.service.ts'),
    join(root, 'grading', 'activity.mapper.ts'),
  ].filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  for (const file of files) {
    expect({ file, uses: /similarity/i.test(readFileSync(file, 'utf8')) }).toEqual({ file, uses: false });
  }
  // The similarity controllers are staff-only: no StudentGuard, no portal path.
  const controller = readFileSync(join(__dirname, 'similarity.controller.ts'), 'utf8');
  expect(controller).not.toContain('StudentGuard');
  expect(controller).not.toContain("'portal");
});
