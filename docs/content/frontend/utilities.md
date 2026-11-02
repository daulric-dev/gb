---
sidebar_label: Utilities
---

# Utilities and Hooks

## API Client (`lib/api.ts`)

The core API client used by all pages to communicate with the backend.

### Configuration

- **Base URL**: `/api` (relative path, proxied to the backend via Next.js rewrites)
- **Proxy**: Auth endpoints (`/api/auth/*`) are handled by a Route Handler at `app/api/auth/[...path]/route.ts` that explicitly forwards cookies and `Set-Cookie` headers. It uses `getSetCookie()` to forward each `Set-Cookie` header individually (the standard `Headers.forEach()` can merge multiple cookies into one unparseable value). All other endpoints use the Next.js rewrite defined in `next.config.ts`.
- **Content-Type**: `application/json` for all requests. There is no multipart helper: file bytes never go through the API (see `lib/files/upload.ts` below)
- **API Version**: `X-API-Version: 1` header sent with every request

### `api<T>(path, options?)` Function

The main export. Makes authenticated JSON requests to the backend.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `path` | string | API path (e.g., `/classes`) - prepended with base URL |
| `options.method` | string | HTTP method (defaults to `GET`) |
| `options.body` | object | Request body (auto-serialized to JSON) |

**Authentication:**
- Sends `credentials: "include"` so the browser forwards the `gb_session` cookie on every request
- The frontend never reads or attaches a token - the backend's `AuthGuard` validates the session cookie on every authenticated request and slides its expiry

### `apiQuery<T>(path, filters?, options?)` Function

For the API's search and filter lists, which take the HTTP `QUERY` method ([HTTP QUERY](../backend/http-query.md)): sends `method: "QUERY"` with `filters` as the JSON body (`{}` when omitted, so there is always a body and a `Content-Type`). Everything else - headers, cookies, 401 and `FEATURE_DISABLED` handling - is `api()`'s. There is no response cache, so different filters to one path are separate reads. Used for `/courses`, `/students`, `/files`, `/files/folders/contents`, chat history (`lib/chat.ts`), portal notices (`lib/portal-notifications.ts`), organisation schools and invites (`listOrganisationSchools`, `listInvites` in `lib/organisation.ts`) and SSO activity (`listSsoAudit` in `lib/sso-audit.ts`).

```ts
const students = await apiQuery<Student[]>("/students", { search: "ada" });
```

### 401 Handling

If the API returns a `401 Unauthorized`, the frontend redirects to `/login`. There is no client-side refresh retry - there is no token to refresh, so a 401 means the session itself is gone (expired, revoked, or the cookie was cleared).

### File uploads (`lib/files/upload.ts`)

Every upload goes straight to object storage with a presigned URL: the client asks the API for a ticket, `PUT`s the bytes to the ticket's `uploadUrl` with exactly its `headers` (no cookies), then calls the matching complete route so the backend checks the stored bytes.

| Export | Use |
|--------|-----|
| `uploadFile(file, { ticket, complete }, options?)` | Files and assignment hand-ins (`/files/upload-ticket`, `/portal/me/activities/:id/upload-ticket`). Returns the released file; a `503` on complete is retried with backoff. |
| `uploadAvatar(image, filename, onProgress?)` | Profile pictures: `POST /auth/avatar/resumable`, the PUT, then `POST /auth/avatar/complete { path }`. Returns the new `avatar_url`. |
| `uploadImage(ticketPath, completePath, image, filename, onProgress?)` | The shared image flow behind the three below: ticket, PUT, then `POST completePath { path }`; returns the complete route's answer. |
| `uploadCourseBanner(courseId, image, filename, onProgress?)` | Course cover images: `/courses/:id/banner/upload-ticket` then `/banner/complete`. Returns the updated course. |
| `uploadSchoolLogo(image, filename, onProgress?)` | The school logo: `/schools/current/logo/upload-ticket` then `/complete`. Returns the new `logoUrl`. |
| `imageFileProblem(file, maxBytes)` | A pre-check (JPEG/PNG/WebP and size) that returns a message or null; the backend checks again. |
| `sendToStorage(blob, ticket, onProgress?)` | The PUT itself, retried once on a dropped connection. Throws `UploadError` when storage refuses it. |

### `buildUrl(path)` Function

Constructs a full URL from a relative API path. Ensures `path` starts with `/` and prepends the base URL (`/api`). Exported for use by other modules (e.g., `lib/reports/api.ts`).

### `ApiError` Class

Custom error class thrown on non-OK responses:

```typescript
class ApiError extends Error {
  status: number;   // HTTP status code
  message: string;  // Error message from the API
}
```

Never show `err.message` directly. Every toast, alert and inline error goes through `userMessage(err, fallback)` from `lib/errors.ts`:
```typescript
try {
  await api("/something", { method: "POST", body: data });
} catch (err) {
  toast.error(userMessage(err, "Failed to save"));
}
```

### `lib/errors.ts`

| Export | What it does |
|--------|--------------|
| `userMessage(err, fallback)` | An `ApiError` 4xx: the API's message (the first one for a validation list) when it is safe text, else `fallback` (a 429 falls back to `RATE_LIMIT_MESSAGE`). A 5xx: `GENERIC_ERROR_MESSAGE`, plus `Reference: <errorId>` when the API sent one. No response (`ApiError` status 0, or a fetch `TypeError`): `NETWORK_ERROR_MESSAGE`. A `FriendlyError` (including `UploadError` and the location errors in `lib/attendance.ts`): its message when safe. Anything else: `fallback`. |
| `safeText(text)` | One trimmed line of at most 200 characters, or `null` for non-strings, blank text, multi-line dumps and anything that looks internal: stack frames, Prisma text and codes, SQL/Postgres errors, `ECONN…`, `TypeError`/`ReferenceError`/`SyntaxError`, `…Exception:`, JSON parse errors, HTML pages, source file paths, Nest's `Cannot GET /…`. |
| `FriendlyError` | An `Error` whose message was written for the user. |

Route errors are caught by `app/error.tsx`, `app/dashboard/error.tsx`, `app/portal/error.tsx` and `app/organisation/error.tsx` (all render `components/layout/error-fallback.tsx`) and, for the root layout, `app/global-error.tsx`. They show a fixed message, "Try again" (`retry()`), and `error.digest` as a reference; the error itself only goes to the console. `mobile/src/lib/errors.ts` applies the same rules in the app.

---

## Session Cookies

The frontend has no client-side token storage. Auth state lives entirely in one HTTP-only cookie, `gb_session` (an opaque random token, 30-day sliding expiry), set by the backend after `POST /api/auth/otp/verify` or an SSO sign-in. The browser sends it on every request via `credentials: "include"`, and `proxy.ts` checks for its presence to gate protected routes.

Because the cookie is HTTP-only, JavaScript cannot read it - there's nothing to coordinate across tabs, no `localStorage` sync, no refresh logic. The backend extends the session as it is used.

### Multi-Tab Behavior

All tabs share the same cookie (browser-managed) and the token never changes during a session, so concurrent requests from multiple tabs always see the same valid session. There is no client-side coordination required.

---

## Class Name Utility (`lib/utils.ts`)

### `cn(...inputs)`

Merges Tailwind CSS class names using `clsx` + `tailwind-merge`. Handles conditional classes and resolves conflicts (e.g., `p-2` vs `p-4` keeps only the last one).

```typescript
cn("p-2 text-red-500", condition && "text-blue-500", "p-4")
// → "text-blue-500 p-4"
```

Used extensively in all components for dynamic styling.

---

## Profile Hook (`lib/use-profile.ts`)

### `useProfile()`

A React hook that fetches the current user's profile from the backend. Uses **Preact Signals** for reactive state.

**Returns:**
```typescript
{
  profile: Signal<UserProfile | null>;  // null while loading or on error
  loading: Signal<boolean>;
}
```

Values are accessed via `.value` (e.g. `profile.value?.email`).

**`UserProfile` type:**
```typescript
{
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  avatar_url: string | null;
  school: {
    id: string;
    name: string;
  } | null;
}
```

**Behavior:**
- Calls `GET /api/auth/me` on mount; cookies authenticate the request
- On 401, `lib/api.ts` redirects to `/login` and the hook leaves `profile.value` as `null`
- Used by the dashboard layout to populate the sidebar and header with user info

---

## Mobile Detection Hook (`hooks/use-mobile.ts`)

### `useIsMobile()`

Returns `true` when the viewport width is below 768px.

**Implementation:** Uses `window.matchMedia("(max-width: 768px)")` with an event listener for resize changes.

Used internally by the Sidebar component for responsive behavior.
