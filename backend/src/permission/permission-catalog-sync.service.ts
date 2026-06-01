import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '@/supabase/supabase.service';
import { PERMISSION_CATALOG, PERMISSION_KEYS } from './permission.catalog';

/**
 * Keeps the public.permission_catalog table in sync with the code-defined
 * catalog on boot. Upserts every code key; logs (does not delete) DB keys that
 * are absent from code so a removed resource is noticed but never silently
 * drops admin-configured grants. The guard never reads this table — it exists
 * only as an FK target and for the admin UI to list assignable permissions.
 */
@Injectable()
export class PermissionCatalogSyncService implements OnModuleInit {
  private readonly logger = new Logger(PermissionCatalogSyncService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async onModuleInit(): Promise<void> {
    const supabase = this.supabaseService.getServiceClient();

    const rows = PERMISSION_CATALOG.map((e) => ({
      resource: e.resource,
      action: e.action,
      key: e.key,
      description: e.description,
    }));

    const { error } = await supabase
      .from('permission_catalog')
      .upsert(rows, { onConflict: 'resource,action' });

    if (error) {
      this.logger.error(`Failed to sync permission catalog: ${error.message}`);
      return;
    }

    const { data: existing, error: readError } = await supabase
      .from('permission_catalog')
      .select('key');

    if (!readError && existing) {
      const orphans = existing
        .map((r: { key: string }) => r.key)
        .filter((k: string) => !PERMISSION_KEYS.has(k as never));
      if (orphans.length > 0) {
        this.logger.warn(
          `permission_catalog has ${orphans.length} key(s) not present in code (left in place): ${orphans.join(', ')}`,
        );
      }
    }

    this.logger.log(`Synced ${rows.length} permission catalog entries`);
  }
}
