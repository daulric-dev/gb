import { describe, expect, test } from 'bun:test';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { StudentGuard } from './student.guard';
import { createRoutingSupabase, expectRejection } from '@/test/mocks';

function makeContext(request: any) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const noopCache = {
  get: () => Promise.resolve(null),
  set: async () => {},
  deleteByPrefix: async () => {},
} as any;

function guardWith(tables: Record<string, any>, cache: any = noopCache) {
  return new StudentGuard(createRoutingSupabase({ tables }) as any, cache);
}

const STUDENT_PROFILE = { account_type: 'student', is_active: true };

describe('StudentGuard', () => {
  test('fails closed when AuthGuard did not populate the user', async () => {
    const guard = guardWith({});
    expect(
      await expectRejection(guard.canActivate(makeContext({}))),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('pins the linked student to the request', async () => {
    const guard = guardWith({
      user_profile: { data: STUDENT_PROFILE, error: null },
      'student.student': {
        data: { id: 'student-1', school_id: 'school-1', is_active: true },
        error: null,
      },
    });

    const req: any = { user: { id: 'u1' } };
    expect(await guard.canActivate(makeContext(req))).toBe(true);
    expect(req.student).toEqual({
      studentId: 'student-1',
      schoolId: 'school-1',
    });
  });

  test('denies a staff account outright', async () => {
    const guard = guardWith({
      user_profile: { data: { account_type: 'staff', is_active: true }, error: null },
    });

    const err = await expectRejection(
      guard.canActivate(makeContext({ user: { id: 'u1' } })),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toContain('student accounts');
  });

  test('denies a student who has not redeemed a claim code', async () => {
    const guard = guardWith({
      user_profile: { data: STUDENT_PROFILE, error: null },
      'student.student': { data: null, error: null },
    });

    const err = await expectRejection(
      guard.canActivate(makeContext({ user: { id: 'u1' } })),
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(String((err as Error).message)).toContain('No student record');
  });

  test('denies a deactivated account', async () => {
    const guard = guardWith({
      user_profile: {
        data: { account_type: 'student', is_active: false },
        error: null,
      },
    });

    expect(
      await expectRejection(
        guard.canActivate(makeContext({ user: { id: 'u1' } })),
      ),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('denies an inactive student record', async () => {
    const guard = guardWith({
      user_profile: { data: STUDENT_PROFILE, error: null },
      'student.student': {
        data: { id: 'student-1', school_id: 'school-1', is_active: false },
        error: null,
      },
    });

    expect(
      await expectRejection(
        guard.canActivate(makeContext({ user: { id: 'u1' } })),
      ),
    ).toBeInstanceOf(ForbiddenException);
  });

  test('resolves the student id from the account, never from the request', async () => {
    const guard = guardWith({
      user_profile: { data: STUDENT_PROFILE, error: null },
      'student.student': {
        data: { id: 'student-1', school_id: 'school-1', is_active: true },
        error: null,
      },
    });

    // A caller trying to pin someone else's record must not be believed.
    const req: any = {
      user: { id: 'u1' },
      student: { studentId: 'victim', schoolId: 'other' },
    };
    await guard.canActivate(makeContext(req));
    expect(req.student.studentId).toBe('student-1');
  });

  test('serves a cached context without re-querying', async () => {
    const sb = createRoutingSupabase({});
    const cache = {
      get: () =>
        Promise.resolve({ studentId: 'student-1', schoolId: 'school-1' }),
      set: async () => {},
      deleteByPrefix: async () => {},
    } as any;

    const guard = new StudentGuard(sb as any, cache);
    const req: any = { user: { id: 'u1' } };

    expect(await guard.canActivate(makeContext(req))).toBe(true);
    expect(req.student.studentId).toBe('student-1');
    expect(sb._calls).toHaveLength(0);
  });
});
