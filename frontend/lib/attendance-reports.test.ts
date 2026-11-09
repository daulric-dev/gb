import { describe, expect, test } from "bun:test";
import { byRateThenName, countedSessions, formatPercent, lastWeeks, localToday, rangeQuery } from "./attendance-reports";

describe("attendance reports helpers", () => {
  test("percent formatting keeps one decimal and shows a dash for nothing counted", () => {
    expect(formatPercent(66.66)).toBe("66.7%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(null)).toBe("–");
  });

  test("the default range is the last four weeks, today included", () => {
    expect(lastWeeks("2026-11-09")).toEqual({ from: "2026-10-13", to: "2026-11-09" });
    expect(rangeQuery({ from: "2026-10-13", to: "2026-11-09" })).toBe("from=2026-10-13&to=2026-11-09");
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });

  test("counted sessions leave out excused", () => {
    expect(countedSessions({ present: 2, late: 1, absent: 1, excused: 4, rate: 75 })).toBe(4);
  });

  test("lowest rate first; nothing counted last", () => {
    const row = (lastName: string, rate: number | null) => ({
      lastName, firstName: null, rate, present: 0, late: 0, absent: 0, excused: 0,
    });
    const sorted = [row("C", null), row("B", 90), row("A", 50), row("D", 50)].sort(byRateThenName);
    expect(sorted.map((r) => r.lastName)).toEqual(["A", "D", "B", "C"]);
  });
});
