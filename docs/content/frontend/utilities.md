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
- Reads the access token from the in-memory module variable via `getAccessToken()`
- Attaches it as `Authorization: Bearer <token>`

### Automatic Token Refresh

If the API returns a `401 Unauthorized`:

1. Calls `POST /api/auth/refresh` (the httpOnly cookie is sent automatically)
2. Stores the new access token in memory via `setAccessToken()`
3. **Retries the original request** with the new access token
4. If refresh also fails → clears the in-memory token, redirects to `/login`

This uses a **single-flight pattern** - if multiple requests get 401 simultaneously, only one refresh call is made and all waiters share the result.

### `apiUpload<T>(path, formData)` Function

Uploads files via `multipart/form-data`. Used for avatar uploads and any other file upload that sends a `FormData` body instead of JSON.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `path` | string | API path (e.g., `/auth/avatar`) |
| `formData` | FormData | The form data containing the file |

Has the same authentication and automatic token refresh behavior as `api()`. Returns the parsed JSON response.

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

## Auth Helpers (`lib/auth.ts`)

Manages the access token and handles session bootstrap on page refresh.

### Storage Strategy

| Data | Storage | Purpose |
|------|---------|---------|
| Access token (JWT) | In-memory + `localStorage` | Used for API requests; `localStorage` enables multi-tab sharing |
| Refresh token | httpOnly cookie (`gb_refresh_token`) | Set/managed by the backend; survives page refresh |

The access token is kept in both a module-level variable (fast reads) and `localStorage` (cross-tab sharing). When a new tab opens, `bootstrapSession()` checks `localStorage` first — if a valid token exists (set by another tab), it uses it directly without hitting the refresh endpoint. This avoids consuming the one-time refresh token unnecessarily.

The httpOnly cookie is used by `proxy.ts` for route protection (cookies are accessible in middleware, in-memory variables are not).

### Multi-Tab Support

Supabase uses **one-time refresh tokens** — each refresh call rotates the token and invalidates the old one. Without coordination, two tabs calling refresh simultaneously would race: the first succeeds and rotates the token, the second fails because it sent the now-invalid old token.

This is handled by:
1. **localStorage sharing** — new tabs read the access token from localStorage and skip the refresh call entirely
2. **Single-flight pattern** — within a single tab, concurrent `bootstrapSession()` calls are deduplicated so only one refresh request is made

### Functions

| Function | Description |
|----------|-------------|
| `setAccessToken(token)` | Stores the access token in memory and `localStorage` (no-op if token is falsy) |
| `clearAccessToken()` | Clears the access token from memory and `localStorage` |
| `getAccessToken()` | Returns the access token from memory, falling back to `localStorage` |
| `isAuthenticated()` | Returns `true` if an access token is available (memory or `localStorage`) |
| `bootstrapSession()` | Returns immediately if a token exists in `localStorage`; otherwise calls `POST /api/auth/refresh` using the cookie, stores the new access token, and returns `true` on success |

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
- Skips the API call if no access token is in memory (avoids unnecessary 401s)
- Otherwise calls `GET /api/auth/me` on mount
- Used by the dashboard layout to populate the sidebar and header with user info

---

## Mobile Detection Hook (`hooks/use-mobile.ts`)

### `useIsMobile()`

Returns `true` when the viewport width is below 768px.

**Implementation:** Uses `window.matchMedia("(max-width: 768px)")` with an event listener for resize changes.

Used internally by the Sidebar component for responsive behavior.
