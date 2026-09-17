import { beforeEach, describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StudentClaimService } from './student-claim.service';
import { createRoutingSupabase, expectRejection } from '@/test/mocks';

const ACTOR = 'staff-1';
const SCHOOL = 'school-1';
const STUDENT = 'student-1';
const USER = 'user-1';

const noopCache = {
  get: () => Promise.resolve(null),
  set: async () => {},
  delete: async () => {},
  deleteByPrefix: async () => {},
} as any;

function service(sb: any, cache: any = noopCache) {
  return new StudentClaimService(sb as any, cache);
}

describe('StudentClaimService.issue', () => {
  test('returns a formatted code and stores only its hash', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.student': {
          data: { id: STUDENT, school_id: SCHOOL, user_profile_id: null },
          error: null,
        },
        'student.student_claim_code': { data: null, error: null },
      },
    });

    const result = await service(sb).issue(ACTOR, STUDENT);

    expect(result.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const insert = sb._calls.find(
      (c: any) => c.table === 'student_claim_code' && c.op === 'insert',
    );
    if (!insert) throw new Error('expected a claim code insert');
    // The plaintext must never be persisted.
    expect(insert.payload.code_hash).not.toContain(
      result.code.replace(/-/g, ''),
    );
    expect(insert.payload.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('clears any outstanding code before issuing a new one', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.student': {
          data: { id: STUDENT, school_id: SCHOOL, user_profile_id: null },
          error: null,
        },
        'student.student_claim_code': { data: null, error: null },
      },
    });

    await service(sb).issue(ACTOR, STUDENT);

    const ops = sb._calls
      .filter((c: any) => c.table === 'student_claim_code')
      .map((c: any) => c.op);
    expect(ops).toEqual(['delete', 'insert']);
  });

  test('refuses a student belonging to another school', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.student': {
          data: {
            id: STUDENT,
            school_id: 'other-school',
            user_profile_id: null,
          },
          error: null,
        },
      },
    });

    expect(
      await expectRejection(service(sb).issue(ACTOR, STUDENT)),
    ).toBeInstanceOf(NotFoundException);
  });

  test('refuses a student that already has an account', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.student': {
          data: { id: STUDENT, school_id: SCHOOL, user_profile_id: 'someone' },
          error: null,
        },
      },
    });

    expect(
      await expectRejection(service(sb).issue(ACTOR, STUDENT)),
    ).toBeInstanceOf(ConflictException);
  });

  test('rejects an out-of-range expiry', async () => {
    const sb = createRoutingSupabase({});
    expect(
      await expectRejection(service(sb).issue(ACTOR, STUDENT, 0)),
    ).toBeInstanceOf(BadRequestException);
    expect(
      await expectRejection(service(sb).issue(ACTOR, STUDENT, 365)),
    ).toBeInstanceOf(BadRequestException);
  });

  test('issued codes omit ambiguous glyphs and do not repeat', async () => {
    const make = () =>
      createRoutingSupabase({
        tables: {
          user_profile: { data: { school_id: SCHOOL }, error: null },
          'student.student': {
            data: { id: STUDENT, school_id: SCHOOL, user_profile_id: null },
            error: null,
          },
          'student.student_claim_code': { data: null, error: null },
        },
      });

    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const { code } = await service(make()).issue(ACTOR, STUDENT);
      expect(code).not.toMatch(/[ILO01]/);
      seen.add(code);
    }
    expect(seen.size).toBe(25);
  });
});

describe('StudentClaimService.getStatus', () => {
  function statusFor(student: any, code: any) {
    return service(
      createRoutingSupabase({
        tables: {
          user_profile: { data: { school_id: SCHOOL }, error: null },
          'student.student': { data: student, error: null },
          'student.student_claim_code': { data: code, error: null },
        },
      }),
    ).getStatus(ACTOR, STUDENT);
  }

  const unlinked = { id: STUDENT, school_id: SCHOOL, user_profile_id: null };

  test('reports an outstanding code without revealing it', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const out = await statusFor(unlinked, {
      expires_at: expiresAt,
      created_at: '2026-09-01',
    });

    expect(out).toEqual({
      hasAccount: false,
      outstandingCode: { expiresAt, issuedAt: '2026-09-01' },
      expiredCode: false,
    });
    // Nothing in the payload could be redeemed.
    expect(JSON.stringify(out)).not.toContain('hash');
  });

  test('treats a past expiry as no outstanding code', async () => {
    const out = await statusFor(unlinked, {
      expires_at: new Date(Date.now() - 1000).toISOString(),
      created_at: '2026-09-01',
    });

    expect(out.outstandingCode).toBeNull();
    expect(out.expiredCode).toBe(true);
  });

  test('reports a linked account', async () => {
    const out = await statusFor(
      { id: STUDENT, school_id: SCHOOL, user_profile_id: 'u1' },
      null,
    );
    expect(out.hasAccount).toBe(true);
    expect(out.outstandingCode).toBeNull();
  });

  test('refuses a student from another school', async () => {
    const svc = service(
      createRoutingSupabase({
        tables: {
          user_profile: { data: { school_id: SCHOOL }, error: null },
          'student.student': {
            data: { id: STUDENT, school_id: 'elsewhere', user_profile_id: null },
            error: null,
          },
        },
      }),
    );

    expect(
      await expectRejection(svc.getStatus(ACTOR, STUDENT)),
    ).toBeInstanceOf(NotFoundException);
  });
});

describe('StudentClaimService.redeem', () => {
  let rpcArgs: any;

  beforeEach(() => {
    rpcArgs = undefined;
  });

  function redeemer(
    profile: any,
    rpcResult: any = {
      data: [{ student_id: STUDENT, school_id: SCHOOL }],
      error: null,
    },
  ) {
    const sb = createRoutingSupabase({
      tables: { user_profile: { data: profile, error: null } },
      rpc: {
        redeem_student_claim_code: (args: any) => {
          rpcArgs = args;
          return rpcResult;
        },
      },
    });
    return { svc: service(sb), sb };
  }

  test('links the account and never sends plaintext to the database', async () => {
    const { svc } = redeemer({ school_id: null, account_type: 'staff' });

    const out = await svc.redeem(USER, 'ABCD-EFGH-JKMN');

    expect(out).toEqual({ studentId: STUDENT, schoolId: SCHOOL });
    expect(rpcArgs.p_user_id).toBe(USER);
    expect(rpcArgs.p_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rpcArgs)).not.toContain('ABCD');
  });

  test('accepts the code in any case or dash formatting', async () => {
    const { svc } = redeemer({ school_id: null, account_type: 'staff' });
    const a = await svc.redeem(USER, 'abcd-efgh-jkmn');
    const hashA = rpcArgs.p_code_hash;

    const { svc: svc2 } = redeemer({ school_id: null, account_type: 'staff' });
    await svc2.redeem(USER, 'ABCDEFGHJKMN');

    expect(a).toEqual({ studentId: STUDENT, schoolId: SCHOOL });
    expect(rpcArgs.p_code_hash).toBe(hashA);
  });

  test('refuses an account that already belongs to a school', async () => {
    const { svc } = redeemer({ school_id: SCHOOL, account_type: 'staff' });

    expect(
      await expectRejection(svc.redeem(USER, 'ABCD-EFGH-JKMN')),
    ).toBeInstanceOf(ConflictException);
  });

  test('rejects a wrong-length code without querying the database', async () => {
    const { svc, sb } = redeemer({ school_id: null, account_type: 'staff' });

    expect(await expectRejection(svc.redeem(USER, 'SHORT'))).toBeInstanceOf(
      BadRequestException,
    );
    expect(sb._rpcCalls).toHaveLength(0);
  });

  test('maps an expired or unknown code to a generic error', async () => {
    const { svc } = redeemer(
      { school_id: null, account_type: 'staff' },
      { data: null, error: { code: 'P0002', message: 'invalid_claim_code' } },
    );

    const err = await expectRejection(svc.redeem(USER, 'ABCD-EFGH-JKMN'));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String((err as Error).message)).toContain('Invalid or expired');
  });

  test('maps an already-claimed record to a conflict', async () => {
    const { svc } = redeemer(
      { school_id: null, account_type: 'staff' },
      {
        data: null,
        error: { code: 'P0003', message: 'student_already_claimed' },
      },
    );

    expect(
      await expectRejection(svc.redeem(USER, 'ABCD-EFGH-JKMN')),
    ).toBeInstanceOf(ConflictException);
  });

  test('clears the cached profile so the client stops seeing no school', async () => {
    const deleted: string[] = [];
    const cache = {
      get: () => Promise.resolve(null),
      set: async () => {},
      delete: async (key: string) => {
        deleted.push(key);
      },
      deleteByPrefix: async () => {},
    } as any;

    const sb = createRoutingSupabase({
      tables: {
        user_profile: {
          data: { school_id: null, account_type: 'staff' },
          error: null,
        },
      },
      rpc: {
        redeem_student_claim_code: () => ({
          data: [{ student_id: STUDENT, school_id: SCHOOL }],
          error: null,
        }),
      },
    });

    await service(sb, cache).redeem(USER, 'ABCD-EFGH-JKMN');

    // getProfile caches for thirty days; without this the redeemed student is
    // stranded on the join screen.
    expect(deleted).toContain(`profile:${USER}`);
    expect(deleted).toContain(`student-context:${USER}`);
  });

  test('requires a profile to exist first', async () => {
    const { svc } = redeemer(null);

    expect(
      await expectRejection(svc.redeem(USER, 'ABCD-EFGH-JKMN')),
    ).toBeInstanceOf(BadRequestException);
  });
});
