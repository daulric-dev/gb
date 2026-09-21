import Constants from "expo-constants";

const API_PORT = 3001;

function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return `${configured.replace(/\/$/, "")}/api`;

  // e.g. "192.168.0.12:8081" — present whenever the app is served by Metro,
  // including a production-mode preview (`expo start --no-dev`). Keyed off
  // Metro rather than __DEV__ for exactly that reason: a preview is still
  // served from this machine even though it builds as production.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)
      ?.debuggerHost;

  const host = hostUri?.split(":")[0];
  if (host) return `http://${host}:${API_PORT}/api`;

  // No override and no Metro: a standalone build. There is no localhost worth
  // talking to on a phone, so failing here is the only honest option - the
  // alternative is an app that installs, launches and silently reaches
  // nothing.
  throw new Error(
    "EXPO_PUBLIC_API_URL is required in a standalone build. Set it to the " +
      "backend's public HTTPS URL (no /api suffix) before building.",
  );
}

const BASE_URL = resolveBaseUrl();

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

/**
 * A request that never reached the server.
 *
 * `fetch` rejects with a bare TypeError when the host is down, the address is
 * wrong or the network is gone. Screens catch errors and fall back to a
 * message about whatever they were doing - "Failed to send OTP" - which sends
 * you looking at the wrong thing entirely. Turning it into an ApiError with a
 * status of 0 lets every screen say what actually happened.
 */
export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

async function fetchOrThrow(
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
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

  const res = await fetchOrThrow(buildUrl(path), {
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

/**
 * Multipart upload (mirror of the web `apiUpload`). Pass a ready FormData; on
 * React Native, append files as `{ uri, name, type }`. Content-Type is left
 * unset so fetch adds the multipart boundary itself.
 */
export async function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
  options: { skipAuthRedirect?: boolean } = {},
): Promise<T> {
  const res = await fetchOrThrow(buildUrl(path), {
    method: "POST",
    headers: { "X-API-Version": "1" },
    credentials: "include",
    body: formData,
  });

  if (res.status === 401) handleUnauthorized(options.skipAuthRedirect ?? false);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
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
