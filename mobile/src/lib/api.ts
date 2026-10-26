import Constants from "expo-constants";
import {
  isSubscriptionRequired,
  notifySubscriptionRequired,
} from "@/lib/subscription-required";
import {
  authHeaders,
  getSessionToken,
  rememberSessionToken,
  setSessionToken,
} from "@/lib/session-token";

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

/**
 * A 401: the token this request carried is dead (expired, revoked, signed out
 * elsewhere) - or the request carried none.
 *
 * Only that token is forgotten. Requests overlap: a background call sent
 * before sign-in (no token) can come back 401 after the sign-in response has
 * stored a fresh token, and clearing on every 401 used to throw that fresh
 * token away - the next request ("Complete profile") then went out without
 * one and failed with "Session expired".
 */
/**
 * Sign-in endpoints answer 401 for a wrong or used code / a failed SSO step.
 * That is about the code, not the session, so it must never clear the token
 * (a double-submitted, already-used code used to sign the app straight out).
 */
const SIGN_IN_PATHS = /^\/auth\/(otp\/|dev\/code|sso\/)/;

async function handleUnauthorized(
  path: string,
  skipAuthRedirect: boolean,
  sentToken: string | null,
): Promise<never> {
  const current = await getSessionToken();
  const stillCurrent = sentToken !== null && current === sentToken;
  if (__DEV__) {
    // Shows in the Metro terminal: which request was refused and with what.
    console.warn(
      `[auth] 401 ${path} sentToken=${sentToken ? "yes" : "no"} ` +
        `storedNow=${current ? (current === sentToken ? "same" : "different") : "none"}`,
    );
  }
  if (stillCurrent) await setSessionToken(null);
  // A request that went out signed-out says nothing about the session we
  // have now, so it doesn't sign the app out either.
  if (!skipAuthRedirect && (stillCurrent || current === null)) {
    unauthorizedHandler?.();
  }
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

/**
 * The ApiError for a failed response. A 402 SUBSCRIPTION_REQUIRED (the school
 * is read-only) also raises a single notice; it is still thrown so the caller
 * stops.
 */
async function errorFrom(res: Response): Promise<ApiError> {
  const error = await res.json().catch(() => ({ message: res.statusText }));
  if (isSubscriptionRequired(res.status, error)) notifySubscriptionRequired();
  return new ApiError(res.status, error?.message || res.statusText, error);
}

export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, headers: customHeaders, skipAuthRedirect, ...rest } = options;

  const sentToken = await getSessionToken();
  const headers: Record<string, string> = {
    "X-API-Version": "1",
    ...(await authHeaders()),
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

  // Before anything else: a rotated token can come on any status.
  await rememberSessionToken(res);
  if (res.status === 401) {
    // A wrong/used code: show the server's message, keep the session.
    if (SIGN_IN_PATHS.test(path)) throw await errorFrom(res);
    await handleUnauthorized(path, skipAuthRedirect ?? false, sentToken);
  }

  if (!res.ok) throw await errorFrom(res);

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
  const sentToken = await getSessionToken();
  const res = await fetchOrThrow(buildUrl(path), {
    method: "POST",
    headers: { "X-API-Version": "1", ...(await authHeaders()) },
    credentials: "include",
    body: formData,
  });

  await rememberSessionToken(res);
  if (res.status === 401) {
    await handleUnauthorized(
      path,
      options.skipAuthRedirect ?? false,
      sentToken,
    );
  }

  if (!res.ok) throw await errorFrom(res);

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
