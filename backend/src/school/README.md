# School (`src/school`)

Schools and staff membership. A school is the top-level unit every other record is scoped to. This module lets a signed-in user create a school (and become its admin), ask to join an existing one, and leave; it lets a school admin review join requests, list members and remove them.

Membership has two copies. The canonical one is a `public.school_management` row per (user, school) with the base role (`admin`, `member`, `teacher`, or null) and any custom roles through `school_management_role`. `public.user_profile.school_id` and `.role` are a denormalised copy of the user's **active** school and role, which most of the app reads. Every write here updates both and drops the user's `profile:<userId>` cache entry.

Students do not join through this module: a join request from an account whose `account_type` is `student` is refused at approval time. Students join with the school's join code ([`src/student-account`](../student-account/README.md)) or by email domain ([`src/email-domain`](../email-domain/README.md)).

## What it provides

### HTTP routes

The controller has `@UseGuards(AuthGuard, PermissionGuard)`, so every route needs a signed-in session. `PermissionGuard` only acts on routes with `@RequirePermission`. `AdminGuard` (from `src/auth`) requires `user_profile.role = 'admin'`, an active profile, and an `admin` membership row in the active school.

| Method | Path | Guard / who may call | What it does |
| --- | --- | --- | --- |
| GET | `/api/schools` | Any signed-in user | Active schools (`id`, `name`, `school_type`), sorted by name. Cached under `schools:all` for 30 days. Versioned as `school.list`. |
| GET | `/api/schools/my-pending-request` | Any signed-in user | The caller's pending join request, or null. |
| GET | `/api/schools/members` | `@RequirePermission('school', 'read')` | Members of the caller's active school with their base role, owner flag and custom (non-system) roles. |
| POST | `/api/schools/leave` | Any signed-in user | Leave the active school. Refused for the school owner and for the only admin. Deletes the membership and pending requests and clears the profile's school and role. |
| DELETE | `/api/schools/members/:membershipId` | `AdminGuard` | Remove a member of the admin's school. The owner and the admin themself cannot be removed. Removal, detaching the user and a `school_membership` entry in the [erasure log](../erasure/README.md) commit together (leaving a school logs one too). |
| POST | `/api/schools/members/:membershipId/sessions/revoke` | `AdminGuard` | Sign a staff member of the admin's school out of every device, at once (`SessionService.revokeAll(userId, 'admin')`); returns `{ revoked }`. A membership of another school is a 404; only the owner can sign the owner out (403). Logged at info level, not in the erasure log (nothing is erased). |
| GET | `/api/schools/join-requests` | `AdminGuard` | Pending join requests for the admin's school, oldest first. |
| PATCH | `/api/schools/join-requests/:requestId/approve` | `AdminGuard` | Approve with a base role and optional custom role ids. Upserts the membership, assigns custom roles, mirrors the profile and marks the request approved, all in one transaction. |
| PATCH | `/api/schools/join-requests/:requestId/reject` | `AdminGuard` | Mark a pending request rejected. |
| POST | `/api/schools` | Any signed-in user | Create a school; the creator becomes owner and admin. On a dedicated deployment (`DEDICATED_DEPLOYMENT=true`) only the first school can be created. Versioned as `school.detail`. |
| POST | `/api/schools/:schoolId/join-requests` | Any signed-in user | Ask to join an active school. One pending request per user. |

Other routes under `/api/schools/...` live elsewhere: `/api/schools/join-code` in `src/student-account`, `/api/schools/email-domains` in `src/email-domain`.

### Services / exports

- `SchoolService` (exported): `findAll`, `create`, `createJoinRequest`, `getPendingRequests`, `approveRequest`, `rejectRequest`, `getMyPendingRequest`, `getMembers`, `leaveSchool`, `removeMember`. Not global.

### Other

- `transformer.ts` - `v1SchoolList` and `v1SchoolDetail`, registered by `src/versioning/transformer-registry.ts` as `school.list` / `school.detail`. Both are pass-through today.

## Used by

- `src/app.module.ts` imports `SchoolModule`. No other module imports it or injects `SchoolService`; `src/auth/auth.service.ts` only refers to `SchoolService.create` in comments (the creator-is-admin rule).
- `src/versioning/transformer-registry.ts` imports `./transformer`.
- Web: `frontend/app/schools/page.tsx` (list, create, my pending request, request to join), `frontend/app/dashboard/staff/page.tsx` and `staff/_components/PendingRequestsTab.tsx` (members, join requests, approve, reject, remove), `frontend/app/dashboard/_components/AdminDashboard.tsx` (join requests), `frontend/app/dashboard/settings/page.tsx` (leave), and the member pickers in `dashboard/files/_components/ShareDialog.tsx` and `dashboard/courses/[courseId]/people/_components/AddStaffDialog.tsx`.
- Mobile: `mobile/app/(auth)/schools.tsx`, `mobile/app/staff/index.tsx`, `mobile/src/features/staff/PendingRequests.tsx`, `mobile/src/features/dashboard/AdminDashboard.tsx`, `mobile/src/features/files/ShareSheet.tsx`, `mobile/app/(tabs)/settings.tsx` (leave).
- Scripts: `scripts/student-flow-check.ts` checks that a student is denied `GET /schools/members`.

## Depends on

- `PrismaService`, `CacheService` (both global).
- `AuthGuard`, `AdminGuard` (`src/auth`), `PermissionGuard` and `@RequirePermission` (`src/permission`), `VersioningService` (`src/versioning`).

## Data

Tables in [`prisma/schema/school.prisma`](../../prisma/schema/school.prisma) (Postgres schema `public`):

- `school` - read, created.
- `school_management` - created, upserted, deleted, counted.
- `school_management_role` - created on approval; read for member lists.
- `school_role` - read to validate custom role ids (must belong to the school and not be a system role).
- `school_join_request` - created, read, updated (approve / reject), deleted on leave.
- `user_profile` - read; `school_id`, `role`, `is_active` updated.

Cache keys: `schools:all` (30 days, appended to on create) and `profile:<userId>` (deleted on create, approve, leave, remove).

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `DEDICATED_DEPLOYMENT` | unset | `true` blocks `POST /api/schools` once any school exists. |

## Files

| File | Purpose |
| --- | --- |
| `school.module.ts` | Declares the controller and `SchoolService`. |
| `school.controller.ts` | The routes above. |
| `school.service.ts` | Business logic and the profile mirror. |
| `transformer.ts` | v1 response transformers. |
| `dto/` | Request bodies - see [dto/README.md](./dto/README.md). |
| `school.service.test.ts` | Unit tests. |

## Tests

```bash
cd backend && bun test src/school
```

Covers `findAll` caching, `create` (cache append, DB error), `createJoinRequest` (no automatic admin takeover, no role written while joining, unknown school, duplicate pending request, insert failure), `getMembers` (shape and custom roles only) and `approveRequest` (other school refused; membership, profile and status written).

## See also

- [docs/content/backend/school.md](../../../docs/content/backend/school.md)
- [docs/content/dedicated-deployment.md](../../../docs/content/dedicated-deployment.md)
- [src/permission/README.md](../permission/README.md), [src/student-account/README.md](../student-account/README.md), [src/email-domain/README.md](../email-domain/README.md)
