import { SetMetadata } from '@nestjs/common';
import { Action, permKey, PermissionKey, Resource } from './permission.catalog';

export const PERMISSION_KEY = 'required_permission';

/**
 * Declares the catalog permission a route requires. Read by PermissionGuard.
 * Routes without this decorator are not permission-gated (the guard is inert).
 *
 * @example
 *   @RequirePermission('attendance', 'create')
 *   @Post()
 *   mark() { ... }
 */
export const RequirePermission = (resource: Resource, action: Action) =>
  SetMetadata<string, PermissionKey>(PERMISSION_KEY, permKey(resource, action));
