import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { api, ApiError } from "@/lib/api";
import {
  NOTICE_COOLDOWN_MS,
  isSubscriptionRequired,
  notifySubscriptionRequired,
  onSubscriptionRequired,
  resetSubscriptionNotice,
} from "@/lib/subscription-required";

describe("isSubscriptionRequired", () => {
  test("only a 402 carrying the SUBSCRIPTION_REQUIRED code", () => {
    expect(isSubscriptionRequired(402, { code: "SUBSCRIPTION_REQUIRED" })).toBe(true);
    expect(isSubscriptionRequired(402, { code: "OTHER" })).toBe(false);
    expect(isSubscriptionRequired(403, { code: "SUBSCRIPTION_REQUIRED" })).toBe(false);
    expect(isSubscriptionRequired(402, null)).toBe(false);
  });
});

describe("notifySubscriptionRequired", () => {
  beforeEach(() => resetSubscriptionNotice());

  test("shows one notice per cooldown window", () => {
    const t = 1_000_000;
    expect(notifySubscriptionRequired(t)).toBe(true);
    expect(notifySubscriptionRequired(t + 10)).toBe(false);
    expect(notifySubscriptionRequired(t + NOTICE_COOLDOWN_MS - 1)).toBe(false);
    expect(notifySubscriptionRequired(t + NOTICE_COOLDOWN_MS)).toBe(true);
  });

  test("tells listeners every time, even when the toast is deduped", () => {
    let calls = 0;
    const off = onSubscriptionRequired(() => {
      calls += 1;
    });
    notifySubscriptionRequired(1);
    notifySubscriptionRequired(2);
    off();
    notifySubscriptionRequired(3);
    expect(calls).toBe(2);
  });
});

describe("api() on 402", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetSubscriptionNotice();
    globalThis.fetch = mock(
      async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : "url" in input ? input.url : input.toString();
        if (url.includes("/billing/status")) {
          return new Response(JSON.stringify({ enabled: true, readOnly: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            statusCode: 402,
            code: "SUBSCRIPTION_REQUIRED",
            message: "Subscription required",
          }),
          { status: 402, headers: { "Content-Type": "application/json" } },
        );
      },
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("still throws so callers stop, and notifies once for a burst", async () => {
    let notified = 0;
    const off = onSubscriptionRequired(() => {
      notified += 1;
    });

    const errors = await Promise.all([
      api("/courses", { method: "POST", body: {} }).catch((e: unknown) => e),
      api("/courses", { method: "POST", body: {} }).catch((e: unknown) => e),
    ]);
    off();

    for (const err of errors) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(402);
    }
    expect(notified).toBe(2);
    // The first request showed the toast; the second hit the cooldown.
    expect(notifySubscriptionRequired()).toBe(false);
  });

  test("a 402 without the code is an ordinary error", async () => {
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({ message: "Pay" }), { status: 402 }),
    ) as unknown as typeof fetch;
    let notified = 0;
    const off = onSubscriptionRequired(() => {
      notified += 1;
    });
    await api("/x", { method: "POST" }).catch(() => {});
    off();
    expect(notified).toBe(0);
  });
});
