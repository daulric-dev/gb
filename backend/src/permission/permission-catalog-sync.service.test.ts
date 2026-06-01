import { describe, test, expect } from 'bun:test';
import { PermissionCatalogSyncService } from './permission-catalog-sync.service';
import { PERMISSION_CATALOG } from './permission.catalog';
import { createRoutingSupabase } from '@/test/mocks';

describe('PermissionCatalogSyncService', () => {
  test('upserts the full code catalog on boot', async () => {
    const sb = createRoutingSupabase({
      tables: {
        permission_catalog: (call) =>
          call.op === 'upsert'
            ? { data: null, error: null }
            : {
                data: PERMISSION_CATALOG.map((e) => ({ key: e.key })),
                error: null,
              },
      },
    });

    const svc = new PermissionCatalogSyncService(sb as any);
    await svc.onModuleInit();

    const upsert = sb._calls.find(
      (c) => c.table === 'permission_catalog' && c.op === 'upsert',
    );
    expect(upsert).toBeDefined();
    expect(upsert?.payload).toHaveLength(PERMISSION_CATALOG.length);
  });
});
