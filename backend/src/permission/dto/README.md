# Permission DTOs (`src/permission/dto`)

Request bodies for the admin role-management routes in `permission.controller.ts`. They are validated by the global `ValidationPipe`. Every route that uses them is behind `AuthGuard` and `AdminGuard`.

| File | Defines | Used by | Validation |
| --- | --- | --- | --- |
| `create-role.dto.ts` | `CreateRoleDto` | `POST /api/permissions/roles` | `name`: non-empty string, at most 100 characters. `description`: optional string, at most 300 characters. |
| `update-role.dto.ts` | `UpdateRoleDto` | `PATCH /api/permissions/roles/:roleId` | `name`: optional, at most 100. `description`: optional, at most 300. |
| `set-role-permissions.dto.ts` | `SetRolePermissionsDto` | `PUT /api/permissions/roles/:roleId/permissions` | `keys`: array of unique strings. It is the full replacement set; each key is checked against the catalog in `PermissionService.setRolePermissions()`. |
| `assign-role.dto.ts` | `AssignRoleDto` | `POST /api/permissions/members/:membershipId/roles` | `roleId`: non-empty UUID (a `school_role` id) |
| `change-member-role.dto.ts` | `ChangeMemberRoleDto` | `PATCH /api/permissions/members/:membershipId/base-role` | `role`: optional, `admin`, `member`, `teacher`, or `null` to clear the base role |

The DTOs only check shape. Rules that depend on data are enforced in `PermissionService`: unknown keys, system roles being read-only, everything belonging to the admin's school, and the school owner's role being fixed.

## Adding a DTO

Create `<name>.dto.ts` with class-validator rules and `@ApiProperty` decorators, use it as the `@Body()` type in `permission.controller.ts`, and put any data-dependent checks in `PermissionService`.
