import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ExtensionService } from './extension.service';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

const ACTIVITY = {
  id: 'act-1',
  course_id: 'course-1',
  kind: 'assignment',
  due_at: PAST,
  time_limit_minutes: null,
};

const ROW = {
  id: 'ext-1',
  activity_id: 'act-1',
  student_id: 'stu-1',
  due_at: FUTURE,
  reason: 'Ill',
  created_by: 'user-1',
  created_at: PAST,
  updated_at: PAST,
};

/** `role` is the caller's course role; null for none. */
function build(
  setup: (prisma: MockPrisma) => void,
  role: string | null = 'teacher',
) {
  const prisma = createMockPrisma();
  prisma.activity.findUnique.mockResolvedValue(ACTIVITY);
  prisma.course_student.findUnique.mockResolvedValue({ status: 'active' });
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
  const service = new ExtensionService(
    prisma as any,
    access as any,
    auditLog as any,
  );
  return { service, prisma, records };
}

describe('ExtensionService permissions', () => {
  test('someone with no role in the course gets a 404', async () => {
    const { service } = build(() => {}, null);
    await expect(service.list('user-9', 'act-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.set('user-9', 'act-1', 'stu-1', { dueAt: FUTURE.toISOString() }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.remove('user-9', 'act-1', 'stu-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  test('a role outside the marking staff is refused', async () => {
    const { service } = build(() => {}, 'observer');
    await expect(
      service.set('user-9', 'act-1', 'stu-1', { dueAt: FUTURE.toISOString() }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  test('a TA can extend, as they can mark', async () => {
    const { service } = build((p) => {
      p.activity_extension.upsert.mockResolvedValue(ROW);
    }, 'ta');
    const saved = await service.set('user-1', 'act-1', 'stu-1', {
      dueAt: FUTURE.toISOString(),
    });
    expect(saved.dueAt).toBe(FUTURE.toISOString());
  });

  test('an unknown activity is a 404', async () => {
    const { service } = build((p) => {
      p.activity.findUnique.mockResolvedValue(null);
    });
    await expect(service.list('user-1', 'nope')).rejects.toThrow(
      'Activity not found',
    );
  });
});

describe('ExtensionService.set', () => {
  test('a due date in the past is refused', async () => {
    const { service, prisma } = build(() => {});
    await expect(
      service.set('user-1', 'act-1', 'stu-1', { dueAt: PAST.toISOString() }),
    ).rejects.toThrow('The new due date must be in the future');
    expect(prisma.activity_extension.upsert).not.toHaveBeenCalled();
  });

  test('an unreadable date is refused', async () => {
    const { service } = build(() => {});
    await expect(
      service.set('user-1', 'act-1', 'stu-1', { dueAt: 'soon' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('offline work has no due date to extend', async () => {
    const { service } = build((p) => {
      p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, kind: 'offline' });
    });
    await expect(
      service.set('user-1', 'act-1', 'stu-1', { dueAt: FUTURE.toISOString() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('the student must be enrolled', async () => {
    const missing = build((p) => {
      p.course_student.findUnique.mockResolvedValue(null);
    });
    await expect(
      missing.service.set('user-1', 'act-1', 'stu-9', {
        dueAt: FUTURE.toISOString(),
      }),
    ).rejects.toThrow('That student is not enrolled in this course');

    const dropped = build((p) => {
      p.course_student.findUnique.mockResolvedValue({ status: 'dropped' });
    });
    await expect(
      dropped.service.set('user-1', 'act-1', 'stu-1', {
        dueAt: FUTURE.toISOString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(dropped.prisma.activity_extension.upsert).not.toHaveBeenCalled();
  });

  test('creates the extension and audits it as a create', async () => {
    const { service, prisma, records } = build((p) => {
      p.activity_extension.upsert.mockResolvedValue(ROW);
    });
    const saved = await service.set('user-1', 'act-1', 'stu-1', {
      dueAt: FUTURE.toISOString(),
      reason: '  Ill  ',
    });
    expect(saved).toEqual({
      id: 'ext-1',
      activityId: 'act-1',
      studentId: 'stu-1',
      dueAt: FUTURE.toISOString(),
      reason: 'Ill',
      createdBy: 'user-1',
      createdAt: PAST.toISOString(),
      updatedAt: PAST.toISOString(),
    });
    const upsert = prisma.activity_extension.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({
      activity_id_student_id: { activity_id: 'act-1', student_id: 'stu-1' },
    });
    expect(upsert.create.reason).toBe('Ill');
    expect(upsert.create.created_by).toBe('user-1');
    expect(upsert.create.due_at).toEqual(FUTURE);

    expect(records).toHaveLength(1);
    const [tx, schoolId, actor, entry] = records[0];
    expect(tx).toBe(prisma);
    expect(schoolId).toBe('school-1');
    expect(actor).toEqual({ id: 'user-1' });
    expect(entry.entity).toBe('activity_extension');
    expect(entry.entityId).toBe('ext-1');
    expect(entry.action).toBe('create');
    expect(entry.changes.dueAt).toEqual({ before: null, after: FUTURE });
    expect(entry.changes.studentId).toEqual({ before: null, after: 'stu-1' });
  });

  test('replacing an extension audits an update with the old date', async () => {
    const older = new Date(Date.now() + 3_600_000);
    const { service, records } = build((p) => {
      p.activity_extension.findUnique.mockResolvedValue({
        ...ROW,
        due_at: older,
      });
      p.activity_extension.upsert.mockResolvedValue(ROW);
    });
    await service.set('user-1', 'act-1', 'stu-1', {
      dueAt: FUTURE.toISOString(),
      reason: 'Ill',
    });
    const entry = records[0][3];
    expect(entry.action).toBe('update');
    expect(entry.changes).toEqual({ dueAt: { before: older, after: FUTURE } });
  });

  test('a running untimed quiz attempt moves to the new due date', async () => {
    const { service, prisma } = build((p) => {
      p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, kind: 'quiz' });
      p.activity_extension.upsert.mockResolvedValue(ROW);
    });
    await service.set('user-1', 'act-1', 'stu-1', {
      dueAt: FUTURE.toISOString(),
    });
    const update = prisma.submission.updateMany.mock.calls[0][0];
    expect(update.where.activity_id).toBe('act-1');
    expect(update.where.student_id).toBe('stu-1');
    expect(update.where.quiz_started_at).toEqual({ not: null });
    expect(update.data.quiz_expires_at).toEqual(FUTURE);
  });

  test('timed quizzes and assignments leave attempts alone', async () => {
    const timed = build((p) => {
      p.activity.findUnique.mockResolvedValue({
        ...ACTIVITY,
        kind: 'quiz',
        time_limit_minutes: 20,
      });
      p.activity_extension.upsert.mockResolvedValue(ROW);
    });
    await timed.service.set('user-1', 'act-1', 'stu-1', {
      dueAt: FUTURE.toISOString(),
    });
    expect(timed.prisma.submission.updateMany).not.toHaveBeenCalled();

    const assignment = build((p) => {
      p.activity_extension.upsert.mockResolvedValue(ROW);
    });
    await assignment.service.set('user-1', 'act-1', 'stu-1', {
      dueAt: FUTURE.toISOString(),
    });
    expect(assignment.prisma.submission.updateMany).not.toHaveBeenCalled();
  });
});

describe('ExtensionService.remove and list', () => {
  test('removing an extension that does not exist is a 404', async () => {
    const { service } = build(() => {});
    await expect(service.remove('user-1', 'act-1', 'stu-1')).rejects.toThrow(
      'This student has no extension',
    );
  });

  test('removes the extension and audits a delete', async () => {
    const { service, prisma, records } = build((p) => {
      p.activity_extension.findUnique.mockResolvedValue(ROW);
    });
    await service.remove('user-1', 'act-1', 'stu-1');
    expect(prisma.activity_extension.delete).toHaveBeenCalledWith({
      where: { id: 'ext-1' },
    });
    const entry = records[0][3];
    expect(entry.action).toBe('delete');
    expect(entry.entityId).toBe('ext-1');
    expect(entry.changes.dueAt).toEqual({ before: FUTURE, after: null });
  });

  test('removing a quiz extension puts a running untimed attempt back on the activity date', async () => {
    const { service, prisma } = build((p) => {
      p.activity.findUnique.mockResolvedValue({ ...ACTIVITY, kind: 'quiz' });
      p.activity_extension.findUnique.mockResolvedValue(ROW);
    });
    await service.remove('user-1', 'act-1', 'stu-1');
    expect(
      prisma.submission.updateMany.mock.calls[0][0].data.quiz_expires_at,
    ).toEqual(PAST);
  });

  test('lists the activity’s extensions', async () => {
    const { service, prisma } = build((p) => {
      p.activity_extension.findMany.mockResolvedValue([ROW]);
    });
    const list = await service.list('user-1', 'act-1');
    expect(list.map((e) => e.studentId)).toEqual(['stu-1']);
    expect(prisma.activity_extension.findMany.mock.calls[0][0].where).toEqual({
      activity_id: 'act-1',
    });
  });
});
