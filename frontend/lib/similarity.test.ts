import { describe, expect, test } from "bun:test";
import { flagsByStudent, matchSource, similarityLabel } from "./similarity";

describe("similarity helpers", () => {
  test("label", () => {
    expect(similarityLabel({ count: 1, maxScore: 62 })).toBe("Similar to 1 submission · 62%");
    expect(similarityLabel({ count: 3, maxScore: 41 })).toBe("Similar to 3 submissions · 41%");
  });

  test("flags keyed by student keep the highest", () => {
    const out = flagsByStudent([
      { submissionId: "s1", studentId: "a", count: 1, maxScore: 45 },
      { submissionId: "s1", studentId: "a", count: 2, maxScore: 70 },
      { submissionId: "s2", studentId: "b", count: 1, maxScore: 50 },
    ]);
    expect(out.a.maxScore).toBe(70);
    expect(Object.keys(out).sort()).toEqual(["a", "b"]);
    expect(flagsByStudent(null)).toEqual({});
  });

  test("a match outside the teacher's courses has no name", () => {
    const base = {
      fingerprintId: "f",
      otherId: "o",
      part: "",
      partLabel: "Text answer",
      score: 50,
    };
    expect(
      matchSource({
        ...base,
        sameActivity: false,
        other: { submissionId: null, studentName: null, activityTitle: "Essay", courseName: "History", canView: false },
      }),
    ).toBe("A student in another course · Essay (History)");
    expect(
      matchSource({
        ...base,
        sameActivity: true,
        other: { submissionId: "x", studentName: "Ada", activityTitle: "Essay", courseName: "History", canView: true },
      }),
    ).toBe("Ada");
  });
});
