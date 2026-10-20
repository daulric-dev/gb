import { describe, test, expect } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { ClassTeacherGuard } from './class-teacher.guard';
import { createMockQueryBuilder } from '@/test/mocks';

function context(request: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as any;
}

/**
 * The report's own class is 'victim-class'; the caller is class teacher of
 * 'own-class' only.
 */
function guard() {
  const reportBuilder = createMockQueryBuilder({
    data: { student_group_id: 'victim-class' },
    error: null,
  });
  const profileBuilder = createMockQueryBuilder({
    data: { role: 'teacher', school_id: 'school-1' },
    error: null,
  });
  const lookups: string[] = [];
  const assignmentBuilder: any = createMockQueryBuilder();
  assignmentBuilder.eq = (col: string, value: string) => {
    if (col === 'student_group_id') lookups.push(value);
    return assignmentBuilder;
  };
  assignmentBuilder.maybeSingle = () =>
    Promise.resolve({
      data: lookups.at(-1) === 'own-class' ? { id: 'a1' } : null,
      error: null,
    });

  const client = {
    from: () => profileBuilder,
    schema: (schema: string) => ({
      from: () => (schema === 'reporting' ? reportBuilder : assignmentBuilder),
    }),
  };
  return {
    guard: new ClassTeacherGuard({ getServiceClient: () => client } as any),
    lookups,
  };
}

describe('ClassTeacherGuard', () => {
  test('authorises a report route against the report, not a client class id', async () => {
    const { guard: g, lookups } = guard();
    const request = {
      user: { id: 'teacher-1' },
      url: '/api/reports/r1/pdf/p1/download?studentGroupId=own-class',
      params: { id: 'r1', pdfId: 'p1' },
      query: { studentGroupId: 'own-class' },
    };

    await expect(g.canActivate(context(request))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(lookups).toEqual(['victim-class']);
  });

  test('still uses the class id on class-scoped routes', async () => {
    const { guard: g } = guard();
    const request = {
      user: { id: 'teacher-1' },
      url: '/api/classes/own-class/enroll',
      params: { classId: 'own-class' },
    };

    expect(await g.canActivate(context(request))).toBe(true);
  });
});
