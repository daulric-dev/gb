import { describe, test, expect, beforeEach } from "bun:test";

const store = new Map<string, string>();
globalThis.localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
} as Storage;
globalThis.document ??= { cookie: "" } as unknown as Document;
globalThis.window ??= globalThis as unknown as Window & typeof globalThis;

import {
  getTokens,
  setTokens,
  clearTokens,
  getAccessToken,
  isAuthenticated,
} from "@/lib/auth";

describe("auth", () => {
  beforeEach(() => {
    store.clear();
    document.cookie = "";
  });

  test("getTokens returns null when nothing stored", () => {
    const tokens = getTokens();
    expect(tokens.access).toBeNull();
    expect(tokens.refresh).toBeNull();
  });

  test("setTokens/getTokens round-trip", () => {
    setTokens("access-123", "refresh-456");
    const tokens = getTokens();
    expect(tokens.access).toBe("access-123");
    expect(tokens.refresh).toBe("refresh-456");
  });

  test("clearTokens removes tokens", () => {
    setTokens("access-123", "refresh-456");
    clearTokens();
    const tokens = getTokens();
    expect(tokens.access).toBeNull();
    expect(tokens.refresh).toBeNull();
  });

  test("getAccessToken returns the access token", () => {
    setTokens("my-access", "my-refresh");
    expect(getAccessToken()).toBe("my-access");
  });

  test("isAuthenticated returns true when token exists", () => {
    setTokens("token", "refresh");
    expect(isAuthenticated()).toBe(true);
  });

  test("isAuthenticated returns false when no token", () => {
    expect(isAuthenticated()).toBe(false);
  });
});
