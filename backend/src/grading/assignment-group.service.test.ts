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
