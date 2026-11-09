import { describe, expect, test } from "bun:test";
import {
  addDays,
  daysIn,
  entryDayLabel,
  groupByDay,
  isoWeekday,
  minutesToTime,
  timeRange,
  timeToMinutes,
  weekOf,
  weekdayLabel,
  type TimetableOccurrence,
} from "./timetable";

describe("timetable times", () => {
  test("minutes to HH:MM and back", () => {
    expect(minutesToTime(545)).toBe("09:05");
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(1440)).toBe("24:00");
    expect(timeToMinutes("09:05")).toBe(545);
    expect(timeToMinutes("9:05")).toBe(545);
    expect(timeToMinutes("24:00")).toBe(1440);
    expect(timeToMinutes("24:01")).toBeNull();
    expect(timeToMinutes("12:60")).toBeNull();
    expect(timeToMinutes("noon")).toBeNull();
    expect(timeRange(540, 600)).toBe("09:00–10:00");
  });
});

describe("timetable days", () => {
  test("weekday labels", () => {
    expect(weekdayLabel(1)).toBe("Monday");
    expect(weekdayLabel(7, true)).toBe("Sun");
    expect(entryDayLabel({ weekday: 3, cycleDay: null })).toBe("Wednesday");
    expect(entryDayLabel({ weekday: null, cycleDay: 4 })).toBe("Day 4");
  });

  test("week ranges run Monday to Sunday", () => {
    expect(isoWeekday("2026-11-09")).toBe(1);
    expect(weekOf("2026-11-12")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(weekOf("2026-11-15")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(weekOf("2027-01-01")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysIn("2026-11-09", "2026-11-11")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11"]);
  });

  test("groups occurrences by day in time order", () => {
    const o = (date: string, startMinute: number) => ({ date, startMinute }) as TimetableOccurrence;
    const g = groupByDay([o("2026-11-10", 600), o("2026-11-09", 540), o("2026-11-10", 480)]);
    expect([...g.keys()]).toEqual(["2026-11-09", "2026-11-10"]);
    expect(g.get("2026-11-10")!.map((x) => x.startMinute)).toEqual([480, 600]);
  });
});
