import { describe, test, expect } from 'bun:test';
import { ForbiddenException } from '@nestjs/common';
import { FileManagerService } from './file-manager.service';
import { FileListFilter } from './dto/list-files.filter';
import { createRoutingSupabase, expectRejection } from '@/test/mocks';

const USER = 'user-1';

function fileRow(over: Partial<Record<string, any>> = {}) {
  return {
    id: 'f1',
    school_id: 'school-1',
    owner_id: USER,
    name: 'doc.pdf',
    bucket: 'file-manager',
    storage_path: 's/p',
    content_type: 'application/pdf',
    size_bytes: 10,
    source: 'upload',
    source_ref: null,
    status: 'ready',
    scan_detail: null,
    created_at: 't',
    updated_at: 't',
    ...over,
  };
}

/** Access stub: resolves principals once, no shared ids, no download grants. */
function accessStub(over: Partial<Record<string, any>> = {}) {
  return {
    principalsFor: () =>
      Promise.resolve({ userId: USER, roleIds: [], groupIds: [] }),
    sharedFileIdsFor: () => Promise.resolve(over.sharedIds ?? []),
    downloadFlagsFor: () =>
      Promise.resolve(over.downloadFlags ?? new Map<string, boolean>()),
  };
}

function makeService(
  fileResult: { data: any; error: any; count?: number },
  access = accessStub(),
) {
  const supabase = createRoutingSupabase({
    userSchoolId: 'school-1',
    tables: { 'file_manager.file': fileResult },
  });
  const chatSystem = { notifyFileShares: () => Promise.resolve() };
  const folders = {
    getOwned: () => Promise.resolve({ id: "folder-1", owner_id: USER }),
  };
  const svc = new FileManagerService(
    supabase as any,
    access as any,
    {} as any,
    chatSystem as any,
    folders as any,
  );
  return { svc, supabase };
}

describe('list', () => {
  test('returns a bare array when unpaginated and marks owner files downloadable', async () => {
    const { svc } = makeService({
      data: [fileRow({ id: 'a' }), fileRow({ id: 'b' })],
      error: null,
    });
    const out = await svc.list(USER, FileListFilter.Own);
    expect(Array.isArray(out)).toBe(true);
    const arr = out as any[];
    expect(arr).toHaveLength(2);
    expect(arr.every((f) => f.canDownload === true)).toBe(true);
  });

  test('short-circuits to empty when nothing is shared', async () => {
    const { svc } = makeService(
      { data: [], error: null },
      accessStub({ sharedIds: [] }),
    );
    const out = await svc.list(USER, FileListFilter.Shared);
    expect(out).toEqual([]);
  });

  test('resolves download rights from the batched flag map for shared files', async () => {
    const { svc } = makeService(
      {
        data: [fileRow({ id: 'x', owner_id: 'other' })],
        error: null,
      },
      accessStub({
        sharedIds: ['x'],
        downloadFlags: new Map([['x', true]]),
      }),
    );
    const out = (await svc.list(USER, FileListFilter.Shared)) as any[];
    expect(out).toHaveLength(1);
    expect(out[0].canDownload).toBe(true);
  });

  test('returns a paginated envelope when a page is requested', async () => {
    const { svc } = makeService({
      data: [fileRow({ id: 'a' }), fileRow({ id: 'b' })],
      error: null,
      count: 5,
    });
    const out = (await svc.list(USER, FileListFilter.Own, {
      page: 1,
      pageSize: 2,
    })) as any;
    expect(out.data).toHaveLength(2);
    expect(out.meta).toMatchObject({
      total: 5,
      page: 1,
      pageSize: 2,
      pageCount: 3,
      hasMore: true,
    });
  });
});

describe('ownership guard', () => {
  test('rename on a file the user does not own throws Forbidden', async () => {
    const { svc } = makeService({
      data: fileRow({ owner_id: 'someone-else' }),
      error: null,
    });
    const err = await expectRejection(svc.rename(USER, 'f1', 'new'));
    expect(err).toBeInstanceOf(ForbiddenException);
  });
});
