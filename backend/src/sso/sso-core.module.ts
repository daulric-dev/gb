import { Global, Module } from '@nestjs/common';
import { SsoRegistry } from './sso.registry';
import { SsoSettingsService } from './sso-settings.service';
import { SchoolSsoService } from './school-sso.service';

/**
 * The adapter registry on its own, global, so email domains (which store a
 * provider id), schools and the organisation console (which edit a school's
 * sign-in apps) and sign-in (which uses them) share it without importing
 * each other's modules. SsoSettingsService holds each school's own app
 * settings, which the registry resolves per sign-in; SchoolSsoService is
 * the admin side of them.
 */
@Global()
@Module({
  providers: [SsoSettingsService, SsoRegistry, SchoolSsoService],
  exports: [SsoSettingsService, SsoRegistry, SchoolSsoService],
})
export class SsoCoreModule {}
