import { setAccessToken, getAccessToken, clearAccessToken } from "./auth";

const ALLOWED_ORIGINS = [
  "http://localhost:3001",
  process.env.NEXT_PUBLIC_API_URL,
].filter(Boolean) as string[];

function resolveBaseUrl(): string {
  const origin = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  const parsed = new URL(origin);
  if (!ALLOWED_ORIGINS.includes(parsed.origin)) {
    throw new Error(`Untrusted API origin: ${parsed.origin}`);
  }
  return `${parsed.origin}/api`;
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
};

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {

  try {
    const res = await fetch(buildUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-API-Version": "1" },
    });

    if (!res.ok) return false;

    const data = await res.json();
    setAccessToken(data.access_token);
    return true;
  } catch {
    return false;
  }
}

export async function api<T = unknown>( path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers: customHeaders, ...rest } = options;
  const access = getAccessToken();

  const headers: Record<string, string> = {
    "X-API-Version": "1",
    ...((customHeaders as Record<string, string>) || {}),
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (access) {
    headers["Authorization"] = `Bearer ${access}`;
  }

  const url = buildUrl(path);

  let res = await fetch(url, {
    ...rest,
    headers,
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && access) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = attemptRefresh().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }

    const refreshed = await refreshPromise;

    if (refreshed) {
      const newAccess = getAccessToken()
      headers["Authorization"] = `Bearer ${newAccess}`;
      res = await fetch(url, {
        ...rest,
        headers,
        credentials: "include",
        body: body ? JSON.stringify(body) : undefined,
      });
    } else {
      clearAccessToken();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new Error("Session expired");
    }
  }

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

export async function apiUpload<T = unknown>(path: string, formData: FormData): Promise<T> {
  const access = getAccessToken();

  const headers: Record<string, string> = {
    "X-API-Version": "1",
  };

  if (access) {
    headers["Authorization"] = `Bearer ${access}`;
  }

  const url = buildUrl(path);

  let res = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
    credentials: "include",
  });

  if (res.status === 401 && access) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = attemptRefresh().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }

    const refreshed = await refreshPromise;

    if (refreshed) {
      const newAccess = getAccessToken();
      headers["Authorization"] = `Bearer ${newAccess}`;
      res = await fetch(url, {
        method: "POST",
        headers,
        credentials: "include",
        body: formData,
      });
    } else {
      clearAccessToken();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new Error("Session expired");
    }
  }

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