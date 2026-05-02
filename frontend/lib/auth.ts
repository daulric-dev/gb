const STORAGE_KEY = "gb_access_token";

let _accessToken: string | null = null;

export function setAccessToken(token: string) {
  if (!token) return;
  _accessToken = token;
  try { localStorage.setItem(STORAGE_KEY, token); } catch {}
}

export function clearAccessToken() {
  _accessToken = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function getAccessToken() {
  if (_accessToken) return _accessToken;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) _accessToken = stored;
  } catch {}
  return _accessToken;
}

export function isAuthenticated() {
  return getAccessToken() !== null;
}

let _bootstrapPromise: Promise<boolean> | null = null;

export function bootstrapSession(): Promise<boolean> {
  if (_bootstrapPromise) return _bootstrapPromise;

  // If another tab already stored a valid token, use it without hitting refresh
  if (getAccessToken()) return Promise.resolve(true);

  _bootstrapPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: "POST",
        credentials: "include",
        headers: {
          "X-API-Version": "1"
        }
      })

      if (!res.ok) return false;

      const data = await res.json();
      if (!data.access_token) return false;

      setAccessToken(data.access_token);
      return true;
    } catch {
      return false;
    } finally {
      _bootstrapPromise = null;
    }
  })();

  return _bootstrapPromise;
}