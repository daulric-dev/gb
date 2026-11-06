import { Global, Module } from '@nestjs/common';
import {
  OrganisationAuditLogController,
  SchoolAuditLogController,
} from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

@Global()
@Module({
  controllers: [SchoolAuditLogController, OrganisationAuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
