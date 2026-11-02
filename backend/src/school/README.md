# School (`src/school`)

Schools and staff membership. A school is the top-level unit every other record is scoped to. Schools are created by organisation admins ([`src/organisation`](../organisation/README.md)); this module lets a signed-in user ask to join an existing one and leave; it lets a school admin review join requests, list members and remove them.

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
| GET | `/api/schools/current/upload-limit` | Any signed-in user (students too) | The active school's upload limit: `{ uploadLimitBytes, uploadLimitMb, maxUploadMb, platformMaxMb, platformDefaultMb }`. `maxUploadMb` is the school's own setting (null = platform default). 400 without an active school. Versioned as `school.uploadLimit`. |
| PATCH | `/api/schools/current/upload-limit` | `@RequirePermission('school', 'update')` | Body `{ maxUploadMb: number \| null }` (`UpdateUploadLimitDto`); null returns the school to the default. Above `UPLOAD_MAX_MB` is a 400 naming that limit. Returns the same shape as the GET. Resolution and caching are in `UploadLimitService` ([`src/file-manager`](../file-manager/README.md)). |
| GET | `/api/schools/current/features` | `@RequirePermission('school', 'update')` | Platform features for the active school: `[{ key, label, description, availableInOrganisation, enabledForSchool, effective, requires }]`. From `FeatureService` ([`src/features`](../features/README.md)). 400 without an active school. |
| PATCH | `/api/schools/current/features` | `@RequirePermission('school', 'update')` | Body `{ features: { [key]: boolean } }` (`UpdateFeaturesDto`). `false` switches a feature off for the school, `true` back on; `true` for one the organisation does not allow is a 400 "<Label> is turned off for your organisation", an unknown key a 400. Clears cached profiles. Returns the same list. |
| GET | `/api/schools/current/sso/providers` | `@RequirePermission('school', 'update')` | The active school's sign-in providers: its own Google and Microsoft apps (or the install-wide env fallback while it has none) and SAML's service provider details. Never a secret. Same items as the organisation console's `/api/organisation/schools/:id/sso/providers` (`SchoolSsoService`, [`src/sso`](../sso/README.md)). 400 without an active school. |
| PUT | `/api/schools/current/sso/providers/:key` | `@RequirePermission('school', 'update')` | Body `{ enabled?, clientId?, clientSecret?, settings? }` (`UpdateSchoolSsoProviderDto`). Saves the active school's own app for `google` or `azure`; the secret is write-only and encrypted. 400 for enabling without a client ID and secret, for `saml`, or an empty body; 404 for an unknown provider. Returns the item. Needs a step-up confirmation (`@RequireStepUp()`, 403 `STEP_UP_REQUIRED`); logged to the SSO audit log, and may email the school's admins ([`src/sso`](../sso/README.md)). |
| QUERY | `/api/schools/current/sso/audit` | `@RequirePermission('school', 'update')` + `AdminGuard` | The active school's single sign-on activity, newest first. JSON body `ListSsoAuditQueryDto`: `limit` (1-200, default 50; else 400), `before` (UUID of the last entry shown). `SsoAuditService.list`, never a secret. |
| POST | `/api/schools/current/logo/upload-ticket` | `@RequirePermission('school', 'update')` | Body `{ filename, contentType, totalSize }` (`CreateResumableUploadDto` from `src/images/dto`). A presigned PUT (5 minutes) to `images/uploads/school-logos/<schoolId>-<32 hex>.<ext>`. JPEG, PNG or WebP (never SVG), at most 2 MB. |
| POST | `/api/schools/current/logo/complete` | `@RequirePermission('school', 'update')` | Body `{ path }`, which must be a staging key for the active school. Verifies size, type and leading bytes, serves the bytes from `images/school-logos/<schoolId>-<32 hex>.<ext>`, deletes the staged and previous objects, sets `school.logo_path` and drops every member's cached profile. Returns `{ logoUrl }`. |
| DELETE | `/api/schools/current/logo` | `@RequirePermission('school', 'update')` | Clear the logo and delete its object; returns `{ logoUrl: null }`. |

Organisation admins reach the same upload-limit, logo and features services for any school, without switching into it, through `/api/organisation/schools/:id/*` ([`src/organisation`](../organisation/README.md)); `SchoolModule` exports `SchoolLogoService` for that.
| POST | `/api/schools/leave` | Any signed-in user | Leave the active school. Refused for the school owner and for the only admin. Deletes the membership and pending requests and clears the profile's school and role. An organisation admin managing the school without a membership just has the profile's school and role cleared. |
| DELETE | `/api/schools/members/:membershipId` | `AdminGuard` | Remove a member of the admin's school. The owner and the admin themself cannot be removed. Removal, detaching the user and a `school_membership` entry in the [erasure log](../erasure/README.md) commit together (leaving a school logs one too). |
| POST | `/api/schools/members/:membershipId/sessions/revoke` | `AdminGuard` | Sign a staff member of the admin's school out of every device, at once (`SessionService.revokeAll(userId, 'admin')`); returns `{ revoked }`. A membership of another school is a 404; only the owner can sign the owner out (403). Logged at info level, not in the erasure log (nothing is erased). |
| GET | `/api/schools/join-requests` | `AdminGuard` | Pending join requests for the admin's school, oldest first. |
| PATCH | `/api/schools/join-requests/:requestId/approve` | `AdminGuard` | Approve with a base role and optional custom role ids. Upserts the membership, assigns custom roles, mirrors the profile and marks the request approved, all in one transaction. |
| PATCH | `/api/schools/join-requests/:requestId/reject` | `AdminGuard` | Mark a pending request rejected. |
| POST | `/api/schools/:schoolId/join-requests` | Any signed-in user | Ask to join an active school. One pending request per user. |

Members read the logo from their profile: `GET /api/auth/me` embeds the school with `logo_url` (null without one), and the student portal's `GET /api/portal/me` has `school.logoUrl`. Logos are served publicly by an unguessable name from `GET /api/images/school-logos/<file>` (or the image CDN), like avatars.

There is no `POST /api/schools`: schools are created with `POST /api/organisation/schools`, which also appoints their admin. Other routes under `/api/schools/...` live elsewhere: `/api/schools/join-code` in `src/student-account`, `/api/schools/email-domains` in `src/email-domain`.

### Services / exports

- `SchoolLogoService` (not exported): `createTicket`, `complete`, `remove`, built on `ImagesService`'s shared upload steps. Exports `SCHOOL_LOGO_MAX_BYTES`.
- `SchoolService` (exported): `findAll`, `createJoinRequest`, `getPendingRequests`, `approveRequest`, `rejectRequest`, `getMyPendingRequest`, `getMembers`, `leaveSchool`, `removeMember`. Not global.

### Other

- `transformer.ts` - `v1SchoolList` and `v1SchoolUploadLimit`, registered by `src/versioning/transformer-registry.ts` as `school.list` / `school.uploadLimit`. All are pass-through today.

## Used by

- `src/app.module.ts` imports `SchoolModule`, which imports `FileManagerModule` for `UploadLimitService` and `ImagesModule` for `ImagesService`. No other module imports it or injects `SchoolService`. `src/organisation` creates schools and appoints their admins itself, and drops the `schools:all` cache entry when it does.
- `src/versioning/transformer-registry.ts` imports `./transformer`.
- Web: `frontend/app/schools/page.tsx` (list, my pending request, request to join), `frontend/app/dashboard/staff/page.tsx` and `staff/_components/PendingRequestsTab.tsx` (members, join requests, approve, reject, remove), `frontend/app/dashboard/_components/AdminDashboard.tsx` (join requests), `frontend/app/dashboard/settings/page.tsx` (leave) and `settings/_components/upload-limit-settings.tsx` (upload limit) and `settings/_components/school-logo-settings.tsx` (logo; both also used, with `apiBase` `/organisation/schools/<id>`, by `frontend/app/organisation/schools/[schoolId]/page.tsx`; via `uploadSchoolLogo` in `lib/files/upload.ts`; shown by `components/layout/app-sidebar.tsx` and `app/portal/layout.tsx`), `frontend/lib/files/upload-limit.ts` (upload limit pre-check), and the member pickers in `dashboard/files/_components/ShareDialog.tsx` and `dashboard/courses/[courseId]/people/_components/AddStaffDialog.tsx`.
- Mobile: `mobile/app/(auth)/schools.tsx`, `mobile/app/staff/index.tsx`, `mobile/src/features/staff/PendingRequests.tsx`, `mobile/src/features/dashboard/AdminDashboard.tsx`, `mobile/src/features/files/ShareSheet.tsx`, `mobile/app/(tabs)/settings.tsx` (leave), `mobile/src/lib/upload-limit.ts` (upload limit pre-check), `mobile/src/features/dashboard/SchoolLogo.tsx` (shows the logo on the home screens; editing is web-only).
- Scripts: `scripts/student-flow-check.ts` checks that a student is denied `GET /schools/members`.

## Depends on

- `PrismaService`, `CacheService` (both global).
- `AuthGuard`, `AdminGuard` (`src/auth`), `PermissionGuard` and `@RequirePermission` (`src/permission`), `VersioningService` (`src/versioning`).

## Data

Tables in [`prisma/schema/school.prisma`](../../prisma/schema/school.prisma) (Postgres schema `public`):

- `school` - read; `max_upload_mb` updated through `UploadLimitService`; `logo_path` (storage key under `images/school-logos/`) set and cleared by `SchoolLogoService`.
- `school_management` - upserted, deleted, counted.
- `school_management_role` - created on approval; read for member lists.
- `school_role` - read to validate custom role ids (must belong to the school and not be a system role).
- `school_join_request` - created, read, updated (approve / reject), deleted on leave.
- `user_profile` - read; `school_id`, `role`, `is_active` updated.

Cache keys: `upload-limit:<schoolId>` (60 seconds, owned by `UploadLimitService`), `schools:all` (30 days; dropped by `src/organisation` when a school is created or changed) and `profile:<userId>` (deleted on approve, leave, remove, and for every member when the logo changes).

## Files

| File | Purpose |
| --- | --- |
| `school.module.ts` | Declares the controller, `SchoolService` and `SchoolLogoService`. |
| `school.controller.ts` | The routes above. |
| `school.service.ts` | Business logic and the profile mirror. |
| `transformer.ts` | v1 response transformers. |
| `dto/` | Request bodies - see [dto/README.md](./dto/README.md). |
| `school.service.test.ts` | Unit tests. |
| `school-logo.service.ts` | School logo upload, replace and remove. |
| `school-logo.service.test.ts` | Logo routes gated by `school:update`; ticket, verification, replace and remove. |

## Tests

```bash
cd backend && bun test src/school
```

Covers `findAll` caching, `createJoinRequest` (no automatic admin takeover, no role written while joining, unknown school, duplicate pending request, insert failure), `getMembers` (shape and custom roles only) and `approveRequest` (other school refused; membership, profile and status written); the logo routes require `school:update`, tickets refuse SVG, non-images and files over 2 MB, completion refuses another school's key and bytes that are not the declared image, and replace/remove delete the old object.

## See also

- [docs/content/backend/school.md](../../../docs/content/backend/school.md)
- [src/organisation/README.md](../organisation/README.md) - creating schools and appointing their admins
- [src/permission/README.md](../permission/README.md), [src/student-account/README.md](../student-account/README.md), [src/email-domain/README.md](../email-domain/README.md)
