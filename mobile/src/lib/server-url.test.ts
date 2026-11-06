import { describe, expect, mock, test } from "bun:test";

// expo-secure-store is React Native source Bun can't load; server-url only
// touches it when saving the chosen server, which these tests don't do.
mock.module("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));

const { checkServerUrl, normalizeServerUrl, resolveServerUrl } = await import(
  "./server-url"
);

describe("normalizeServerUrl", () => {
  test("adds HTTPS to a school hostname and removes a trailing slash", () => {
    expect(normalizeServerUrl("school.example.com/")).toBe(
      "https://school.example.com",
    );
  });

  test("accepts a URL ending in the API path but stores the instance root", () => {
    expect(normalizeServerUrl("https://school.example.com/api")).toBe(
      "https://school.example.com",
    );
  });

  test("rejects insecure public URLs", () => {
    expect(() => normalizeServerUrl("http://school.example.com")).toThrow(
      "HTTPS",
    );
  });

  test("allows local HTTP development servers", () => {
    expect(normalizeServerUrl("http://192.168.1.20:3001", true)).toBe(
      "http://192.168.1.20:3001",
    );
  });

  test("rejects credentials, query strings, and non-API paths", () => {
    expect(() =>
      normalizeServerUrl("https://user:pass@school.example.com"),
    ).toThrow("username or password");
    expect(() =>
      normalizeServerUrl("https://school.example.com?tenant=1"),
    ).toThrow("query or fragment");
    expect(() =>
      normalizeServerUrl("https://school.example.com/platform"),
    ).toThrow("base URL");
  });

  test("resolves a frontend URL through its public discovery document", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = async (input) => {
      urls.push(String(input));
      if (String(input).endsWith("/.well-known/gradebook.json")) {
        return Response.json({ apiUrl: "https://api.school.example.com" });
      }
      return Response.json({ status: "ok" });
    };

    try {
      const apiUrl = await resolveServerUrl("https://school.example.com");
      await checkServerUrl(apiUrl);
      expect(apiUrl).toBe("https://api.school.example.com");
      expect(urls).toEqual([
        "https://school.example.com/.well-known/gradebook.json",
        "https://api.school.example.com/health",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("uses a direct backend URL when discovery is not published", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 404 });
    try {
      expect(await resolveServerUrl("https://api.school.example.com")).toBe(
        "https://api.school.example.com",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects invalid or insecure backend URLs advertised by discovery", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      Response.json({ apiUrl: "http://attacker.example" });
    try {
      await expect(
        resolveServerUrl("https://school.example.com"),
      ).rejects.toThrow("HTTPS");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
