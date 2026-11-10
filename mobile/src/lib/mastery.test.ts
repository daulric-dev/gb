import { describe, expect, test } from "bun:test";
import { formatEvidenceDate, levelTone, outcomeAccessibilityLabel, parentOutcomesPath, toneColor } from "./mastery";

const scale = {
  levels: [
    { value: 1, label: "Beginning" },
    { value: 2, label: "Developing" },
    { value: 3, label: "Proficient" },
    { value: 4, label: "Exceeding" },
  ],
  masteryThreshold: 3,
};

describe("mastery (mobile)", () => {
  test("tones and colours", () => {
    expect([null, 1, 2, 3, 4].map((l) => levelTone(l, scale))).toEqual(["none", "low", "mid", "high", "top"]);
    expect(toneColor("none", "light")).toBeUndefined();
    expect(toneColor("high", "dark")).not.toBe(toneColor("high", "light"));
  });

  test("labels for screen readers carry the level text", () => {
    expect(
      outcomeAccessibilityLabel({
        code: "MA.1",
        title: "Fractions",
        mastery: { score: 3.3, level: 3, label: "Proficient", status: "mastered", mastered: true, evidenceCount: 2 },
      }),
    ).toBe("MA.1 Fractions: Proficient, mastered, 2 pieces of evidence");
  });

  test("paths and dates", () => {
    expect(parentOutcomesPath("a b")).toBe("/parent/children/a%20b/outcomes");
    expect(formatEvidenceDate("2026-10-01T23:00:00Z")).toBe("1 Oct 2026");
  });
});
