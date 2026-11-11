import { describe, expect, test } from "bun:test";
import {
  timeZoneLabel,
  utcOffsetLabel,
  addDays,
  daysIn,
  entryDayLabel,
  groupByDay,
  isKnownTimeZone,
  isoWeekday,
  timeZoneOptions,
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

describe("school time zone picker", () => {
  test("lists IANA zones, sorted, with UTC and any extra zone included", () => {
    const zones = timeZoneOptions("Europe/London", null, undefined);
    expect(zones).toContain("UTC");
    expect(zones).toContain("Europe/London");
    expect(zones).toContain("America/New_York");
    expect([...zones].sort((a, b) => a.localeCompare(b))).toEqual(zones);
    expect(new Set(zones).size).toBe(zones.length);
  });

  test("known zones are accepted, made-up ones are not", () => {
    expect(isKnownTimeZone("Asia/Tokyo")).toBe(true);
    expect(isKnownTimeZone("UTC")).toBe(true);
    expect(isKnownTimeZone("Mars/Base")).toBe(false);
    expect(isKnownTimeZone("")).toBe(false);
  });
});

describe("UTC offset labels", () => {
  test("whole and half hours, both signs, UTC", () => {
    const winter = new Date("2026-01-15T12:00:00Z");
    expect(utcOffsetLabel("America/New_York", winter)).toBe("UTC-5");
    expect(utcOffsetLabel("America/Port_of_Spain", winter)).toBe("UTC-4");
    expect(utcOffsetLabel("Asia/Kolkata", winter)).toBe("UTC+5:30");
    expect(utcOffsetLabel("UTC", winter)).toBe("UTC");
    expect(utcOffsetLabel("Not/AZone", winter)).toBe("");
  });

  test("follows daylight saving time", () => {
    expect(utcOffsetLabel("America/New_York", new Date("2026-07-15T12:00:00Z"))).toBe("UTC-4");
  });

  test("label for the picker", () => {
    const at = new Date("2026-01-15T12:00:00Z");
    expect(timeZoneLabel("America/Sao_Paulo", at)).toBe("America/Sao_Paulo (UTC-3)");
    expect(timeZoneLabel("UTC", at)).toBe("UTC");
  });
});
