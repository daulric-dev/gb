import { describe, expect, test } from 'bun:test';
import { AssignmentGroupService } from './assignment-group.service';
import { createMockPrisma } from '@/test/prisma-mock';

describe('AssignmentGroupService audit logging', () => {
  test('records one field-level create entry in the write transaction', async () => {
    const prisma = createMockPrisma();
    prisma.assignment_group.create.mockResolvedValue({
      id: 'group-1',
      course_id: 'course-1',
      name: 'Essays',
      weight: 30,
      position: 0,
      drop_lowest: 1,
      drop_highest: 0,
    });
    const access = {
      require: async () => ({
        course: { id: 'course-1', school_id: 'school-1' },
        role: 'teacher',
      }),
    };
    let args: any[] = [];
    const auditLog = {
      record: async (...recordArgs: any[]) => {
        args = recordArgs;
      },
    };
    const service = new AssignmentGroupService(
      prisma as any,
      access as any,
      auditLog as any,
    );

    await service.create('user-1', 'course-1', {
      name: 'Essays',
      weight: 30,
      dropLowest: 1,
    });

    expect(args[0]).toBe(prisma);
    expect(args[1]).toBe('school-1');
    expect(args[2]).toEqual({ id: 'user-1' });
    expect(args[3].entity).toBe('assignment_group');
    expect(args[3].entityId).toBe('group-1');
    expect(args[3].action).toBe('create');
    expect(args[3].changes.name).toEqual({ before: null, after: 'Essays' });
    expect(args[3].changes.dropLowest).toEqual({ before: null, after: 1 });
  });
});

describe('AssignmentGroupService names (unique per course, ignoring case, on every provider)', () => {
  const build = () => {
    const prisma = createMockPrisma();
    const access = { require: async () => ({ course: { id: 'course-1', school_id: 'school-1' }, role: 'teacher' }) };
    return { prisma, service: new AssignmentGroupService(prisma as any, access as any, undefined as any) };
  };

  test('creating a group whose name another group has (any case) is a 409, checked before the insert', async () => {
    const { prisma, service } = build();
    prisma.assignment_group.count.mockResolvedValue(1);
    await expect(service.create('u', 'course-1', { name: 'essays' })).rejects.toMatchObject({ status: 409 });
    expect(prisma.assignment_group.create).not.toHaveBeenCalled();
    expect(prisma.assignment_group.count.mock.calls[0][0].where).toMatchObject({
      course_id: 'course-1',
      name: { equals: 'essays', mode: 'insensitive' },
    });
  });

  test('renaming checks every other group of the course', async () => {
    const { prisma, service } = build();
    prisma.assignment_group.findFirst.mockResolvedValue({ id: 'g1', course_id: 'course-1', name: 'A', weight: null, position: 0, drop_lowest: 0, drop_highest: 0 });
    prisma.assignment_group.count.mockResolvedValue(1);
    await expect(service.update('u', 'course-1', 'g1', { name: 'B' })).rejects.toMatchObject({ status: 409 });
    expect(prisma.assignment_group.count.mock.calls[0][0].where.NOT).toEqual({ id: 'g1' });
    expect(prisma.assignment_group.updateManyAndReturn).not.toHaveBeenCalled();
  });
});
