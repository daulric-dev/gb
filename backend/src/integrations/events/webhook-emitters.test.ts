import { describe, expect, mock, test } from 'bun:test';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';
import { createMockCacheService } from '@/test/mocks';
import { createMockErasureLog } from '@/test/erasure-mocks';
import { CourseService } from '@/course/course.service';
import { CourseAccessService } from '@/course/access/course-access.service';
import { AnnouncementService } from '@/announcement/announcement.service';
import { SchoolService } from '@/school/school.service';
import { PermissionService } from '@/permission/permission.service';
import { StudentService } from '@/student/student.service';
import { StudentMembershipService } from '@/student-account/student-membership.service';
import { ActivityService } from '@/grading/activity.service';
import { SubmissionService } from '@/grading/submission.service';
import { AttendanceService } from '@/attendance/attendance.service';
import { validateEventData } from '@/integrations/events/webhook-event-types';

/**
 * Each wired service emits its event after the change, with data that
 * matches the event type's schema, through a recording stand-in for
 * WebhookEvents (whether anyone is subscribed is WebhookEvents' business,
 * tested in webhooks.test.ts).
 */

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';
const STUDENT = '55555555-5555-4555-8555-555555555555';
const ACTIVITY = '66666666-6666-4666-8666-666666666666';
const SESSION = '77777777-7777-4777-8777-777777777777';
const SUBMISSION = '88888888-8888-4888-8888-888888888888';
const MEMBERSHIP = '99999999-9999-4999-8999-999999999999';
const REQUEST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const person = (id: string) => ({ id, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@riverside.edu' });
const courseRef = { id: COURSE, name: 'Maths', code: 'MAT' };

function recorder() {
  const events: { type: string; schoolId?: string; courseId?: string; data: any }[] = [];
  const webhooks = {
    events,
    emit: mock(async (schoolId: string, type: string, data: any) => {
      const built = typeof data === 'function' ? await data() : data;
      if (built) events.push({ schoolId, type, data: built });
      return 1;
    }),
    emitForCourse: mock(async (courseId: string, type: string, build: any) => {
      const built = await build(courseRef);
      if (built) events.push({ courseId, type, data: built });
      return 1;
    }),
    student: async (id: string) => person(id),
    studentOfUser: async () => person(STUDENT),
    staff: async (id: string) => person(id),
    staffOrNull: async (id: string | null) => (id ? person(id) : null),
    activity: async (id: string) => ({ id, title: 'Essay', kind: 'assignment', points: 20 }),
  };
  return webhooks;
}

/** Fire-and-forget emissions settle over a few ticks. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

function expectEvent(webhooks: ReturnType<typeof recorder>, type: string) {
  const e = webhooks.events.find((x) => x.type === type);
  if (!e) throw new Error(`expected a ${type} event; got ${webhooks.events.map((x) => x.type).join(', ') || 'none'}`);
  expect(validateEventData(type, e.data)).toEqual([]);
  return e;
}

function courseRow(over: Record<string, any> = {}) {
  return {
    id: COURSE,
    school_id: SCHOOL,
    academic_year_id: null,
    term_id: null,
    name: 'Maths',
    code: 'MAT',
    description: null,
    status: 'published',
    join_code: 'ABC234',
    grade_scale_id: null,
    is_template: false,
    banner_color: null,
    banner_image_path: null,
    created_by: USER,
    created_at: new Date('2026-10-01T00:00:00Z'),
    updated_at: new Date('2026-10-01T00:00:00Z'),
    ...over,
  };
}

function courseDb(): MockPrisma {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL });
  prisma.school_management.findFirst.mockResolvedValue({ role: 'teacher', school_management_role: [] });
  prisma.course_staff.findUnique.mockResolvedValue({ role: 'teacher' });
  prisma.course.findUnique.mockResolvedValue(courseRow());
  prisma.course.findFirst.mockResolvedValue(courseRow());
  prisma.course.create.mockResolvedValue(courseRow());
  prisma.course.update.mockResolvedValue(courseRow({ status: 'archived' }));
  return prisma;
}

function courseService(prisma: MockPrisma, webhooks: any) {
  const cache = createMockCacheService() as any;
  return new CourseService(
    cache,
    new CourseAccessService(cache, prisma as any),
    prisma as any,
    createMockErasureLog() as any,
    webhooks,
  );
}

describe('courses emit their events', () => {
  test('course.created', async () => {
    const webhooks = recorder();
    await courseService(courseDb(), webhooks).create(USER, { name: 'Maths' });
    await settle();
    const e = expectEvent(webhooks, 'course.created');
    expect(e.data.createdBy.id).toBe(USER);
  });

  test('course.archived only when the status changes to archived', async () => {
    const webhooks = recorder();
    const prisma = courseDb();
    await courseService(prisma, webhooks).update(USER, COURSE, { status: 'archived' });
    await settle();
    expectEvent(webhooks, 'course.archived');

    const quiet = recorder();
    await courseService(courseDb(), quiet).update(USER, COURSE, { name: 'Algebra' });
    await settle();
    expect(quiet.events).toHaveLength(0);
  });

  test('student.enrolled for students not already active; student.unenrolled on removal', async () => {
    const webhooks = recorder();
    const prisma = courseDb();
    prisma.student.findMany.mockResolvedValue([{ id: STUDENT }, { id: OTHER_USER }]);
    // OTHER_USER is already enrolled: only STUDENT is announced.
    prisma.course_student.findMany.mockResolvedValue([{ student_id: OTHER_USER }]);
    await courseService(prisma, webhooks).enrollStudents(USER, COURSE, [STUDENT, OTHER_USER]);
    await settle();
    const enrolled = webhooks.events.filter((e) => e.type === 'student.enrolled');
    expect(enrolled.map((e) => e.data.student.id)).toEqual([STUDENT]);
    expect(enrolled[0].data.via).toBe('staff');
    expectEvent(webhooks, 'student.enrolled');

    prisma.submission.count.mockResolvedValue(2);
    prisma.course_student.updateMany.mockResolvedValue({ count: 1 });
    await courseService(prisma, webhooks).removeStudent(USER, COURSE, STUDENT);
    await settle();
    const e = expectEvent(webhooks, 'student.unenrolled');
    expect(e.data.dropped).toBe(true);
  });

  test('joining by course code announces a new enrolment once', async () => {
    const webhooks = recorder();
    const prisma = courseDb();
    await courseService(prisma, webhooks).joinByCode(STUDENT, SCHOOL, 'abc234');
    await settle();
    expect(expectEvent(webhooks, 'student.enrolled').data.via).toBe('join_code');

    const again = recorder();
    prisma.course_student.findUnique.mockResolvedValue({ status: 'active' });
    await courseService(prisma, again).joinByCode(STUDENT, SCHOOL, 'abc234');
    await settle();
    expect(again.events).toHaveLength(0);
  });
});

describe('announcements', () => {
  test('announcement.posted carries the title, never the body', async () => {
    const webhooks = recorder();
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL, role: 'admin' });
    prisma.announcement.create.mockResolvedValue({
      id: SUBMISSION,
      school_id: SCHOOL,
      course_id: null,
      author_user_profile_id: USER,
      title: 'Exams',
      body: 'Secret body text',
      created_at: new Date(),
      updated_at: new Date(),
    });
    const service = new AnnouncementService(
      prisma as any,
      createMockCacheService() as any,
      {} as any,
      undefined,
      webhooks as any,
    );
    await service.create(USER, { title: 'Exams', body: 'Secret body text' } as any);
    await settle();
    const e = expectEvent(webhooks, 'announcement.posted');
    expect(e.schoolId).toBe(SCHOOL);
    expect(e.data.announcement).toEqual({ id: SUBMISSION, title: 'Exams', scope: 'school' });
    expect(JSON.stringify(e.data)).not.toContain('Secret body');
  });
});

describe('people', () => {
  test('staff.joined when a join request is approved; staff.left when removed', async () => {
    const webhooks = recorder();
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === USER
        ? { role: 'admin', is_active: true, school_id: SCHOOL }
        : { account_type: 'staff' },
    );
    prisma.school_management.findFirst.mockResolvedValue({ id: 'm-admin', role: 'admin' });
    prisma.school_join_request.findUnique.mockResolvedValue({
      id: REQUEST,
      user_id: OTHER_USER,
      school_id: SCHOOL,
      status: 'pending',
    });
    prisma.school_management.create.mockResolvedValue({ id: MEMBERSHIP });
    prisma.school_join_request.update.mockResolvedValue({ id: REQUEST, status: 'approved' });
    const service = new SchoolService(
      prisma as any,
      createMockCacheService() as any,
      createMockErasureLog() as any,
      {} as any,
      webhooks as any,
    );
    await service.approveRequest(USER, REQUEST, 'teacher');
    await settle();
    const joined = expectEvent(webhooks, 'staff.joined');
    expect(joined.data).toMatchObject({ staff: { id: OTHER_USER }, role: 'teacher', via: 'join_request' });

    prisma.school_management.findUnique.mockResolvedValue({
      id: MEMBERSHIP,
      user_id: OTHER_USER,
      school_id: SCHOOL,
      role: 'teacher',
    });
    prisma.school.findUnique.mockResolvedValue({ owner_id: USER });
    await service.removeMember(USER, MEMBERSHIP);
    await settle();
    expect(expectEvent(webhooks, 'staff.left').data.via).toBe('removed');
  });

  test('staff.role_changed with before and after', async () => {
    const webhooks = recorder();
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL, role: 'admin', is_active: true });
    prisma.school_management.findFirst.mockResolvedValue({ id: 'm-admin', role: 'admin' });
    prisma.school_management.findUnique.mockResolvedValue({
      id: MEMBERSHIP,
      user_id: OTHER_USER,
      school_id: SCHOOL,
      role: 'teacher',
    });
    const cache = { get: async () => null, set: async () => {}, delete: async () => {}, deletePattern: async () => {}, deleteByPrefix: async () => {} };
    const service = new PermissionService(cache as any, prisma as any, webhooks as any);
    await service.changeMemberRole(USER, MEMBERSHIP, 'admin');
    await settle();
    const e = expectEvent(webhooks, 'staff.role_changed');
    expect(e.data.role).toEqual({ before: 'teacher', after: 'admin' });
  });

  test('student.left_school when an active student is marked inactive', async () => {
    const webhooks = recorder();
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL, role: 'admin' });
    prisma.student.findFirst.mockResolvedValue({ is_active: true });
    prisma.student.update.mockResolvedValue({
      id: STUDENT,
      school_id: SCHOOL,
      first_name: 'Ada',
      last_name: 'Lovelace',
      is_active: false,
      user_profile_id: null,
      date_of_birth: null,
      enrollment_date: null,
      gender: null,
    });
    const service = new StudentService(prisma as any, createMockCacheService() as any, webhooks as any);
    await service.update(USER, STUDENT, { isActive: false } as any);
    await settle();
    expect(expectEvent(webhooks, 'student.left_school').data.via).toBe('marked_inactive');

    // Already inactive: not a departure.
    const quiet = recorder();
    prisma.student.findFirst.mockResolvedValue({ is_active: false });
    await new StudentService(prisma as any, createMockCacheService() as any, quiet as any).update(
      USER,
      STUDENT,
      { isActive: false } as any,
    );
    await settle();
    expect(quiet.events).toHaveLength(0);
  });

  test('student.joined_school after redeeming the school join code', async () => {
    const webhooks = recorder();
    const prisma = createMockPrisma();
    prisma.$queryRaw.mockResolvedValue([{ student_id: STUDENT, school_id: SCHOOL }]);
    const service = new StudentMembershipService(prisma as any, createMockCacheService() as any, webhooks as any);
    await service.joinByCode(USER, 'ABCD-EFGH-JKMN');
    await settle();
    const e = expectEvent(webhooks, 'student.joined_school');
    expect(e.data).toMatchObject({ student: { id: STUDENT }, via: 'join_code' });
    expect(e.schoolId).toBe(SCHOOL);
  });
});

describe('grading', () => {
  const activityRow = {
    id: ACTIVITY,
    course_id: COURSE,
    assignment_group_id: null,
    kind: 'assignment',
    title: 'Essay',
    instructions: null,
    points: 20,
    due_at: new Date('2026-11-11T00:00:00Z'),
    status: 'draft',
    published_at: null,
    allow_file: true,
    allow_multiple_files: false,
    allow_text: true,
    max_attempts: 1,
    omit_from_final_grade: false,
    rubric_id: null,
    created_by: USER,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  };
  const access = {
    require: async (_u: string, courseId: string) => ({ course: { id: courseId, school_id: SCHOOL }, role: 'teacher' }),
    requireStudent: async (_s: string, courseId: string) => ({ id: courseId, school_id: SCHOOL }),
  };

  test('activity.published', async () => {
    const webhooks = recorder();
    const prisma = createMockPrisma();
    prisma.activity.findUnique.mockResolvedValue({ ...activityRow });
    prisma.activity.update.mockImplementation(async ({ data }: any) => ({ ...activityRow, ...data }));
    const service = new ActivityService(prisma as any, access as any, undefined, webhooks as any);
    await service.publish(USER, ACTIVITY);
    await settle();
    const e = expectEvent(webhooks, 'activity.published');
    expect(e.data.activity).toMatchObject({ id: ACTIVITY, kind: 'assignment', points: 20 });
  });

  function submissions(webhooks: any, setup: (p: MockPrisma) => void) {
    const prisma = createMockPrisma();
    setup(prisma);
    return {
      prisma,
      service: new SubmissionService(prisma as any, {} as any, access as any, webhooks),
    };
  }

  test('grade.recorded when a teacher marks work', async () => {
    const webhooks = recorder();
    const { service } = submissions(webhooks, (p) => {
      p.activity.findUnique.mockResolvedValue({ ...activityRow, status: 'published' });
      p.course_student.findFirst.mockResolvedValue({ student_id: STUDENT });
      p.submission.upsert.mockResolvedValue({
        id: SUBMISSION,
        student_id: STUDENT,
        status: 'graded',
        score: 15,
        feedback: null,
        excused: false,
        excused_reason: null,
        graded_at: new Date(),
      });
    });
    await service.grade(USER, ACTIVITY, STUDENT, { score: 15 });
    await settle();
    const e = expectEvent(webhooks, 'grade.recorded');
    expect(e.data.grade).toEqual({ score: 15, points: 20, status: 'graded', excused: false });
    expect(e.data.source).toBe('teacher');
    expect(e.data.gradedBy.id).toBe(USER);
  });

  test('submission.handed_in when an assignment is handed in', async () => {
    const webhooks = recorder();
    const { service } = submissions(webhooks, (p) => {
      p.activity.findUnique.mockResolvedValue({ ...activityRow, status: 'published' });
      p.student.findUnique.mockResolvedValue({ user_profile_id: USER });
      p.submission.findFirst.mockResolvedValue({ id: SUBMISSION, status: 'draft', file_id: null });
      p.submission.updateManyAndReturn.mockResolvedValue([
        { id: SUBMISSION, status: 'submitted', submitted_at: new Date('2026-11-04T09:00:00Z') },
      ]);
    });
    await service.submitAssignment(STUDENT, ACTIVITY, { textBody: 'My essay' });
    await settle();
    const e = expectEvent(webhooks, 'submission.handed_in');
    expect(JSON.stringify(e.data)).not.toContain('My essay');
  });

  test('quiz.completed with the automatic score', async () => {
    const webhooks = recorder();
    const { service } = submissions(webhooks, (p) => {
      p.activity.findUnique.mockResolvedValue({ ...activityRow, kind: 'quiz', status: 'published', max_attempts: null });
      p.student.findUnique.mockResolvedValue({ user_profile_id: USER });
      p.submission.findFirst.mockResolvedValue({ id: SUBMISSION, status: 'draft', file_id: null, attempt_count: 0, graded_by: null });
      p.$queryRaw.mockResolvedValue([{ score: 8, points: 10, attempts_used: 1 }]);
    });
    await service.submitQuiz(STUDENT, ACTIVITY, []);
    await settle();
    const e = expectEvent(webhooks, 'quiz.completed');
    expect(e.data.grade).toMatchObject({ score: 8, points: 10 });
    expect(e.data.submission.attempt).toBe(1);
  });
});

describe('attendance', () => {
  const sessionRow = {
    id: SESSION,
    course_id: COURSE,
    title: 'Period 1',
    opened_by: USER,
    opened_at: new Date(Date.now() - 60_000),
    closes_at: new Date(Date.now() + 10 * 60_000),
    closed_at: null,
    check_in_code: '1234',
    late_after_minutes: 5,
    latitude: null,
    longitude: null,
    radius_m: null,
  };

  function attendance(webhooks: any, setup: (p: MockPrisma) => void = () => {}) {
    const prisma = createMockPrisma();
    prisma.attendance_session.findFirst.mockResolvedValue({ ...sessionRow });
    prisma.attendance_session.findUnique.mockResolvedValue({ ...sessionRow });
    prisma.attendance_session.create.mockResolvedValue({ ...sessionRow });
    setup(prisma);
    const access = {
      require: async () => ({ course: { id: COURSE, name: 'Maths', status: 'published', school_id: SCHOOL }, role: 'teacher' }),
    };
    const realtime = { publishStaff: async () => {}, publishPortal: async () => {} };
    const push = { sendToUsers: async () => {} };
    const service = new AttendanceService(
      prisma as any,
      createMockCacheService() as any,
      access as any,
      push as any,
      realtime as any,
      createMockErasureLog() as any,
      webhooks,
    );
    return { service, prisma };
  }

  test('attendance.session_opened', async () => {
    const webhooks = recorder();
    const { service } = attendance(webhooks);
    await service.open(USER, COURSE, { title: 'Period 1' });
    await settle();
    const e = expectEvent(webhooks, 'attendance.session_opened');
    expect(e.data.openedBy.id).toBe(USER);
    expect(e.data.session.requiresCode).toBe(true);
  });

  test('attendance.recorded when a teacher sets a record', async () => {
    const webhooks = recorder();
    const { service } = attendance(webhooks, (p) => {
      p.course_student.findFirst.mockResolvedValue({ status: 'active' });
      p.course_attendance_record.upsert.mockResolvedValue({
        session_id: SESSION,
        student_id: STUDENT,
        status: 'excused',
        method: 'teacher',
        checked_in_at: null,
        distance_m: null,
        note: null,
      });
    });
    await service.setRecord(USER, COURSE, SESSION, STUDENT, { status: 'excused' });
    await settle();
    const e = expectEvent(webhooks, 'attendance.recorded');
    expect(e.data.record).toEqual({ status: 'excused', method: 'teacher', checkedInAt: null });
    expect(e.data.recordedBy.id).toBe(USER);
  });

  test('attendance.session_closed with counts', async () => {
    const webhooks = recorder();
    const { service } = attendance(webhooks, (p) => {
      p.attendance_session.updateManyAndReturn.mockResolvedValue([
        { ...sessionRow, closed_at: new Date() },
      ]);
      p.course_attendance_record.findMany.mockResolvedValue([
        { session_id: SESSION, student_id: STUDENT, status: 'present', method: 'self', checked_in_at: new Date(), distance_m: null, note: null },
        { session_id: SESSION, student_id: OTHER_USER, status: 'absent', method: 'auto', checked_in_at: null, distance_m: null, note: null },
      ]);
    });
    await service.close(USER, COURSE, SESSION);
    await settle();
    const e = expectEvent(webhooks, 'attendance.session_closed');
    expect(e.data.counts).toEqual({ present: 1, late: 0, absent: 1, excused: 0 });
  });
});
