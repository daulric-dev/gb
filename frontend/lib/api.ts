import { loginPath } from "@/lib/routing";
import {
  isSubscriptionRequired,
  notifySubscriptionRequired,
} from "@/lib/subscription-required";

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
  skipSubscriptionNotice?: boolean;
};

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
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

/**
 * The ApiError for a failed response. A 402 SUBSCRIPTION_REQUIRED (the school
 * is read-only) also raises the app-wide notice; it is still thrown so the
 * caller stops what it was doing.
 */
async function errorFrom(
  res: Response,
  options?: RequestOptions,
): Promise<ApiError> {
  const error = await res.json().catch(() => ({ message: res.statusText }));
  if (!options?.skipSubscriptionNotice && isSubscriptionRequired(res.status, error)) {
    notifySubscriptionRequired();
  }
  return new ApiError(res.status, error?.message || res.statusText, error);
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

  if (!res.ok) throw await errorFrom(res, options);

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
