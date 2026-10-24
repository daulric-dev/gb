import { describe, test, expect } from 'bun:test';
import { FileAccessService } from './file-access.service';
import { createMockPrisma } from '@/test/prisma-mock';

const USER = 'user-1';
const SCHOOL = 'school-1';

/**
 * Build an access service whose principal resolution yields the given role and
 * course ids, and whose file_share table returns the given rows.
 */
function makeService(opts: {
  roleIds?: string[];
  courseIds?: string[];
  shares?: any[];
}) {
  const prisma = createMockPrisma();
  // principalsFor: membership → roles → courses
  prisma.school_management.findFirst.mockResolvedValue({ id: 'mgmt-1' });
  prisma.school_management_role.findMany.mockResolvedValue(
    (opts.roleIds ?? []).map((school_role_id) => ({ school_role_id })),
  );
  prisma.course_staff.findMany.mockResolvedValue(
    (opts.courseIds ?? []).map((course_id) => ({ course_id })),
  );
  prisma.student.findFirst.mockResolvedValue(null);
  prisma.course.findMany.mockResolvedValue(
    (opts.courseIds ?? []).map((id) => ({ id })),
  );
  prisma.file_share.findMany.mockResolvedValue(opts.shares ?? []);
  return new FileAccessService(prisma as any);
}

describe('accessFor', () => {
  test('owner gets full access regardless of status', async () => {
    const svc = makeService({});
    const access = await svc.accessFor(USER, SCHOOL, {
      id: 'f1',
      owner_id: USER,
      status: 'pending',
    });
    expect(access).toEqual({ isOwner: true, canView: true, canDownload: true });
  });

  test('non-owner with no matching share gets nothing', async () => {
    const svc = makeService({ shares: [] });
    const access = await svc.accessFor(USER, SCHOOL, {
      id: 'f1',
      owner_id: 'someone-else',
      status: 'ready',
    });
    expect(access).toEqual({
      isOwner: false,
      canView: false,
      canDownload: false,
    });
  });

  test('view-only share on a ready file: can view, cannot download', async () => {
    const svc = makeService({
      shares: [
        { principal_type: 'user', principal_id: USER, can_download: false },
      ],
    });
    const access = await svc.accessFor(USER, SCHOOL, {
      id: 'f1',
      owner_id: 'other',
      status: 'ready',
    });
    expect(access.canView).toBe(true);
    expect(access.canDownload).toBe(false);
  });

  test('a share never grants access to a not-yet-ready file', async () => {
    const svc = makeService({
      shares: [
        { principal_type: 'user', principal_id: USER, can_download: true },
      ],
    });
    const access = await svc.accessFor(USER, SCHOOL, {
      id: 'f1',
      owner_id: 'other',
      status: 'scanning',
    });
    expect(access.canView).toBe(false);
    expect(access.canDownload).toBe(false);
  });

  test('download flag is OR-ed across matching shares (role match wins)', async () => {
    const svc = makeService({
      roleIds: ['role-A'],
      shares: [
        { principal_type: 'user', principal_id: USER, can_download: false },
        { principal_type: 'role', principal_id: 'role-A', can_download: true },
      ],
    });
    const access = await svc.accessFor(USER, SCHOOL, {
      id: 'f1',
      owner_id: 'other',
      status: 'ready',
    });
    expect(access.canDownload).toBe(true);
  });
});

describe('downloadFlagsFor', () => {
  test('returns an empty map for no file ids', async () => {
    const svc = makeService({});
    const flags = await svc.downloadFlagsFor([], {
      userId: USER,
      roleIds: [],
      courseIds: [],
    });
    expect(flags.size).toBe(0);
  });

  test('maps only files the principals match, OR-ing can_download', async () => {
    const svc = makeService({
      shares: [
        // matches by course, downloadable
        {
          file_id: 'f1',
          principal_type: 'course',
          principal_id: 'c1',
          can_download: true,
        },
        // matches by user, view-only
        {
          file_id: 'f2',
          principal_type: 'user',
          principal_id: USER,
          can_download: false,
        },
        // does not match the caller
        {
          file_id: 'f3',
          principal_type: 'role',
          principal_id: 'role-Z',
          can_download: true,
        },
      ],
    });
    const flags = await svc.downloadFlagsFor(['f1', 'f2', 'f3'], {
      userId: USER,
      roleIds: [],
      courseIds: ['c1'],
    });
    expect(flags.get('f1')).toBe(true);
    expect(flags.get('f2')).toBe(false);
    expect(flags.has('f3')).toBe(false);
  });
});
