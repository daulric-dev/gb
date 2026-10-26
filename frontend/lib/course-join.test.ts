import { describe, expect, test } from "bun:test";
import { joinUrl, normaliseJoinCode } from "./course-join";

describe("course join links", () => {
  test("the QR link is /join/<code> on the web app's origin", () => {
    expect(joinUrl("AB12CD", "https://app.example.com/")).toBe(
      "https://app.example.com/join/AB12CD",
    );
  });

  test("codes are normalised to upper case and trimmed", () => {
    expect(normaliseJoinCode("ab12cd")).toBe("AB12CD");
    expect(normaliseJoinCode("%20ab12cd%20")).toBe("AB12CD");
  });

  test("anything that isn't a join code is refused", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "ab",
      "ab-12",
      "ab/cd",
      "%E0%A4%A",
      "x".repeat(21),
    ]) {
      expect(normaliseJoinCode(bad as string)).toBeNull();
    }
  });
});
