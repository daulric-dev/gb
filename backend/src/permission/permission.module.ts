import { Module } from '@nestjs/common';
import { PermissionController } from './permission.controller';
import { PermissionService } from './permission.service';
import { PermissionGuard } from './permission.guard';
import { PermissionCatalogSyncService } from './permission-catalog-sync.service';

@Module({
  controllers: [PermissionController],
  providers: [PermissionService, PermissionGuard, PermissionCatalogSyncService],
  exports: [PermissionGuard, PermissionService],
})
export class PermissionModule {}
