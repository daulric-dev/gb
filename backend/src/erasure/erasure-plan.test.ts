import { describe, expect, test } from 'bun:test';
import {
  compileObjectKeys,
  compileStep,
  InvalidPlanError,
  OCCURRED_AT,
  plan,
  userStoragePrefixes,
  validatePlan,
} from './erasure-plan';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const AT = new Date('2026-10-25T10:00:00Z');

const rejects = (p: unknown) => {
  let err: unknown;
  try {
    validatePlan(p);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(InvalidPlanError);
};

describe('validatePlan', () => {
  test('accepts every plan shape the app writes', () => {
    validatePlan(
      plan.of(
        plan.prefixes(userStoragePrefixes(A, [B])),
        plan.del('file_manager.file', { owner_id: [A] }, true),
        plan.del('public.user_profile', { id: [A] }),
        plan.del('account.app_user', { id: [A] }),
      ),
    );
    validatePlan(plan.of(plan.update('chat.message', { id: [A] }, { body: null, deleted_at: OCCURRED_AT })));
    validatePlan(plan.of(plan.update('course.discussion_reply', { id: [A] }, { body: '', author_user_profile_id: null })));
    validatePlan(plan.of(plan.update('student.student', { id: [A], user_profile_id: null }, { user_profile_id: B })));
    validatePlan(plan.of(plan.update('public.user_profile', { id: [A], school_id: [B] }, { school_id: null, role: null })));
  });

  test('refuses tables and columns outside the registry', () => {
    rejects(plan.of(plan.del('public.school', { id: [A] })));
    rejects(plan.of(plan.del('chat.message', { sender_id: [A] })));
    rejects(plan.of(plan.update('chat.message', { id: [A] }, { sender_id: null })));
    rejects(plan.of(plan.del('chat.message', { id: [A] }, true)));
  });

  test('refuses anything that could carry or write personal data', () => {
    rejects(plan.of(plan.update('chat.message', { id: [A] }, { body: 'hello' })));
    rejects(plan.of(plan.update('chat.message', { id: [A] }, { metadata: { name: 'x' } as any })));
    rejects(plan.of(plan.update('file_manager.file', { id: [A] }, { deleted_at: '2026-01-01' })));
    rejects(plan.of(plan.del('chat.message', { id: ['jane@example.com'] })));
    rejects(plan.of(plan.prefixes([`file-manager/${B}/${A}/report-card.pdf`])));
    rejects(plan.of(plan.prefixes(['file-manager/'])));
  });

  test('refuses steps that could match a whole table', () => {
    rejects(plan.of(plan.del('chat.message', {})));
    rejects(plan.of(plan.del('chat.message', { id: [] })));
    rejects(plan.of(plan.update('student.student', { user_profile_id: null }, { user_profile_id: B })));
  });

  test('refuses malformed plans', () => {
    rejects(null);
    rejects({ v: 2, steps: [] });
    rejects({ v: 1, steps: [] });
    rejects({ v: 1, steps: [{ op: 'truncate', table: 'chat.message' }] });
  });
});

describe('compileStep', () => {
  test('a delete is a parameterised DELETE by uuid list', () => {
    const { sql, params } = compileStep(plan.del('course.course', { id: [A, B] }) as any, AT);
    expect(sql).toBe('DELETE FROM "course"."course" WHERE "id" = ANY($1::uuid[])');
    expect(params).toEqual([[A, B]]);
  });

  test('an update only touches rows that would change, so re-running counts 0', () => {
    const step = plan.update('chat.message', { id: [A] }, { body: null, deleted_at: OCCURRED_AT, metadata: {} });
    const { sql, params } = compileStep(step as any, AT);
    expect(sql).toBe(
      'UPDATE "chat"."message" SET "body" = NULL, "deleted_at" = COALESCE("deleted_at", $2::timestamptz), "metadata" = \'{}\'::jsonb ' +
        'WHERE "id" = ANY($1::uuid[]) AND ("body" IS NOT NULL OR "deleted_at" IS NULL OR "metadata" IS DISTINCT FROM \'{}\'::jsonb)',
    );
    expect(params).toEqual([[A], AT]);
  });

  test('IS NULL filters and uuid values are bound, never inlined', () => {
    const step = plan.update('student.student', { id: [A], user_profile_id: null }, { user_profile_id: B });
    const { sql, params } = compileStep(step as any, AT);
    expect(sql).toContain('"user_profile_id" IS NULL');
    expect(sql).toContain('"user_profile_id" = $2::uuid');
    expect(sql).not.toContain(B);
    expect(params).toEqual([[A], B]);
  });

  test('count mode for dry runs', () => {
    expect(compileStep(plan.del('chat.message', { id: [A] }) as any, AT, 'count').sql).toBe(
      'SELECT count(*)::int AS n FROM "chat"."message" WHERE "id" = ANY($1::uuid[])',
    );
  });

  test('object keys of file rows', () => {
    expect(compileObjectKeys(plan.del('file_manager.file', { owner_id: [A] }, true) as any).sql).toBe(
      'SELECT "bucket", "storage_path" FROM "file_manager"."file" WHERE "owner_id" = ANY($1::uuid[])',
    );
  });
});

test('userStoragePrefixes covers each school folder and the avatar', () => {
  expect(userStoragePrefixes(A, [B, B, 'not-a-uuid'])).toEqual([`file-manager/${B}/${A}/`, `images/avatars/${A}.`]);
});
