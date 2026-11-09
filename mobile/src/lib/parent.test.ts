import { describe, expect, test } from "bun:test";
import {
  announcementSource,
  attendanceRate,
  formatLinkCode,
  gradeText,
  isCompleteLinkCode,
  relationshipText,
  toggleNoticeKind,
} from "./parent";

describe("parent helpers", () => {
  test("link codes", () => {
    expect(formatLinkCode("abcdefghjk")).toBe("ABCDE-FGHJK");
    expect(isCompleteLinkCode("ABCDE-FGHJK")).toBe(true);
    expect(isCompleteLinkCode("ABC")).toBe(false);
  });

  test("text", () => {
    expect(gradeText({ percent: 90, letter: "A" })).toBe("A (90%)");
    expect(gradeText(null)).toBe("No grade yet");
    expect(attendanceRate({ present: 1, late: 0, absent: 0, excused: 0, rate: null })).toBe("—");
    expect(relationshipText("father")).toBe("Father");
    expect(toggleNoticeKind([], "absence", true)).toEqual(["absence"]);
  });
});

describe("announcementSource", () => {
  const base = { id: "1", title: "t", body: null, createdAt: null, author: null };
  test("school posts name the school; course posts the course", () => {
    expect(
      announcementSource({ ...base, scope: "school", courseId: null, courseName: null, schoolName: "Hill" }),
    ).toBe("Hill (whole school)");
    expect(announcementSource({ ...base, scope: "course", courseId: "c", courseName: "Maths" })).toBe("Maths");
    expect(announcementSource({ ...base, courseId: "c", courseName: "Maths" })).toBe("Maths");
  });
});
