import { describe, expect, test } from "bun:test";
import { lateDays } from "./format";

describe("lateDays", () => {
  test("returns null when not late or when either date is missing", () => {
    expect(lateDays("2026-10-01T12:00:00.000Z", "2026-10-01T12:00:00.000Z")).toBe(
      null,
    );
    expect(lateDays(null, "2026-10-02T12:00:00.000Z")).toBeNull();
    expect(lateDays("invalid", "2026-10-02T12:00:00.000Z")).toBeNull();
  });

  test("rounds any portion of a late day up to the next day", () => {
    expect(lateDays("2026-10-01T12:00:00.000Z", "2026-10-01T12:01:00.000Z")).toBe(
      1,
    );
    expect(lateDays("2026-10-01T12:00:00.000Z", "2026-10-03T12:00:00.000Z")).toBe(
      2,
    );
  });
});
