import { describe, expect, test } from "bun:test";
import {
  bucketActivity,
  byDueDate,
  pastDueMessage,
  studentDueAt,
} from "./work-types";

describe("student due dates", () => {
  test("the effective due date wins, even when it is null", () => {
    expect(
      studentDueAt({ dueAt: "2026-11-01T00:00:00Z", effectiveDueAt: "2026-11-09T00:00:00Z" }),
    ).toBe("2026-11-09T00:00:00Z");
    expect(studentDueAt({ dueAt: "2026-11-01T00:00:00Z" })).toBe(
      "2026-11-01T00:00:00Z",
    );
    expect(
      studentDueAt({ dueAt: "2026-11-01T00:00:00Z", effectiveDueAt: null }),
    ).toBeNull();
  });

  test("the to-do sorts by the student's own date", () => {
    const extended = {
      dueAt: "2026-11-01T00:00:00Z",
      effectiveDueAt: "2026-12-01T00:00:00Z",
    };
    const soon = { dueAt: "2026-11-20T00:00:00Z" };
    expect([extended, soon].sort(byDueDate)).toEqual([soon, extended]);
  });

  test("extended work stays upcoming", () => {
    const base = {
      id: "a",
      courseId: "c",
      assignmentGroupId: null,
      kind: "assignment" as const,
      title: "Essay",
      instructions: null,
      points: 10,
      status: "published" as const,
      publishedAt: null,
      allowFile: true,
      allowMultipleFiles: false,
      allowText: true,
      maxAttempts: 1,
      timeLimitMinutes: null,
      lockdownBrowser: false,
      rubricId: null,
      submission: null,
      dueAt: "2020-01-01T00:00:00Z",
    };
    expect(bucketActivity(base)).toBe("past");
    expect(
      bucketActivity({ ...base, effectiveDueAt: "2999-01-01T00:00:00Z" }),
    ).toBe("upcoming");
  });

  test("the closed message names the date and asks for an extension", () => {
    expect(pastDueMessage("2026-11-01T12:00:00Z")).toStartWith(
      "This was due on ",
    );
    expect(pastDueMessage("2026-11-01T12:00:00Z")).toEndWith(
      "Ask your teacher for an extension",
    );
    expect(pastDueMessage(null)).toBe("This is closed");
  });
});
