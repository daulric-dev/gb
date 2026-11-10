import { describe, expect, test } from 'bun:test';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FeatureGuard } from '@/features/feature.guard';
import { FeatureService } from '@/features/feature.service';
import { FeatureDisabledException } from '@/features/feature-disabled.exception';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import {
  CourseTimetableController,
  MyTimetableController,
  PortalTimetableController,
  SchoolTimetableController,
} from './timetable.controller';
import {
  AttendanceAlertController,
  AttendanceReportController,
  CourseAttendanceReportController,
} from '@/attendance-alerts/attendance-alerts.controller';

function context(controller: any, method: string, request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => controller.prototype[method],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

function guardFor(org: Record<string, boolean>, disabled: string[] = []) {
  const prisma = createMockPrisma();
  prisma.organisation.findFirst.mockResolvedValue({ features: org });
  prisma.school.findUnique.mockImplementation(async ({ where }) =>
    where.id === 'school-1' ? { disabled_features: disabled } : null,
  );
  prisma.course.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1', account_type: 'staff' });
  return new FeatureGuard(new Reflector(), new FeatureService(prisma as any, createMockCacheService() as any), prisma as any);
}

const staff = { user: { id: 'u1' }, params: {} };
const inCourse = { user: { id: 'u1' }, params: { courseId: 'c1' } };
const student = { user: { id: 'stu' }, student: { studentId: 'r1', schoolId: 'school-1' }, params: {} };

const cases: [string, any, string, any, string][] = [
  ['school timetable setup', SchoolTimetableController, 'setup', staff, 'timetable'],
  ['rooms', SchoolTimetableController, 'createRoom', staff, 'timetable'],
  ['course timetable', CourseTimetableController, 'create', inCourse, 'timetable'],
  ['cancel / move', CourseTimetableController, 'override', inCourse, 'timetable'],
  ['staff today', MyTimetableController, 'mine', staff, 'timetable'],
  ['student timetable', PortalTimetableController, 'mine', student, 'timetable'],
  ['school report', AttendanceReportController, 'school', staff, 'attendance_alerts'],
  ['report CSV', AttendanceReportController, 'schoolCsv', staff, 'attendance_alerts'],
  ['student report', AttendanceReportController, 'student', staff, 'attendance_alerts'],
  ['course report', CourseAttendanceReportController, 'get', inCourse, 'attendance_alerts'],
  ['alerts', AttendanceAlertController, 'list', staff, 'attendance_alerts'],
  ['alert settings', AttendanceAlertController, 'updateSettings', staff, 'attendance_alerts'],
];

describe('timetable and attendance alerts are feature-gated (default off)', () => {
  for (const [name, controller, method, request, feature] of cases) {
    test(`${name}: off by default, on when the organisation turns ${feature} on, off without attendance`, async () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      expect(guards).toContain(FeatureGuard);
      const ctx = context(controller, method, request);

      const byDefault: any = await expectRejection(guardFor({}).canActivate(ctx));
      expect(byDefault).toBeInstanceOf(FeatureDisabledException);
      expect(byDefault.getResponse()).toMatchObject({ code: 'FEATURE_DISABLED', feature });

      expect(await guardFor({ [feature]: true }).canActivate(ctx)).toBe(true);

      // Requires attendance: a school that turned attendance off loses it.
      const noAttendance: any = await expectRejection(guardFor({ [feature]: true }, ['attendance']).canActivate(ctx));
      expect(noAttendance).toBeInstanceOf(FeatureDisabledException);
    });
  }
});
