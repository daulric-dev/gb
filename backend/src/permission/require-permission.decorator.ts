import { SetMetadata, applyDecorators } from '@nestjs/common';
import { Action, permKey, PermissionKey, Resource } from './permission.catalog';

export const PERMISSION_KEY = 'required_permission';
export const PERMISSION_SCOPE_KEY = 'required_permission_scope';

/**
 * Which school PermissionGuard checks the permission in.
 *
 * - `param`   - `:schoolId` on the route. The guard checks membership there,
 *               so naming another school only reaches a school you belong to.
 * - `course`  - the school owning `:courseId`.
 * - `active`  - the caller's active school (`user_profile.school_id`). Correct
 *               only when the handler also works in the active school; a
 *               handler that takes a resource id from the body and resolves
 *               its own school must not use this, or the permission is checked
 *               in one school while the work happens in another.
 *
 * Left out, the guard falls back to `param`, then `course`, then `active`, and
 * logs that it did. That fallback is how every route behaved before scopes
 * existed; the log is there so the remaining ones can be annotated and it can
 * be removed.
 */
export type PermissionScope = 'param' | 'course' | 'active';

/**
 * Declares the catalog permission a route requires. Read by PermissionGuard.
 * Routes without this decorator are not permission-gated (the guard is inert).
 *
 * @example
 *   @RequirePermission('course', 'create', 'active')
 *   @Post()
 *   create() { ... }
 */
export const RequirePermission = (
  resource: Resource,
  action: Action,
  scope?: PermissionScope,
) =>
  applyDecorators(
    SetMetadata<string, PermissionKey>(PERMISSION_KEY, permKey(resource, action)),
    ...(scope
      ? [SetMetadata<string, PermissionScope>(PERMISSION_SCOPE_KEY, scope)]
      : []),
  );
