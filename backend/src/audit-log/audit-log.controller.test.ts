import { describe, expect, test } from 'bun:test';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { AuthGuard } from '@/auth/auth.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';
import {
  OrganisationAuditLogController,
  SchoolAuditLogController,
} from './audit-log.controller';

describe('Audit log access', () => {
  test('school history requires authentication and audit-log:read', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SchoolAuditLogController),
    ).toEqual([AuthGuard, PermissionGuard]);
    const handler = SchoolAuditLogController.prototype.list;
    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe('audit-log:read');
  });

  test('organisation-wide history requires organisation admin access', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, OrganisationAuditLogController),
    ).toEqual([AuthGuard, OrganisationAdminGuard]);
  });

  test('reverting an audit entry is an organisation-admin-only POST route', () => {
    const handler = OrganisationAuditLogController.prototype.revert;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'audit-log/:id/revert',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.POST,
    );
    expect(
      Reflect.getMetadata(GUARDS_METADATA, OrganisationAuditLogController),
    ).toEqual([AuthGuard, OrganisationAdminGuard]);
  });
});
