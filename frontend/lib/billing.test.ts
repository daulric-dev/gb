import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  BILLING_DISABLED,
  billableSeats,
  billingLoaded,
  billingStatus,
  daysUntil,
  estimateAmountCents,
  fetchBillingStatus,
  formatMoney,
  refreshBillingStatus,
  resetBillingState,
} from "@/lib/billing";

const prices = { perUserCents: 500, flatCents: 30000 };

function respond(status: number, body: unknown) {
  globalThis.fetch = mock(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("formatMoney", () => {
  test("formats cents in the given currency", () => {
    expect(formatMoney(30000, "USD", "en-US")).toBe("$300.00");
    expect(formatMoney(500, "USD", "en-US")).toBe("$5.00");
    expect(formatMoney(0, "USD", "en-US")).toBe("$0.00");
  });

  test("respects the currency's minor units", () => {
    // JPY has no minor unit, so the amount is already whole yen.
    expect(formatMoney(500, "JPY", "en-US")).toBe("¥500");
    expect(formatMoney(123456, "EUR", "en-US")).toBe("€1,234.56");
  });

  test("lower-case and invalid codes don't throw", () => {
    expect(formatMoney(1000, "usd", "en-US")).toBe("$10.00");
    expect(formatMoney(1000, "NOPE!", "en-US")).toBe("10.00 NOPE!");
  });
});

describe("estimateAmountCents", () => {
  test("per user multiplies the per-user price by the seats", () => {
    expect(estimateAmountCents("per_user", 42, prices)).toBe(21000);
  });

  test("flat is the flat price regardless of seats", () => {
    expect(estimateAmountCents("flat", 1, prices)).toBe(30000);
    expect(estimateAmountCents("flat", 5000, prices)).toBe(30000);
  });

  test("bills at least one seat", () => {
    expect(estimateAmountCents("per_user", 0, prices)).toBe(500);
    expect(billableSeats(-3)).toBe(1);
    expect(billableSeats(Number.NaN)).toBe(1);
  });

  test("uses the prices it is given, not hard-coded ones", () => {
    const other = { perUserCents: 700, flatCents: 25000 };
    expect(estimateAmountCents("per_user", 10, other)).toBe(7000);
    expect(estimateAmountCents("flat", 10, other)).toBe(25000);
  });
});

describe("daysUntil", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  test("rounds partial days up and never goes negative", () => {
    expect(daysUntil("2026-01-02T00:00:00Z", now)).toBe(1);
    expect(daysUntil("2026-01-31T12:00:00Z", now)).toBe(30);
    expect(daysUntil("2025-12-01T00:00:00Z", now)).toBe(0);
  });
  test("null for missing or invalid dates", () => {
    expect(daysUntil(null, now)).toBeNull();
    expect(daysUntil("not a date", now)).toBeNull();
  });
});

describe("billing status", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => resetBillingState());
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("404 (billing routes absent) means disabled", async () => {
    respond(404, { statusCode: 404, message: "Cannot GET /api/billing/status" });
    expect(await fetchBillingStatus()).toEqual(BILLING_DISABLED);
  });

  test("enabled: false means disabled even if other fields are set", async () => {
    respond(200, { enabled: false, readOnly: true, status: "read_only", trialEndsAt: null });
    expect(await fetchBillingStatus()).toEqual(BILLING_DISABLED);
  });

  test("enabled status passes through", async () => {
    const body = {
      enabled: true,
      readOnly: false,
      status: "trialing",
      trialEndsAt: "2026-02-01T00:00:00Z",
    };
    respond(200, body);
    expect(await fetchBillingStatus()).toEqual(body);
  });

  test("refresh stores the status and marks it loaded", async () => {
    respond(200, { enabled: true, readOnly: true, status: "read_only", trialEndsAt: null });
    await refreshBillingStatus();
    expect(billingLoaded.value).toBe(true);
    expect(billingStatus.value.readOnly).toBe(true);
  });

  test("refresh after a 404 leaves billing disabled", async () => {
    respond(404, { message: "Not Found" });
    await refreshBillingStatus();
    expect(billingLoaded.value).toBe(true);
    expect(billingStatus.value).toEqual(BILLING_DISABLED);
  });

  test("a server error keeps the previous status", async () => {
    respond(200, { enabled: true, readOnly: false, status: "active", trialEndsAt: null });
    await refreshBillingStatus();
    respond(500, { message: "boom" });
    await refreshBillingStatus();
    expect(billingStatus.value.enabled).toBe(true);
    expect(billingStatus.value.status).toBe("active");
  });

  test("a network failure before anything loaded leaves billing hidden", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    await refreshBillingStatus();
    expect(billingStatus.value).toEqual(BILLING_DISABLED);
  });
});
