import { describe, test, expect } from 'bun:test';
import { FileAccessService } from './file-access.service';
import { createRoutingSupabase } from '@/test/mocks';

const USER = 'user-1';
const SCHOOL = 'school-1';

/**
 * Build an access service whose principal resolution yields the given role and
 * group ids, and whose file_share table returns the given rows.
 */
function makeService(opts: {
  roleIds?: string[];
  groupIds?: string[];
  shares?: any[];
}) {
  const supabase = createRoutingSupabase({
    userSchoolId: SCHOOL,
    tables: {
      // principalsFor: membership → roles → groups
      school_management: { data: { id: 'mgmt-1' }, error: null },
      school_management_role: {
        data: (opts.roleIds ?? []).map((school_role_id) => ({
          school_role_id,
        })),
        error: null,
      },
      'staff.teacher_group_assignment': {
        data: (opts.groupIds ?? []).map((student_group_id) => ({
          student_group_id,
        })),
        error: null,
      },
      'file_manager.file_share': { data: opts.shares ?? [], error: null },
    },
  });
  return new FileAccessService(supabase as any);
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
      groupIds: [],
    });
    expect(flags.size).toBe(0);
  });

  test('maps only files the principals match, OR-ing can_download', async () => {
    const svc = makeService({
      shares: [
        // matches by group, downloadable
        {
          file_id: 'f1',
          principal_type: 'group',
          principal_id: 'g1',
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
      groupIds: ['g1'],
    });
    expect(flags.get('f1')).toBe(true);
    expect(flags.get('f2')).toBe(false);
    expect(flags.has('f3')).toBe(false);
  });
});
