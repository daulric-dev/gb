import { describe, expect, test } from 'bun:test';
import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ParentGuard } from './parent.guard';
import { ParentLinkController, ParentPortalController } from './parent-portal.controller';
import { StudentParentsController } from './parent-staff.controller';
import { FeatureGuard } from '@/features/feature.guard';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { AuthGuard } from '@/auth/auth.guard';
import { AdminGuard } from '@/auth/admin.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { StudentGuard } from '@/student-portal/student.guard';
import { StudentPortalController } from '@/student-portal/student-portal.controller';
import { StudentController } from '@/student/student.controller';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const CHILD = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const PARENT = 'parent-1';

function context(controller: any, method: string, request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => controller.prototype[method],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

/**
 * A parent linked to CHILD at school-1. `org` is the organisation's feature
 * overrides, `disabled` the school's opt-outs.
 */
function setup(
  opts: {
    org?: Record<string, boolean>;
    disabled?: string[];
    accountType?: string;
    settings?: Record<string, unknown>;
    dob?: Date | null;
  } = {},
) {
  const prisma: MockPrisma = createMockPrisma();
  prisma.organisation.findFirst.mockResolvedValue({
    features: opts.org ?? { parent_portal: true, parent_notifications: true },
  });
  prisma.school.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === 'school-1' ? { disabled_feature_rows: (opts.disabled ?? []).map((feature) => ({ feature })) } : null,
  );
  prisma.user_profile.findUnique.mockResolvedValue({
    account_type: opts.accountType ?? 'parent',
    is_active: true,
    school_id: null,
    role: null,
  });
  prisma.parent_student_link.findFirst.mockImplementation(async ({ where }: any) =>
    where.user_profile_id === PARENT && where.student_id === CHILD
      ? {
          student: {
            id: CHILD,
            school_id: 'school-1',
            is_active: true,
            date_of_birth: opts.dob ?? null,
            school: { parent_settings: opts.settings ?? {}, is_active: true },
          },
        }
      : null,
  );
  prisma.parent_student_link.findMany.mockResolvedValue([
    { student: { school_id: 'school-1' } },
  ]);
  const features = new FeatureService(prisma as any, createMockCacheService() as any);
  const parentGuard = new ParentGuard(prisma as any, features);
  const featureGuard = new FeatureGuard(new Reflector(), features, prisma as any);
  return { prisma, parentGuard, featureGuard };
}

/** Run ParentGuard then FeatureGuard, as the controller does. */
async function run(
  s: ReturnType<typeof setup>,
  controller: any,
  method: string,
  params: Record<string, string> = {},
) {
  const req: any = { user: { id: PARENT }, params };
  const ctx = context(controller, method, req);
  await s.parentGuard.canActivate(ctx);
  await s.featureGuard.canActivate(ctx);
  return req;
}

const PARENT_ROUTES: [string, Record<string, string>][] = [
  ['children', {}],
  ['overview', { studentId: CHILD }],
  ['courses', { studentId: CHILD }],
  ['grades', { studentId: CHILD, courseId: 'c1' }],
  ['work', { studentId: CHILD }],
  ['attendance', { studentId: CHILD }],
  ['announcements', { studentId: CHILD }],
  ['getPrefs', {}],
  ['setPrefs', {}],
];

describe('parent routes are guarded', () => {
  test('every parent route runs AuthGuard, ParentGuard and FeatureGuard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, ParentPortalController);
    expect(guards).toEqual([AuthGuard, ParentGuard, FeatureGuard]);
    for (const [method] of PARENT_ROUTES) {
      expect(typeof (ParentPortalController.prototype as any)[method]).toBe('function');
    }
    // Every method on the controller is covered by the list above.
    const methods = Object.getOwnPropertyNames(ParentPortalController.prototype).filter(
      (m) => m !== 'constructor',
    );
    expect(methods.sort()).toEqual(PARENT_ROUTES.map(([m]) => m).sort());
  });

  for (const [method, params] of PARENT_ROUTES) {
    test(`${method}: 403 FEATURE_DISABLED with parent_portal off at the organisation`, async () => {
      const s = setup({ org: { parent_portal: false } });
      const err: any = await expectRejection(run(s, ParentPortalController, method, params));
      expect(err).toBeInstanceOf(FeatureDisabledException);
      expect(err.getResponse()).toMatchObject({ statusCode: 403, code: 'FEATURE_DISABLED' });
    });

    test(`${method}: 403 FEATURE_DISABLED when the school switched parent_portal off`, async () => {
      const s = setup({ disabled: ['parent_portal'] });
      const err: any = await expectRejection(run(s, ParentPortalController, method, params));
      expect(err).toBeInstanceOf(FeatureDisabledException);
      expect(err.getResponse()).toMatchObject({ code: 'FEATURE_DISABLED' });
    });

    test(`${method}: allowed with the features on`, async () => {
      const s = setup();
      const req = await run(s, ParentPortalController, method, params);
      expect(req.parent.userId).toBe(PARENT);
    });
  }

  test('notification preferences need parent_notifications too', async () => {
    const s = setup({ org: { parent_portal: true, parent_notifications: false } });
    const err: any = await expectRejection(run(s, ParentPortalController, 'getPrefs'));
    expect(err.getResponse()).toMatchObject({ code: 'FEATURE_DISABLED', feature: 'parent_notifications' });
  });

  test('staff parent-link routes need parent_portal for the active school', async () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, StudentParentsController);
    expect(guards).toEqual([AuthGuard, PermissionGuard, FeatureGuard]);
    const s = setup({ org: { parent_portal: false } });
    s.prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1', account_type: 'staff' });
    const err: any = await expectRejection(
      s.featureGuard.canActivate(
        context(StudentParentsController, 'list', { user: { id: 'staff-1' }, params: { studentId: CHILD } }),
      ),
    );
    expect(err).toBeInstanceOf(FeatureDisabledException);
  });

  test('redeeming is open to any signed-in user (it is how an account becomes a parent)', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ParentLinkController)).toEqual([AuthGuard]);
  });
});

describe('ParentGuard', () => {
  test('pins the linked child and its school', async () => {
    const s = setup();
    const req = await run(s, ParentPortalController, 'overview', { studentId: CHILD });
    expect(req.parent).toEqual({ userId: PARENT, studentId: CHILD, schoolId: 'school-1' });
    expect(s.prisma.parent_student_link.findFirst.mock.calls[0][0].where).toEqual({
      user_profile_id: PARENT,
      student_id: CHILD,
    });
  });

  test("another family's child (IDOR) is a 404 on every child route", async () => {
    for (const [method, params] of PARENT_ROUTES.filter(([, p]) => p.studentId)) {
      const s = setup();
      const err = await expectRejection(
        run(s, ParentPortalController, method, { ...params, studentId: OTHER }),
      );
      expect(err).toBeInstanceOf(NotFoundException);
    }
  });

  test('a malformed id is a 404 without a query', async () => {
    const s = setup();
    const err = await expectRejection(
      run(s, ParentPortalController, 'overview', { studentId: "1' OR 1=1" }),
    );
    expect(err).toBeInstanceOf(NotFoundException);
    expect(s.prisma.parent_student_link.findFirst).not.toHaveBeenCalled();
  });

  test('staff and student accounts are refused', async () => {
    for (const accountType of ['staff', 'student']) {
      const s = setup({ accountType });
      const err = await expectRejection(run(s, ParentPortalController, 'children'));
      expect(err).toBeInstanceOf(ForbiddenException);
    }
  });

  test('a child at or over the school age limit is a 404', async () => {
    const s = setup({ settings: { maxStudentAge: 16 }, dob: new Date('2000-01-01') });
    const err = await expectRejection(
      run(s, ParentPortalController, 'overview', { studentId: CHILD }),
    );
    expect(err).toBeInstanceOf(NotFoundException);
  });

  test('without a child, a school with the portal on is picked for the feature check', async () => {
    const s = setup();
    s.prisma.parent_student_link.findMany.mockResolvedValue([
      { student: { school_id: 'school-off' } },
      { student: { school_id: 'school-1' } },
    ]);
    s.prisma.school.findUnique.mockImplementation(async ({ where }: any) => ({
      disabled_feature_rows: (where.id === 'school-off' ? ['parent_portal'] : []).map((feature) => ({ feature })),
    }));
    const req = await run(s, ParentPortalController, 'children');
    expect(req.parent.schoolId).toBe('school-1');
  });
});

describe('a parent account cannot use staff or student routes', () => {
  const parentProfile = { account_type: 'parent', is_active: true, school_id: null, role: null };

  test('StudentGuard refuses a parent (student portal)', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue(parentProfile);
    const guard = new StudentGuard(prisma as any, createMockCacheService() as any);
    const err = await expectRejection(
      guard.canActivate(context(StudentPortalController, 'me', { user: { id: PARENT } })),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test('PermissionGuard refuses a parent (no school, no membership)', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue(parentProfile);
    const guard = new PermissionGuard(new Reflector(), createMockCacheService() as any, prisma as any);
    const err = await expectRejection(
      guard.canActivate(context(StudentController, 'findOne', { user: { id: PARENT }, params: { id: CHILD } })),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test("PermissionGuard refuses a parent even on a school's own route", async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue(parentProfile);
    prisma.school_management.findUnique.mockResolvedValue(null);
    prisma.school_management.findFirst.mockResolvedValue(null);
    const guard = new PermissionGuard(new Reflector(), createMockCacheService() as any, prisma as any);
    const err = await expectRejection(
      guard.canActivate(
        context(StudentParentsController, 'list', { user: { id: PARENT }, params: { schoolId: 'school-1', studentId: CHILD } }),
      ),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
  });

  test('AdminGuard refuses a parent', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue(parentProfile);
    const guard = new AdminGuard(prisma as any);
    const err = await expectRejection(
      guard.canActivate(context(StudentController, 'findOne', { user: { id: PARENT } })),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
  });
});
