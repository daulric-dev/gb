import { describe, expect, mock, test } from 'bun:test';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { GradeScaleController } from './grade-scale.controller';
import { AuthGuard } from '@/auth/auth.guard';
import { AdminGuard } from '@/auth/admin.guard';
import { PermissionGuard } from '@/permission/permission.guard';
import { PERMISSION_KEY } from '@/permission/require-permission.decorator';

const proto = GradeScaleController.prototype as any;

const ROUTES: Array<[string, string, boolean]> = [
  ['list', 'grade-scale:read', false],
  ['getDefault', 'grade-scale:read', false],
  ['get', 'grade-scale:read', false],
  ['create', 'grade-scale:create', true],
  ['update', 'grade-scale:update', true],
  ['replaceBands', 'grade-scale:update', true],
  ['setDefault', 'grade-scale:update', true],
  ['remove', 'grade-scale:delete', true],
];

describe('GradeScaleController', () => {
  test('every route sits behind AuthGuard and PermissionGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, GradeScaleController)).toEqual([
      AuthGuard,
      PermissionGuard,
    ]);
  });

  for (const [method, key, admin] of ROUTES) {
    test(`${method} requires ${key}${admin ? ' and AdminGuard' : ''}`, () => {
      expect(Reflect.getMetadata(PERMISSION_KEY, proto[method])).toBe(key);
      const guards = Reflect.getMetadata(GUARDS_METADATA, proto[method]) ?? [];
      expect(guards.includes(AdminGuard)).toBe(admin);
    });
  }

  test('passes the caller id to the service and versions the response', async () => {
    const service = {
      list: mock(async () => ['raw']),
      get: mock(async () => ({ id: 'gs-1' })),
      update: mock(async () => ({ id: 'gs-1' })),
      delete: mock(async () => ({ message: 'Grade scale deleted' })),
    };
    const transform = mock((raw: unknown) => ({ versioned: raw }));
    const versioning = { resolve: mock(() => transform) };
    const ctl = new GradeScaleController(service as any, versioning as any);
    const req = { user: { id: 'u1' } };

    expect(await ctl.list(req)).toEqual({ versioned: ['raw'] });
    expect(service.list).toHaveBeenCalledWith('u1');
    expect(versioning.resolve).toHaveBeenLastCalledWith(req, 'gradeScale.list');

    await ctl.get(req, 'gs-1');
    expect(service.get).toHaveBeenCalledWith('gs-1', 'u1');
    expect(versioning.resolve).toHaveBeenLastCalledWith(req, 'gradeScale.detail');

    await ctl.update(req, 'gs-1', { name: 'x' });
    expect(service.update).toHaveBeenCalledWith('gs-1', 'u1', { name: 'x' });
    expect(versioning.resolve).toHaveBeenLastCalledWith(req, 'gradeScale.updated');

    await ctl.remove(req, 'gs-1');
    expect(service.delete).toHaveBeenCalledWith('gs-1', 'u1');
    expect(versioning.resolve).toHaveBeenLastCalledWith(req, 'gradeScale.deleted');
  });
});
