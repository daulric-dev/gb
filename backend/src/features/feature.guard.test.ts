import { describe, expect, test } from 'bun:test';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FeatureGuard } from './feature.guard';
import { FeatureService } from './feature.service';
import { FeatureDisabledException } from './feature-disabled.exception';
import { createMockCacheService, expectRejection } from '@/test/mocks';
import { createMockPrisma } from '@/test/prisma-mock';
import { ChatController } from '@/chat/chat.controller';
import { PortalAttendanceController } from '@/attendance/portal-attendance.controller';
import { AttendanceController } from '@/attendance/attendance.controller';
import { AnnouncementController } from '@/announcement/announcement.controller';
import { CourseAnnouncementController } from '@/announcement/course-announcement.controller';
import { StudentPortalController } from '@/student-portal/student-portal.controller';
import { FileManagerController } from '@/file-manager/file-manager.controller';
import { CourseFileController } from '@/course/course-file.controller';
import { CalendarController, PortalCalendarController } from '@/calendar/calendar.controller';
import { CourseCopyController } from '@/course/course-copy.controller';
import { DiscussionController } from '@/discussion/discussion.controller';
import { PortalDiscussionController } from '@/discussion/portal-discussion.controller';

function context(controller: any, method: string, request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => controller.prototype[method],
    getClass: () => controller,
  } as unknown as ExecutionContext;
}

/** A guard over a school whose admin switched `disabled` off. */
function setup(disabled: string[] = [], orgFeatures: Record<string, boolean> = {}) {
  const prisma = createMockPrisma();
  prisma.organisation.findFirst.mockResolvedValue({ features: orgFeatures });
  prisma.school.findUnique.mockImplementation(async ({ where }) =>
    where.id === 'school-1' ? { disabled_feature_rows: disabled.map((feature) => ({ feature })) } : null,
  );
  prisma.course.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.user_profile.findUnique.mockResolvedValue({
    school_id: 'school-1',
    account_type: 'staff',
  });
  const features = new FeatureService(prisma as any, createMockCacheService() as any);
  const guard = new FeatureGuard(new Reflector(), features, prisma as any);
  return { prisma, guard };
}

const staff = { user: { id: 'u1' }, params: {} };
const inCourse = { user: { id: 'u1' }, params: { courseId: 'c1' } };
const student = { user: { id: 'stu' }, student: { studentId: 'r1', schoolId: 'school-1' }, params: {} };

async function refusal(promise: Promise<unknown>, feature: string) {
  const err: any = await expectRejection(promise);
  expect(err).toBeInstanceOf(FeatureDisabledException);
  expect(err.getStatus()).toBe(403);
  expect(err.getResponse()).toMatchObject({
    statusCode: 403,
    code: 'FEATURE_DISABLED',
    feature,
  });
  return err;
}

describe('FeatureGuard on representative routes', () => {
  const cases: [string, any, string, any, string][] = [
    ['chat conversations', ChatController, 'listConversations', staff, 'messaging'],
    ['portal attendance check-in', PortalAttendanceController, 'checkIn', student, 'attendance'],
    ['staff attendance', AttendanceController, 'open', inCourse, 'attendance'],
    ['school announcements', AnnouncementController, 'findAll', staff, 'announcements'],
    ['course announcements', CourseAnnouncementController, 'list', inCourse, 'announcements'],
    ['portal announcements', StudentPortalController, 'announcements', student, 'announcements'],
    ['portal school announcements', StudentPortalController, 'schoolAnnouncements', student, 'announcements'],
    ['file sharing', FileManagerController, 'share', staff, 'files'],
    ['file folders', FileManagerController, 'listFolders', staff, 'files'],
    ['staff calendar', CalendarController, 'list', staff, 'calendar'],
    ['calendar .ics', CalendarController, 'ics', staff, 'calendar'],
    ['portal calendar', PortalCalendarController, 'list', student, 'calendar'],
    ['course templates', CourseCopyController, 'templates', staff, 'course_copy'],
    ['course copy', CourseCopyController, 'copy', inCourse, 'course_copy'],
    ['discussions', DiscussionController, 'list', inCourse, 'discussions'],
    ['portal discussions', PortalDiscussionController, 'list', student, 'discussions'],
  ];

  for (const [name, controller, method, request, feature] of cases) {
    test(`${name}: 403 FEATURE_DISABLED when ${feature} is off, allowed when on`, async () => {
      expect(typeof controller.prototype[method]).toBe('function');
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      const methodGuards = Reflect.getMetadata(GUARDS_METADATA, controller.prototype[method]) ?? [];
      expect([...guards, ...methodGuards]).toContain(FeatureGuard);

      const on = setup();
      expect(await on.guard.canActivate(context(controller, method, request))).toBe(true);

      const off = setup([feature]);
      const err = await refusal(off.guard.canActivate(context(controller, method, request)), feature);
      expect(err.getResponse().message).toContain('is turned off for your school');
    });
  }

  test('creating a channel also needs chat_channels (off by default)', async () => {
    const { guard } = setup();
    await refusal(
      guard.canActivate(context(ChatController, 'createChannel', staff)),
      'chat_channels',
    );
    const on = setup([], { chat_channels: true });
    expect(await on.guard.canActivate(context(ChatController, 'createChannel', staff))).toBe(true);
  });

  test('an organisation switch applies to every school', async () => {
    const { guard } = setup([], { calendar: false });
    await refusal(guard.canActivate(context(CalendarController, 'list', staff)), 'calendar');
  });

  test('with files off, a teacher can still list and upload files for course content', async () => {
    const off = setup(['files']);
    for (const method of ['list', 'createUploadTicket']) {
      expect(await off.guard.canActivate(context(FileManagerController, method, staff))).toBe(true);
    }
  });

  test('course content files are not gated by the files feature', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, CourseFileController) ?? [];
    expect(guards).not.toContain(FeatureGuard);
  });

  test('school resolution: the course school for :courseId, the student school for students', async () => {
    const { prisma, guard } = setup();
    await guard.canActivate(context(AttendanceController, 'open', inCourse));
    expect(prisma.course.findUnique.mock.calls[0][0].where).toEqual({ id: 'c1' });

    const s = setup();
    await s.guard.canActivate(context(PortalAttendanceController, 'checkIn', student));
    expect(s.prisma.user_profile.findUnique).not.toHaveBeenCalled();
    expect(s.prisma.school.findUnique.mock.calls[0][0].where).toEqual({ id: 'school-1' });
  });

  test('is inert on routes without @RequireFeature', async () => {
    const { prisma, guard } = setup(['files']);
    class Plain {
      route() {}
    }
    expect(await guard.canActivate(context(Plain, 'route', staff))).toBe(true);
    expect(prisma.organisation.findFirst).not.toHaveBeenCalled();
  });
});
