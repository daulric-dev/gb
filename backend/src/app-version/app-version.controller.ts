import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { AppVersionService } from './app-version.service';

/**
 * Public: the mobile app asks it on launch and on returning to the
 * foreground, signed in or not. Only the default throttler applies.
 */
@ApiTags('App')
@Controller('app')
export class AppVersionController {
  constructor(private readonly versions: AppVersionService) {}

  /** `{ ios: { minimum, latest, storeUrl }, android: { ... } }`, nulls when unset. */
  @Get('version')
  version(@Res({ passthrough: true }) reply: FastifyReply) {
    // Short, so raising the minimum reaches every app within minutes.
    reply.header('Cache-Control', 'public, max-age=300');
    return this.versions.versions();
  }
}
