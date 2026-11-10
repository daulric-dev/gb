import { describe, expect, test } from "bun:test";
import { marksComplete, windowLabel, withMark } from "./peer-review-helpers";

describe("peer review helpers", () => {
  test("window label", () => {
    const f = (iso: string) => iso.slice(0, 10);
    expect(windowLabel({ state: "open", opensAt: null, closesAt: "2026-12-01T00:00:00Z" }, f)).toBe(
      "Open until 2026-12-01",
    );
    expect(windowLabel({ state: "not_started", opensAt: null, closesAt: "x" }, f)).toBe(
      "Waiting for your teacher to start it",
    );
  });

  test("marks", () => {
    const a = { criterionId: "a", ratingId: "r1", points: 2, comment: null };
    const next = withMark([a], { ...a, ratingId: "r2", points: 3 });
    expect(next).toEqual([{ ...a, ratingId: "r2", points: 3 }]);
    const rubric = { criteria: [{ id: "a" }, { id: "b" }] } as never;
    expect(marksComplete(rubric, next)).toBe(false);
    expect(marksComplete(null, [])).toBe(true);
  });
});
