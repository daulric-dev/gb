import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { StudentMembershipService } from './student-membership.service';
import { expectRejection } from '@/test/mocks';
import { createMockPrisma, type MockPrisma } from '@/test/prisma-mock';

const ACTOR = 'staff-1';
const SCHOOL = 'school-1';
const USER = 'user-1';
const JOINED = 'student-new';

/** Records the keys dropped, which is the whole point of finalise(). */
function recordingCache() {
  const deleted: string[] = [];
  return {
    deleted,
    cache: {
      get: () => Promise.resolve(null),
      set: async () => {},
      delete: async (key: string) => {
        deleted.push(key);
      },
      deleteByPrefix: async () => {},
    } as any,
  };
}

function service(prisma: MockPrisma, cache: any = recordingCache().cache) {
  return new StudentMembershipService(prisma as any, cache);
}

/** A database where the actor (and anyone) is in SCHOOL. */
function db(): MockPrisma {
  const prisma = createMockPrisma();
  prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL });
  return prisma;
}

/** An error as raised by a SQL function through $queryRaw. */
const raised = (message: string, code = 'P0001') =>
  Object.assign(new Error(`Raw query failed. Message: \`${message}\``), {
    code: 'P2010',
    meta: { code, message },
  });

/** The SQL text and bound values of the nth raw query. */
function rawCall(prisma: MockPrisma, n = 0) {
  const [strings, ...values] = prisma.$queryRaw.mock.calls[n];
  return { sql: (strings as string[]).join('?'), values };
}

describe('StudentMembershipService codes', () => {
  test('issues a grouped code and stores only its hash', async () => {
    const prisma = db();
    const result = await service(prisma).issueCode(ACTOR);

    expect(result.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const data = prisma.school_join_code.create.mock.calls[0][0].data;
    expect(data.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.code_hash).not.toContain(result.code.replace(/-/g, ''));
    expect(data.expires_at.toISOString()).toBe(result.expiresAt);
  });

  test('reissuing clears the previous code first, atomically', async () => {
    const prisma = db();
    const ops: string[] = [];
    prisma.school_join_code.deleteMany.mockImplementation(async () => {
      ops.push('delete');
      return { count: 1 };
    });
    prisma.school_join_code.create.mockImplementation(async () => {
      ops.push('insert');
      return {};
    });
    await service(prisma).issueCode(ACTOR);

    expect(ops).toEqual(['delete', 'insert']);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.school_join_code.deleteMany.mock.calls[0][0].where).toEqual({
      school_id: SCHOOL,
      revoked_at: null,
    });
  });

  test('rejects an out-of-range expiry', async () => {
    const prisma = db();
    expect(
      await expectRejection(service(prisma).issueCode(ACTOR, 0)),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await expectRejection(service(prisma).issueCode(ACTOR, 365)),
    ).toBeInstanceOf(BadRequestException);
  });

  test('status never returns the code itself', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    const prisma = db();
    prisma.school_join_code.findFirst.mockResolvedValue({
      expires_at: expiresAt,
      created_at: new Date('2026-09-01T00:00:00Z'),
    });

    const out = await service(prisma).getCodeStatus(ACTOR);
    expect(out.activeCode?.expiresAt).toBe(expiresAt.toISOString());
    expect(out.activeCode?.issuedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(JSON.stringify(out)).not.toContain('hash');
  });

  test('a past expiry is not an active code', async () => {
    const prisma = db();
    prisma.school_join_code.findFirst.mockResolvedValue({
      expires_at: new Date(Date.now() - 1000),
      created_at: new Date('2026-09-01T00:00:00Z'),
    });

    const out = await service(prisma).getCodeStatus(ACTOR);
    expect(out.activeCode).toBeNull();
    expect(out.expired).toBe(true);
  });
});

describe('StudentMembershipService.joinByCode', () => {
  function joiner(result: unknown[] | Error) {
    const { deleted, cache } = recordingCache();
    const prisma = db();
    if (result instanceof Error) prisma.$queryRaw.mockRejectedValue(result);
    else prisma.$queryRaw.mockResolvedValue(result);
    return { svc: service(prisma, cache), prisma, deleted };
  }

  const ok = [{ student_id: JOINED, school_id: SCHOOL }];

  test('joining drops every membership cache key', async () => {
    const { svc, deleted } = joiner(ok);

    const out = await svc.joinByCode(USER, 'ABCD-EFGH-JKMN');
    expect(out).toEqual({ studentId: JOINED, schoolId: SCHOOL });

    // The bug this service exists to prevent: profile and students hold for
    // thirty days, so a miss is effectively permanent.
    expect(deleted).toContain(`profile:${USER}`);
    expect(deleted).toContain(`student-context:${USER}`);
    expect(deleted).toContain(`students:${SCHOOL}`);
  });

  test('never sends the plaintext code to the database', async () => {
    const { svc, prisma } = joiner(ok);
    await svc.joinByCode(USER, 'ABCD-EFGH-JKMN');

    const { sql, values } = rawCall(prisma);
    expect(sql).toContain('redeem_school_join_code');
    expect(values[0]).toBe(USER);
    expect(values[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(values)).not.toContain('ABCD');
  });

  test('accepts any case or dash formatting', async () => {
    const a = joiner(ok);
    await a.svc.joinByCode(USER, 'abcd-efgh-jkmn');
    const b = joiner(ok);
    await b.svc.joinByCode(USER, 'ABCDEFGHJKMN');

    expect(rawCall(a.prisma).values[1]).toBe(rawCall(b.prisma).values[1]);
  });

  test('a wrong-length code never reaches the database', async () => {
    const { svc, prisma } = joiner(ok);
    expect(await expectRejection(svc.joinByCode(USER, 'SHORT'))).toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  test('no row back is an invalid code', async () => {
    const { svc } = joiner([]);
    expect(
      await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN')),
    ).toBeInstanceOf(BadRequestException);
  });

  test('an account already in a school is refused', async () => {
    const { svc } = joiner(raised('already_in_a_school', 'P0012'));
    expect(
      await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN')),
    ).toBeInstanceOf(ConflictException);
  });

  test('an unknown or expired code gives a generic error', async () => {
    const { svc } = joiner(raised('invalid_join_code', 'P0011'));
    const err = await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN'));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String((err as Error).message)).toContain('Invalid or expired');
  });

  test('a missing migration says so', async () => {
    const { svc } = joiner(
      raised('function public.redeem_school_join_code does not exist', '42883'),
    );
    const err = await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN'));
    expect(String((err as Error).message)).toContain('pending migrations');
  });
});
