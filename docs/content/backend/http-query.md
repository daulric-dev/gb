---
sidebar_label: HTTP QUERY
---

# HTTP QUERY

The API's search and filter lists use the HTTP **QUERY** method (RFC 10008): a safe, idempotent read like GET, but the filters travel in a JSON request body instead of the URL. Search terms and filters stay out of URLs, proxy logs and browser history, and the body is validated by the same class-validator DTOs as any other request.

There is **no GET fallback**. A `GET` to one of these paths now answers **404** (Fastify answers 404, not 405, for a method a path does not have).

## Converted endpoints

All under `/api`. Path parameters stay in the path; every filter is optional, and an empty body (or `{}`) means every default.

| Endpoint | Body DTO | Body fields |
| --- | --- | --- |
| `QUERY /courses` | `ListCoursesQueryDto` | `status` (`draft` / `published` / `archived`), `termId`, `academicYearId` (UUIDs) |
| `QUERY /students` | `ListStudentsQueryDto` | `search` (max 100); paging `page`, `pageSize` (1-100), `cursor`, `cursorColumn`, `cursorDirection` |
| `QUERY /files` | `ListFilesQueryDto` | `filter` (`own` / `shared` / `all`, default `all`), `page`, `pageSize` (1-100) |
| `QUERY /files/folders/contents` | `BrowseFolderQueryDto` | `folderId` (UUID; omit for the root) |
| `QUERY /chat/conversations/:id/messages` | `ListMessagesQueryDto` | `before` (ISO 8601), `limit` (1-100, default 30) |
| `QUERY /portal/me/notifications` | `ListCourseNotificationsQueryDto` | `limit` (1-100, default 30), `before` (ISO 8601), `unread` (boolean) |
| `QUERY /organisation/schools` | `ListOrganisationSchoolsQueryDto` | `search` (name or code, max 100), `status` (`active` / `inactive` / `all`, default `all`) |
| `QUERY /organisation/invites` | `ListInvitesQueryDto` | `kind` (`school_admin` / `organisation_admin`) |
| `QUERY /schools/current/sso/audit` | `ListSsoAuditQueryDto` | `limit` (1-200, default 50), `before` (UUID of the last entry shown) |
| `QUERY /organisation/schools/:id/sso/audit` | `ListSsoAuditQueryDto` | as above |
| `QUERY /schools/current/webhooks/:id/deliveries` | `ListDeliveriesQueryDto` | `status` (`pending` / `succeeded` / `failed` / `abandoned`), `eventType`, `limit` (1-200, default 50), `before` (UUID of the last delivery shown) |
| `QUERY /organisation/schools/:schoolId/webhooks/:id/deliveries` | `ListDeliveriesQueryDto` | as above |
| `QUERY /schools/current/webhooks/audit` | `ListIntegrationAuditQueryDto` | `limit` (1-200, default 50), `before` (UUID) |
| `QUERY /organisation/schools/:schoolId/webhooks/audit` | `ListIntegrationAuditQueryDto` | as above |

Responses, guards, permissions, feature guards, throttling and `X-API-Version` handling are unchanged. An unknown property or a bad value is a **400** (the global `ValidationPipe` runs with `whitelist` and `forbidNonWhitelisted`).

Still **GET**: calendars (JSON and `.ics`), terms by year, SSO discover / start / callback, file and submission downloads, every read by id, and the SSE streams.

## Request shape

```bash
curl -X QUERY https://api.example.com/api/students \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <session token>' \
  -d '{"search":"ada","page":1,"pageSize":20}'
```

`Content-Type: application/json` is required when there is a body. A QUERY with **no body** is accepted as "no filters": `acceptEmptyQueryBodies()` (`backend/src/common/http-query.ts`, installed by `createApp.ts`) replaces an empty QUERY body - with no `Content-Type` or a JSON one - with `{}` before Fastify parses it. Without that, Fastify answers 400 for a QUERY without `Content-Type` (RFC 10008 requires it) and for an empty JSON body. Other methods are untouched.

In the backend a route is declared with `@QueryMethod()` (named so to avoid clashing with the `@Query()` parameter decorator) and reads its filters with `@Body()`:

```ts
@QueryMethod()
async list(@Req() req: any, @Body() query: ListCoursesQueryDto) { ... }
```

## Clients

- Web: `apiQuery(path, filters?, options?)` in `frontend/lib/api.ts` sends `method: "QUERY"` with the JSON body (`{}` when no filters). There is no response cache in the client, so different bodies to one path are always separate reads.
- Mobile: the same `apiQuery` in `mobile/src/lib/api.ts`; React Native's fetch passes the custom method and body through.

## CORS, proxies and Swagger

- **CORS**: QUERY is not CORS-safelisted, so browsers send a preflight `OPTIONS` before every cross-origin QUERY. `CORS_METHODS` (`backend/src/common/http-query.ts`) lists it, so the preflight passes. Expect one extra round trip per new path/body combination until the browser caches the preflight.
- **Caddy**: `infrastructure/caddy/Caddyfile` proxies every method (no `method` matcher on the proxy routes), so QUERY and its body reach the backend. Keep it that way if you add routes.
- **Other proxies, CDNs and WAFs** in front of the API must pass unknown methods with their body. Some reject anything outside GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS, or drop the body: check yours, e.g. with the curl above.
- **Swagger**: `@nestjs/swagger` 12 writes these operations under a `query` key in an OpenAPI 3.0 document. `query` is only an operation key from OpenAPI 3.2, so Swagger UI at `/docs` may not show them. This page is the reference for them.

## Mobile release note

Mobile builds released before this change still send `GET` to these paths and get 404s: the course, student, file, chat history and notice screens fail to load. When the first app build using QUERY is live in both stores, raise [`MOBILE_MIN_VERSION`](../environment-variables.md) to that build's version, so older installs get the blocking "Update required" screen instead of broken lists. Until then, ship the backend change and the app update together.
