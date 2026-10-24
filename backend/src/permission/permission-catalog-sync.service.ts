import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { PERMISSION_CATALOG, PERMISSION_KEYS } from './permission.catalog';

/**
 * Keeps the public.permission_catalog table in sync with the code-defined
 * catalog on boot. Upserts every code key; logs (does not delete) DB keys that
 * are absent from code so a removed resource is noticed but never silently
 * drops admin-configured grants. The guard never reads this table - it exists
 * only as an FK target and for the admin UI to list assignable permissions.
 */
@Injectable()
export class PermissionCatalogSyncService implements OnModuleInit {
  private readonly logger = new Logger(PermissionCatalogSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const rows = PERMISSION_CATALOG.map((e) => ({
      resource: e.resource,
      action: e.action,
      key: e.key,
      description: e.description,
    }));

    try {
      await this.prisma.$transaction(
        rows.map((row) =>
          this.prisma.permission_catalog.upsert({
            where: {
              resource_action: { resource: row.resource, action: row.action },
            },
            create: row,
            update: { key: row.key, description: row.description },
          }),
        ),
      );
    } catch (err) {
      this.logger.error(
        `Failed to sync permission catalog: ${(err as Error).message}`,
      );
      return;
    }

    try {
      const existing = await this.prisma.permission_catalog.findMany({
        select: { key: true },
      });
      const orphans = existing
        .map((r) => r.key)
        .filter((k) => !PERMISSION_KEYS.has(k as never));
      if (orphans.length > 0) {
        this.logger.warn(
          `permission_catalog has ${orphans.length} key(s) not present in code (left in place): ${orphans.join(', ')}`,
        );
      }
    } catch {
      // Orphan reporting is best effort.
    }

    this.logger.log(`Synced ${rows.length} permission catalog entries`);
  }
}
