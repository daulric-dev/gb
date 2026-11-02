import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module';
import { FileManagerModule } from '@/file-manager/file-manager.module';
import { SchoolModule } from '@/school/school.module';
import { EmailDomainModule } from '@/email-domain/email-domain.module';
import { OrganisationController, SetupController } from './organisation.controller';
import { OrganisationService } from './organisation.service';
import { OrganisationAdminGuard } from './organisation-admin.guard';
import { InviteController } from './invite.controller';
import { InviteService } from './invite.service';
import { SignInController } from './sign-in.controller';

/**
 * The organisation that self-hosts this install: first-run setup, its
 * admins, and creating and staffing its schools (inviting admins who have
 * no account yet).
 */
@Module({
  // FileManagerModule (UploadLimitService) and SchoolModule (SchoolLogoService)
  // back the per-school settings routes; EmailDomainModule the sign-in ones.
  imports: [AuthModule, FileManagerModule, SchoolModule, EmailDomainModule],
  controllers: [SetupController, OrganisationController, InviteController, SignInController],
  providers: [OrganisationService, OrganisationAdminGuard, InviteService],
  exports: [OrganisationService, InviteService],
})
export class OrganisationModule {}
