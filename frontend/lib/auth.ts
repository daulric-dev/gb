let _accessToken: string | null = null;

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function setAccessToken(token: string) {
  _accessToken = token;
}

export function clearAccessToken() {
  _accessToken = null;
}

export function getAccessToken() {
  return _accessToken;
}

export function isAuthenticated() {
  return _accessToken !== null;
}

export async function bootstrapSession(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: {
        "X-API-Version":  "1"
      }

    })

    if (!res.ok) return false;

    const data = await res.json();
    setAccessToken(data.access_token);
    return true;
  } catch (e) {
    return false;
  }
}