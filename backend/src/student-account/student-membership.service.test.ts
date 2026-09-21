import { describe, expect, test } from 'bun:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StudentMembershipService } from './student-membership.service';
import { createRoutingSupabase, expectRejection } from '@/test/mocks';

const ACTOR = 'staff-1';
const SCHOOL = 'school-1';
const USER = 'user-1';
const JOINED = 'student-new';
const EXISTING = 'student-old';

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

function service(sb: any, cache: any = recordingCache().cache) {
  return new StudentMembershipService(sb as any, cache);
}

describe('StudentMembershipService codes', () => {
  function issuer() {
    return createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.school_join_code': { data: null, error: null },
      },
    });
  }

  test('issues a grouped code and stores only its hash', async () => {
    const sb = issuer();
    const result = await service(sb).issueCode(ACTOR);

    expect(result.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    const insert = sb._calls.find(
      (c: any) => c.table === 'school_join_code' && c.op === 'insert',
    );
    if (!insert) throw new Error('expected a join code insert');
    expect(insert.payload.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(insert.payload.code_hash).not.toContain(
      result.code.replace(/-/g, ''),
    );
  });

  test('reissuing clears the previous code first', async () => {
    const sb = issuer();
    await service(sb).issueCode(ACTOR);

    const ops = sb._calls
      .filter((c: any) => c.table === 'school_join_code')
      .map((c: any) => c.op);
    expect(ops).toEqual(['delete', 'insert']);
  });

  test('rejects an out-of-range expiry', async () => {
    const sb = issuer();
    expect(await expectRejection(service(sb).issueCode(ACTOR, 0))).toBeInstanceOf(
      BadRequestException,
    );
    expect(
      await expectRejection(service(sb).issueCode(ACTOR, 365)),
    ).toBeInstanceOf(BadRequestException);
  });

  test('status never returns the code itself', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.school_join_code': {
          data: { expires_at: expiresAt, created_at: '2026-09-01' },
          error: null,
        },
      },
    });

    const out = await service(sb).getCodeStatus(ACTOR);
    expect(out.activeCode?.expiresAt).toBe(expiresAt);
    expect(JSON.stringify(out)).not.toContain('hash');
  });

  test('a past expiry is not an active code', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.school_join_code': {
          data: {
            expires_at: new Date(Date.now() - 1000).toISOString(),
            created_at: '2026-09-01',
          },
          error: null,
        },
      },
    });

    const out = await service(sb).getCodeStatus(ACTOR);
    expect(out.activeCode).toBeNull();
    expect(out.expired).toBe(true);
  });
});

describe('StudentMembershipService.joinByCode', () => {
  function joiner(rpcResult: any) {
    const { deleted, cache } = recordingCache();
    const sb = createRoutingSupabase({
      tables: { user_profile: { data: { school_id: SCHOOL }, error: null } },
      rpc: { redeem_school_join_code: () => rpcResult },
    });
    return { svc: service(sb, cache), sb, deleted };
  }

  const ok = {
    data: [{ student_id: JOINED, school_id: SCHOOL }],
    error: null,
  };

  test('joining drops every membership cache key', async () => {
    const { svc, deleted } = joiner(ok);

    await svc.joinByCode(USER, 'ABCD-EFGH-JKMN');

    // The bug this service exists to prevent: profile and students hold for
    // thirty days, so a miss is effectively permanent.
    expect(deleted).toContain(`profile:${USER}`);
    expect(deleted).toContain(`student-context:${USER}`);
    expect(deleted).toContain(`students:${SCHOOL}`);
  });

  test('never sends the plaintext code to the database', async () => {
    const { svc, sb } = joiner(ok);
    await svc.joinByCode(USER, 'ABCD-EFGH-JKMN');

    const call = sb._rpcCalls[0];
    expect(call.args.p_code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(call.args)).not.toContain('ABCD');
  });

  test('accepts any case or dash formatting', async () => {
    const a = joiner(ok);
    await a.svc.joinByCode(USER, 'abcd-efgh-jkmn');
    const b = joiner(ok);
    await b.svc.joinByCode(USER, 'ABCDEFGHJKMN');

    expect(a.sb._rpcCalls[0].args.p_code_hash).toBe(
      b.sb._rpcCalls[0].args.p_code_hash,
    );
  });

  test('a wrong-length code never reaches the database', async () => {
    const { svc, sb } = joiner(ok);
    expect(await expectRejection(svc.joinByCode(USER, 'SHORT'))).toBeInstanceOf(
      BadRequestException,
    );
    expect(sb._rpcCalls).toHaveLength(0);
  });

  test('an account already in a school is refused', async () => {
    const { svc } = joiner({
      data: null,
      error: { code: 'P0012', message: 'already_in_a_school' },
    });
    expect(
      await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN')),
    ).toBeInstanceOf(ConflictException);
  });

  test('an unknown or expired code gives a generic error', async () => {
    const { svc } = joiner({
      data: null,
      error: { code: 'P0011', message: 'invalid_join_code' },
    });
    const err = await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN'));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String((err as Error).message)).toContain('Invalid or expired');
  });

  test('a missing migration says so', async () => {
    const { svc } = joiner({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function' },
    });
    const err = await expectRejection(svc.joinByCode(USER, 'ABCD-EFGH-JKMN'));
    expect(String((err as Error).message)).toContain('pending migrations');
  });
});

describe('StudentMembershipService duplicates', () => {
  test('lists candidate pairs for the actor school', async () => {
    const sb = createRoutingSupabase({
      tables: { user_profile: { data: { school_id: SCHOOL }, error: null } },
      rpc: {
        student_duplicate_candidates: () => ({
          data: [
            { joined_id: JOINED, existing_id: EXISTING, full_name: 'Sam Self' },
          ],
          error: null,
        }),
      },
    });

    const out = await service(sb).listDuplicates(ACTOR);
    expect(out).toEqual([
      { joinedId: JOINED, existingId: EXISTING, name: 'Sam Self' },
    ]);
    expect(sb._rpcCalls[0].args.p_school_id).toBe(SCHOOL);
  });

  test('merging drops the caches of the account that moved', async () => {
    const { deleted, cache } = recordingCache();
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.student': { data: { user_profile_id: USER }, error: null },
      },
      rpc: {
        merge_student_records: () => ({
          data: [{ student_id: EXISTING }],
          error: null,
        }),
      },
    });

    const out = await service(sb, cache).mergeDuplicate(ACTOR, JOINED, EXISTING);

    expect(out.studentId).toBe(EXISTING);
    expect(deleted).toContain(`profile:${USER}`);
    expect(deleted).toContain(`students:${SCHOOL}`);
  });

  test('refuses to discard a record that carries results', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.student': { data: { user_profile_id: USER }, error: null },
      },
      rpc: {
        merge_student_records: () => ({
          data: null,
          error: { code: 'P0017', message: 'joined_record_has_data' },
        }),
      },
    });

    const err = await expectRejection(
      service(sb).mergeDuplicate(ACTOR, JOINED, EXISTING),
    );
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String((err as Error).message)).toContain('results recorded');
  });

  test('refuses a target that already has an account', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.student': { data: { user_profile_id: USER }, error: null },
      },
      rpc: {
        merge_student_records: () => ({
          data: null,
          error: { code: 'P0016', message: 'existing_record_already_claimed' },
        }),
      },
    });

    expect(
      await expectRejection(service(sb).mergeDuplicate(ACTOR, JOINED, EXISTING)),
    ).toBeInstanceOf(ConflictException);
  });

  test('a record from another school is not found', async () => {
    const sb = createRoutingSupabase({
      tables: {
        user_profile: { data: { school_id: SCHOOL }, error: null },
        'student.student': { data: { user_profile_id: USER }, error: null },
      },
      rpc: {
        merge_student_records: () => ({
          data: null,
          error: { code: 'P0014', message: 'student_other_school' },
        }),
      },
    });

    expect(
      await expectRejection(service(sb).mergeDuplicate(ACTOR, JOINED, EXISTING)),
    ).toBeInstanceOf(NotFoundException);
  });
});
