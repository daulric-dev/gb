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
