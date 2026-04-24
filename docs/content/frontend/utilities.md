---
sidebar_label: Utilities
---

# Utilities and Hooks

## API Client (`lib/api.ts`)

The core API client used by all pages to communicate with the backend.

### Configuration

- **Base URL**: `NEXT_PUBLIC_API_URL` environment variable, or `http://localhost:3001` + `/api`
- **URL Validation**: The base URL is validated against an allowlist (`ALLOWED_ORIGINS`) at module load via `resolveBaseUrl()`. All paths are validated to start with `/` via `buildUrl()`. This prevents SSRF vulnerabilities (flagged by CodeQL).
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
- Reads the access token from localStorage via `getAccessToken()`
- Attaches it as `Authorization: Bearer <token>`

### Automatic Token Refresh

If the API returns a `401 Unauthorized`:

1. Reads the refresh token from localStorage
2. Calls `POST /api/auth/refresh` with the refresh token
3. Stores the new tokens via `setTokens()`
4. **Retries the original request** with the new access token
5. If refresh also fails → clears tokens, redirects to `/login`

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

Constructs a validated full URL from a relative API path. Ensures `path` starts with `/` and the base URL origin is in the allowlist. Exported for use by other modules (e.g., `lib/reports/api.ts`).

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

Manages authentication tokens in the browser.

### Storage Strategy

| Data | Storage | Key |
|------|---------|-----|
| Access token (JWT) | localStorage | `gb_access_token` |
| Refresh token | localStorage | `gb_refresh_token` |
| Login flag | Cookie | `gb_logged_in` |

The cookie is used by `proxy.ts` for route protection (cookies are accessible in middleware/proxy, localStorage is not).

### Functions

| Function | Description |
|----------|-------------|
| `getTokens()` | Returns `{ access_token, refresh_token }` from localStorage |
| `setTokens(access, refresh)` | Stores both tokens + sets `gb_logged_in=1` cookie (30-day expiry, `SameSite=Lax`) |
| `clearTokens()` | Removes both tokens + deletes the cookie |
| `getAccessToken()` | Shorthand - returns just the access token |
| `isAuthenticated()` | Returns `true` if an access token exists |

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
- Calls `GET /api/auth/me` on mount
- Used by the dashboard layout to populate the sidebar and header with user info

---

## Mobile Detection Hook (`hooks/use-mobile.ts`)

### `useIsMobile()`

Returns `true` when the viewport width is below 768px.

**Implementation:** Uses `window.matchMedia("(max-width: 768px)")` with an event listener for resize changes.

Used internally by the Sidebar component for responsive behavior.
