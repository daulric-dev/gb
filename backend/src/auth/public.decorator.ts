import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:public';

/**
 * Marks a route (or a whole controller) as reachable without a session.
 *
 * AuthGuard runs globally (APP_GUARD in app.module.ts), so every route is
 * authenticated unless it says otherwise here. Adding this decorator opens a
 * route to the internet: route-coverage.test.ts holds the complete list of
 * public routes, so a new one fails that test until it is added there
 * deliberately.
 *
 * A route marked public still runs the guards its controller or handler lists
 * itself - the LTI Assignment and Grade Services routes, for instance, are
 * public to AuthGuard and authenticated by LtiAgsGuard's own bearer check.
 *
 * @example
 *   @Public()
 *   @Get('version')
 *   version() { ... }
 */
export const Public = () => SetMetadata<string, true>(IS_PUBLIC_KEY, true);
