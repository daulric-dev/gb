import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PeerReviewService } from './peer-review.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const NOW = new Date('2026-11-25T12:00:00Z');
const DUE = new Date('2026-11-20T12:00:00Z');
const CLOSES = new Date('2026-11-30T12:00:00Z');

const ACTIVITY = {
  id: 'act-1',
  course_id: 'course-1',
  kind: 'assignment',
  title: 'Essay',
  instructions: 'Write about rivers',
  status: 'published',
  due_at: DUE,
};

const SETTING = {
  activity_id: 'act-1',
  enabled: true,
  reviews_per_student: 2,
  anonymous: true,
  open_mode: 'after_due',
  closes_at: CLOSES,
  rubric_id: null,
  quality_points: null,
  quality_activity_id: null,
  seed: 'seed',
  started_at: DUE,
  ready_notified_at: null,
};

/** stu-2 reviews stu-1's submission (sub-1). */
const ALLOCATION = {
  id: 'alloc-1',
  activity_id: 'act-1',
  submission_id: 'sub-1',
  reviewer_id: 'stu-2',
  comment: 'Good start',
  rubric_marks: [],
  submitted_at: null,
  hidden: false,
  hidden_reason: null,
  hidden_at: null,
  created_at: DUE,
  updated_at: DUE,
};

interface Options {
  role?: string | null;
  enrolled?: boolean;
  feature?: boolean;
  setting?: Record<string, unknown> | null;
}

function build(setup: (prisma: MockPrisma) => void = () => {}, opts: Options = {}) {
  const role = opts.role === undefined ? 'teacher' : opts.role;
  const prisma = createMockPrisma();
  prisma.activity.findUnique.mockResolvedValue(ACTIVITY);
  prisma.peer_review_setting.findUnique.mockResolvedValue(
    opts.setting === undefined ? SETTING : opts.setting,
  );
  prisma.peer_review_allocation.findUnique.mockResolvedValue(ALLOCATION);
  prisma.submission.findUnique.mockResolvedValue({
    id: 'sub-1',
    student_id: 'stu-1',
    text_body: 'My essay about rivers',
    file_id: null,
  });
  prisma.student.findMany.mockResolvedValue([
    { id: 'stu-1', first_name: 'Ada', last_name: 'Author' },
    { id: 'stu-2', first_name: 'Rex', last_name: 'Reviewer' },
  ]);
  setup(prisma);
  const audits: any[][] = [];
  const notices: any[][] = [];
  const access = {
    require: async (_u: string, courseId: string, roles: readonly string[]) => {
      if (!role) throw new NotFoundException('Course not found');
      if (!roles.includes(role)) throw new ForbiddenException('nope');
      return { course: { id: courseId, school_id: 'school-1' }, role };
    },
    requireStudent: async (_s: string, courseId: string) => {
      if (opts.enrolled === false) throw new NotFoundException('Course not found');
      return { id: courseId, school_id: 'school-1' };
    },
  };
  const features = {
    assertEnabled: async () => {
      if (opts.feature === false) throw new ForbiddenException('FEATURE_DISABLED');
    },
    isEnabled: async () => opts.feature !== false,
  };
  const files = {
    readContentForAuthorisedCaller: async (id: string) => ({
      body: Buffer.from('x'),
      size: 1,
      contentType: 'application/pdf',
      filename: `real-name-${id}.pdf`,
    }),
  };
  const notifications = {
    peerReviewAssigned: async (...args: any[]) => void notices.push(['assigned', ...args]),
    peerReviewsReady: async (...args: any[]) => void notices.push(['ready', ...args]),
  };
  const auditLog = { record: async (...args: any[]) => void audits.push(args) };
  const service = new PeerReviewService(
    prisma as any,
    access as any,
    files as any,
    features as any,
    notifications as any,
    auditLog as any,
  );
  return { service, prisma, audits, notices };
}

describe('reviewer access (IDOR)', () => {
  test('only the assigned reviewer can open a review; anyone else gets a 404', async () => {
    const { service } = build();
    await expect(service.reviewForStudent('stu-3', 'alloc-1', NOW)).rejects.toBeInstanceOf(NotFoundException);
    // The author cannot open the review of their own work either.
    await expect(service.reviewForStudent('stu-1', 'alloc-1', NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.saveReview('stu-3', 'alloc-1', { comment: 'x' }, NOW)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.readReviewFile('stu-3', 'alloc-1', 'file-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  test('a reviewer no longer in the course gets a 404', async () => {
    const { service } = build(() => {}, { enrolled: false });
    await expect(service.reviewForStudent('stu-2', 'alloc-1', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  test('a file must belong to the reviewed submission', async () => {
    const { service } = build((p) => {
      p.submission_file.findMany.mockResolvedValue([
        { file: { id: 'file-1', name: 'Ada Author essay.pdf', content_type: 'application/pdf' } },
      ]);
    });
    // A file id from elsewhere (another student's work) is not served.
    await expect(service.readReviewFile('stu-2', 'alloc-1', 'file-9')).rejects.toBeInstanceOf(NotFoundException);
    const file = await service.readReviewFile('stu-2', 'alloc-1', 'file-1');
    // Anonymous: the author's name in the file name is not passed on.
    expect(file.filename).toBe('Attachment 1.pdf');
  });

  test('anonymous review: the reviewer never sees the author', async () => {
    const { service } = build((p) => {
      p.submission_file.findMany.mockResolvedValue([
        { file: { id: 'file-1', name: 'Ada Author essay.pdf', content_type: 'application/pdf' } },
      ]);
    });
    const view = await service.reviewForStudent('stu-2', 'alloc-1', NOW);
    expect(view.author).toBeNull();
    expect(JSON.stringify(view)).not.toContain('Ada');
    expect(view.submission.files[0].name).toBe('Attachment 1.pdf');
    expect(view.canEdit).toBe(true);
  });

  test('named review: the reviewer sees the author', async () => {
    const { service } = build(() => {}, { setting: { ...SETTING, anonymous: false } });
    const view = await service.reviewForStudent('stu-2', 'alloc-1', NOW);
    expect(view.author).toBe('Ada Author');
  });

  test('the review cannot be opened before the window opens', async () => {
    const { service } = build(() => {}, { setting: { ...SETTING, started_at: null, open_mode: 'manual' } });
    await expect(service.reviewForStudent('stu-2', 'alloc-1', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  test('peer review switched off for the activity hides it', async () => {
    const { service } = build(() => {}, { setting: { ...SETTING, enabled: false } });
    await expect(service.reviewForStudent('stu-2', 'alloc-1', NOW)).rejects.toBeInstanceOf(NotFoundException);
    expect(await service.activityForStudent('stu-2', 'act-1', NOW)).toEqual({ enabled: false });
  });
});

describe('window enforcement', () => {
  test('a review can be saved and handed in while open, and edited after', async () => {
    const { service, prisma } = build();
    prisma.peer_review_allocation.update.mockImplementation(async ({ data }: any) => ({ ...ALLOCATION, ...data }));
    const saved = await service.saveReview('stu-2', 'alloc-1', { comment: ' Clear argument ', submit: true }, NOW);
    expect(saved.comment).toBe('Clear argument');
    expect(saved.submittedAt).toBe(NOW.toISOString());
  });

  test('after the window closes, saving is refused', async () => {
    const { service } = build();
    const after = new Date(CLOSES.getTime() + 1000);
    await expect(service.saveReview('stu-2', 'alloc-1', { comment: 'late', submit: true }, after)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  test('a comment-only review needs a comment to be handed in', async () => {
    const { service } = build();
    await expect(service.saveReview('stu-2', 'alloc-1', { comment: '  ', submit: true }, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('what the author sees', () => {
  const received = [
    { ...ALLOCATION, id: 'alloc-2', reviewer_id: 'stu-2', submitted_at: NOW, comment: 'Nice' },
  ];

  test('nothing until the window closes', async () => {
    const { service } = build((p) => {
      p.peer_review_allocation.findMany.mockResolvedValue([]);
    });
    const view = await service.activityForStudent('stu-1', 'act-1', NOW);
    expect(view.enabled && view.received).toBeNull();
  });

  test('after it closes: submitted, not hidden, and anonymous when set', async () => {
    const after = new Date(CLOSES.getTime() + 1000);
    const { service, prisma } = build((p) => {
      p.submission.findUnique.mockResolvedValue({ id: 'sub-1' });
      p.peer_review_allocation.findMany.mockImplementation(async ({ where }: any) =>
        where.submission_id ? received : [],
      );
    });
    const view: any = await service.activityForStudent('stu-1', 'act-1', after);
    expect(view.state).toBe('closed');
    expect(view.received).toHaveLength(1);
    expect(view.received[0].reviewer).toBeNull();
    expect(JSON.stringify(view.received)).not.toContain('stu-2');
    expect(JSON.stringify(view.received)).not.toContain('Rex');
    const where = prisma.peer_review_allocation.findMany.mock.calls.find((c: any) => c[0].where.submission_id)![0].where;
    expect(where).toMatchObject({ submission_id: 'sub-1', hidden: false, submitted_at: { not: null } });
  });

  test('named reviews show the reviewer', async () => {
    const after = new Date(CLOSES.getTime() + 1000);
    const { service } = build(
      (p) => {
        p.submission.findUnique.mockResolvedValue({ id: 'sub-1' });
        p.peer_review_allocation.findMany.mockImplementation(async ({ where }: any) =>
          where.submission_id ? received : [],
        );
      },
      { setting: { ...SETTING, anonymous: false } },
    );
    const view: any = await service.activityForStudent('stu-1', 'act-1', after);
    expect(view.received[0].reviewer).toBe('Rex Reviewer');
  });
});

describe('hiding a review', () => {
  test('staff hide a review; it is audited', async () => {
    const { service, prisma, audits } = build();
    const out = await service.setHidden('teacher-1', 'act-1', 'alloc-1', { hidden: true, reason: 'Rude' });
    expect(out).toEqual({ id: 'alloc-1', hidden: true, hiddenReason: 'Rude' });
    expect(prisma.peer_review_allocation.update.mock.calls[0][0].data).toMatchObject({
      hidden: true,
      hidden_reason: 'Rude',
      hidden_by: 'teacher-1',
    });
    expect(audits[0][3]).toMatchObject({
      entity: 'peer_review_allocation',
      entityId: 'alloc-1',
      action: 'update',
      changes: { hidden: { before: false, after: true }, hiddenReason: { before: null, after: 'Rude' } },
    });
  });

  test('someone with no role in the course cannot hide (404)', async () => {
    const { service } = build(() => {}, { role: null });
    await expect(service.setHidden('stu-2', 'act-1', 'alloc-1', { hidden: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  test('a review from another activity is not found', async () => {
    const { service } = build((p) => {
      p.peer_review_allocation.findUnique.mockResolvedValue({ ...ALLOCATION, activity_id: 'act-9' });
    });
    await expect(service.setHidden('teacher-1', 'act-1', 'alloc-1', { hidden: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  test('with the feature off the staff routes answer 403', async () => {
    const { service } = build(() => {}, { feature: false });
    await expect(service.overview('teacher-1', 'act-1', NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('settings', () => {
  const input = {
    enabled: true,
    reviewsPerStudent: 2,
    anonymous: true,
    openMode: 'after_due' as const,
    closesAt: CLOSES.toISOString(),
  };

  test('assignments only; after the due date needs a due date', async () => {
    const quiz = build((p) => p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, kind: 'quiz' }), { setting: null });
    await expect(quiz.service.updateSettings('t', 'act-1', input, NOW)).rejects.toBeInstanceOf(BadRequestException);
    const undated = build((p) => p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, due_at: null }), { setting: null });
    await expect(undated.service.updateSettings('t', 'act-1', input, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  test('a TA cannot change settings', async () => {
    const { service } = build(() => {}, { role: 'ta', setting: null });
    await expect(service.updateSettings('t', 'act-1', input, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  test('once started, anonymity cannot be removed nor reviews per student lowered', async () => {
    const { service } = build();
    await expect(service.updateSettings('t', 'act-1', { ...input, anonymous: false }, NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.updateSettings('t', 'act-1', { ...input, reviewsPerStudent: 1 }, NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  test('review quality that counts creates a published offline column', async () => {
    const { service, prisma } = build(() => {}, { setting: null });
    prisma.activity.create.mockResolvedValue({ id: 'quality-1' });
    prisma.peer_review_setting.upsert.mockImplementation(async ({ create }: any) => ({
      ...SETTING,
      ...create,
      started_at: null,
    }));
    const future = new Date('2026-11-10T00:00:00Z');
    await service.updateSettings('t', 'act-1', { ...input, qualityPoints: 10 }, future);
    expect(prisma.activity.create.mock.calls[0][0].data).toMatchObject({
      course_id: 'course-1',
      kind: 'offline',
      title: 'Peer review: Essay',
      points: 10,
      status: 'published',
    });
    expect(prisma.peer_review_setting.upsert.mock.calls[0][0].create).toMatchObject({
      quality_activity_id: 'quality-1',
      quality_points: 10,
    });
  });
});

describe('allocation in the service', () => {
  test('submitters exclude excused, unsubmitted and dropped students', async () => {
    const { service, prisma } = build((p) => {
      p.submission.findMany.mockResolvedValue([
        { id: 'sub-1', student_id: 'stu-1' },
        { id: 'sub-2', student_id: 'stu-2' },
        { id: 'sub-3', student_id: 'stu-3' },
      ]);
      p.course_student.findMany.mockResolvedValue([{ student_id: 'stu-1' }, { student_id: 'stu-2' }]);
    });
    const list = await service.submitters(ACTIVITY);
    expect(list.map((s) => s.studentId)).toEqual(['stu-1', 'stu-2']);
    expect(prisma.submission.findMany.mock.calls[0][0].where).toMatchObject({
      excused: false,
      submitted_at: { not: null },
      status: { in: ['submitted', 'graded'] },
    });
    expect(prisma.course_student.findMany.mock.calls[0][0].where.status).toEqual({ not: 'dropped' });
  });

  test('opening the window stores the allocation, stamps the start and tells reviewers', async () => {
    const { service, prisma, notices } = build((p) => {
      p.submission.findMany.mockResolvedValue([
        { id: 'sub-1', student_id: 'stu-1' },
        { id: 'sub-2', student_id: 'stu-2' },
        { id: 'sub-3', student_id: 'stu-3' },
      ]);
      p.course_student.findMany.mockResolvedValue([
        { student_id: 'stu-1' },
        { student_id: 'stu-2' },
        { student_id: 'stu-3' },
      ]);
    });
    const reviewers = await service.allocateNow(ACTIVITY, { ...SETTING, started_at: null } as any, NOW);
    expect(reviewers.sort()).toEqual(['stu-1', 'stu-2', 'stu-3']);
    const rows = prisma.peer_review_allocation.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(6);
    const owner: Record<string, string> = { 'sub-1': 'stu-1', 'sub-2': 'stu-2', 'sub-3': 'stu-3' };
    for (const r of rows) expect(owner[r.submission_id]).not.toBe(r.reviewer_id);
    expect(prisma.peer_review_setting.update.mock.calls[0][0].data.started_at).toEqual(NOW);
    expect(prisma.job_lease.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'peer-review:activity:act-1' }),
    });
    expect(prisma.job_lease.updateMany).toHaveBeenCalledWith({
      where: { key: 'peer-review:activity:act-1', owner_token: expect.any(String) },
      // Taken and released outside the allocation transaction, on the real clock.
      data: { owner_token: null, expires_at: null, updated_at: expect.any(Date) },
    });
    expect(notices[0][0]).toBe('assigned');
  });

  test('a teacher cannot make a student review their own work', async () => {
    const { service } = build((p) => {
      p.submission.findUnique.mockResolvedValue({ id: 'sub-1', activity_id: 'act-1', student_id: 'stu-1' });
    });
    await expect(
      service.addAllocation('t', 'act-1', { reviewerId: 'stu-1', submissionId: 'sub-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('a review already handed in cannot be reassigned', async () => {
    const { service } = build((p) => {
      p.peer_review_allocation.findUnique.mockResolvedValue({ ...ALLOCATION, submitted_at: NOW });
    });
    await expect(service.reassign('t', 'act-1', 'alloc-1', 'stu-3')).rejects.toBeInstanceOf(ConflictException);
  });

  test('the sweep tells authors once the window has closed', async () => {
    const after = new Date(CLOSES.getTime() + 1000);
    const { service, prisma, notices } = build((p) => {
      p.peer_review_setting.findMany.mockImplementation(async ({ where }: any) =>
        where.ready_notified_at === null
          ? [{ activity_id: 'act-1', activity: { id: 'act-1', title: 'Essay', course_id: 'course-1', course: { school_id: 'school-1' } } }]
          : [],
      );
      p.peer_review_allocation.findMany.mockResolvedValue([
        { submission: { student_id: 'stu-1' } },
        { submission: { student_id: 'stu-1' } },
      ]);
    });
    const out = await service.sweep(after);
    expect(out.notified).toBe(1);
    expect(notices[0]).toEqual(['ready', 'course-1', expect.objectContaining({ id: 'act-1' }), ['stu-1']]);
    expect(prisma.peer_review_setting.update.mock.calls[0][0].data.ready_notified_at).toEqual(after);
  });
});
