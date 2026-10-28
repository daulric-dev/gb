import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { APP_VERSION_HEADER } from './app-version.config';
import { AppVersionService } from './app-version.service';

/** 426 Upgrade Required (not in Nest's HttpStatus enum). */
export const UPGRADE_REQUIRED = 426;

/**
 * Routes an out-of-date build can still reach: the version check itself, so
 * it can find the store, and sign-out. /health is a raw Fastify route outside
 * Nest and never reaches a guard.
 */
const ALWAYS_ALLOWED = new Set(['/api/app/version', '/api/auth/logout']);

/**
 * Refuses API requests from a mobile build below the minimum version with 426
 * `{ code: 'update_required', storeUrl }`. Only the app sends the version
 * header; browsers and scripts never do, so they are never refused.
 */
@Injectable()
export class AppVersionGuard implements CanActivate {
  constructor(private readonly versions: AppVersionService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    const header = req.headers?.[APP_VERSION_HEADER];
    if (!header) return true;

    const path = String(req.url ?? '').split('?')[0];
    if (ALWAYS_ALLOWED.has(path)) return true;

    const refused = this.versions.updateRequired(header);
    if (!refused) return true;
    throw new HttpException(
      {
        statusCode: UPGRADE_REQUIRED,
        code: 'update_required',
        message: 'This version of GradeBook is out of date. Update the app to continue.',
        storeUrl: refused.storeUrl,
      },
      UPGRADE_REQUIRED,
    );
  }
}
