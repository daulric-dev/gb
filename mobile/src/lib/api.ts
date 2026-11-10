import Constants from "expo-constants";
import {
  isUpdateRequiredResponse,
  setUpdateRequired,
  storeUrlFrom,
} from "@/lib/update-required";
import {
  authHeaders,
  getSessionToken,
  rememberSessionToken,
  setSessionToken,
} from "@/lib/session-token";
import { clearPushState } from "@/lib/push-state";
import {
  reportNetworkFailure,
  reportNetworkSuccess,
} from "@/lib/connectivity";

const API_PORT = 3001;

function resolveDevelopmentServerUrl(): string | null {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (__DEV__ && configured) {
    return configured.replace(/\/api\/?$/, "").replace(/\/$/, "");
  }

  // e.g. "192.168.0.12:8081" — present whenever the app is served by Metro,
  // including a production-mode preview (`expo start --no-dev`). Keyed off
  // Metro rather than __DEV__ for exactly that reason: a preview is still
  // served from this machine even though it builds as production.
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)
      ?.debuggerHost;

  const host = hostUri?.split(":")[0];
  return host ? `http://${host}:${API_PORT}` : null;
}

let apiOrigin: string | null = null;

/** The development server is only a convenience; release builds require a chosen instance. */
export function developmentServerUrl(): string | null {
  return resolveDevelopmentServerUrl();
}

/** Set the selected platform instance at runtime. The API lives under `/api`. */
export function setApiServerUrl(origin: string | null): void {
  apiOrigin = origin ? `${origin.replace(/\/+$/, "")}/api` : null;
}

/** The selected API origin (".../api"), or null before one is chosen. */
export function apiServerOrigin(): string | null {
  return apiOrigin;
}

function baseUrl(): string {
  if (!apiOrigin) {
    throw new Error(
      "Connect to your school's server before making API requests.",
    );
  }
  return apiOrigin;
}

/** The backend's host (e.g. "api.example.com"), for telling people where it is. */
export function serverHost(): string {
  try {
    return new URL(baseUrl()).host;
  } catch {
    return apiOrigin ?? "your school server";
  }
}

export function buildUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`API path must start with "/": ${path}`);
  }
  return `${baseUrl()}${path}`;
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
 * Called on `403 { code: 'FEATURE_DISABLED' }`: the school switched a feature
 * off while the app was open. The AuthProvider re-reads the profile so tabs
 * and lists drop it. The error is still thrown, so the screen shows it.
 */
let featureDisabledHandler: ((error: ApiError) => void) | null = null;

export function setFeatureDisabledHandler(
  handler: ((error: ApiError) => void) | null,
) {
  featureDisabledHandler = handler;
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
  if (stillCurrent) {
    await setSessionToken(null);
    // The session is gone, and the API unbinds its push token with it; drop
    // ours so the next sign-in registers afresh.
    clearPushState();
  }
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
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    // Offline mode (connectivity.ts) is judged from real requests; a request
    // the caller cancelled says nothing about the network.
    if (!init.signal?.aborted) reportNetworkFailure();
    // Same text as NETWORK_ERROR_MESSAGE in lib/errors.ts.
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  reportNetworkSuccess();
  return res;
}

/**
 * The ApiError for a failed response. A 426 `update_required` (this build is
 * below the API's minimum) also switches to the blocking update screen; it is
 * still thrown so the caller stops.
 */
async function errorFrom(res: Response): Promise<ApiError> {
  const error = await res.json().catch(() => ({ message: res.statusText }));
  if (isUpdateRequiredResponse(res.status, error))
    setUpdateRequired(storeUrlFrom(error));
  const apiError = new ApiError(res.status, error?.message || res.statusText, error);
  if (apiError.code === "FEATURE_DISABLED") featureDisabledHandler?.(apiError);
  return apiError;
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
 * HTTP QUERY: a safe, idempotent read with its filters in a JSON body instead
 * of the URL. The API's search and filter lists take it (courses, students,
 * files, chat history, notices); a GET to those paths is a 404. React
 * Native's fetch sends a custom method and its body as-is. `filters`
 * defaults to `{}`, so every QUERY carries a JSON body. Builds from before
 * QUERY still send GET to these paths and fail: raise MOBILE_MIN_VERSION to
 * the first build with this (docs/content/backend/http-query.md).
 */
export function apiQuery<T = unknown>(
  path: string,
  filters: object = {},
  options: Omit<RequestOptions, "method" | "body"> = {},
): Promise<T> {
  return api<T>(path, { ...options, method: "QUERY", body: filters });
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

  /** The API's machine-readable error code, e.g. "FEATURE_DISABLED". */
  get code(): string | undefined {
    const code = (this.data as { code?: unknown } | undefined)?.code;
    return typeof code === "string" ? code : undefined;
  }

  /** For a FEATURE_DISABLED error, which feature is off. */
  get feature(): string | undefined {
    const feature = (this.data as { feature?: unknown } | undefined)?.feature;
    return typeof feature === "string" ? feature : undefined;
  }
}
