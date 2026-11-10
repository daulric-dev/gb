import { describe, expect, test } from "bun:test";
import { lateLabel, penaltyBreakdown } from "./late";

describe("lateLabel", () => {
  test("hours under a day, started days after", () => {
    expect(lateLabel(0)).toBe("");
    expect(lateLabel(60)).toBe("Late (1 hour)");
    expect(lateLabel(3 * 3_600)).toBe("Late (3 hours)");
    expect(lateLabel(86_400)).toBe("Late (1 day)");
    expect(lateLabel(86_401)).toBe("Late (2 days)");
  });
});

describe("penaltyBreakdown", () => {
  test("raw − percent = score", () => {
    expect(penaltyBreakdown(85, 10, 76.5)).toBe("85 − 10% late = 76.5");
    expect(penaltyBreakdown(85, 10, 85, true)).toBe("85 (10% late penalty waived)");
    expect(penaltyBreakdown(85, 0, 85)).toBeNull();
  });
});
