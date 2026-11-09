import { describe, expect, test } from "bun:test";
import {
  addDays,
  groupByDate,
  isoWeekday,
  minuteLabel,
  occurrencePath,
  phase,
  rateLabel,
  statusLabel,
  timeRange,
  weekStart,
  type TimetableOccurrence,
} from "./timetable";

const occ = (over: Partial<TimetableOccurrence> = {}): TimetableOccurrence => ({
  entryId: "e1",
  courseId: "c1",
  courseName: "Maths",
  courseCode: null,
  periodId: "p1",
  periodName: "Period 1",
  occursOn: "2026-11-09",
  date: "2026-11-09",
  startMinute: 540,
  endMinute: 600,
  startsAt: "2026-11-09T09:00:00.000Z",
  endsAt: "2026-11-09T10:00:00.000Z",
  roomId: null,
  roomName: null,
  status: "scheduled",
  note: null,
  cycleDay: null,
  ...over,
});

describe("timetable helpers", () => {
  test("calendar days and weeks", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(isoWeekday("2026-11-15")).toBe(7);
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
  });

  test("times are the school's local minutes", () => {
    expect(minuteLabel(545)).toBe("09:05");
    expect(timeRange(occ())).toBe("09:00–10:00");
  });

  test("status labels and grouping", () => {
    expect(statusLabel(occ())).toBeNull();
    expect(statusLabel(occ({ status: "cancelled" }))).toBe("Cancelled");
    expect(statusLabel(occ({ status: "moved" }))).toBe("Moved");
    expect(statusLabel(occ({ status: "moved", date: "2026-11-12" }))).toMatch(/^Moved from /);
    const days = groupByDate([occ({ date: "2026-11-10", entryId: "b" }), occ({ startMinute: 600 }), occ({ entryId: "c" })]);
    expect(days.map((d) => [d.date, d.items.length])).toEqual([
      ["2026-11-09", 2],
      ["2026-11-10", 1],
    ]);
    expect(days[0].items[0].entryId).toBe("c");
  });

  test("phase, path and rate", () => {
    const o = occ();
    expect(phase(o, Date.parse("2026-11-09T08:59:00Z"))).toBe("upcoming");
    expect(phase(o, Date.parse("2026-11-09T09:30:00Z"))).toBe("now");
    expect(phase(o, Date.parse("2026-11-09T10:00:00Z"))).toBe("past");
    expect(occurrencePath(o)).toBe("/courses/c1/timetable/occurrences/e1/2026-11-09");
    expect(rateLabel(null)).toBe("–");
    expect(rateLabel(92.5)).toBe("92.5%");
  });
});
