import { describe, test, expect } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { FolderService } from './folder.service';
import { createRoutingSupabase, expectRejection } from '@/test/mocks';

const USER = 'u1';

function folderRow(over: Record<string, any> = {}) {
  return {
    id: 'f1',
    school_id: 's1',
    owner_id: USER,
    parent_id: null,
    name: 'Folder',
    is_system: false,
    created_at: 't',
    updated_at: 't',
    ...over,
  };
}

function service(route: (state: any) => { data: any; error: any }) {
  const supabase = createRoutingSupabase({
    userSchoolId: 's1',
    tables: { 'file_manager.folder': route },
  });
  return new FolderService(supabase as any);
}

describe('FolderService.create', () => {
  test('creates a root folder and sanitizes the name', async () => {
    const svc = service((state) =>
      state.op === 'insert'
        ? { data: folderRow({ name: state.payload.name, parent_id: null }), error: null }
        : { data: null, error: null },
    );
    const out = await svc.create(USER, '  Term / Reports  ');
    // Slashes are replaced (they would break folder pathing) and trimmed.
    expect(out.name).toBe('Term - Reports');
    expect(out.parentId).toBeNull();
    expect(out.isSystem).toBe(false);
  });

  test('rejects a duplicate name via the unique index', async () => {
    const svc = service((state) =>
      state.op === 'insert'
        ? { data: null, error: { code: '23505', message: 'duplicate key' } }
        : { data: null, error: null },
    );
    const err = await expectRejection(svc.create(USER, 'Reports'));
    expect(err).toBeInstanceOf(BadRequestException);
  });

  test('rejects an empty name', async () => {
    const svc = service(() => ({ data: null, error: null }));
    const err = await expectRejection(svc.create(USER, '   '));
    expect(err).toBeInstanceOf(BadRequestException);
  });
});

describe('FolderService.rename', () => {
  test('refuses to rename a system folder', async () => {
    // getOwned resolves via select; return a system folder.
    const svc = service((state) =>
      state.op === 'select'
        ? { data: folderRow({ is_system: true, name: 'Reports' }), error: null }
        : { data: folderRow(), error: null },
    );
    const err = await expectRejection(svc.rename(USER, 'f1', 'Nope'));
    expect(err).toBeInstanceOf(BadRequestException);
  });
});

describe('FolderService.move', () => {
  test('rejects moving a folder into itself', async () => {
    const svc = service((state) =>
      state.op === 'select'
        ? { data: folderRow({ id: 'A' }), error: null }
        : { data: folderRow(), error: null },
    );
    const err = await expectRejection(svc.move(USER, 'A', 'A'));
    expect(err).toBeInstanceOf(BadRequestException);
  });

  test('is a no-op when the folder is already in the destination', async () => {
    const svc = service((state) => {
      if (state.op === 'update') {
        throw new Error('should not update on a no-op move');
      }
      return { data: folderRow({ id: 'A', parent_id: 'P' }), error: null };
    });
    const out = await svc.move(USER, 'A', 'P');
    expect(out.parentId).toBe('P');
  });

  test('moves a folder to the root', async () => {
    const svc = service((state) =>
      state.op === 'update'
        ? { data: folderRow({ id: 'A', parent_id: null }), error: null }
        : { data: folderRow({ id: 'A', parent_id: 'P' }), error: null },
    );
    const out = await svc.move(USER, 'A', null);
    expect(out.parentId).toBeNull();
  });

  test('rejects moving a folder into one of its own descendants', async () => {
    let subtreeCalls = 0;
    const svc = service((state) => {
      if (state.op === 'update') return { data: folderRow(), error: null };
      // getOwned queries filter by id; collectSubtree does not.
      if (state.filters.id === 'A') {
        return { data: folderRow({ id: 'A', parent_id: null }), error: null };
      }
      if (state.filters.id === 'B') {
        return { data: folderRow({ id: 'B', parent_id: 'A' }), error: null };
      }
      // collectSubtree BFS: first level returns B, then nothing.
      subtreeCalls += 1;
      return { data: subtreeCalls === 1 ? [{ id: 'B' }] : [], error: null };
    });
    // B is a child of A; moving A under B would create a cycle.
    const err = await expectRejection(svc.move(USER, 'A', 'B'));
    expect(err).toBeInstanceOf(BadRequestException);
  });
});

describe('FolderService.findOrCreateSystemPath', () => {
  test('creates each missing segment and returns the leaf id', async () => {
    const svc = service((state) => {
      if (state.op === 'insert') {
        const id = state.payload.name === 'Reports' ? 'reports-id' : 'date-id';
        return { data: { id }, error: null };
      }
      // No existing folder — force the create path for both segments.
      return { data: null, error: null };
    });
    const leaf = await svc.findOrCreateSystemPath(USER, 's1', [
      'Reports',
      '2026-07-12',
    ]);
    expect(leaf).toBe('date-id');
  });

  test('reuses an existing folder without inserting', async () => {
    const svc = service((state) => {
      if (state.op === 'select') return { data: { id: 'existing' }, error: null };
      throw new Error('should not insert when the folder already exists');
    });
    const leaf = await svc.findOrCreateSystemPath(USER, 's1', ['Reports']);
    expect(leaf).toBe('existing');
  });
});
