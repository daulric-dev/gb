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

function redirectToLogin() {
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

function handleUnauthorized(skipAuthRedirect: boolean): never {
  if (!skipAuthRedirect) redirectToLogin();
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

export async function apiUpload<T = unknown>(
  path: string,
  formData: FormData,
): Promise<T> {
  const res = await fetchOrThrow(buildUrl(path), {
    method: "POST",
    headers: { "X-API-Version": "1" },
    body: formData,
    credentials: "include",
  });

  if (res.status === 401) handleUnauthorized(false);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(res.status, error.message || res.statusText, error);
  }

  return res.json();
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
