import { describe, expect, test } from "bun:test";
import {
  describeDistribution,
  describeSubmissions,
  describeTrend,
  describeValues,
  histogramRows,
  lastUpdatedText,
  pct,
  schoolQuery,
  type ActivityAnalytics,
  type Distribution,
} from "./analytics";

const dist = (over: Partial<Distribution> = {}): Distribution => ({
  count: 4,
  min: 40,
  max: 95,
  mean: 70,
  median: 72.5,
  q1: 60,
  q3: 85,
  histogram: Array.from({ length: 10 }, (_, i) => ({ from: i * 10, to: i * 10 + 10, count: i === 7 ? 2 : i === 4 || i === 9 ? 1 : 0 })),
  ...over,
});

describe("analytics text", () => {
  test("percent and query helpers", () => {
    expect(pct(null)).toBe("-");
    expect(pct(72.5)).toBe("72.5%");
    expect(schoolQuery({ termId: "t1", academicYearId: null })).toBe("termId=t1");
    expect(schoolQuery({})).toBe("");
  });

  test("distribution summary names the median, quartiles and the busiest band", () => {
    expect(describeDistribution(dist())).toBe(
      "4 students. Median 72.5%, middle half between 60% and 85%, range 40% to 95%. Most common band: 70-80% (2).",
    );
    expect(describeDistribution(dist({ count: 0 }))).toBe("No marks yet.");
    expect(histogramRows(dist())[7]).toEqual({ label: "70-80", count: 2 });
  });

  test("trend summary gives the direction and extremes", () => {
    expect(describeTrend([])).toBe("No marks yet.");
    expect(
      describeTrend([
        { week: "2026-10-05", average: 70, count: 3 },
        { week: "2026-10-12", average: 60, count: 3 },
        { week: "2026-10-19", average: 75.5, count: 2 },
      ]),
    ).toBe(
      "3 weeks with marks. From 70% (week of 2026-10-05) to 75.5% (week of 2026-10-19), up 5.5 points. Highest 75.5% (week of 2026-10-19), lowest 60% (week of 2026-10-12).",
    );
  });

  test("submission and value summaries", () => {
    const a = (title: string, rate: number | null, missing: number) =>
      ({ title, rate, missing }) as ActivityAnalytics;
    expect(describeSubmissions([a("Quiz", null, 0)])).toBe("Nothing is due yet.");
    expect(describeSubmissions([a("Essay", 90, 1), a("Lab", 50, 5), a("Quiz", null, 0)])).toBe(
      "2 of 3 activities are due. Lowest submission rate: Lab at 50% (5 missing).",
    );
    expect(describeValues([{ name: "A", value: 80 }, { name: "B", value: null }, { name: "C", value: 60 }], "average")).toBe(
      "Highest average: A at 80%. Lowest: C at 60%.",
    );
  });

  test("last updated", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(lastUpdatedText(null, now)).toContain("Not computed yet");
    expect(lastUpdatedText("2026-11-10T11:55:00Z", now)).toBe("Updated 5 minutes ago");
    expect(lastUpdatedText("2026-11-10T10:00:00Z", now)).toBe("Updated 2 hours ago");
  });
});
