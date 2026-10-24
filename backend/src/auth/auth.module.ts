import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { ImagesModule } from '@/images/images.module';
import { StudentAccountModule } from '@/student-account/student-account.module';
import { EmailDomainModule } from '@/email-domain/email-domain.module';

@Module({
  imports: [ImagesModule, StudentAccountModule, EmailDomainModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}
