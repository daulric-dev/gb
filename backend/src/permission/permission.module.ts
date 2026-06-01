import { Module } from '@nestjs/common';
import { PermissionController } from './permission.controller';
import { PermissionMeController } from './permission-me.controller';
import { PermissionService } from './permission.service';
import { PermissionGuard } from './permission.guard';
import { PermissionCatalogSyncService } from './permission-catalog-sync.service';

@Module({
  controllers: [PermissionController, PermissionMeController],
  providers: [PermissionService, PermissionGuard, PermissionCatalogSyncService],
  exports: [PermissionGuard, PermissionService],
})
export class PermissionModule {}
