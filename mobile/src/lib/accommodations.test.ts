import { describe, expect, test } from "bun:test";
import { accommodationBadges, quizMinutesLabel } from "./accommodations";

describe("accommodationBadges", () => {
  test("time and lockdown labels", () => {
    expect(
      accommodationBadges({
        source: "student",
        timeMultiplier: 1.5,
        extraMinutes: null,
        lockdownExempt: true,
      }),
    ).toEqual(["×1.5 time", "No lockdown"]);
    expect(
      accommodationBadges({
        source: "activity",
        timeMultiplier: null,
        extraMinutes: 20,
        lockdownExempt: false,
      }),
    ).toEqual(["+20 min"]);
    expect(accommodationBadges(null)).toEqual([]);
  });
});

describe("quizMinutesLabel", () => {
  test("mentions the standard limit only when it differs", () => {
    expect(quizMinutesLabel(30, 30)).toBe("30 minutes");
    expect(quizMinutesLabel(45, 30)).toBe(
      "45 minutes (extra time: the quiz is 30 minutes)",
    );
  });
});
