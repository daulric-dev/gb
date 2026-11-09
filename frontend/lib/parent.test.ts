import { describe, expect, test } from "bun:test";
import {
  announcementSource,
  attendanceRate,
  childTabs,
  formatLinkCode,
  gradeText,
  isCompleteLinkCode,
  isParentJoinPath,
  personName,
  relationshipText,
  selectedChildId,
  switchChildPath,
  toggleNoticeKind,
  type ParentVisibility,
} from "@/lib/parent";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const all: ParentVisibility = {
  grades: true,
  work: true,
  attendance: true,
  announcements: true,
  reports: true,
  notifications: true,
};

describe("childTabs", () => {
  test("every tab when the school shows everything", () => {
    expect(childTabs(A, all).map((t) => t.label)).toEqual([
      "Overview",
      "Grades",
      "Attendance",
      "Announcements",
      "Reports",
    ]);
  });

  test("hides what the school hides", () => {
    expect(
      childTabs(A, { ...all, grades: false, attendance: false, reports: false }).map((t) => t.href),
    ).toEqual([`/parent/${A}`, `/parent/${A}/announcements`]);
    expect(childTabs(A, { ...all, announcements: false }).at(-1)).toEqual({
      href: `/parent/${A}/reports`,
      label: "Reports",
    });
  });
});

describe("child selection", () => {
  const kids = [{ id: A }, { id: B }];

  test("the child in the path when it is one of theirs", () => {
    expect(selectedChildId(`/parent/${B}/grades`, kids)).toBe(B);
  });

  test("falls back to the first child for an unknown or missing id", () => {
    expect(selectedChildId(`/parent/${"3".repeat(8)}-3333-4333-8333-333333333333`, kids)).toBe(A);
    expect(selectedChildId("/parent", kids)).toBe(A);
    expect(selectedChildId("/parent", [])).toBeNull();
  });

  test("switching keeps the page", () => {
    expect(switchChildPath(`/parent/${A}/attendance`, B)).toBe(`/parent/${B}/attendance`);
    expect(switchChildPath(`/parent/${A}`, B)).toBe(`/parent/${B}`);
    expect(switchChildPath("/parent/settings", B)).toBe(`/parent/${B}`);
  });
});

describe("join paths", () => {
  test("accept and link pages, with or without a query", () => {
    expect(isParentJoinPath("/parent/accept")).toBe(true);
    expect(isParentJoinPath("/parent/accept?token=abc")).toBe(true);
    expect(isParentJoinPath("/parent/link/")).toBe(true);
    expect(isParentJoinPath("/parent")).toBe(false);
    expect(isParentJoinPath(`/parent/${A}`)).toBe(false);
  });
});

describe("link codes", () => {
  test("formats as typed", () => {
    expect(formatLinkCode("abcde")).toBe("ABCDE");
    expect(formatLinkCode("abcdefghjk")).toBe("ABCDE-FGHJK");
    expect(formatLinkCode(" ab cd-ef gh jk zz")).toBe("ABCDE-FGHJK");
    expect(isCompleteLinkCode("abcde-fghjk")).toBe(true);
    expect(isCompleteLinkCode("abcde")).toBe(false);
  });
});

describe("text helpers", () => {
  test("names and relationships", () => {
    expect(personName({ firstName: "Ada", lastName: null })).toBe("Ada");
    expect(personName(null, "Parent")).toBe("Parent");
    expect(relationshipText("mother")).toBe("Mother");
    expect(relationshipText("guardian", "Grandmother")).toBe("Grandmother");
    expect(relationshipText(null)).toBeNull();
  });

  test("grades and attendance", () => {
    expect(gradeText(null)).toBe("No grade yet");
    expect(gradeText({ percent: 88.25, letter: "B+" })).toBe("B+ (88.3%)");
    expect(gradeText({ percent: 70, letter: null })).toBe("70%");
    expect(attendanceRate({ present: 1, late: 0, absent: 0, excused: 0, rate: 95.5 })).toBe("95.5%");
    expect(attendanceRate({ present: 0, late: 0, absent: 0, excused: 0, rate: null })).toBe("—");
  });

  test("notice kinds keep catalog order", () => {
    expect(toggleNoticeKind(["announcement"], "missing_work", true)).toEqual([
      "missing_work",
      "announcement",
    ]);
    expect(toggleNoticeKind(["missing_work", "absence"], "missing_work", false)).toEqual(["absence"]);
  });
});

describe("announcementSource", () => {
  const base = { id: "1", title: "t", body: null, createdAt: null, author: null };
  test("school posts name the school", () => {
    expect(
      announcementSource({ ...base, scope: "school", courseId: null, courseName: null, schoolName: "Hill" }),
    ).toBe("Hill (whole school)");
    expect(announcementSource({ ...base, scope: "school", courseId: null, courseName: null })).toBe(
      "Whole school",
    );
  });
  test("course posts name the course, older servers included", () => {
    expect(announcementSource({ ...base, scope: "course", courseId: "c", courseName: "Maths" })).toBe("Maths");
    expect(announcementSource({ ...base, courseId: "c", courseName: "Maths" })).toBe("Maths");
  });
});
