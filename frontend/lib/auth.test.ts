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
  getAccessToken,
  setAccessToken,
  clearAccessToken,
  isAuthenticated,
} from "@/lib/auth";

describe("auth", () => {
  beforeEach(() => {
    clearAccessToken();
  });


  test("setTokens/getTokens round-trip", () => {
    setAccessToken("access-123");
    const token = getAccessToken();
    expect(token).toBe("access-123");
  });

  test("clearTokens removes tokens", () => {
    setAccessToken("access-123");
    clearAccessToken();
    const token = getAccessToken();
    expect(token).toBeNull();
  });

  test("getAccessToken returns the access token", () => {
    setAccessToken("my-access");
    expect(getAccessToken()).toBe("my-access");
  });

  test("isAuthenticated returns false when no token", () => {
    expect(isAuthenticated()).toBe(false);
  });

  test("isAuthenticated returns true when token exists", () => {
    setAccessToken("token");
    expect(isAuthenticated()).toBe(true);
  });

});