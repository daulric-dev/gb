---
sidebar_label: Utilities
---

# Utilities and Hooks

## API Client (`lib/api.ts`)

The core API client used by all pages to communicate with the backend.

### Configuration

- **Base URL**: `/api` (relative path, proxied to the backend via Next.js rewrites)
- **Proxy**: Auth endpoints (`/api/auth/*`) are handled by a Route Handler at `app/api/auth/[...path]/route.ts` that explicitly forwards cookies and `Set-Cookie` headers. It uses `getSetCookie()` to forward each `Set-Cookie` header individually (the standard `Headers.forEach()` can merge multiple cookies into one unparseable value). All other endpoints use the Next.js rewrite defined in `next.config.ts`.
- **Content-Type**: `application/json` for all requests (except `apiUpload` which uses `multipart/form-data`)
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
- Sends `credentials: "include"` so the browser forwards the Supabase session cookies (`sb-*-auth-token*`) on every request
- The frontend never reads or attaches an access token — the backend's `AuthGuard` validates and silently refreshes the session via cookies on every authenticated request

### 401 Handling

If the API returns a `401 Unauthorized`, the frontend redirects to `/login`. There is no client-side refresh retry — the backend rotates the access token transparently on every authenticated call, so a 401 means the refresh token itself is invalid (expired, revoked, or the session cookies were cleared).

### `apiUpload<T>(path, formData)` Function

Uploads files via `multipart/form-data`. Used for avatar uploads and any other file upload that sends a `FormData` body instead of JSON.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `path` | string | API path (e.g., `/auth/avatar`) |
| `formData` | FormData | The form data containing the file |

Sends `credentials: "include"` and handles 401 the same way as `api()`. Returns the parsed JSON response.

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

Used throughout the app for error handling:
```typescript
try {
  await api("/something", { method: "POST", body: data });
} catch (err) {
  const msg = err instanceof ApiError ? err.message : "Something went wrong";
  toast.error(msg);
}
```

---

## Session Cookies

The frontend has no client-side token storage. Auth state lives entirely in HTTP-only cookies (`sb-<project>-auth-token` and chunks `.0`, `.1`, ...) set by the backend after `POST /api/auth/otp/verify`. The browser sends them on every request via `credentials: "include"`, and `proxy.ts` checks for their presence to gate protected routes.

Because the cookies are HTTP-only, JavaScript cannot read them — there's nothing to coordinate across tabs, no `localStorage` sync, no single-flight refresh logic. Refresh is handled server-side by `AuthGuard` on every authenticated request.

### Multi-Tab Behavior

All tabs share the same cookies (browser-managed) and the backend serializes refresh internally, so concurrent requests from multiple tabs always see a valid rotated session. There is no client-side coordination required.

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
