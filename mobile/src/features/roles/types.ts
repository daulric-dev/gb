/**
 * Local types for the Roles (RBAC) feature. Mirrors the web frontend's
 * `app/dashboard/roles/_components/types.ts`. Kept local per convention —
 * do not add these to `@/lib/types`.
 */

export interface SchoolRole {
  id: string;
  name: string;
  description: string | null;
  /** Built-in roles are read-only: no edit / delete / permission changes. */
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export type PermissionAction = "create" | "read" | "update" | "delete";

export interface CatalogEntry {
  resource: string;
  action: PermissionAction;
  /** The permission key, formatted `resource:action`. */
  key: string;
  description: string;
}
