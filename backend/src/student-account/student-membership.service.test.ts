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
  const CODE_HASH = /^[0-9a-f]{64}$/;

  /** A live code for SCHOOL and an unbound profile, unless overridden. */
  function joiner(
    opts: {
      code?: { school_id: string } | null;
      profile?: Record<string, unknown> | null;
      bound?: number;
    } = {},
  ) {
    const { deleted, cache } = recordingCache();
    const prisma = createMockPrisma();
    const profile =
      opts.profile === undefined
        ? { first_name: 'Ada', last_name: 'Lovelace', school_id: null, account_type: 'student' }
        : opts.profile;
    prisma.user_profile.findUnique.mockResolvedValue(profile);
    prisma.school_join_code.findFirst.mockResolvedValue(
      opts.code === undefined ? { school_id: SCHOOL } : opts.code,
    );
    prisma.student.create.mockResolvedValue({ id: JOINED });
    prisma.user_profile.updateMany.mockResolvedValue({ count: opts.bound ?? 1 });
    return { svc: service(prisma, cache), prisma, deleted };
  }

  test('joining creates the record, binds the profile and drops every membership cache key', async () => {
    const { svc, prisma, deleted } = joiner();

    const out = await svc.joinByCode(USER, 'ABCD-EFGH-JKMN');
    expect(out).toEqual({ studentId: JOINED, schoolId: SCHOOL });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.student.create.mock.calls[0][0].data).toEqual({
      school_id: SCHOOL,
      first_name: 'Ada',
      last_name: 'Lovelace',
      user_profile_id: USER,
      is_active: true,
    });
    // Bound only while still unbound (compare-and-set).
    expect(prisma.user_profile.updateMany.mock.calls[0][0]).toEqual({
      where: { id: USER, school_id: null },
      data: { school_id: SCHOOL, account_type: 'student', role: null, is_active: true },
    });
    // Students are not staff members.
    expect(prisma.school_management.create).not.toHaveBeenCalled();
    expect(prisma.school_management.upsert).not.toHaveBeenCalled();

    // The bug this service exists to prevent: profile and students hold for
    // thirty days, so a miss is effectively permanent.
    expect(deleted).toContain(`profile:${USER}`);
    expect(deleted).toContain(`student-context:${USER}`);
    expect(deleted).toContain(`students:${SCHOOL}`);
  });

  test('looks the code up by hash only, live and unrevoked, never by the plaintext', async () => {
    const { svc, prisma } = joiner();
    const before = Date.now();
    await svc.joinByCode(USER, 'ABCD-EFGH-JKMN');

    const where = prisma.school_join_code.findFirst.mock.calls[0][0].where;
    expect(where.code_hash).toMatch(CODE_HASH);
    expect(where.revoked_at).toBeNull();
    expect(where.expires_at.gt.getTime()).toBeGreaterThanOrEqual(before);
    expect(JSON.stringify(prisma.school_join_code.findFirst.mock.calls)).not.toContain('ABCD');
  });

  test('accepts any case or dash formatting', async () => {
    const a = joiner();
    await a.svc.joinByCode(USER, 'abcd-efgh-jkmn');
    const b = joiner();
    await b.svc.joinByCode(USER, 'ABCDEFGHJKMN');

    expect(a.prisma.school_join_code.findFirst.mock.calls[0][0].where.code_hash).toBe(
      b.prisma.school_join_code.findFirst.mock.calls[0][0].where.code_hash,
    );
  });

  test('a wrong-length code never reaches the database', async () => {
    const { svc, prisma } = joiner();
    expect(await expectRejection(svc.joinByCode(USER, 'SHORT'))).toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.school_join_code.findFirst).not.toHaveBeenCalled();
    expect(prisma.student.create).not.toHaveBeenCalled();
  });

  test('an unknown, expired or revoked code gives a generic error and writes nothing', async () => {
    const { svc, prisma } = joiner({ code: null });
    const err = await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN'));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String((err as Error).message)).toContain('Invalid or expired');
    expect(prisma.student.create).not.toHaveBeenCalled();
  });

  test('a missing profile is asked to complete it', async () => {
    const { svc } = joiner({ profile: null });
    const err = await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN'));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String((err as Error).message)).toBe('Complete your profile first');
  });

  test('an account already in a school is refused', async () => {
    const { svc, prisma } = joiner({
      profile: { first_name: 'A', last_name: 'B', school_id: 'other', account_type: 'student' },
    });
    expect(
      await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN')),
    ).toBeInstanceOf(ConflictException);
    expect(prisma.student.create).not.toHaveBeenCalled();
  });

  test('a profile settled concurrently between read and bind is refused (the transaction rolls back)', async () => {
    const { svc, deleted } = joiner({ bound: 0 });
    expect(
      await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN')),
    ).toBeInstanceOf(ConflictException);
    expect(deleted).toEqual([]);
  });

  test('a database failure is logged, and the user gets a plain message', async () => {
    const { svc, prisma } = joiner();
    prisma.student.create.mockRejectedValue(new Error('duplicate key value violates unique constraint'));
    const err = await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN'));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String((err as Error).message)).toBe('Failed to redeem join code');
  });

  test('a parent account cannot join as a student', async () => {
    const { svc, prisma } = joiner({
      profile: { first_name: 'P', last_name: 'Q', school_id: null, account_type: 'parent' },
    });
    expect(
      await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN')),
    ).toBeInstanceOf(ConflictException);
    expect(prisma.school_join_code.findFirst).not.toHaveBeenCalled();
  });
});
