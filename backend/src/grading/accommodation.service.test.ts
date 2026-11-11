import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccommodationService } from './accommodation.service';
import {
  ActivityAccommodationController,
  StudentAccommodationController,
} from './accommodation.controller';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const PAST = new Date(Date.now() - 86_400_000);

const QUIZ = { id: 'act-1', course_id: 'course-1', kind: 'quiz' };

const ROW = {
  id: 'acc-1',
  activity_id: 'act-1',
  student_id: 'stu-1',
  time_multiplier: '1.5',
  extra_minutes: null,
  lockdown_exempt: true,
  reason: 'Screen reader',
  created_by: 'user-1',
  created_at: PAST,
  updated_at: PAST,
};

const DEFAULT_ROW = { ...ROW, id: 'sacc-1', activity_id: undefined };

/** `role` is the caller's course role; null for none. */
function build(
  setup: (prisma: MockPrisma) => void = () => {},
  role: string | null = 'teacher',
) {
  const prisma = createMockPrisma();
  prisma.activity.findUnique.mockResolvedValue(QUIZ);
  prisma.course_student.findUnique.mockResolvedValue({ status: 'active' });
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: 'school-1' });
  prisma.student.findFirst.mockResolvedValue({ id: 'stu-1' });
  // A school admin (every student, sensitive details); tests override.
  prisma.school_management.findFirst.mockResolvedValue({ role: 'admin', school_management_role: [] });
  setup(prisma);
  const records: any[][] = [];
  const access = {
    require: async (_u: string, courseId: string, roles: readonly string[]) => {
      if (!role) throw new NotFoundException('Course not found');
      if (!roles.includes(role)) throw new ForbiddenException('nope');
      return { course: { id: courseId, school_id: 'school-1' }, role };
    },
  };
  const auditLog = {
    record: async (...args: any[]) => {
      records.push(args);
    },
  };
  const service = new AccommodationService(
    prisma as any,
    access as any,
    auditLog as any,
  );
  return { service, prisma, records };
}

describe('activity accommodations: permissions', () => {
  test('no role in the course is a 404 on every route', async () => {
    const { service } = build(undefined, null);
    await expect(service.listForActivity('u', 'act-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.setForActivity('u', 'act-1', 'stu-1', { timeMultiplier: 1.5 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.removeForActivity('u', 'act-1', 'stu-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('a role outside the marking staff is refused', async () => {
    const { service } = build(undefined, 'observer');
    await expect(
      service.setForActivity('u', 'act-1', 'stu-1', { timeMultiplier: 1.5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  test('a TA can set one, as they can extend', async () => {
    const { service } = build((p) => {
      p.activity_accommodation.upsert.mockResolvedValue(ROW);
    }, 'ta');
    const saved = await service.setForActivity('u', 'act-1', 'stu-1', {
      timeMultiplier: 1.5,
      lockdownExempt: true,
    });
    expect(saved).toMatchObject({
      activityId: 'act-1',
      studentId: 'stu-1',
      timeMultiplier: 1.5,
      lockdownExempt: true,
    });
  });
});

describe('activity accommodations: validation', () => {
  test('only quizzes take accommodations', async () => {
    const { service } = build((p) => {
      p.activity.findUnique.mockResolvedValue({ ...QUIZ, kind: 'assignment' });
    });
    await expect(
      service.setForActivity('u', 'act-1', 'stu-1', { extraMinutes: 10 }),
    ).rejects.toThrow('Accommodations apply to quizzes only');
  });

  test('bad values are a 400 and nothing is written', async () => {
    const { service, prisma } = build();
    await expect(
      service.setForActivity('u', 'act-1', 'stu-1', {
        timeMultiplier: 1.5,
        extraMinutes: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.activity_accommodation.upsert).not.toHaveBeenCalled();
  });

  test('the student must be enrolled and not dropped', async () => {
    const { service } = build((p) => {
      p.course_student.findUnique.mockResolvedValue({ status: 'dropped' });
    });
    await expect(
      service.setForActivity('u', 'act-1', 'stu-1', { extraMinutes: 10 }),
    ).rejects.toThrow('That student is not enrolled in this course');
  });
});

describe('activity accommodations: audit and running attempts', () => {
  test('a new one is audited as a create', async () => {
    const { service, records } = build((p) => {
      p.activity_accommodation.upsert.mockResolvedValue(ROW);
    });
    await service.setForActivity('user-1', 'act-1', 'stu-1', {
      timeMultiplier: 1.5,
      lockdownExempt: true,
    });
    expect(records).toHaveLength(1);
    const [, schoolId, actor, entry] = records[0];
    expect(schoolId).toBe('school-1');
    expect(actor).toEqual({ id: 'user-1' });
    expect(entry).toMatchObject({
      entity: 'activity_accommodation',
      entityId: 'acc-1',
      action: 'create',
    });
  });

  test('replacing one is audited as an update', async () => {
    const { service, records } = build((p) => {
      p.activity_accommodation.findUnique.mockResolvedValue({
        ...ROW,
        time_multiplier: null,
        extra_minutes: 10,
      });
      p.activity_accommodation.upsert.mockResolvedValue(ROW);
    });
    await service.setForActivity('user-1', 'act-1', 'stu-1', {
      timeMultiplier: 1.5,
    });
    expect(records[0][3].action).toBe('update');
  });

  test('a running timed attempt gets the extra time', async () => {
    const started = new Date(Date.now() - 10 * 60_000);
    const expires = new Date(started.getTime() + 30 * 60_000);
    const { service, prisma } = build((p) => {
      p.activity_accommodation.upsert.mockResolvedValue(ROW);
      p.submission.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          activity_id: 'act-1',
          quiz_started_at: started,
          quiz_expires_at: expires,
          activity: { time_limit_minutes: 30 },
        },
      ]);
      p.activity_accommodation.findMany.mockResolvedValue([
        ROW,
      ]);
    });
    await service.setForActivity('u', 'act-1', 'stu-1', { timeMultiplier: 1.5 });
    expect(prisma.submission.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'sub-1' },
      data: { quiz_expires_at: new Date(started.getTime() + 45 * 60_000) },
    });
  });

  test('a running attempt never loses time', async () => {
    const started = new Date(Date.now() - 10 * 60_000);
    const expires = new Date(started.getTime() + 60 * 60_000);
    const { service, prisma } = build((p) => {
      p.activity_accommodation.findUnique.mockResolvedValue(ROW);
      p.submission.findMany.mockResolvedValue([
        {
          id: 'sub-1',
          activity_id: 'act-1',
          quiz_started_at: started,
          quiz_expires_at: expires,
          activity: { time_limit_minutes: 30 },
        },
      ]);
    });
    await service.removeForActivity('u', 'act-1', 'stu-1');
    expect(prisma.submission.update).not.toHaveBeenCalled();
  });

  test('removing a missing one is a 404; removing is audited', async () => {
    const missing = build();
    await expect(
      missing.service.removeForActivity('u', 'act-1', 'stu-1'),
    ).rejects.toThrow('This student has no accommodation here');

    const { service, prisma, records } = build((p) => {
      p.activity_accommodation.findUnique.mockResolvedValue(ROW);
    });
    await service.removeForActivity('user-1', 'act-1', 'stu-1');
    expect(prisma.activity_accommodation.delete).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
    });
    expect(records[0][3]).toMatchObject({
      entity: 'activity_accommodation',
      action: 'delete',
    });
  });
});

describe('school-wide default', () => {
  test('a student from another school is a 404', async () => {
    const { service, prisma } = build((p) => {
      p.student.findFirst.mockResolvedValue(null);
    });
    await expect(service.getForStudent('u', 'stu-9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.setForStudent('u', 'stu-9', { timeMultiplier: 2 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.student.findFirst.mock.calls[0][0].where).toEqual({
      id: 'stu-9',
      school_id: 'school-1',
    });
  });

  test('none is null', async () => {
    const { service } = build();
    expect(await service.getForStudent('u', 'stu-1')).toBeNull();
  });

  test('set is validated, saved and audited', async () => {
    const { service, prisma, records } = build((p) => {
      p.student_accommodation.upsert.mockResolvedValue(DEFAULT_ROW);
    });
    await expect(
      service.setForStudent('u', 'stu-1', { extraMinutes: 700 }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const saved = await service.setForStudent('user-1', 'stu-1', {
      timeMultiplier: 1.5,
      lockdownExempt: true,
    });
    expect(saved).toMatchObject({ studentId: 'stu-1', timeMultiplier: 1.5 });
    expect(prisma.student_accommodation.upsert.mock.calls[0][0].create).toMatchObject(
      { student_id: 'stu-1', time_multiplier: 1.5, lockdown_exempt: true },
    );
    expect(records[0][1]).toBe('school-1');
    expect(records[0][3]).toMatchObject({
      entity: 'student_accommodation',
      action: 'create',
    });
  });

  test('remove is audited; a missing default is a 404', async () => {
    const missing = build();
    await expect(
      missing.service.removeForStudent('u', 'stu-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    const { service, records } = build((p) => {
      p.student_accommodation.findUnique.mockResolvedValue(DEFAULT_ROW);
    });
    await service.removeForStudent('u', 'stu-1');
    expect(records[0][3]).toMatchObject({
      entity: 'student_accommodation',
      action: 'delete',
    });
  });
});

describe('controllers', () => {
  test('activity routes need a session; the service checks the course role', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ActivityAccommodationController),
    ).toEqual([AuthGuard]);
  });

  test('the default needs student:read to see and student:update to change', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, StudentAccommodationController),
    ).toEqual([AuthGuard, PermissionGuard]);
    const proto = StudentAccommodationController.prototype as any;
    expect(Reflect.getMetadata(PERMISSION_KEY, proto.get)).toBe('student:read');
    expect(Reflect.getMetadata(PERMISSION_KEY, proto.set)).toBe('student:update');
    expect(Reflect.getMetadata(PERMISSION_KEY, proto.remove)).toBe(
      'student:update',
    );
  });
});
