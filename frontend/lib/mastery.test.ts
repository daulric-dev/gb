import { describe, expect, test } from "bun:test";
import {
  calculationSummary,
  cellDescription,
  cellText,
  defaultBands,
  formatEvidenceDate,
  levelTone,
  nestOutcomes,
  scaleError,
} from "./mastery";

const scale = {
  levels: [
    { value: 1, label: "Beginning" },
    { value: 2, label: "Developing" },
    { value: 3, label: "Proficient" },
    { value: 4, label: "Exceeding" },
  ],
  masteryThreshold: 3,
  calculation: "decaying_average" as const,
  decayWeight: 0.65,
  minEvidence: 1,
};

describe("mastery helpers", () => {
  test("tones follow the scale and the threshold", () => {
    expect([null, 1, 2, 3, 4].map((l) => levelTone(l, scale))).toEqual(["none", "low", "mid", "high", "top"]);
    // Threshold at the top level: the top is just "high".
    expect(levelTone(4, { ...scale, masteryThreshold: 4 })).toBe("high");
  });

  test("cell text and the screen reader description always carry the label", () => {
    const r = { score: 3.3, level: 3, label: "Proficient", status: "mastered" as const, mastered: true, evidenceCount: 2 };
    expect(cellText(r)).toBe("Proficient · 3.3");
    expect(cellDescription(r, { code: "MA.1", title: "Fractions" })).toBe(
      "MA.1 Fractions: Proficient, score 3.3, mastered, 2 pieces of evidence",
    );
    const none = { score: null, level: null, label: null, status: "no_evidence" as const, mastered: false, evidenceCount: 0 };
    expect(cellText(none)).toBe("-");
    expect(cellDescription(none, { code: "A", title: "B" })).toBe("A B: no evidence yet");
  });

  test("outcomes nest under their parents, depth first", () => {
    const out = nestOutcomes([
      { id: "c", parentId: "b" },
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "x", parentId: "missing" },
    ]);
    expect(out.map((o) => [o.id, o.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
      ["x", 0],
    ]);
  });

  test("scale validation mirrors the server", () => {
    const ok = { levels: ["A", "B", "C", "D"], masteryThreshold: 3, decayWeight: 0.65, minEvidence: 1, scoreBands: defaultBands(4) };
    expect(scaleError(ok)).toBeNull();
    expect(scaleError({ ...ok, levels: ["A"] })).toMatch(/2 to 10/);
    expect(scaleError({ ...ok, masteryThreshold: 5 })).toMatch(/between 1 and 4/);
    expect(scaleError({ ...ok, scoreBands: [{ minPercent: 5, level: 1 }] })).toMatch(/0%/);
    expect(defaultBands(5).map((b) => b.minPercent)).toEqual([0, 20, 40, 60, 80]);
  });

  test("dates are fixed format in UTC", () => {
    expect(formatEvidenceDate("2026-10-01T23:30:00Z")).toBe("1 Oct 2026");
    expect(formatEvidenceDate("nope")).toBe("");
  });

  test("calculation summary", () => {
    expect(calculationSummary(scale)).toBe(
      "Mastery uses a decaying average (the newest evidence counts 65%). An outcome is mastered at Proficient or above. Late penalties never count.",
    );
    expect(calculationSummary({ ...scale, calculation: "highest", minEvidence: 3 })).toContain("at least 3 pieces");
  });
});
