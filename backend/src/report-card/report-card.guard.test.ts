import { describe, expect, test } from 'bun:test';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FeatureGuard } from '@/features/feature.guard';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { FEATURE_KEY } from '@/features/require-feature.decorator';
import { PermissionGuard } from '@/permission/permission.guard';
import { StudentGuard } from '@/student-portal/student.guard';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import { ReportCommentController } from './report-comment.controller';
import { ReportReleaseController } from './report-release.controller';
import { PortalReportController } from './portal-report.controller';

function context(controller: any, method: string, request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => controller.prototype[method],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

function guardFor(disabled: string[], orgFeatures: Record<string, boolean> = {}) {
  const prisma = createMockPrisma();
  prisma.organisation.findFirst.mockResolvedValue({ features: orgFeatures });
  prisma.school.findUnique.mockImplementation(async ({ where }: any) =>
    where.id === 'school-1' ? { disabled_features: disabled } : null,
  );
  prisma.course.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1', account_type: 'staff' });
  const features = new FeatureService(prisma as any, createMockCacheService() as any);
  return new FeatureGuard(new Reflector(), features, prisma as any);
}

const staff = { user: { id: 'u1' }, params: {} };
const inCourse = { user: { id: 'u1' }, params: { courseId: 'c1' } };
const student = { user: { id: 'stu' }, student: { studentId: 'r1', schoolId: 'school-1' }, params: {} };

const ROUTES: [any, string, any][] = [
  [ReportCommentController, 'list', inCourse],
  [ReportCommentController, 'save', inCourse],
  ...[
    'terms',
    'overview',
    'update',
    'students',
    'headComments',
    'preview',
    'file',
    'publish',
    'unpublish',
    'regenerate',
    'zip',
    'transcript',
    'transcriptPdf',
  ].map((m) => [ReportReleaseController, m, staff] as [any, string, any]),
  ...['list', 'file', 'link', 'transcript', 'transcriptPdf'].map(
    (m) => [PortalReportController, m, student] as [any, string, any],
  ),
];

describe('report_cards feature flag', () => {
  for (const [controller, method, request] of ROUTES) {
    test(`${controller.name}.${method}: 403 FEATURE_DISABLED when off, allowed when on`, async () => {
      expect(typeof controller.prototype[method]).toBe('function');
      expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(FeatureGuard);
      expect(Reflect.getMetadata(FEATURE_KEY, controller)).toEqual(['report_cards']);

      expect(await guardFor([]).canActivate(context(controller, method, request))).toBe(true);

      for (const guard of [guardFor(['report_cards']), guardFor([], { report_cards: false })]) {
        const err: any = await expectRejection(guard.canActivate(context(controller, method, request)));
        expect(err).toBeInstanceOf(FeatureDisabledException);
        expect(err.getStatus()).toBe(403);
        expect(err.getResponse()).toMatchObject({ statusCode: 403, code: 'FEATURE_DISABLED', feature: 'report_cards' });
      }
    });
  }

  test('admin routes also need the report-card permission; portal routes need a student', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ReportReleaseController)).toContain(PermissionGuard);
    expect(Reflect.getMetadata(GUARDS_METADATA, PortalReportController)).toContain(StudentGuard);
    const perm = (m: string) =>
      Reflect.getMetadata('required_permission', ReportReleaseController.prototype[m as keyof ReportReleaseController]);
    for (const m of ['update', 'headComments', 'publish', 'unpublish', 'regenerate']) {
      expect(perm(m)).toBe('report-card:update');
    }
    for (const m of ['terms', 'overview', 'students', 'preview', 'file', 'zip', 'transcript', 'transcriptPdf']) {
      expect(perm(m)).toBe('report-card:read');
    }
  });
});
