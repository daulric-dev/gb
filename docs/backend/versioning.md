# API Versioning

## Overview

The API uses a **header-based response versioning** strategy. Clients send an `X-API-Version` header to request a specific response shape. The server transforms raw internal data through version-specific transformer functions before returning it.

This allows the API to evolve response shapes without breaking older clients -- a v1 client keeps receiving the v1 shape, while newer clients can opt into v2, v3, etc.

## Architecture

```
Client Request                     Server
─────────────────                  ──────────────────────────────────────

GET /api/auth/me                   VersioningGuard (global)
X-API-Version: 2        ──►       ┌────────────────────────────────────┐
                                   │ 1. Validate header format          │
                                   │ 2. Reject if version > max         │
                                   └──────────────┬─────────────────────┘
                                                  ▼
                                   Controller handler
                                   ┌────────────────────────────────────┐
                                   │ 1. Call service to get raw data    │
                                   │ 2. versioning.resolve(req, key)   │
                                   │ 3. Returns the v2 transformer     │
                                   │ 4. Transform raw → v2 shape       │
                                   └────────────────────────────────────┘
                         ◄──       Response (v2 shape)
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `VersioningService` | `src/versioning/versioning.service.ts` | Central registry; resolves `X-API-Version` header to the correct transformer |
| `VersioningGuard` | `src/versioning/versioning.guard.ts` | Global guard that validates the version header before any handler runs |
| `TransformerRegistry` | `src/versioning/transformer-registry.ts` | Singleton that registers all transformers at startup via `onModuleInit` |
| `VersioningModule` | `src/versioning/versioning.module.ts` | Global module that exports `VersioningService` and bootstraps the registry |
| `transformer.ts` | `src/<module>/transformer.ts` | Pure functions that convert raw data to a versioned response shape |

### URL Prefix

All routes are served under a simple prefix:

```
/api/<resource>
```

The URL does not contain a version number. Versioning is handled entirely by the `X-API-Version` header.

### Why a Centralized Registry?

Controllers in this project depend on `SupabaseService`, which is `Scope.REQUEST`. NestJS does **not** call `onModuleInit` on request-scoped providers. To avoid this limitation, all transformer registrations are centralized in `TransformerRegistry` -- a singleton provider whose `onModuleInit` is guaranteed to run during bootstrap, before any request is handled.

Controllers only call `this.versioning.resolve(req, namespace)` in their handlers. They never register transformers themselves.

---

## VersioningGuard

A global `APP_GUARD` registered in `app.module.ts`. It runs **before** any controller handler and validates the `X-API-Version` header:

```
Header present?
├── No  → Allow (no version constraint)
└── Yes → Is it a positive integer?
          ├── No  → 400 "Must be a positive integer"
          └── Yes → Is it ≤ max registered version?
                    ├── Yes → Allow
                    └── No  → 400 "Version X does not exist. Latest is Y."
```

This ensures invalid versions are rejected early with a `400 Bad Request`, before the handler or any service logic executes.

---

## VersioningService

The `VersioningService` is a global injectable that acts as a central **registry** for all version transformers:

```typescript
@Injectable()
export class VersioningService {
  private readonly registry = new Map<string, Map<number, TransformerFn>>();

  register(namespace: string, versions: Record<number, TransformerFn>): void;
  registerAll(prefix: string, map: Record<string, Record<number, TransformerFn>>): void;
  resolve(req: any, namespace: string): TransformerFn;
  getRegisteredNamespaces(): string[];
  getVersions(namespace: string): number[];
}
```

- **`register(namespace, versions)`** -- registers transformer functions under a namespaced key (e.g., `'auth.profile'`). Can be called multiple times to add new versions.
- **`registerAll(prefix, map)`** -- bulk registration. Takes a prefix (e.g., `'auth'`) and a map of response types to version maps. Calls `register()` for each, prepending the prefix.
- **`resolve(req, namespace)`** -- reads `X-API-Version` from the request, looks up the namespace, and returns the matching transformer. Defaults to the highest registered version if no header is present.
- **`getRegisteredNamespaces()`** -- lists all registered namespaces (used by the guard for version validation).
- **`getVersions(namespace)`** -- lists all version numbers registered for a namespace.
- Logs each registration at startup for visibility.

### Version Resolution Flow

```
Header present?
├── Yes → Is version in the namespace map?
│         ├── Yes → Return that version's transformer
│         └── No  → 400 "Available versions: [...]"
└── No  → Return the latest version's transformer
```

---

## TransformerRegistry

The `TransformerRegistry` is a singleton provider in `VersioningModule` that runs `onModuleInit` during app bootstrap. It imports all `transformer.ts` files and calls `versioning.registerAll()` for each module:

```typescript
@Injectable()
export class TransformerRegistry implements OnModuleInit {
  constructor(private readonly versioning: VersioningService) {}

  onModuleInit() {
    this.versioning.registerAll('auth', {
      profile: { 1: auth.v1Profile },
      session: { 1: auth.v1Session },
      verifyOtp: { 1: auth.v1VerifyOtp },
      message: { 1: auth.v1Message },
    });

    this.versioning.registerAll('student', {
      list: { 1: student.v1StudentList },
      detail: { 1: student.v1StudentDetail },
      // ...
    });

    // ... all other modules
  }
}
```

When adding a v2 transformer, you add it here alongside v1:

```typescript
this.versioning.registerAll('student', {
  list: { 1: student.v1StudentList, 2: student.v2StudentList },
  detail: { 1: student.v1StudentDetail, 2: student.v2StudentDetail },
});
```

### Registered Modules

All modules have v1 transformers registered:

| Module | Namespaces |
|--------|------------|
| auth | `profile`, `session`, `verifyOtp`, `message` |
| school | `list`, `detail` |
| student | `list`, `detail`, `created`, `updated`, `paginated` |
| class | `list`, `detail`, `created`, `updated`, `deleted`, `teachers`, `teacherAdded`, `teacherRemoved`, `subjects` |
| academicYear | `list`, `detail`, `created`, `updated` |
| term | `list`, `detail`, `created`, `updated`, `deleted` |
| subject | `list`, `detail`, `created`, `updated`, `deleted` |
| enrollment | `students`, `studentSubjects`, `enrolled`, `bulkEnrolled`, `unenrolled`, `subjectsAssigned`, `bulkSubjectsAssigned`, `subjectRemoved` |
| grade | `byAssessment`, `byTermSubject`, `created`, `bulkGraded`, `updated`, `excluded` |
| assessment | `list`, `detail`, `created`, `updated`, `excluded`, `deleted` |
| calculation | `studentTerm`, `studentYear`, `classTerm`, `classYear`, `classSummary` |
| report | `list`, `detail`, `generated`, `updated`, `classSummary`, `classSummaryFiles`, `classSummaryUploaded`, `studentReport`, `pdfHistory`, `pdfLatest`, `pdfSaved`, `pdfUploaded` |
| reportEntry | `updated` |

---

## Current Implementation (Auth Module)

The auth module is the reference implementation for versioning.

### Files

```
src/auth/
├── auth.controller.ts    # Injects VersioningService, calls resolve() in handlers
└── transformer.ts        # v1Profile, v1Session, v1VerifyOtp, v1Message
```

### `src/auth/transformer.ts`

Four transformer functions, one for each response type:

```typescript
export function v1Profile(raw: any) {
  return {
    id: raw.id,
    email: raw.email,
    first_name: raw.first_name ?? null,
    last_name: raw.last_name ?? null,
    role: raw.role ?? null,
    school: raw.school ?? null,
  };
}

export function v1Session(raw: any) {
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    expires_in: raw.expires_in,
    expires_at: raw.expires_at,
  };
}

export function v1VerifyOtp(session: any, user: any, profile: any) {
  const hasOnboarded = !!(profile?.first_name && profile?.school_id);
  return {
    session: v1Session(session),
    user: {
      id: user.id,
      email: user.email,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      role: profile?.role ?? null,
      school: profile?.school ?? null,
      is_onboarded: hasOnboarded,
    },
  };
}

export function v1Message(message: string) {
  return { message };
}
```

### `src/auth/auth.controller.ts` (versioning parts)

Controllers inject `VersioningService` and call `resolve()` in handlers. They do **not** register transformers -- that's handled by `TransformerRegistry`:

```typescript
import { VersioningService } from '@/versioning/versioning.service';

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly supabaseService: SupabaseService,
    private readonly versioning: VersioningService,
  ) {}

  @Get('me')
  async me(@Req() req: any) {
    const raw = await this.authService.getProfile(req.user.id);
    return this.versioning.resolve(req, 'auth.profile')(raw);
  }
}
```

### Auth Response Types (v1)

| Type | Endpoints | Shape |
|------|-----------|-------|
| `profile` | `GET /auth/me`, `PATCH /auth/onboard`, `PATCH /auth/profile` | `{ id, email, first_name, last_name, role, school }` |
| `session` | `POST /auth/refresh` | `{ access_token, refresh_token, expires_in, expires_at }` |
| `verifyOtp` | `POST /auth/otp/verify` | `{ session: { ... }, user: { id, email, ..., is_onboarded } }` |
| `message` | `POST /auth/otp/send`, `DELETE /auth/account`, `POST /auth/logout` | `{ message }` |

---

## Implementing Transformers: Full Guide

### Scenario 1: Adding a field (non-breaking, additive)

**Example:** Add `avatar_url` to the profile response.

**Step 1 - Add the v2 transformer in `src/auth/transformer.ts`:**

```typescript
export function v2Profile(raw: any) {
  return {
    ...v1Profile(raw),
    avatar_url: raw.avatar_url ?? null,
  };
}
```

v2 extends v1 by spreading it. v1 clients still get the same shape (no `avatar_url`), and v2 clients get the extra field.

**Step 2 - Register in `src/versioning/transformer-registry.ts`:**

```typescript
this.versioning.registerAll('auth', {
  profile: { 1: auth.v1Profile, 2: auth.v2Profile },
  session: { 1: auth.v1Session },
  verifyOtp: { 1: auth.v1VerifyOtp },
  message: { 1: auth.v1Message },
});
```

**Step 3 - No handler changes needed.** `this.versioning.resolve()` auto-detects the latest version from the registry.

**Result:**

| Header | Response |
|--------|----------|
| `X-API-Version: 1` | `{ id, email, first_name, last_name, role, school }` |
| `X-API-Version: 2` or none | `{ id, email, first_name, last_name, role, school, avatar_url }` |

---

### Scenario 2: Restructuring the shape (breaking change)

**Example:** Nest name fields and add timestamps in v3.

**Step 1 - Add the v3 transformer:**

```typescript
export function v3Profile(raw: any) {
  return {
    id: raw.id,
    email: raw.email,
    name: {
      first: raw.first_name ?? null,
      last: raw.last_name ?? null,
    },
    role: raw.role ?? null,
    school: raw.school ?? null,
    avatar_url: raw.avatar_url ?? null,
    created_at: raw.created_at ?? null,
  };
}
```

v3 does **not** spread v2 because the shape is fundamentally different. It builds from scratch.

**Step 2 - Register:**

```typescript
profile: { 1: auth.v1Profile, 2: auth.v2Profile, 3: auth.v3Profile },
```

**Result:**

| Header | Response |
|--------|----------|
| `X-API-Version: 1` | `{ id, email, first_name, last_name, role, school }` |
| `X-API-Version: 2` | `{ ..., avatar_url }` |
| `X-API-Version: 3` or none | `{ id, email, name: { first, last }, role, school, avatar_url, created_at }` |

All three versions coexist. No existing client breaks.

---

### Scenario 3: Removing a field

**Example:** Remove `role` from the profile in v2.

**Step 1 - Write v2 from scratch (don't spread v1, since spreading would include `role`):**

```typescript
export function v2Profile(raw: any) {
  return {
    id: raw.id,
    email: raw.email,
    first_name: raw.first_name ?? null,
    last_name: raw.last_name ?? null,
    school: raw.school ?? null,
  };
}
```

**Step 2 - Register and the latest version is auto-detected from the registry.**

v1 clients still receive `role`. v2 clients do not.

---

### Scenario 4: Renaming a field

**Example:** Rename `first_name` → `firstName` in v2.

```typescript
export function v2Profile(raw: any) {
  return {
    id: raw.id,
    email: raw.email,
    firstName: raw.first_name ?? null,
    lastName: raw.last_name ?? null,
    role: raw.role ?? null,
    school: raw.school ?? null,
  };
}
```

v1 returns `first_name` / `last_name`. v2 returns `firstName` / `lastName`. Same data, different keys.

---

### Scenario 5: Transformers with multiple arguments

Some responses are assembled from multiple sources. The `verifyOtp` transformer is an example:

```typescript
export function v1VerifyOtp(session: any, user: any, profile: any) {
  return {
    session: v1Session(session),
    user: { id: user.id, email: user.email, ... },
  };
}
```

The handler passes all arguments through:

```typescript
return this.versioning.resolve(req, 'auth.verifyOtp')(session, user, profile);
```

When creating v2, keep the same function signature so the handler doesn't change:

```typescript
export function v2VerifyOtp(session: any, user: any, profile: any) {
  return {
    session: v2Session(session),
    user: v2Profile(profile),
    requires_2fa: user.mfa_enabled ?? false,
  };
}
```

---

### Scenario 6: Different versions for different response types

Response types within a module can be at different version numbers. For example, `auth.profile` might be on v3 while `auth.session` is still on v1:

```typescript
this.versioning.registerAll('auth', {
  profile: { 1: auth.v1Profile, 2: auth.v2Profile, 3: auth.v3Profile },
  session: { 1: auth.v1Session },
  message: { 1: auth.v1Message },
});
```

A client sending `X-API-Version: 3` will get `v3Profile` when the handler resolves `'auth.profile'`. For `'auth.session'`, since there's no v3 entry, `resolve()` returns the latest available (v1).

---

## Adding Versioning to a New Module

Full walkthrough using a hypothetical **announcement** module as an example.

### 1. Create `src/announcement/transformer.ts`

Define the v1 shape for each response type the controller returns:

```typescript
export function v1AnnouncementDetail(raw: any) {
  return {
    id: raw.id,
    title: raw.title,
    body: raw.body,
    published_at: raw.published_at ?? null,
  };
}

export function v1AnnouncementList(data: any[]) {
  return data.map(v1AnnouncementDetail);
}

export function v1AnnouncementCreated(raw: any) {
  return v1AnnouncementDetail(raw);
}
```

### 2. Register in `src/versioning/transformer-registry.ts`

Import the transformers and add a `registerAll` call in `onModuleInit`:

```typescript
import * as announcement from '@/announcement/transformer';

// inside onModuleInit()
this.versioning.registerAll('announcement', {
  list: { 1: announcement.v1AnnouncementList },
  detail: { 1: announcement.v1AnnouncementDetail },
  created: { 1: announcement.v1AnnouncementCreated },
});
```

### 3. Use `resolve()` in the controller

```typescript
import { VersioningService } from '@/versioning/versioning.service';

export class AnnouncementController {
  constructor(
    private readonly announcementService: AnnouncementService,
    private readonly versioning: VersioningService,
  ) {}

  @Get()
  async findAll(@Req() req: any) {
    const raw = await this.announcementService.findAll();
    return this.versioning.resolve(req, 'announcement.list')(raw);
  }

  @Get(':id')
  async findOne(@Req() req: any, @Param('id') id: string) {
    const raw = await this.announcementService.findOne(id);
    return this.versioning.resolve(req, 'announcement.detail')(raw);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateAnnouncementDto) {
    const raw = await this.announcementService.create(dto);
    return this.versioning.resolve(req, 'announcement.created')(raw);
  }
}
```

### 4. Later, when adding v2

Add to `transformer.ts`:

```typescript
export function v2AnnouncementDetail(raw: any) {
  return {
    ...v1AnnouncementDetail(raw),
    author: raw.author_name ?? null,
    read_count: raw.read_count ?? 0,
  };
}

export function v2AnnouncementList(data: any[]) {
  return data.map(v2AnnouncementDetail);
}
```

Update the registration in `transformer-registry.ts`:

```typescript
this.versioning.registerAll('announcement', {
  list: { 1: announcement.v1AnnouncementList, 2: announcement.v2AnnouncementList },
  detail: { 1: announcement.v1AnnouncementDetail, 2: announcement.v2AnnouncementDetail },
  created: { 1: announcement.v1AnnouncementCreated },
});
```

No handler changes. No route changes. Old clients unaffected.

---

## Testing with curl

Use these commands to test versioning against the running backend (`localhost:3001`).

### Valid requests

```bash
# No version header (defaults to latest)
curl -s -X POST http://localhost:3001/api/auth/otp/send \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com"}'

# Explicit version 1
curl -s -X POST http://localhost:3001/api/auth/otp/send \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 1" \
  -d '{"email":"test@test.com"}'
```

### Invalid versions (all return 400)

```bash
# Non-existent version
curl -s -X POST http://localhost:3001/api/auth/otp/send \
  -H "Content-Type: application/json" \
  -H "X-API-Version: 5" \
  -d '{"email":"test@test.com"}'
# → {"message":"API version 5 does not exist. Latest version is 1.","error":"Bad Request","statusCode":400}

# String instead of integer
curl -s -H "X-API-Version: abc" http://localhost:3001/api/auth/otp/send \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com"}'
# → {"message":"Invalid API version \"abc\". Must be a positive integer.","error":"Bad Request","statusCode":400}

# Zero
curl -s -H "X-API-Version: 0" http://localhost:3001/api/auth/otp/send \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com"}'
# → {"message":"Invalid API version \"0\". Must be a positive integer.","error":"Bad Request","statusCode":400}

# Negative
curl -s -H "X-API-Version: -1" http://localhost:3001/api/auth/otp/send \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com"}'
# → {"message":"Invalid API version \"-1\". Must be a positive integer.","error":"Bad Request","statusCode":400}
```

---

## Rules and Conventions

### Naming

| Convention | Example |
|------------|---------|
| Transformer file | `src/<module>/transformer.ts` |
| Function name | `v<number><ResponseType>` - e.g., `v1Profile`, `v2StudentList` |
| Namespace key | `<module>.<responseType>` - e.g., `auth.profile`, `student.list` |

### Guidelines

1. **Never modify an existing transformer.** Once a version is released, its shape is frozen. Create a new version instead.
2. **Keep transformers pure.** No side effects, no async, no service calls. They receive raw data and return a plain object.
3. **Use `?? null` for optional fields.** This ensures clients always get a consistent shape (field present but `null`) rather than `undefined` (field absent).
4. **Spread the previous version when adding fields.** This keeps the diff small and makes it obvious what changed.
5. **Write from scratch when restructuring.** If the shape is fundamentally different (renaming, nesting, removing), don't spread -- build the new object explicitly.
6. **Register in `TransformerRegistry`.** All registrations happen in `src/versioning/transformer-registry.ts`, not in controllers.
7. **Use namespaced keys.** Format: `<module>.<responseType>` (e.g., `auth.profile`, `student.detail`).
8. **Latest version is auto-detected.** No need to maintain a `LATEST_VERSION` constant -- the registry derives it from the highest registered version number.

### Deprecation

When you want to stop supporting an old version:

1. Remove the version entry from the `registerAll()` call in `transformer-registry.ts`
2. Clients sending that version will receive a `400 Bad Request` from the guard or resolver
3. Optionally log a warning when an unsupported version is requested (can be added to `VersioningService.resolve()`)

---

## Pagination (Opt-in Feature)

Separately from header-based versioning, list endpoints can support **pagination** via query parameters. Pagination is not a version change -- it's an opt-in feature available within any API version.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | - | Page number (1-based). Activates offset mode. |
| `pageSize` | number | 20 | Items per page (min: 1, max: 100). |
| `cursor` | string | - | Cursor value from a previous `nextCursor`. Activates cursor mode. |
| `cursorColumn` | string | `id` | Database column to paginate on. |
| `cursorDirection` | `asc` \| `desc` | `asc` | Sort direction for the cursor column. |

When no pagination params are sent, the endpoint returns its original flat array. When `page` or `cursor` is present, the response is wrapped:

```json
{
  "data": [ ... ],
  "meta": {
    "total": 142,
    "page": 1,
    "pageSize": 20,
    "pageCount": 8,
    "nextCursor": null,
    "hasMore": true
  }
}
```

### Pagination Files

| File | Purpose |
|------|---------|
| `src/pagination/pagination.dto.ts` | `PaginationQueryDto` and `PaginatedResult<T>` types |
| `src/pagination/pagination.service.ts` | Generic `paginate<T>()` supporting offset and cursor modes |
| `src/pagination/pagination.module.ts` | Global module exporting `PaginationService` |

### Endpoints with Pagination

| Endpoint | Supported |
|----------|-----------|
| `GET /api/students` | Yes |

---

## Files Summary

| File | Purpose |
|------|---------|
| `src/versioning/versioning.service.ts` | `VersioningService` - central registry with `register()`, `registerAll()`, and `resolve()` |
| `src/versioning/versioning.guard.ts` | `VersioningGuard` - global guard that validates `X-API-Version` before handlers run |
| `src/versioning/transformer-registry.ts` | `TransformerRegistry` - singleton that registers all transformers at startup |
| `src/versioning/versioning.module.ts` | Global module providing `VersioningService` and `TransformerRegistry` |
| `src/<module>/transformer.ts` | Per-module transformer functions (pure, typed) |
| `src/createApp.ts` | Global prefix (`/api`), CORS config allowing `X-API-Version` header |
| `src/worker.ts` | Same prefix and CORS config; forwards all headers through Fastify `.inject()` |

---

## Design Decisions

**Why header-based, not URL-based?**
URL-based versioning (`/v1/` vs `/v2/`) duplicates routes and controllers. Header-based versioning keeps one set of routes and transforms the response at the edge.

**Why a centralized registry instead of controller `onModuleInit`?**
Controllers depend on `SupabaseService`, which uses `Scope.REQUEST`. NestJS does not call lifecycle hooks on request-scoped providers, so `onModuleInit` in controllers never fires. The `TransformerRegistry` is a singleton whose `onModuleInit` is guaranteed to run during bootstrap.

**Why a global guard for validation?**
Without the guard, an invalid version header would only be caught inside `resolve()` -- which runs after the service call. If the service throws first (e.g., a Supabase error), the client sees a 500 instead of a clear 400 version error. The guard rejects bad versions before any handler logic executes.

**Why namespaced keys (`auth.profile`, `student.list`)?**
Prevents collisions between modules that might both have a `detail` or `list` response type. The namespace makes ownership clear and keys self-documenting.

**Why auto-detect latest from the registry?**
Eliminates a manual `LATEST_VERSION` constant that can get out of sync. The highest registered version number is always the default.

**Why pure functions for transformers?**
Easy to test, compose, and reason about. No dependencies on NestJS, Supabase, or runtime state.
