import { describe, test, expect } from 'bun:test';
import { PermissionCatalogSyncService } from './permission-catalog-sync.service';
import { PERMISSION_CATALOG } from './permission.catalog';
import { createMockPrisma } from '@/test/prisma-mock';

describe('PermissionCatalogSyncService', () => {
  test('upserts the full code catalog on boot', async () => {
    const prisma = createMockPrisma();
    prisma.permission_catalog.findMany.mockResolvedValue(
      PERMISSION_CATALOG.map((e) => ({ key: e.key })),
    );

    const svc = new PermissionCatalogSyncService(prisma as any);
    await svc.onModuleInit();

    expect(prisma.permission_catalog.upsert).toHaveBeenCalledTimes(
      PERMISSION_CATALOG.length,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
