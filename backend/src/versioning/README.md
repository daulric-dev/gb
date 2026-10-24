# Versioning (`src/versioning`)

Header-based response versioning. A client sends `X-API-Version: <n>`; a controller passes its raw result through the transformer registered for that version, so the response shape for version 1 can be kept while version 2 changes. URLs are not versioned (every route is just `/api/...`). Without the header, the latest registered version of each namespace is used.

Only version 1 exists today, and every v1 transformer is a pass-through. The web and mobile clients already send `X-API-Version: 1` on every request (`frontend/lib/api.ts`, `mobile/src/lib/api.ts`), as do the backend scripts, so a future v2 will not change what they receive.

## What it provides

- **HTTP routes** - none.
- **Services / exports** - `VersioningModule` is `@Global()` and exports `VersioningService`:
  - `register(namespace, { [version]: fn })` and `registerAll(prefix, { key: { [version]: fn } })` - namespaces are `<prefix>.<key>`, e.g. `student.list`.
  - `resolve(req, namespace)` - the transformer for the request's `X-API-Version`, or the latest when there is no header. 400 when the namespace has no transformers, the header is not an integer, or that version is not registered for the namespace.
  - `getRegisteredNamespaces()`, `getVersions(namespace)`.
- **Other**
  - `VersioningGuard` - registered globally as an `APP_GUARD` in `src/app.module.ts`, so it runs on every route. A missing header passes. A header that is not a positive integer, or is higher than the highest version registered anywhere, is a 400. (Per-namespace checks happen later, in `resolve`.)
  - `TransformerRegistry` - on module init, imports each feature's `transformer.ts` and registers its functions. This is the one place to look up which namespaces exist.

### Registered namespaces (all v1)

| Prefix | Keys | Transformer file | Resolved in |
| --- | --- | --- | --- |
| `auth` | `profile`, `session`, `verifyOtp`, `message` | `src/auth/transformer.ts` | `src/auth/auth.controller.ts` |
| `school` | `list`, `detail` | `src/school/transformer.ts` | `src/school/school.controller.ts` |
| `student` | `list`, `detail`, `created`, `updated`, `paginated` | `src/student/transformer.ts` | `src/student/student.controller.ts` |
| `academicYear` | `list`, `detail`, `created`, `updated` | `src/academic-year/transformer.ts` | `src/academic-year/academic-year.controller.ts` |
| `term` | `list`, `detail`, `created`, `updated`, `deleted` | `src/term/transformer.ts` | `src/term/term.controller.ts` |
| `gradeScale` | `list`, `detail`, `created`, `updated`, `bandsReplaced`, `defaultSet`, `deleted` | `src/grade-scale/transformer.ts` | `src/grade-scale/grade-scale.controller.ts` |
| `announcement` | `list`, `detail`, `created`, `updated`, `deleted`, `unreadCount`, `markRead` | `src/announcement/transformer.ts` | `src/announcement/announcement.controller.ts` |
| `images` | `uploaded`, `resumable` | `src/images/transformer.ts` | `src/auth/auth.controller.ts` (avatar upload routes) |

Routes in other modules (courses, grading, files, chat, billing, ...) do not go through versioning; they return their results directly.

## Used by

- `src/app.module.ts` imports `VersioningModule` and registers `VersioningGuard` as a global guard.
- The controllers in the table inject `VersioningService` and call `this.versioning.resolve(req, '<namespace>')(raw)`.

## Depends on

Nothing but `@nestjs/common`, plus the feature `transformer.ts` files it imports.

## Data

None.

## Configuration

None. The version comes from the `X-API-Version` request header, which CORS allows in `src/createApp.ts`.

## Files

| File | Purpose |
| --- | --- |
| `versioning.module.ts` | Global module providing `VersioningService` and `TransformerRegistry`, exporting the service. |
| `versioning.service.ts` | The registry and `resolve()`. |
| `versioning.guard.ts` | Global guard validating `X-API-Version`. |
| `transformer-registry.ts` | Registers every module's transformers at startup. |

## Adding versioning to a module (or a v2)

1. In the module, create `transformer.ts` with one function per response kind, e.g. `export function v1ThingList(rows: ThingRow[]) { return rows; }`.
2. Register them in `transformer-registry.ts`: `this.versioning.registerAll('thing', { list: { 1: thing.v1ThingList } });`.
3. In the controller, inject `VersioningService` and return `this.versioning.resolve(req, 'thing.list')(raw)`.
4. For a breaking change, add `v2ThingList` and register `{ 1: v1ThingList, 2: v2ThingList }`. Clients still sending `1` keep the old shape; clients sending no header get v2. Usually v2 is the service's new output and v1 maps it back to the old shape.

Detailed scenarios (adding, renaming and removing fields, multi-argument transformers) are in the docs page below.

## Tests

There are no tests for this folder or for the v1 transformers (which are pass-through). Check behaviour with curl as shown in the docs page below, e.g. `curl -H 'X-API-Version: 5' ...` returns 400.

## See also

- [docs/content/backend/versioning.md](../../../docs/content/backend/versioning.md)
- [src/pagination/README.md](../pagination/README.md) (the `student.paginated` shape)
