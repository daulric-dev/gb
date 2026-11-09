import { describe, expect, test } from "bun:test";
import {
  changedComments,
  completionPercent,
  deadlineState,
  documentSummary,
  draftErrors,
  initialDrafts,
  markAllReady,
  publishWarnings,
  reportFallbackName,
  termLabel,
  type CourseReportComments,
} from "@/lib/report-cards";

const students: CourseReportComments["students"] = [
  { studentId: "s1", firstName: "Ada", lastName: "Lovelace", percent: 90, letter: "A", comment: "Great", status: "ready", updatedAt: null },
  { studentId: "s2", firstName: "Alan", lastName: "Turing", percent: null, letter: null, comment: "", status: null, updatedAt: null },
  { studentId: "s3", firstName: "Grace", lastName: "Hopper", percent: 70, letter: "C", comment: "Half", status: "draft", updatedAt: null },
];

describe("report card helpers", () => {
  test("termLabel and completionPercent", () => {
    expect(termLabel({ name: "Autumn", yearName: "2026-27" })).toBe("Autumn · 2026-27");
    expect(termLabel({ name: "Autumn", yearName: null })).toBe("Autumn");
    expect(completionPercent({ ready: 1, students: 3 })).toBe(33);
    expect(completionPercent({ ready: 0, students: 0 })).toBe(0);
  });

  test("deadlineState", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(deadlineState(null, now)).toBe("none");
    expect(deadlineState("nonsense", now)).toBe("none");
    expect(deadlineState("2026-11-30T00:00:00Z", now)).toBe("passed");
    expect(deadlineState("2026-12-02T00:00:00Z", now)).toBe("soon");
    expect(deadlineState("2026-12-20T00:00:00Z", now)).toBe("open");
  });

  test("changedComments sends only real changes", () => {
    const drafts = initialDrafts(students);
    expect(changedComments(students, drafts)).toEqual([]);
    drafts.s1 = { ...drafts.s1, body: "  Great  " };
    expect(changedComments(students, drafts)).toEqual([]);
    drafts.s2 = { studentId: "s2", body: "New", status: "draft" };
    drafts.s3 = { ...drafts.s3, status: "ready" };
    expect(changedComments(students, drafts).map((d) => d.studentId)).toEqual(["s2", "s3"]);
  });

  test("an emptied existing comment is still sent", () => {
    const drafts = initialDrafts(students);
    drafts.s3 = { studentId: "s3", body: "", status: "draft" };
    expect(changedComments(students, drafts)).toEqual([{ studentId: "s3", body: "", status: "draft" }]);
  });

  test("draftErrors and markAllReady", () => {
    expect(
      draftErrors([
        { studentId: "a", body: " ", status: "ready" },
        { studentId: "b", body: "x".repeat(2001), status: "draft" },
        { studentId: "c", body: "ok", status: "ready" },
      ]),
    ).toEqual({ a: "Write a comment before marking it ready", b: "At most 2000 characters" });
    const all = markAllReady(initialDrafts(students));
    expect(all.s1.status).toBe("ready");
    expect(all.s2.status).toBe("draft");
    expect(all.s3.status).toBe("ready");
  });

  test("documentSummary and publishWarnings", () => {
    expect(documentSummary({ ready: 0, pending: 0, failed: 0 })).toBe("Not generated yet");
    expect(documentSummary({ ready: 12, pending: 2, failed: 1 })).toBe("12 ready · 2 generating · 1 failed");
    expect(publishWarnings({ students: 3, totals: { comments: 3, ready: 3, draft: 0, missing: 0 } })).toEqual([]);
    expect(publishWarnings({ students: 3, totals: { comments: 3, ready: 1, draft: 1, missing: 1 } })).toEqual([
      "1 comment is missing.",
      "1 comment is still a draft.",
    ]);
    expect(publishWarnings({ students: 0, totals: { comments: 0, ready: 0, draft: 0, missing: 0 } })[0]).toMatch(/No students/);
  });

  test("reportFallbackName strips unsafe characters", () => {
    expect(reportFallbackName({ firstName: "Ada", lastName: "Love/lace" }, "Autumn")).toBe("Lovelace-Ada-Autumn-report.pdf");
    expect(reportFallbackName({ firstName: null, lastName: null }, "")).toBe("report.pdf");
  });
});
