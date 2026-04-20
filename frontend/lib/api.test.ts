import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

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

import { ApiError } from "@/lib/api";
import { setTokens } from "@/lib/auth";

type MockedFetch = typeof fetch & { mock: { calls: [string, Record<string, string | Record<string, string>>][] } };

const BASE_URL = "http://localhost:3001/api/v1";

describe("ApiError", () => {
  test("sets status, message, and data", () => {
    const error = new ApiError(404, "Not Found", { detail: "missing" });
    expect(error.status).toBe(404);
    expect(error.message).toBe("Not Found");
    expect(error.data).toEqual({ detail: "missing" });
  });

  test('name is "ApiError"', () => {
    const error = new ApiError(500, "Internal");
    expect(error.name).toBe("ApiError");
  });

  test("is instance of Error", () => {
    const error = new ApiError(400, "Bad Request");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("api()", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("calls fetch with correct URL", async () => {
    const { api } = await import("@/lib/api");
    await api("/users");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BASE_URL}/users`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  test("sets Authorization header when access token exists", async () => {
    setTokens("test-access", "test-refresh");
    const { api } = await import("@/lib/api");
    await api("/me");

    const callArgs = (globalThis.fetch as MockedFetch).mock.calls[0];
    expect(callArgs[1].headers["Authorization"]).toBe("Bearer test-access");
  });

  test("sets Content-Type when body is provided", async () => {
    const { api } = await import("@/lib/api");
    await api("/data", { method: "POST", body: { name: "test" } });

    const callArgs = (globalThis.fetch as MockedFetch).mock.calls[0];
    expect(callArgs[1].headers["Content-Type"]).toBe("application/json");
  });

  test("throws ApiError on non-ok response", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ message: "Forbidden" }), {
          status: 403,
          statusText: "Forbidden",
        }),
    ) as typeof fetch;

    const { api } = await import("@/lib/api");
    try {
      await api("/secret");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
    }
  });

  test("parses JSON response", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ id: 1, name: "Alice" }), {
          status: 200,
        }),
    ) as typeof fetch;

    const { api } = await import("@/lib/api");
    const result = await api("/users/1");
    expect(result).toEqual({ id: 1, name: "Alice" });
  });
});
