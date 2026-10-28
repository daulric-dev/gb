# Permission (`src/permission`)

School-level, role-based access control. Each staff member of a school has a base role (`admin`, `teacher`, `member`, or none) on their `school_management` membership, and can be given extra **custom roles** that the school's admins define. A route declares the one catalog permission it needs with `@RequirePermission(resource, action)`, and `PermissionGuard` checks the caller's effective permissions in the school the request is about.

Effective permissions are:

> `ROLE_DEFAULTS[base role]` ∪ the permissions of every custom role assigned to the membership. Admins get the whole catalog.

The catalog only covers school-wide surfaces. Work inside a course (content, marking, people) is governed by the caller's course role through `CourseAccessService` and has no catalog keys of its own. Students hold no catalog permissions at all: they reach the API through `StudentGuard` and the `/api/portal` routes.

## What it provides

### HTTP routes

| Method | Path | Guard | What it does |
| --- | --- | --- | --- |
| GET | `/api/permissions/me` | `AuthGuard` (any signed-in user) | The caller's effective permissions in their active school: `{ schoolId, role, accountType, isAdmin, permissions }`. Students and users with no school get an empty list. |
| GET | `/api/permissions/catalog` | `AuthGuard` + `AdminGuard` | The code-defined catalog (`resource`, `action`, `key`, `description`) |
| GET | `/api/permissions/roles` | `AuthGuard` + `AdminGuard` | Roles in the admin's school, system roles first, then by name |
| POST | `/api/permissions/roles` | `AuthGuard` + `AdminGuard` | Create a custom role (`CreateRoleDto`). A duplicate name is a 400. |
| PATCH | `/api/permissions/roles/:roleId` | `AuthGuard` + `AdminGuard` | Rename or describe a custom role (`UpdateRoleDto`). System roles are refused (403). |
| DELETE | `/api/permissions/roles/:roleId` | `AuthGuard` + `AdminGuard` | Delete a custom role. System roles are refused. |
| GET | `/api/permissions/roles/:roleId/permissions` | `AuthGuard` + `AdminGuard` | A role's keys. For a system role these are its code defaults. |
| PUT | `/api/permissions/roles/:roleId/permissions` | `AuthGuard` + `AdminGuard` | Replace a custom role's keys (`SetRolePermissionsDto`). Unknown keys are a 400. Done in one transaction. |
| GET | `/api/permissions/members/:membershipId/roles` | `AuthGuard` + `AdminGuard` | Custom roles assigned to a membership |
| PATCH | `/api/permissions/members/:membershipId/base-role` | `AuthGuard` + `AdminGuard` | Change a member's base role (`ChangeMemberRoleDto`; `null` clears it). The school owner's role cannot be changed. |
| POST | `/api/permissions/members/:membershipId/roles` | `AuthGuard` + `AdminGuard` | Assign a custom role (`AssignRoleDto`). Idempotent upsert. |
| DELETE | `/api/permissions/members/:membershipId/roles/:roleId` | `AuthGuard` + `AdminGuard` | Unassign a custom role |

The management routes use `AdminGuard` rather than `PermissionGuard`, because gating role management with the permissions it manages would be circular. Every role and membership is checked to belong to the admin's own school (403 otherwise).

### Services / exports

`PermissionModule` exports `PermissionGuard` and `PermissionService`. It is not global, but the guard only needs global providers (`Reflector`, `CacheService`, `PrismaService`), so any controller can use `@UseGuards(AuthGuard, PermissionGuard)` without importing the module.

`PermissionService`:

- `listCatalog()`.
- `listRoles()`, `createRole()`, `updateRole()`, `deleteRole()`.
- `getRolePermissions()`, `setRolePermissions()`.
- `assignRoleToMember()`, `unassignRoleFromMember()`, `getMemberRoles()`.
- `changeMemberRole()`: also mirrors the role onto `user_profile.role`, but only when the membership is the user's active school, because `AdminGuard` trusts that column. It then clears `profile:<userId>` from the cache.
- `getMyPermissions(userId)`.
- Every write ends by deleting all cached effective sets (`deleteByPrefix('perm:eff:')`).

`PermissionCatalogSyncService` runs on boot (`onModuleInit`). It upserts every code catalog entry into `public.permission_catalog`, and logs any database keys that are no longer in code without deleting them, so admin-configured grants are never dropped silently. Removing a key therefore takes a migration that deletes its row (grants cascade), as `20261025100000_drop_unenforced_permissions` did for `course:read`, `course:delete`, `student:delete` and `academic-year:delete`. The guard never reads this table: it exists as the foreign-key target for grants and as the list the admin UI shows.

### Other

- **`@RequirePermission(resource, action)`** (`require-permission.decorator.ts`) sets the `required_permission` metadata. Routes without it are not permission-gated.
- **`PermissionGuard`**:
  1. With no metadata, the guard lets the request through.
  2. Without `request.user`, it fails closed (403).
  3. It resolves the school from `:schoolId`, else from the course in `:courseId`, else from the user's active school (`user_profile.school_id`).
  4. It loads the effective set. A non-member gets 403 "not a member of this school"; a missing key gets 403 `Missing permission: <key>`.
- **`permission.effective.ts`**:
  - `computeEffectivePermissions(prisma, userId, schoolId)`.
  - `loadEffectivePermissions(prisma, cache, userId, schoolId)`, the same with a cache in front: key `perm:eff:<userId>:<schoolId>`, TTL `PERM_TTL` = 45 s.
  - Also exports `permCacheKey()` and `PERM_CACHE_PREFIX`.
- **`permission.catalog.ts`**:
  - `RESOURCES` and `ACTIONS`, and `actionsFor()`.
  - `permKey()`, `PERMISSION_CATALOG`, `PERMISSION_KEYS` and `isPermissionKey()`.
  - `ROLE_DEFAULTS` and `defaultsForRole()`.

## Permission catalog

Keys are `<resource>:<action>`, and a key exists only when something enforces it. Every resource has `create`, `read`, `update` and `delete` except these, listed in `RESOURCE_ACTIONS`: `school` has `read` and `update`; `course` has `create` and `update` (reading and deleting a course are decided by the course role in `CourseAccessService`); `student` and `join-code` have `read` and `update` (students self-register and join via code; join codes are issued/revoked via update and inspected via read); `academic-year` has `create`, `read` and `update` (it has no delete route). That makes 31 keys. Admins hold every key. The defaults for the other base roles come from `ROLE_DEFAULTS`:

| Key | Description | teacher | member | Enforced by |
| --- | --- | :---: | :---: | --- |
| `course:create` | Create courses | yes | | `@RequirePermission` in `course.controller.ts`, `course-copy.controller.ts`; `course-copy.service.ts` checks it via `loadEffectivePermissions` |
| `course:update` | Edit courses | | | Not a route decorator: `CourseAccessService` treats a holder as course `admin` in every course, and `course.service.ts` and `dashboard.service.ts` use it to show all of the school's courses |
| `student:read` | View students | yes | yes | `student.controller.ts` |
| `student:update` | Edit students | | | `student.controller.ts` |
| `join-code:read` | View school join code status | yes | yes | `student-account/school-join-code.controller.ts` |
| `join-code:update` | Issue and revoke the school join code | | | `student-account/school-join-code.controller.ts` |
| `term:create` | Create academic terms | | | `term.controller.ts` |
| `term:read` | View academic terms | yes | yes | `term.controller.ts` |
| `term:update` | Edit academic terms | | | `term.controller.ts` |
| `term:delete` | Delete academic terms | | | `term.controller.ts` |
| `academic-year:create` | Create academic years | | | `academic-year.controller.ts` |
| `academic-year:read` | View academic years | yes | yes | `academic-year.controller.ts` |
| `academic-year:update` | Edit academic years | | | `academic-year.controller.ts` |
| `grade-scale:create` | Create grade scales | | | `grade-scale.controller.ts` (also `AdminGuard`) |
| `grade-scale:read` | View grade scales | yes | yes | `grade-scale.controller.ts` |
| `grade-scale:update` | Edit grade scales | | | `grade-scale.controller.ts` (also `AdminGuard`) |
| `grade-scale:delete` | Delete grade scales | | | `grade-scale.controller.ts` (also `AdminGuard`) |
| `school:read` | View school settings | yes | yes | `school.controller.ts` |
| `school:update` | Edit school settings | | | `billing.controller.ts` (plan, payment, invoices) |
| `announcement:create` | Create announcements | yes | | `announcement.controller.ts` |
| `announcement:read` | View announcements | yes | yes | `announcement.controller.ts` |
| `announcement:update` | Edit announcements | yes | | `announcement.controller.ts` |
| `announcement:delete` | Delete announcements | yes | | `announcement.controller.ts` |
| `file:create` | Create files | yes | yes | `file-manager.controller.ts` |
| `file:read` | View files | yes | yes | `file-manager.controller.ts` |
| `file:update` | Edit files | yes | yes | `file-manager.controller.ts` (ownership is checked per file in the service) |
| `file:delete` | Delete files | yes | yes | `file-manager.controller.ts` |
| `chat:create` | Create chat messages | yes | yes | `chat.controller.ts` |
| `chat:read` | View chat messages | yes | yes | `chat.controller.ts` |
| `chat:update` | Edit chat messages | yes | yes | `chat.controller.ts` (ownership is checked per row) |
| `chat:delete` | Delete chat messages | yes | yes | `chat.controller.ts` |

A custom role can grant any of these keys on top of the base role's defaults. System roles (`school_role.is_system`) are read-only and report their code defaults.

## Used by

- **`PermissionGuard` + `@RequirePermission`**: the controllers in the table above, which are `academic-year`, `announcement`, `billing`, `chat`, `course` (`course.controller.ts`, `course-copy.controller.ts`), `file-manager`, `grade-scale`, `school`, `student`, `student-account/school-join-code.controller.ts` and `term`.
- **`loadEffectivePermissions`**:
  - `course/access/course-access.service.ts`: `course:update` means course admin.
  - `course/course.service.ts`: sees all courses.
  - `course/course-copy.service.ts`: `course:create`.
  - `dashboard/dashboard.service.ts`: admin view.
- **`permCacheKey`**: `email-domain/email-domain.service.ts` clears a user's cached set after a domain auto-join.
- **`PermissionModule`** is imported by `src/app.module.ts` and `src/billing/billing.module.ts`.
- **Front end**:
  - `frontend/providers/PermissionsProvider.tsx` calls `GET /permissions/me` for UI gating.
  - `frontend/app/dashboard/roles/` (the page, `RoleFormDialog.tsx`, `PermissionsEditor.tsx`) uses the role and catalog routes.
  - `frontend/app/dashboard/staff/_components/MemberRolesDialog.tsx` and `PendingRequestsTab.tsx` manage member roles.
  - `frontend/app/dashboard/files/_components/ShareDialog.tsx` lists roles to share files with.
- **Mobile**: `mobile/src/providers/PermissionsProvider.tsx` calls `/permissions/me`, and `mobile/app/roles/index.tsx` and `mobile/src/features/roles/RoleForm.tsx` call the role routes.

## Depends on

- `PrismaService`.
- `CacheService` (effective-permission cache).
- `AuthGuard` and `AdminGuard` from `src/auth`.
- `userSchoolId()` from `src/common/user-school.ts`.
- `isUniqueViolation()` and `pgCode()` from `src/common/db-values.ts`.

## Data

All tables are in the `public` schema; see [`prisma/schema/school.prisma`](../../prisma/schema/school.prisma).

| Table | Use |
| --- | --- |
| `permission_catalog` | Catalog rows, kept in sync on boot |
| `school_role` | Custom and system roles per school |
| `school_role_permission` | Grants (role to catalog row) |
| `school_management` | Membership, holding the base `role` |
| `school_management_role` | Custom roles assigned to a membership |
| `user_profile` | Active `school_id`, `account_type`, mirrored `role` |
| `school` | `owner_id` |
| `course` | `school_id`, used for school resolution in the guard |

## Configuration

None. The cache TTL (`PERM_TTL` = 45 seconds) is a constant in `permission.effective.ts`.

## Files

| File | Purpose |
| --- | --- |
| `permission.module.ts` | Module wiring; exports `PermissionGuard` and `PermissionService` |
| `permission.catalog.ts` | Resources, actions, catalog, role defaults |
| `permission.effective.ts` | Effective-permission computation and cache |
| `permission.guard.ts` | `PermissionGuard` |
| `require-permission.decorator.ts` | `@RequirePermission()` |
| `permission.service.ts` | Role and grant management, `getMyPermissions()` |
| `permission.controller.ts` | Admin role-management routes |
| `permission-me.controller.ts` | `GET /api/permissions/me` |
| `permission-catalog-sync.service.ts` | Boot-time catalog sync |
| `permission.catalog.test.ts` | Catalog shape and role defaults |
| `permission.guard.test.ts` | Guard behaviour |
| `permission.service.test.ts` | Service behaviour |
| `permission-catalog-sync.service.test.ts` | Boot sync upserts the full catalog |
| `dto/` | Request DTOs, see [`dto/README.md`](dto/README.md) |

## Tests

`cd backend && bun test src/permission`. Covers:

- **Catalog**: resources without an override expose every action; `course`, `student` and `academic-year` have exactly their reduced sets and the four removed keys are not valid; `school` has only `read` and `update`; admins get exactly the catalog; teachers and members get `school:read` only.
- **Guard**: inert without metadata; fails closed without a user; admin passes, teacher defaults allow and deny the right keys; a custom role adds a key; students and non-members are denied; the school is resolved from `:courseId`; the cache is used.
- **Service**: role creation and duplicates, system-role protection, setting keys (rejects unknown keys, invalidates the cache), `getMyPermissions` for no school, students, admins and the cached path, cross-school membership rejection, `changeMemberRole` (null role, school owner, the not-null migration hint).
- **Sync**: every catalog entry is upserted on boot.

## Adding a permission

1. Add the resource to `RESOURCES` and `RESOURCE_LABELS` in `permission.catalog.ts`. If it does not support all four actions, add it to `RESOURCE_ACTIONS`.
2. Decide the defaults in `ROLE_DEFAULTS`.
3. Put `@RequirePermission('<resource>', '<action>')` on the routes and `@UseGuards(AuthGuard, PermissionGuard)` on the controller.
4. The boot sync adds the rows to `permission_catalog`. No migration is needed for new keys.
5. Update `permission.catalog.test.ts`.

## See also

- [`docs/content/backend/overview.md`](../../../docs/content/backend/overview.md)
- [`../grade-scale/README.md`](../grade-scale/README.md), [`../file-manager/README.md`](../file-manager/README.md): examples of permission-gated modules
