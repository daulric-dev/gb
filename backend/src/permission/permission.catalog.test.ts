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
    expect(actionsFor('class')).toEqual(ACTIONS);
  });

  test('school is read-only', () => {
    expect(actionsFor('school')).toEqual(['read']);

    expect(isPermissionKey('school:read')).toBe(true);
    for (const action of ['create', 'update', 'delete']) {
      expect(isPermissionKey(`school:${action}`)).toBe(false);
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
    expect(admin.has('school:delete' as never)).toBe(false);
  });

  test('teacher and member defaults grant school:read only', () => {
    for (const role of ['teacher', 'member']) {
      const keys = defaultsForRole(role);
      expect(keys.has('school:read')).toBe(true);
      expect(keys.has('school:update' as never)).toBe(false);
    }
  });
});
