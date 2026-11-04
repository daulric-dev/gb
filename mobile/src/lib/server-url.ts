const SERVER_URL_KEY = "gb_server_url";

export function normalizeServerUrl(input: string, allowHttp = false): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Enter your school's server URL.");

  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(
      "Enter a valid server URL, such as https://school.example.com.",
    );
  }

  const httpAllowed =
    allowHttp &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".local") ||
      url.hostname.includes(":") ||
      /^10\./.test(url.hostname) ||
      /^192\.168\./.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname));

  if (url.protocol !== "https:" && !httpAllowed) {
    throw new Error("Use a secure HTTPS server URL.");
  }
  if (url.username || url.password) {
    throw new Error("The server URL must not contain a username or password.");
  }
  if (url.search || url.hash) {
    throw new Error("The server URL must not include a query or fragment.");
  }
  if (url.pathname !== "/" && url.pathname.replace(/\/+$/, "") !== "/api") {
    throw new Error("Enter the server's base URL, not a path.");
  }

  return `${url.origin}`;
}

export async function savedServerUrl(): Promise<string | null> {
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(SERVER_URL_KEY);
  }
  const SecureStore = await import("expo-secure-store");
  return SecureStore.getItemAsync(SERVER_URL_KEY);
}

export async function saveServerUrl(url: string | null): Promise<void> {
  if (typeof localStorage !== "undefined") {
    if (url) localStorage.setItem(SERVER_URL_KEY, url);
    else localStorage.removeItem(SERVER_URL_KEY);
    return;
  }
  const SecureStore = await import("expo-secure-store");
  if (url) await SecureStore.setItemAsync(SERVER_URL_KEY, url);
  else await SecureStore.deleteItemAsync(SERVER_URL_KEY);
}

export async function checkServerUrl(url: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${url}/health`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const health = (await response.json().catch(() => null)) as {
      status?: unknown;
    } | null;
    if (!response.ok || health?.status !== "ok") {
      throw new Error(
        "That server is unavailable or unhealthy. Check the URL or contact your school.",
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.name !== "AbortError" &&
      error.message.startsWith("That server")
    ) {
      throw error;
    }
    throw new Error(
      "Couldn't reach that server. Check the URL and your internet connection.",
    );
  } finally {
    clearTimeout(timer);
  }
}
