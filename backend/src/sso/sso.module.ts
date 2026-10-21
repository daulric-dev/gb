import { Module } from '@nestjs/common';
import { EmailDomainModule } from '@/email-domain/email-domain.module';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

@Module({
  imports: [EmailDomainModule],
  controllers: [SsoController],
  providers: [SsoService],
})
export class SsoModule {}
