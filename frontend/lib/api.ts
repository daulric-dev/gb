const BASE_URL = "/api";

export function buildUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`API path must start with "/": ${path}`);
  }
  return `${BASE_URL}${path}`;
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

function redirectToLogin() {
  if (typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  try {
    const res = await fetch(buildUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { "X-API-Version": "1" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function withRefreshRetry(
  doFetch: () => Promise<Response>,
): Promise<Response> {
  let res = await doFetch();

  if (res.status === 401) {
    if (!refreshPromise) {
      refreshPromise = attemptRefresh().finally(() => {
        refreshPromise = null;
      });
    }

    const refreshed = await refreshPromise;

    if (refreshed) {
      res = await doFetch();
    } else {
      redirectToLogin();
      throw new ApiError(401, "Session expired");
    }
  }

  return res;
}

export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { body, headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    "X-API-Version": "1",
    ...((customHeaders as Record<string, string>) || {}),
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const doFetch = () =>
    fetch(buildUrl(path), {
      ...rest,
      headers,
      credentials: "include",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const res = await withRefreshRetry(doFetch);

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
  const doFetch = () =>
    fetch(buildUrl(path), {
      method: "POST",
      headers: { "X-API-Version": "1" },
      body: formData,
      credentials: "include",
    });

  const res = await withRefreshRetry(doFetch);

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
