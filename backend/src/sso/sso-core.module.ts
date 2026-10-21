import { Global, Module } from '@nestjs/common';
import { SsoRegistry } from './sso.registry';

/**
 * The adapter registry on its own, global, so email domains (which store a
 * provider id) and sign-in (which uses one) share it without importing each
 * other's modules.
 */
@Global()
@Module({
  providers: [SsoRegistry],
  exports: [SsoRegistry],
})
export class SsoCoreModule {}
