import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STEP_UP_KEY } from '@/auth/step-up.guard';
import { createMockPrisma } from '@/test/prisma-mock';
import { PermissionController } from './permission.controller';
import { PermissionService } from './permission.service';
import { computeEffectivePermissions } from './permission.effective';
import { canSeeSensitive, scopedStudentWhere, studentScope } from './student-access';

const SCHOOL = 's1';

function membership(role: string | null, keys: string[] = []) {
  return {
    role,
    school_management_role: [
      { school_role: { school_role_permission: keys.map((key) => ({ permission_catalog: { key } })) } },
    ],
  };
}

describe('effective permissions: safeguarding is explicit only', () => {
  test('a school admin does not hold safeguarding by default', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(membership('admin'));
    const eff = await computeEffectivePermissions(prisma as any, 'u', SCHOOL);
    expect(eff.keys).toContain('student:read-all');
    expect(eff.keys).toContain('student:sensitive');
    expect(eff.keys).toContain('pastoral-note:read');
    expect(eff.keys).not.toContain('pastoral-note:safeguarding');
  });

  test('an admin gets safeguarding through an assigned role', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(membership('admin', ['pastoral-note:safeguarding']));
    const eff = await computeEffectivePermissions(prisma as any, 'u', SCHOOL);
    expect(eff.keys).toContain('pastoral-note:safeguarding');
  });

  test('an organisation admin never gets safeguarding through the organisation', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(null);
    prisma.organisation_admin.findUnique.mockResolvedValue({ user_id: 'u' });
    const eff = await computeEffectivePermissions(prisma as any, 'u', SCHOOL);
    expect(eff.viaOrganisation).toBe(true);
    expect(eff.keys).toContain('student:read-all');
    expect(eff.keys).not.toContain('pastoral-note:safeguarding');
  });

  test('teachers read students (scoped), members do not', async () => {
    const prisma = createMockPrisma();
    prisma.school_management.findFirst.mockResolvedValue(membership('teacher'));
    const teacher = await computeEffectivePermissions(prisma as any, 'u', SCHOOL);
    expect(teacher.keys.filter((k) => k.startsWith('student:'))).toEqual(['student:read']);
    prisma.school_management.findFirst.mockResolvedValue(membership('member'));
    const member = await computeEffectivePermissions(prisma as any, 'u', SCHOOL);
    expect(member.keys.some((k) => k.startsWith('student:'))).toBe(false);
  });
});

describe('student scope', () => {
  test('read-all sees the whole school', () => {
    const scope = studentScope({ keys: ['student:read', 'student:read-all'] }, 'u', SCHOOL);
    expect(scope).toEqual({ all: true });
    expect(scopedStudentWhere(scope, { school_id: SCHOOL })).toEqual({ school_id: SCHOOL });
  });

  test('read alone: students in courses where the caller is course staff, and tutees', () => {
    const scope = studentScope({ keys: ['student:read'] }, 'u', SCHOOL);
    expect(scopedStudentWhere(scope, { id: 'x', school_id: SCHOOL })).toEqual({
      AND: [
        { id: 'x', school_id: SCHOOL },
        {
          OR: [
            {
              course_student: {
                some: { course: { school_id: SCHOOL, course_staff: { some: { user_profile_id: 'u' } } } },
              },
            },
            { form_tutor_id: 'u' },
          ],
        },
      ],
    });
  });

  test('course:update (admin of every course) sees every enrolled student', () => {
    const scope = studentScope({ keys: ['student:read', 'course:update'] }, 'u', SCHOOL);
    expect(scope.all).toBe(false);
    expect(JSON.stringify(scope)).toContain('"course":{"school_id":"s1"}');
    expect(JSON.stringify(scope)).not.toContain('course_staff');
  });

  test('sensitive details need student:sensitive', () => {
    expect(canSeeSensitive({ keys: ['student:read', 'student:read-all'] })).toBe(false);
    expect(canSeeSensitive({ keys: ['student:read', 'student:sensitive'] })).toBe(true);
  });
});

describe('role and permission changes', () => {
  test('every change route needs step-up; reads do not', () => {
    const proto = PermissionController.prototype as any;
    for (const name of [
      'createRole',
      'updateRole',
      'deleteRole',
      'setRolePermissions',
      'changeMemberRole',
      'assignRole',
      'unassignRole',
    ]) {
      expect(Reflect.getMetadata(STEP_UP_KEY, proto[name])).toBe(true);
    }
    for (const name of ['getCatalog', 'listRoles', 'getRolePermissions', 'getMemberRoles']) {
      expect(Reflect.getMetadata(STEP_UP_KEY, proto[name])).toBeUndefined();
    }
  });

  test('granting safeguarding writes its own audit entry', async () => {
    const prisma = createMockPrisma();
    prisma.user_profile.findUnique.mockResolvedValue({ school_id: SCHOOL });
    prisma.school_role.findUnique.mockResolvedValue({ id: 'r1', school_id: SCHOOL, is_system: false, name: 'DSL' });
    prisma.school_role_permission.findMany.mockResolvedValue([{ permission_catalog: { key: 'pastoral-note:read' } }]);
    prisma.permission_catalog.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    const entries: any[] = [];
    const audit = { record: async (_tx: unknown, _s: unknown, _a: unknown, entry: any) => void entries.push(entry) };
    const cache = { deleteByPrefix: async () => {}, get: async () => null, set: async () => {} };
    const svc = new PermissionService(cache as any, prisma as any, undefined, audit as any);

    await svc.setRolePermissions('admin', 'r1', ['pastoral-note:read', 'pastoral-note:safeguarding']);
    const restricted = entries.find((e) => e.entity === 'school_role_restricted_permission');
    expect(restricted.changes.granted).toEqual({ before: null, after: ['pastoral-note:safeguarding'] });

    entries.length = 0;
    prisma.school_role_permission.findMany.mockResolvedValue([
      { permission_catalog: { key: 'pastoral-note:safeguarding' } },
    ]);
    await svc.setRolePermissions('admin', 'r1', ['pastoral-note:read']);
    expect(entries.find((e) => e.entity === 'school_role_restricted_permission').changes.revoked).toEqual({
      before: ['pastoral-note:safeguarding'],
      after: null,
    });

    entries.length = 0;
    prisma.school_role_permission.findMany.mockResolvedValue([]);
    await svc.setRolePermissions('admin', 'r1', ['pastoral-note:read', 'student:read']);
    expect(entries.some((e) => e.entity === 'school_role_restricted_permission')).toBe(false);
  });
});

describe('bulk exports and audit revert need step-up', () => {
  test.each([
    ['gradebook', () => require('@/grading/gradebook.controller').GradebookController, 'export'],
    ['attendance', () => require('@/attendance/attendance.controller').AttendanceController, 'export'],
    ['mastery', () => require('@/mastery/mastery.controller').MasteryCourseController, 'export'],
    ['school attendance', () => require('@/attendance-alerts/attendance-alerts.controller').AttendanceReportController, 'schoolCsv'],
    ['student attendance', () => require('@/attendance-alerts/attendance-alerts.controller').AttendanceReportController, 'studentCsv'],
    ['course attendance', () => require('@/attendance-alerts/attendance-alerts.controller').CourseAttendanceReportController, 'csv'],
    ['school analytics', () => require('@/analytics/analytics.controller').AnalyticsController, 'export'],
    ['course analytics', () => require('@/analytics/analytics.controller').CourseAnalyticsController, 'export'],
    ['pastoral', () => require('@/pastoral/pastoral.controller').PastoralController, 'exportCsv'],
    ['audit revert', () => require('@/audit-log/audit-log.controller').OrganisationAuditLogController, 'revert'],
  ] as const)('%s', (_name, load, method) => {
    const controller = load();
    expect(Reflect.getMetadata(STEP_UP_KEY, controller.prototype[method])).toBe(true);
  });
});
