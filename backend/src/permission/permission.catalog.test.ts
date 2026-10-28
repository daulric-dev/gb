import { describe, expect, test } from 'bun:test';
import {
  ACTIONS,
  actionsFor,
  defaultsForRole,
  isPermissionKey,
  PERMISSION_CATALOG,
  permKey,
  RESOURCES,
} from './permission.catalog';

describe('permission catalog', () => {
  test('resources without an override expose every action', () => {
    expect(actionsFor('term')).toEqual(ACTIONS);
  });

  test('keys nothing enforces do not exist', () => {
    expect(actionsFor('course')).toEqual(['create', 'update']);
    expect(actionsFor('student')).toEqual(['read', 'update']);
    expect(actionsFor('join-code')).toEqual(['read', 'update']);
    expect(actionsFor('academic-year')).toEqual(['create', 'read', 'update']);
    for (const key of [
      'course:read',
      'course:delete',
      'student:create',
      'student:delete',
      'academic-year:delete',
      'join-code:create',
      'join-code:delete',
    ]) {
      expect(isPermissionKey(key)).toBe(false);
    }
  });

  test('school has read and update (billing) only', () => {
    expect(actionsFor('school')).toEqual(['read', 'update']);

    expect(isPermissionKey('school:read')).toBe(true);
    expect(isPermissionKey('school:update')).toBe(true);
    for (const action of ['create', 'delete']) {
      expect(isPermissionKey(`school:${action}`)).toBe(false);
    }
  });

  test('join-code has read and update only', () => {
    expect(isPermissionKey('join-code:read')).toBe(true);
    expect(isPermissionKey('join-code:update')).toBe(true);
    for (const action of ['create', 'delete']) {
      expect(isPermissionKey(`join-code:${action}`)).toBe(false);
    }
  });

  test('catalog contains exactly the supported resource/action pairs', () => {
    const expected = RESOURCES.flatMap((r) =>
      actionsFor(r).map((a) => permKey(r, a)),
    );
    expect(PERMISSION_CATALOG.map((e) => e.key).sort()).toEqual(
      expected.sort(),
    );
  });

  test('admin defaults cover the catalog without inventing school keys', () => {
    const admin = defaultsForRole('admin');
    expect(admin.size).toBe(PERMISSION_CATALOG.length);
    expect(admin.has('school:read')).toBe(true);
    expect(admin.has('school:update')).toBe(true);
    expect(admin.has('school:delete' as never)).toBe(false);
  });

  test('teacher and member defaults grant school:read and join-code:read only', () => {
    for (const role of ['teacher', 'member']) {
      const keys = defaultsForRole(role);
      expect(keys.has('school:read')).toBe(true);
      expect(keys.has('school:update' as never)).toBe(false);
      expect(keys.has('join-code:read')).toBe(true);
      expect(keys.has('join-code:update' as never)).toBe(false);
    }
  });
});
