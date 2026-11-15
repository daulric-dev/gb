import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@/generated/prisma/client';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FeatureGuard } from '@/features/feature.guard';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { FEATURE_KEY } from '@/features/require-feature.decorator';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';
import { StudentGuard } from '@/student-portal/student.guard';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { MasteryCourseController, MasterySchoolController, PortalMasteryController } from './mastery.controller';
import { MasteryService } from './mastery.service';
import { OutcomeService } from './outcome.service';

/** Course access as CourseAccessService answers it: no role 404, too little 403. */
function stubAccess(role: 'teacher' | 'ta' | null = 'teacher', schoolId = 'school-1') {
  return {
    require: async (_u: string, courseId: string, roles: readonly string[]) => {
      if (!role) throw new NotFoundException('Course not found');
      if (!roles.includes(role)) throw new ForbiddenException('Only the course teacher can do that');
      return { course: { id: courseId, school_id: schoolId, name: 'Maths', code: 'MA1' }, role };
    },
  };
}

function outcomes(role: 'teacher' | 'ta' | null = 'teacher', setup: (p: MockPrisma) => void = () => {}) {
  const prisma = createMockPrisma();
  setup(prisma);
  return { prisma, service: new OutcomeService(prisma as any, stubAccess(role) as any) };
}

describe('alignment permissions', () => {
  const ok = (p: MockPrisma) => {
    p.outcome.findFirst.mockResolvedValue({ id: 'out-1', archived_at: null, outcome_set: { archived_at: null } });
    p.activity.findFirst.mockResolvedValue({ id: 'act-1' });
  };

  test('the teacher aligns an activity; evidence for existing marks is worked out at once', async () => {
    const { prisma, service } = outcomes('teacher', ok);
    await service.align('user-1', 'course-1', { outcomeId: 'out-1', activityId: 'act-1' });
    expect(prisma.outcome_alignment.create.mock.calls[0][0].data).toMatchObject({
      outcome_id: 'out-1',
      course_id: 'course-1',
      activity_id: 'act-1',
      criterion_id: null,
      question_id: null,
    });
    // The evidence refresh ran for that activity.
    expect(prisma.activity.findUnique.mock.calls.some((c: any) => c[0].where.id === 'act-1')).toBe(true);
  });

  test('a TA reads but cannot align (403); someone outside the course gets 404', async () => {
    const ta = outcomes('ta', ok);
    expect(await expectRejection(ta.service.align('u', 'course-1', { outcomeId: 'out-1', activityId: 'act-1' }))).toBeInstanceOf(
      ForbiddenException,
    );
    expect(ta.prisma.outcome_alignment.create).not.toHaveBeenCalled();
    await ta.service.courseOutcomes('u', 'course-1');
    const none = outcomes(null, ok);
    expect(await expectRejection(none.service.align('u', 'course-1', { outcomeId: 'out-1', activityId: 'act-1' }))).toBeInstanceOf(
      NotFoundException,
    );
  });

  test('the outcome must be this course\'s own or a school outcome of the course\'s school', async () => {
    const { prisma, service } = outcomes('teacher', (p) => p.activity.findFirst.mockResolvedValue({ id: 'act-1' }));
    expect(await expectRejection(service.align('u', 'course-1', { outcomeId: 'other', activityId: 'act-1' }))).toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.outcome.findFirst.mock.calls[0][0].where).toEqual({
      id: 'other',
      school_id: 'school-1',
      OR: [{ course_id: 'course-1' }, { set_id: { not: null } }],
    });
  });

  test('archived outcomes (or sets) cannot be aligned', async () => {
    const { service } = outcomes('teacher', (p) => {
      p.outcome.findFirst.mockResolvedValue({ id: 'out-1', archived_at: null, outcome_set: { archived_at: new Date() } });
    });
    expect(await expectRejection(service.align('u', 'course-1', { outcomeId: 'out-1', activityId: 'act-1' }))).toBeInstanceOf(
      BadRequestException,
    );
  });

  test('exactly one target; targets must be in the course', async () => {
    const { prisma, service } = outcomes('teacher', (p) =>
      p.outcome.findFirst.mockResolvedValue({ id: 'out-1', archived_at: null, outcome_set: null }),
    );
    expect(
      await expectRejection(service.align('u', 'course-1', { outcomeId: 'out-1', activityId: 'a', criterionId: 'c' })),
    ).toBeInstanceOf(BadRequestException);
    expect(await expectRejection(service.align('u', 'course-1', { outcomeId: 'out-1' }))).toBeInstanceOf(BadRequestException);
    expect(await expectRejection(service.align('u', 'course-1', { outcomeId: 'out-1', activityId: 'elsewhere' }))).toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.activity.findFirst.mock.calls[0][0].where).toEqual({ id: 'elsewhere', course_id: 'course-1' });
    expect(await expectRejection(service.align('u', 'course-1', { outcomeId: 'out-1', criterionId: 'c9' }))).toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.rubric_criterion.findFirst.mock.calls[0][0].where).toEqual({ id: 'c9', rubric: { course_id: 'course-1' } });
    expect(await expectRejection(service.align('u', 'course-1', { outcomeId: 'out-1', questionId: 'q9' }))).toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.quiz_question.findFirst.mock.calls[0][0].where).toEqual({
      id: 'q9',
      OR: [{ activity: { course_id: 'course-1' } }, { question_bank: { course_id: 'course-1' } }],
    });
  });

  test('a duplicate alignment is a 409', async () => {
    const { service } = outcomes('teacher', (p) => {
      ok(p);
      p.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }),
      );
    });
    expect(await expectRejection(service.align('u', 'course-1', { outcomeId: 'out-1', activityId: 'act-1' }))).toBeInstanceOf(
      ConflictException,
    );
  });

  test('removing an alignment is scoped to the course', async () => {
    const { prisma, service } = outcomes('teacher');
    expect(await expectRejection(service.unalign('u', 'course-1', 'al-x'))).toBeInstanceOf(NotFoundException);
    expect(prisma.outcome_alignment.findFirst.mock.calls[0][0].where).toEqual({ id: 'al-x', course_id: 'course-1' });
    expect(prisma.outcome_alignment.deleteMany).not.toHaveBeenCalled();
  });
});

describe('outcome sets: cross-school isolation and archiving', () => {
  test('another school\'s set or outcome is a 404', async () => {
    const { prisma, service } = outcomes();
    expect(await expectRejection(service.getSet('school-2', 'set-1'))).toBeInstanceOf(NotFoundException);
    expect(prisma.outcome_set.findFirst.mock.calls[0][0].where).toEqual({ id: 'set-1', school_id: 'school-2' });
    expect(await expectRejection(service.updateSchoolOutcome('u', 'school-2', 'set-1', 'out-1', { title: 'x' }))).toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.outcome.findFirst.mock.calls[0][0].where).toEqual({ id: 'out-1', set_id: 'set-1', school_id: 'school-2' });
  });

  test('sets are listed for the caller\'s school only', async () => {
    const { prisma, service } = outcomes();
    await service.listSets('school-1', false);
    expect(prisma.outcome_set.findMany.mock.calls[0][0].where).toEqual({ school_id: 'school-1', archived_at: null });
  });

  test('an outcome with evidence is never hard-deleted (409); archiving works', async () => {
    const row = {
      id: 'out-1', set_id: 'set-1', course_id: null, parent_id: null, code: 'A', title: 'A',
      description: null, subject: null, grade_level: null, position: 0, archived_at: null,
    };
    const { prisma, service } = outcomes('teacher', (p) => {
      p.outcome.findFirst.mockResolvedValue(row);
      p.outcome_evidence.count.mockResolvedValue(3);
      p.outcome.update.mockImplementation(async ({ data }: any) => ({ ...row, ...data }));
    });
    expect(await expectRejection(service.removeSchoolOutcome('u', 'school-1', 'set-1', 'out-1'))).toBeInstanceOf(ConflictException);
    expect(prisma.outcome.delete).not.toHaveBeenCalled();
    const archived = await service.updateSchoolOutcome('u', 'school-1', 'set-1', 'out-1', { archived: true });
    expect(archived.archived).toBe(true);
  });

  test('a set with evidence cannot be deleted', async () => {
    const { prisma, service } = outcomes('teacher', (p) => {
      p.outcome_set.findFirst.mockResolvedValue({ id: 'set-1' });
      p.outcome_evidence.count.mockResolvedValue(1);
    });
    expect(await expectRejection(service.removeSet('u', 'school-1', 'set-1'))).toBeInstanceOf(ConflictException);
    expect(prisma.outcome_set.delete).not.toHaveBeenCalled();
  });

  test('a course outcome is managed by the course teacher only and scoped to the course', async () => {
    const ta = outcomes('ta');
    expect(await expectRejection(ta.service.createCourseOutcome('u', 'course-1', { code: 'C', title: 'T' }))).toBeInstanceOf(
      ForbiddenException,
    );
    const { prisma, service } = outcomes('teacher');
    prisma.outcome.create.mockImplementation(async ({ data }: any) => ({ id: 'o', set_id: null, parent_id: null, position: 0, archived_at: null, description: null, subject: null, grade_level: null, ...data }));
    const created = await service.createCourseOutcome('u', 'course-1', { code: ' C1 ', title: ' Fractions ' });
    expect(prisma.outcome.create.mock.calls[0][0].data).toMatchObject({ school_id: 'school-1', course_id: 'course-1', code: 'C1', title: 'Fractions' });
    expect(created.courseId).toBe('course-1');
    expect(await expectRejection(service.updateCourseOutcome('u', 'course-1', 'not-mine', { title: 'x' }))).toBeInstanceOf(
      NotFoundException,
    );
  });

  test('a parent must be in the same set', async () => {
    const { service } = outcomes('teacher', (p) => p.outcome_set.findFirst.mockResolvedValue({ id: 'set-1' }));
    expect(
      await expectRejection(service.createSchoolOutcome('u', 'school-1', 'set-1', { code: 'A', title: 'A', parentId: 'elsewhere' })),
    ).toBeInstanceOf(BadRequestException);
  });

  test('CSV import: errors refuse the whole file; a dry run reports them', async () => {
    const { prisma, service } = outcomes();
    const bad = 'code,title,parent_code\nA,One,Z\n';
    const dry: any = await service.importCsv('u', 'school-1', { csv: bad, title: 'Set', dryRun: true });
    expect(dry.errors[0].message).toMatch(/Parent Z/);
    expect(await expectRejection(service.importCsv('u', 'school-1', { csv: bad, title: 'Set' }))).toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.outcome_set.create).not.toHaveBeenCalled();
  });

  test('CSV import creates the set and outcomes, parents first', async () => {
    const { prisma, service } = outcomes('teacher', (p) => {
      p.outcome_set.create.mockResolvedValue({ id: 'set-new' });
      p.outcome_set.findFirst.mockResolvedValue({ id: 'set-new', title: 'Maths', description: null, source: 'CSV import', archived_at: null });
      let n = 0;
      p.outcome.create.mockImplementation(async () => ({ id: `o${++n}` }));
    });
    const out: any = await service.importCsv('u', 'school-1', {
      csv: 'code,title,parent_code\nM.1.a,Child,M.1\nM.1,Root,\n',
      title: 'Maths',
    });
    expect(out.created).toBe(2);
    expect(prisma.outcome_set.create.mock.calls[0][0].data).toMatchObject({ school_id: 'school-1', title: 'Maths', source: 'CSV import' });
    const data = prisma.outcome.create.mock.calls.map((c: any) => c[0].data);
    expect(data[0]).toMatchObject({ code: 'M.1', parent_id: null, school_id: 'school-1', set_id: 'set-new' });
    expect(data[1]).toMatchObject({ code: 'M.1.a', parent_id: 'o1' });
  });
});

describe('MasteryService', () => {
  function mastery(setup: (p: MockPrisma) => void = () => {}, role: 'teacher' | 'ta' | null = 'teacher') {
    const prisma = createMockPrisma();
    setup(prisma);
    return { prisma, service: new MasteryService(prisma as any, stubAccess(role) as any) };
  }

  test('settings: editable labels and count; a threshold above the top level is a 400', async () => {
    const { prisma, service } = mastery();
    const out = await service.updateSettings('u', 'school-1', { levels: ['Not yet', 'Approaching', 'Meeting'], masteryThreshold: 3 });
    expect(out.levels).toEqual([
      { value: 1, label: 'Not yet' },
      { value: 2, label: 'Approaching' },
      { value: 3, label: 'Meeting' },
    ]);
    // Bands spread evenly for the new count.
    expect(out.scoreBands.map((b) => b.level)).toEqual([1, 2, 3]);
    expect(prisma.mastery_setting.upsert.mock.calls[0][0].where).toEqual({ school_id: 'school-1' });
    const { service: s2 } = mastery();
    expect(await expectRejection(s2.updateSettings('u', 'school-1', { levels: ['A', 'B'], masteryThreshold: 3 }))).toBeInstanceOf(
      BadRequestException,
    );
  });

  const STUDENTS = [
    { student: { id: 'stu-1', first_name: 'Ada', last_name: 'Lovelace', student_number: '=1+1' } },
    { student: { id: 'stu-2', first_name: 'Alan', last_name: 'Turing', student_number: null } },
  ];
  const gridSetup = (p: MockPrisma) => {
    p.outcome.findMany.mockImplementation(async ({ where }: any) =>
      where.course_id
        ? [{ id: 'own', code: '=SUM(A1)', title: 'Course outcome', description: null, set_id: null, course_id: 'course-1', parent_id: null, archived_at: null, position: 0, outcome_set: null }]
        : [{ id: 'sch', code: 'MA.1', title: 'Fractions', description: null, set_id: 'set-1', course_id: null, parent_id: null, archived_at: null, position: 0, outcome_set: { title: 'Framework' } }],
    );
    p.outcome_alignment.findMany.mockResolvedValue([{ outcome_id: 'sch' }]);
    p.course_student.findMany.mockResolvedValue(STUDENTS);
    p.outcome_evidence.findMany.mockImplementation(async ({ distinct }: any) =>
      distinct
        ? []
        : [
            { id: 'e1', outcome_id: 'sch', student_id: 'stu-1', course_id: 'course-1', activity_id: 'a', source: 'activity', ratio: 0.5, rating_rank: null, rating_count: null, assessed_at: new Date('2026-10-01') },
            { id: 'e2', outcome_id: 'sch', student_id: 'stu-1', course_id: 'course-1', activity_id: 'b', source: 'activity', ratio: 0.95, rating_rank: null, rating_count: null, assessed_at: new Date('2026-10-02') },
          ],
    );
  };

  test('grid: students × outcomes with labels, the decaying average, and access by course role', async () => {
    const { prisma, service } = mastery(gridSetup);
    const grid = await service.grid('u', 'course-1');
    expect(grid.outcomes.map((o) => o.id)).toEqual(['own', 'sch']);
    const ada = grid.students.find((s) => s.id === 'stu-1')!;
    const cell = ada.cells.find((c) => c.outcomeId === 'sch')!;
    // 2 then 4 at 0.65: 0.35×2 + 0.65×4 = 3.3 → Proficient, mastered.
    expect(cell).toMatchObject({ score: 3.3, level: 3, label: 'Proficient', mastered: true, status: 'mastered', evidenceCount: 2 });
    expect(ada.cells.find((c) => c.outcomeId === 'own')).toMatchObject({ status: 'no_evidence', label: null });
    // Evidence is read for this course and its roster only.
    const evq = prisma.outcome_evidence.findMany.mock.calls.find((c: any) => !c[0].distinct)![0];
    expect(evq.where).toEqual({ course_id: 'course-1', student_id: { in: ['stu-1', 'stu-2'] } });
    const outsider = mastery(gridSetup, null);
    expect(await expectRejection(outsider.service.grid('u', 'course-1'))).toBeInstanceOf(NotFoundException);
  });

  test('export CSV is formula-safe', async () => {
    const { service } = mastery(gridSetup);
    const { csv, filename } = await service.exportCsv('u', 'course-1');
    expect(filename).toBe('MA1-mastery.csv');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain("'=SUM(A1) Course outcome");
    expect(lines[1]).toContain("'=1+1");
    expect(lines[1]).toContain('Proficient (3.3) mastered');
  });
});

// ── feature and permission gating ─────────────────────────────────────────

function guardFor(disabled: string[], orgFeatures: Record<string, boolean> = { mastery: true }) {
  const prisma = createMockPrisma();
  prisma.organisation.findFirst.mockResolvedValue({ features: orgFeatures });
  prisma.school.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === 'school-1' ? { disabled_feature_rows: disabled.map((feature) => ({ feature })) } : null,
  );
  prisma.course.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1', account_type: 'staff' });
  const features = new FeatureService(prisma as any, createMockCacheService() as any);
  return new FeatureGuard(new Reflector(), features, prisma as any);
}

function context(controller: any, method: string, request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => controller.prototype[method],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

const methods = (c: any) => Object.getOwnPropertyNames(c.prototype).filter((m) => m !== 'constructor' && m !== 'school');

describe('mastery feature flag (default off)', () => {
  const cases: [any, any][] = [
    [MasterySchoolController, { user: { id: 'u1' }, params: {} }],
    [MasteryCourseController, { user: { id: 'u1' }, params: { courseId: 'c1' } }],
    [PortalMasteryController, { user: { id: 'stu' }, student: { studentId: 'r1', schoolId: 'school-1' }, params: {} }],
  ];
  for (const [controller, req] of cases) {
    for (const method of methods(controller)) {
      test(`${controller.name}.${method}: 403 FEATURE_DISABLED unless on`, async () => {
        expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(FeatureGuard);
        expect(Reflect.getMetadata(FEATURE_KEY, controller)).toEqual(['mastery']);
        expect(await guardFor([]).canActivate(context(controller, method, req))).toBe(true);
        for (const guard of [guardFor(['mastery']), guardFor([], {})]) {
          const err: any = await expectRejection(guard.canActivate(context(controller, method, req)));
          expect(err).toBeInstanceOf(FeatureDisabledException);
          expect(err.getResponse()).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'mastery' });
        }
      });
    }
  }

  test('the portal route is a student route; school routes carry school:read / school:update', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PortalMasteryController)).toContain(StudentGuard);
    const perm = (m: string) => Reflect.getMetadata(PERMISSION_KEY, (MasterySchoolController.prototype as any)[m]);
    for (const m of ['settings', 'sets', 'set']) expect(perm(m)).toBe('school:read');
    for (const m of ['updateSettings', 'createSet', 'importSet', 'updateSet', 'removeSet', 'createOutcome', 'updateOutcome', 'removeOutcome']) {
      expect(perm(m)).toBe('school:update');
    }
  });
});
