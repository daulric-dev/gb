/**
 * Mobile port of the web frontend's `lib/api.ts`.
 *
 * Auth is cookie-based (Supabase SSR httpOnly cookies set by the backend on
 * `/auth/otp/verify`). React Native's fetch persists and resends cookies via
 * the platform's native cookie store, so no manual token handling is required —
 * the web `credentials: "include"` behaviour is the default here.
 */

const BASE_URL = `${
  process.env.EXPO_PUBLIC_API_URL || "http://localhost:3001"
}/api`;

export function buildUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`API path must start with "/": ${path}`);
  }
  return `${BASE_URL}${path}`;
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  skipAuthRedirect?: boolean;
};

/**
 * The web app redirects the browser on a 401. On mobile we can't touch
 * `window`, so the AuthProvider registers a handler that resets navigation.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function handleUnauthorized(skipAuthRedirect: boolean): never {
  if (!skipAuthRedirect) unauthorizedHandler?.();
  throw new ApiError(401, "Session expired");
}

export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, headers: customHeaders, skipAuthRedirect, ...rest } = options;

  const headers: Record<string, string> = {
    "X-API-Version": "1",
    ...((customHeaders as Record<string, string>) || {}),
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(buildUrl(path), {
    ...rest,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) handleUnauthorized(skipAuthRedirect ?? false);

  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, error.message || res.statusText, error);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text as T;
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
