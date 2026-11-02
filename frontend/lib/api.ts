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
};

let unauthorizedHandler: (() => void) | null = null;
let featureDisabledHandler: ((error: ApiError) => void) | null = null;

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
    throw new ApiError(0, "Can't reach the server. Check your connection.");
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
