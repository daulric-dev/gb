import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

globalThis.document ??= { cookie: "" } as unknown as Document;
globalThis.window ??= globalThis as unknown as Window & typeof globalThis;

import {
  ApiError,
  api,
  apiQuery,
  setFeatureDisabledHandler,
  setUnauthorizedHandler,
} from "@/lib/api";

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

describe("FEATURE_DISABLED handling", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            code: "FEATURE_DISABLED",
            feature: "files",
            message: "Files are turned off for your school",
          }),
          { status: 403 },
        ),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setFeatureDisabledHandler(null);
  });

  test("throws an ApiError carrying code, feature and message", async () => {
    const error = (await apiQuery("/files").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.code).toBe("FEATURE_DISABLED");
    expect(error.feature).toBe("files");
    expect(error.message).toBe("Files are turned off for your school");
  });

  test("calls the registered handler", async () => {
    const seen: string[] = [];
    setFeatureDisabledHandler((e) => seen.push(e.feature ?? ""));
    await apiQuery("/files").catch(() => {});
    expect(seen).toEqual(["files"]);
  });

  test("a plain 403 does not call it", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 }),
    ) as unknown as typeof fetch;
    let called = 0;
    setFeatureDisabledHandler(() => (called += 1));
    await apiQuery("/files").catch(() => {});
    expect(called).toBe(0);
  });
});

describe("apiQuery()", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify([{ id: "c1" }]), { status: 200 }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const lastCall = () => (globalThis.fetch as MockedFetch).mock.calls.at(-1)!;

  test("sends QUERY with the filters as a JSON body, not in the URL", async () => {
    const rows = await apiQuery<{ id: string }[]>("/courses", { status: "published" });
    expect(rows).toEqual([{ id: "c1" }]);

    const [url, init] = lastCall();
    expect(url).toBe(`${BASE_URL}/courses`);
    expect(init.method).toBe("QUERY");
    expect(init.body).toBe(JSON.stringify({ status: "published" }));
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["X-API-Version"]).toBe("1");
    expect(init.credentials).toBe("include");
  });

  test("no filters is an empty JSON object, never a missing body", async () => {
    await apiQuery("/students");
    const [, init] = lastCall();
    expect(init.method).toBe("QUERY");
    expect(init.body).toBe("{}");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  test("keeps the other options (headers, skipAuthRedirect)", async () => {
    await apiQuery("/files", { filter: "own" }, { headers: { "X-Test": "1" } });
    const [, init] = lastCall();
    expect(init.headers["X-Test"]).toBe("1");
    expect(init.body).toBe(JSON.stringify({ filter: "own" }));
  });

  test("api() passes a QUERY body through as-is", async () => {
    await api("/files/folders/contents", { method: "QUERY", body: { folderId: "f1" } });
    const [, init] = lastCall();
    expect(init.method).toBe("QUERY");
    expect(init.body).toBe(JSON.stringify({ folderId: "f1" }));
  });
});
