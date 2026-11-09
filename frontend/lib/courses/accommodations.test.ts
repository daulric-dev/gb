import { describe, expect, test } from "bun:test";
import {
  accommodationBadges,
  accommodationForm,
  accommodationRequest,
  multiplierLabel,
  quizMinutesLabel,
} from "./accommodations";

const form = (over: Partial<ReturnType<typeof accommodationForm>> = {}) => ({
  ...accommodationForm(null),
  ...over,
});

describe("accommodationBadges", () => {
  test("time and lockdown", () => {
    expect(
      accommodationBadges({ timeMultiplier: 1.5, extraMinutes: null, lockdownExempt: true }),
    ).toEqual(["×1.5 time", "No lockdown"]);
    expect(
      accommodationBadges({ timeMultiplier: null, extraMinutes: 20, lockdownExempt: false }),
    ).toEqual(["+20 min"]);
    expect(accommodationBadges(null)).toEqual([]);
  });

  test("multiplier labels drop trailing zeros", () => {
    expect(multiplierLabel(2)).toBe("×2");
    expect(multiplierLabel(1.25)).toBe("×1.25");
  });
});

describe("accommodationForm", () => {
  test("starts from what the student has", () => {
    expect(
      accommodationForm({ timeMultiplier: 1.5, extraMinutes: null, lockdownExempt: true }),
    ).toEqual({ time: "1.5", extraMinutes: "", lockdownExempt: true, reason: "" });
    expect(
      accommodationForm({
        timeMultiplier: null,
        extraMinutes: 15,
        lockdownExempt: false,
        reason: "Dyslexia",
      }),
    ).toEqual({ time: "extra", extraMinutes: "15", lockdownExempt: false, reason: "Dyslexia" });
  });
});

describe("accommodationRequest", () => {
  test("a multiplier", () => {
    expect(accommodationRequest(form({ time: "1.5", reason: "  x " }))).toEqual({
      ok: true,
      body: { timeMultiplier: 1.5, extraMinutes: null, lockdownExempt: false, reason: "x" },
    });
  });

  test("extra minutes, within range", () => {
    const ok = accommodationRequest(form({ time: "extra", extraMinutes: "600" }));
    expect(ok.ok && ok.body.extraMinutes).toBe(600);
    for (const bad of ["", "0", "601", "1.5", "abc"]) {
      expect(accommodationRequest(form({ time: "extra", extraMinutes: bad })).ok).toBe(false);
    }
  });

  test("lockdown only", () => {
    const res = accommodationRequest(form({ lockdownExempt: true }));
    expect(res).toEqual({
      ok: true,
      body: { timeMultiplier: null, extraMinutes: null, lockdownExempt: true },
    });
  });

  test("nothing, or an unknown multiplier, is refused", () => {
    expect(accommodationRequest(form())).toEqual({
      ok: false,
      error: "Give extra time or a Lockdown exemption",
    });
    expect(accommodationRequest(form({ time: "3" })).ok).toBe(false);
  });
});

describe("quizMinutesLabel", () => {
  test("shows the standard limit only when it differs", () => {
    expect(quizMinutesLabel(30, 30)).toBe("30 minutes");
    expect(quizMinutesLabel(30)).toBe("30 minutes");
    expect(quizMinutesLabel(45, 30)).toBe(
      "45 minutes (extra time: the quiz is 30 minutes)",
    );
  });
});
