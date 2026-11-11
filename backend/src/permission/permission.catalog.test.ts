import { describe, expect, test } from 'bun:test';
import {
  ACTIONS,
  actionsFor,
  defaultsForRole,
  EXPLICIT_ONLY_KEYS,
  EXTRA_ACTIONS,
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
    expect(actionsFor('student')).toEqual(['read', 'update', 'read-all', 'sensitive', 'export', 'erase']);
    expect(actionsFor('join-code')).toEqual(['read', 'update']);
    expect(actionsFor('audit-log')).toEqual(['read']);
    expect(isPermissionKey('audit-log:read')).toBe(true);
    expect(isPermissionKey('audit-log:update')).toBe(false);
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

  test('school has read and update (settings) only', () => {
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

  test('analytics has read only; admins hold it, teachers and members do not', () => {
    expect(actionsFor('analytics')).toEqual(['read']);
    expect(isPermissionKey('analytics:read')).toBe(true);
    expect(isPermissionKey('analytics:update')).toBe(false);
    expect(defaultsForRole('admin').has('analytics:read')).toBe(true);
    expect(defaultsForRole('teacher').has('analytics:read')).toBe(false);
    expect(defaultsForRole('member').has('analytics:read')).toBe(false);
  });

  test('catalog contains exactly the supported resource/action pairs', () => {
    const expected = RESOURCES.flatMap((r) =>
      actionsFor(r).map((a) => permKey(r, a)),
    );
    expect(PERMISSION_CATALOG.map((e) => e.key).sort()).toEqual(
      expected.sort(),
    );
  });

  test('admin defaults cover the catalog except the explicit-only keys', () => {
    const admin = defaultsForRole('admin');
    expect(admin.size).toBe(PERMISSION_CATALOG.length - EXPLICIT_ONLY_KEYS.size);
    expect([...EXPLICIT_ONLY_KEYS]).toEqual(['pastoral-note:safeguarding']);
    for (const key of EXPLICIT_ONLY_KEYS) expect(admin.has(key)).toBe(false);
    expect(admin.has('school:read')).toBe(true);
    expect(admin.has('school:update')).toBe(true);
    expect(admin.has('audit-log:read')).toBe(true);
    expect(admin.has('school:delete' as never)).toBe(false);
  });

  test('attendance-report has read only; admins hold it, teachers and members do not', () => {
    expect(actionsFor('attendance-report')).toEqual(['read']);
    expect(isPermissionKey('attendance-report:read')).toBe(true);
    for (const action of ['create', 'update', 'delete']) {
      expect(isPermissionKey(`attendance-report:${action}`)).toBe(false);
    }
    expect(defaultsForRole('admin').has('attendance-report:read')).toBe(true);
    expect(defaultsForRole('teacher').has('attendance-report:read')).toBe(false);
    expect(defaultsForRole('member').has('attendance-report:read')).toBe(false);
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

  test('course-library has create only, held by admins', () => {
    expect(actionsFor('course-library')).toEqual(['create']);
    expect(isPermissionKey('course-library:create')).toBe(true);
    expect(isPermissionKey('course-library:read')).toBe(false);
    expect(defaultsForRole('admin').has('course-library:create')).toBe(true);
    expect(defaultsForRole('teacher').has('course-library:create')).toBe(false);
  });

  test('student keys: teachers read (course-scoped), members nothing, admins everything', () => {
    for (const a of ['read-all', 'sensitive', 'export', 'erase']) {
      expect(isPermissionKey(`student:${a}`)).toBe(true);
      expect((EXTRA_ACTIONS as readonly string[]).includes(a)).toBe(true);
    }
    const admin = defaultsForRole('admin');
    for (const a of ['read', 'update', 'read-all', 'sensitive', 'export', 'erase']) {
      expect(admin.has(`student:${a}` as never)).toBe(true);
    }
    const teacher = defaultsForRole('teacher');
    expect([...teacher].filter((k) => k.startsWith('student:'))).toEqual(['student:read']);
    const member = defaultsForRole('member');
    expect([...member].some((k) => k.startsWith('student:'))).toBe(false);
    // The extra student actions never leak onto other resources.
    expect(isPermissionKey('course:read-all')).toBe(false);
    expect(isPermissionKey('pastoral-note:export')).toBe(false);
  });

  test('pastoral-note has read, create, update and safeguarding; teachers may only create', () => {
    expect(actionsFor('pastoral-note')).toEqual(['read', 'create', 'update', 'safeguarding']);
    expect(isPermissionKey('pastoral-note:safeguarding')).toBe(true);
    expect(isPermissionKey('pastoral-note:delete')).toBe(false);
    // The extra action never leaks onto other resources.
    expect(isPermissionKey('student:safeguarding')).toBe(false);
    const admin = defaultsForRole('admin');
    for (const a of ['read', 'create', 'update']) {
      expect(admin.has(`pastoral-note:${a}` as never)).toBe(true);
    }
    // Safeguarding is never implied, not even for admins.
    expect(admin.has('pastoral-note:safeguarding')).toBe(false);
    const teacher = defaultsForRole('teacher');
    expect(teacher.has('pastoral-note:create')).toBe(true);
    expect(teacher.has('pastoral-note:read')).toBe(false);
    expect(teacher.has('pastoral-note:safeguarding')).toBe(false);
    const member = defaultsForRole('member');
    expect([...member].some((k) => k.startsWith('pastoral-note:'))).toBe(false);
  });
});
