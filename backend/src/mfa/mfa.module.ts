import { Global, Module } from '@nestjs/common';
import { AuthGuard } from '@/auth/auth.guard';
import { OrganisationAdminGuard } from '@/organisation/organisation-admin.guard';
import { MfaController, MfaOrganisationController } from './mfa.controller';
import { MfaService } from './mfa.service';

/**
 * Authenticator-app two-step verification. Global, so sign-in (AuthService,
 * SsoService) and AuthGuard (the enrolment gate) reach MfaService without
 * importing this module - and this module provides its own AuthGuard rather
 * than importing AuthModule, so nothing is circular. Prisma, cache, sessions,
 * audit log and mail come from their global modules.
 */
@Global()
@Module({
  controllers: [MfaController, MfaOrganisationController],
  providers: [MfaService, AuthGuard, OrganisationAdminGuard],
  exports: [MfaService],
})
export class MfaModule {}
