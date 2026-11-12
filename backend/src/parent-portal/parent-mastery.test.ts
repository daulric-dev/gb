import { describe, expect, mock, test } from 'bun:test';
import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@/auth/auth.guard';
import { FeatureGuard } from '@/features/feature.guard';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { MasteryService } from '@/mastery/mastery.service';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { ParentGuard } from './parent.guard';
import { ParentMasteryController, ParentMasteryService } from './parent-mastery.controller';
import { DEFAULT_PARENT_SETTINGS, mergeParentSettings, parseParentSettings } from './parent-settings';

const CHILD = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SCHOOL = '77777777-7777-4777-8777-777777777777';
const PARENT = 'parent-1';

function context(request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ParentMasteryController.prototype.outcomes,
    getClass: () => ParentMasteryController,
  } as unknown as ExecutionContext;
}

function guards(opts: { org?: Record<string, boolean>; disabled?: string[] } = {}) {
  const prisma: MockPrisma = createMockPrisma();
  prisma.organisation.findFirst.mockResolvedValue({ features: opts.org ?? { parent_portal: true, mastery: true } });
  prisma.school.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === SCHOOL ? { disabled_feature_rows: (opts.disabled ?? []).map((feature) => ({ feature })) } : null,
  );
  prisma.user_profile.findUnique.mockResolvedValue({ account_type: 'parent', is_active: true });
  prisma.parent_student_link.findFirst.mockImplementation(async ({ where }: any) =>
    where.user_profile_id === PARENT && where.student_id === CHILD
      ? {
          student: {
            id: CHILD,
            school_id: SCHOOL,
            is_active: true,
            date_of_birth: null,
            school: { parent_settings: {}, is_active: true },
          },
        }
      : null,
  );
  const features = new FeatureService(prisma as any, createMockCacheService() as any);
  const parentGuard = new ParentGuard(prisma as any, features);
  const featureGuard = new FeatureGuard(new Reflector(), features, prisma as any);
  return async (studentId: string) => {
    const req: any = { user: { id: PARENT }, params: { studentId } };
    await parentGuard.canActivate(context(req));
    await featureGuard.canActivate(context(req));
    return req;
  };
}

describe('parent outcomes route', () => {
  test('AuthGuard, ParentGuard and FeatureGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ParentMasteryController)).toEqual([AuthGuard, ParentGuard, FeatureGuard]);
  });

  test('needs parent_portal and mastery (organisation and school)', async () => {
    for (const [opts, feature] of [
      [{ org: { parent_portal: false, mastery: true } }, 'parent_portal'],
      [{ org: { parent_portal: true } }, 'mastery'],
      [{ disabled: ['mastery'] }, 'mastery'],
    ] as const) {
      const err: any = await expectRejection(guards(opts as any)(CHILD));
      expect(err).toBeInstanceOf(FeatureDisabledException);
      expect(err.getResponse()).toMatchObject({ code: 'FEATURE_DISABLED', feature });
    }
    const req = await guards()(CHILD);
    expect(req.parent).toEqual({ userId: PARENT, studentId: CHILD, schoolId: SCHOOL });
  });

  test("another family's child is a 404", async () => {
    expect(await expectRejection(guards()(OTHER))).toBeInstanceOf(NotFoundException);
  });
});

describe('showMastery parent setting', () => {
  test('defaults off, unlike the other areas; parses and merges', () => {
    expect(DEFAULT_PARENT_SETTINGS.showMastery).toBe(false);
    expect(parseParentSettings({}).showMastery).toBe(false);
    expect(parseParentSettings({ showMastery: true }).showMastery).toBe(true);
    expect(parseParentSettings({ showMastery: 'yes' }).showMastery).toBe(false);
    expect(mergeParentSettings(DEFAULT_PARENT_SETTINGS, { showMastery: true })).toEqual({
      settings: { ...DEFAULT_PARENT_SETTINGS, showMastery: true },
    });
    expect(mergeParentSettings(DEFAULT_PARENT_SETTINGS, { showMastery: 1 })).toEqual({
      error: 'showMastery must be true or false',
    });
  });

  function service(settings: object) {
    const prisma = createMockPrisma();
    prisma.school.findUnique.mockResolvedValue({ parent_settings: settings });
    const studentOutcomes = mock(async (id: string) => ({ scale: {}, courses: [], id }));
    const svc = new ParentMasteryService(prisma as any, { studentOutcomes } as unknown as MasteryService);
    return { svc, studentOutcomes, prisma };
  }

  test('hidden (the default): 403 PARENT_VIEW_HIDDEN and nothing is read', async () => {
    const { svc, studentOutcomes } = service({});
    const err: any = await expectRejection(svc.outcomes({ studentId: CHILD, schoolId: SCHOOL }));
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: 'PARENT_VIEW_HIDDEN' });
    expect(studentOutcomes).not.toHaveBeenCalled();
  });

  test('shown: the guarded child only, read from the child\'s school setting', async () => {
    const { svc, studentOutcomes, prisma } = service({ showMastery: true });
    await svc.outcomes({ studentId: CHILD, schoolId: SCHOOL });
    expect(studentOutcomes.mock.calls[0][0]).toBe(CHILD);
    expect(prisma.school.findUnique.mock.calls[0][0].where).toEqual({ id: SCHOOL });
  });
});

describe('what a student (or parent) sees', () => {
  test('only their own evidence, in courses they see; never other students', async () => {
    const prisma = createMockPrisma();
    prisma.student.findUnique.mockResolvedValue({ school_id: SCHOOL });
    prisma.course_student.findMany.mockResolvedValue([{ course: { id: 'c1', name: 'Maths', code: null } }]);
    prisma.outcome.findMany.mockResolvedValue([
      { id: 'o1', code: 'A', title: 'A', description: null, set_id: null, course_id: 'c1', parent_id: null, archived_at: null, position: 0, outcome_set: null },
    ]);
    prisma.outcome_evidence.findMany.mockImplementation(async ({ distinct }: any) =>
      distinct
        ? []
        : [
            {
              id: 'e1', outcome_id: 'o1', student_id: CHILD, course_id: 'c1', activity_id: 'a1', source: 'rubric',
              ratio: 0.75, rating_rank: 2, rating_count: 4, assessed_at: new Date('2026-10-01T00:00:00Z'),
              activity: { title: 'Essay', kind: 'assignment' },
              outcome_alignment: { rubric_criterion: { title: 'Argument' }, quiz_question: null },
            },
          ],
    );
    const svc = new MasteryService(prisma as any, {} as any);
    const out = await svc.studentOutcomes(CHILD);
    expect(prisma.course_student.findMany.mock.calls[0][0].where).toEqual({
      student_id: CHILD,
      status: { not: 'dropped' },
      course: { status: { in: ['published', 'archived'] }, is_template: false, school_id: SCHOOL },
    });
    const evq = prisma.outcome_evidence.findMany.mock.calls.find((c: any) => !c[0].distinct)![0];
    expect(evq.where).toEqual({ student_id: CHILD, course_id: { in: ['c1'] } });
    const outcome = out.courses[0].outcomes[0];
    expect(outcome.mastery).toMatchObject({ label: 'Proficient', mastered: true });
    expect(outcome.evidence[0]).toEqual({
      id: 'e1',
      activityId: 'a1',
      activityTitle: 'Essay',
      source: 'rubric',
      detail: 'Argument',
      level: 3,
      label: 'Proficient',
      percent: 75,
      assessedAt: '2026-10-01T00:00:00.000Z',
    });
  });
});
