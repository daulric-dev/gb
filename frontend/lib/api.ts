import { loginPath } from "@/lib/routing";

const BASE_URL = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api`;

export function buildUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`API path must start with "/": ${path}`);
  }
  return `${BASE_URL}${path}`;
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  skipAuthRedirect?: boolean;
  /**
   * Opt in to step-up: when the API answers `403 { code: 'STEP_UP_REQUIRED' }`
   * (changing single sign-on settings), ask the registered step-up handler
   * to confirm it's the user, then send the request once more. Without a
   * handler, or if the user cancels, the 403 is thrown as usual.
   */
  stepUp?: boolean;
};

/** The API's code for "confirm it's you first" (backend `@RequireStepUp()`). */
export const STEP_UP_REQUIRED = "STEP_UP_REQUIRED";

let unauthorizedHandler: (() => void) | null = null;
let featureDisabledHandler: ((error: ApiError) => void) | null = null;
let stepUpHandler: (() => Promise<boolean>) | null = null;
let pendingStepUp: Promise<boolean> | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

/**
 * Called when the API answers `403 { code: 'FEATURE_DISABLED' }`: the school's
 * features changed under us. The AuthProvider re-reads the profile so the
 * navigation drops whatever was switched off. The error is still thrown, so
 * the caller shows its message.
 */
export function setFeatureDisabledHandler(
  handler: ((error: ApiError) => void) | null,
) {
  featureDisabledHandler = handler;
}

/**
 * Registered by the step-up dialog (`StepUpDialogHost`): show "Confirm it's
 * you", resolve true once the code is verified, false if dismissed.
 */
export function setStepUpHandler(handler: (() => Promise<boolean>) | null) {
  stepUpHandler = handler;
}

/**
 * Ask the user to confirm, once for any number of requests waiting at the
 * same time. Exported for raw `fetch` callers (`downloadFromUrl`).
 */
export function confirmStepUp(): Promise<boolean> {
  if (!stepUpHandler) return Promise.resolve(false);
  if (!pendingStepUp) {
    pendingStepUp = stepUpHandler()
      .catch(() => false)
      .finally(() => {
        pendingStepUp = null;
      });
  }
  return pendingStepUp;
}

function redirectToLogin() {
  if (typeof window === "undefined") return;

  if (unauthorizedHandler) {
    unauthorizedHandler();
    return;
  }

  const { pathname, search, origin } = window.location;
  window.location.assign(new URL(loginPath(`${pathname}${search}`), origin));
}

function handleUnauthorized(skipAuthRedirect: boolean): never {
  if (!skipAuthRedirect) redirectToLogin();
  throw new ApiError(401, "Session expired");
}

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
    // Same text as NETWORK_ERROR_MESSAGE in lib/errors.ts.
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
}

/** The ApiError for a failed response, carrying the API's message. */
async function errorFrom(res: Response): Promise<ApiError> {
  const error = await res.json().catch(() => ({ message: res.statusText }));
  const apiError = new ApiError(res.status, error?.message || res.statusText, error);
  if (apiError.code === "FEATURE_DISABLED") featureDisabledHandler?.(apiError);
  return apiError;
}

export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, headers: customHeaders, skipAuthRedirect, stepUp, ...rest } = options;

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
    const error = await errorFrom(res);
    // Retried once: a second STEP_UP_REQUIRED is thrown, never looped on.
    if (stepUp && error.code === STEP_UP_REQUIRED && (await confirmStepUp())) {
      return api<T>(path, { ...options, stepUp: false });
    }
    throw error;
  }

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
 * files, chat history, notices, organisation schools and invites, SSO
 * activity); a GET to those paths is a 404. `filters` defaults to `{}`, so
 * every QUERY carries a JSON body and the API sees "no filters", never a
 * missing body. QUERY is not CORS-safelisted, so the browser sends a
 * preflight first. There is no response cache here: two QUERYs to one path
 * with different bodies are two different reads.
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
