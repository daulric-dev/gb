import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

globalThis.document ??= { cookie: "" } as unknown as Document;
globalThis.window ??= globalThis as unknown as Window & typeof globalThis;

import { ApiError, api, setUnauthorizedHandler } from "@/lib/api";

type MockedFetch = typeof fetch & {
  mock: {
    calls: [string, { headers: Record<string, string>; [k: string]: unknown }][];
  };
};

const BASE_URL = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"}/api`;

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
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof fetch;
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

  test("sends credentials so cookies are forwarded", async () => {
    const { api } = await import("@/lib/api");
    await api("/me");

    const callArgs = (globalThis.fetch as MockedFetch).mock.calls[0];
    expect(callArgs[1].credentials).toBe("include");
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
    ) as unknown as typeof fetch;

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
    ) as unknown as typeof fetch;

    const { api } = await import("@/lib/api");
    const result = await api("/users/1");
    expect(result).toEqual({ id: 1, name: "Alice" });
  });
});

describe("401 handling", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ message: "nope" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setUnauthorizedHandler(null);
  });

  test("calls the registered handler instead of touching location", async () => {
    let called = 0;
    setUnauthorizedHandler(() => {
      called += 1;
    });

    await expect(api("/auth/me")).rejects.toThrow(ApiError);
    expect(called).toBe(1);
  });

  test("skipAuthRedirect suppresses it", async () => {
    let called = 0;
    setUnauthorizedHandler(() => {
      called += 1;
    });

    // The profile fetch uses this: a 401 there is "not signed in", which is an
    // answer, not a session that just expired.
    await expect(
      api("/auth/me", { skipAuthRedirect: true }),
    ).rejects.toThrow(ApiError);
    expect(called).toBe(0);
  });

  test("still throws 401 so callers can react", async () => {
    setUnauthorizedHandler(() => {});
    const error = await api("/auth/me").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
  });

  test("unregistering restores the no-handler path", async () => {
    let called = 0;
    setUnauthorizedHandler(() => {
      called += 1;
    });
    setUnauthorizedHandler(null);

    // Without a handler it falls back to a hard navigation, which jsdom-less
    // bun has no implementation for - the point here is only that the handler
    // is not called once it has been removed.
    await api("/auth/me").catch(() => {});
    expect(called).toBe(0);
  });
});
