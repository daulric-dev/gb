import { describe, expect, test } from "bun:test";
import { marksComplete, progressByReviewer, reviewTotal, windowLabel } from "./peer-review";

const fmt = (iso: string) => iso.slice(0, 10);

describe("peer review helpers", () => {
  test("window labels", () => {
    expect(windowLabel({ state: "scheduled", opensAt: "2026-11-20T00:00:00Z", closesAt: "x" }, fmt)).toBe(
      "Opens 2026-11-20",
    );
    expect(windowLabel({ state: "not_started", opensAt: null, closesAt: "x" }, fmt)).toBe(
      "Waiting for the teacher to start it",
    );
    expect(windowLabel({ state: "open", opensAt: null, closesAt: "2026-11-30T00:00:00Z" }, fmt)).toBe(
      "Open until 2026-11-30",
    );
    expect(windowLabel({ state: "closed", opensAt: null, closesAt: "2026-11-30T00:00:00Z" }, fmt)).toBe(
      "Closed 2026-11-30",
    );
  });

  test("totals and completeness", () => {
    const marks = [
      { criterionId: "a", ratingId: null, points: 1.5, comment: null },
      { criterionId: "b", ratingId: null, points: 2.25, comment: null },
    ];
    expect(reviewTotal(marks)).toBe(3.75);
    expect(reviewTotal([])).toBeNull();
    const rubric = { criteria: [{ id: "a" }, { id: "b" }, { id: "c" }] } as never;
    expect(marksComplete(rubric, marks)).toBe(false);
    expect(marksComplete(null, [])).toBe(true);
  });

  test("progress per reviewer", () => {
    const p = progressByReviewer([
      { reviewer: { id: "r1", name: "A" }, submittedAt: "x" },
      { reviewer: { id: "r1", name: "A" }, submittedAt: null },
      { reviewer: null, submittedAt: null },
    ]);
    expect(p.get("r1")).toEqual({ done: 1, total: 2 });
  });
});
