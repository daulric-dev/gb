import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  checkInErrorMessage,
  formatCountdown,
  formatRate,
  msUntil,
  rateColor,
  statusLabel,
} from "@/lib/attendance";

describe("formatCountdown", () => {
  test("minutes and padded seconds", () => {
    expect(formatCountdown(65_000)).toBe("1:05");
    expect(formatCountdown(5 * 60_000)).toBe("5:00");
  });
  test("rounds partial seconds up and never goes negative", () => {
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(-5000)).toBe("0:00");
  });
  test("hours", () => {
    expect(formatCountdown(3_725_000)).toBe("1:02:05");
  });
});

describe("msUntil", () => {
  test("time left, clamped at zero", () => {
    const now = Date.parse("2026-10-20T10:00:00Z");
    expect(msUntil("2026-10-20T10:01:00Z", now)).toBe(60_000);
    expect(msUntil("2026-10-20T09:59:00Z", now)).toBe(0);
    expect(msUntil(null, now)).toBe(0);
  });
});

describe("rate", () => {
  test("colour bands", () => {
    expect(rateColor(95)).toContain("emerald");
    expect(rateColor(90)).toContain("emerald");
    expect(rateColor(80)).toContain("amber");
    expect(rateColor(50)).toContain("red");
    expect(rateColor(null)).toContain("muted");
  });
  test("format", () => {
    expect(formatRate(87.6)).toBe("88%");
    expect(formatRate(null)).toBe("-");
  });
});

describe("labels and errors", () => {
  test("pending is Waiting", () => {
    expect(statusLabel(null)).toBe("Waiting");
    expect(statusLabel("late")).toBe("Late");
  });
  test("API messages pass through", () => {
    expect(
      checkInErrorMessage(new ApiError(409, "That code is not right")),
    ).toBe("That code is not right");
    expect(checkInErrorMessage(new ApiError(429, "Too Many Requests"))).toContain(
      "Too many wrong codes",
    );
  });
});
