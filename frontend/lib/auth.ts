const ACCESS_TOKEN_KEY = "gb_access_token";
const REFRESH_TOKEN_KEY = "gb_refresh_token";

export function getTokens() {
  if (typeof window === "undefined") return { access: null, refresh: null };
  return {
    access: localStorage.getItem(ACCESS_TOKEN_KEY),
    refresh: localStorage.getItem(REFRESH_TOKEN_KEY),
  };
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, access);
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  document.cookie = `gb_logged_in=1; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

export function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  document.cookie = "gb_logged_in=; path=/; max-age=0";
}

export function getAccessToken() {
  return getTokens().access;
}

export function isAuthenticated() {
  return !!getAccessToken();
}