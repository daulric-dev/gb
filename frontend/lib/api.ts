import { getTokens, setTokens, clearTokens } from "./auth";

const BASE_URL = `${(process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001")}/api/v1`;

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  const { refresh } = getTokens();
  if (!refresh) return false;

  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Version": "1" },
      body: JSON.stringify({ refresh_token: refresh }),
    });

    if (!res.ok) return false;

    const data = await res.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

export async function api<T = unknown>( path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers: customHeaders, ...rest } = options;
  const { access } = getTokens();

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

  let res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    headers,
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
      const { access: newAccess } = getTokens();
      headers["Authorization"] = `Bearer ${newAccess}`;
      res = await fetch(`${BASE_URL}${path}`, {
        ...rest,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } else {
      clearTokens();
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