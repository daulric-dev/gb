import { describe, expect, test } from "bun:test";
import {
  extendedLabel,
  extensionRequest,
  suggestedExtensionInput,
} from "./extensions";
import { toLocalInput } from "./format";

const NOW = Date.parse("2026-11-05T12:00:00.000Z");

describe("extensionRequest", () => {
  test("a future date becomes an ISO instant, reason trimmed", () => {
    const local = toLocalInput("2026-11-12T17:00:00.000Z");
    const result = extensionRequest(local, "  Off sick  ", NOW);
    expect(result).toEqual({
      ok: true,
      body: { dueAt: "2026-11-12T17:00:00.000Z", reason: "Off sick" },
    });
  });

  test("an empty reason is left out", () => {
    const local = toLocalInput("2026-11-12T17:00:00.000Z");
    const result = extensionRequest(local, "   ", NOW);
    expect(result.ok && result.body).toEqual({
      dueAt: "2026-11-12T17:00:00.000Z",
    });
  });

  test("a missing, invalid or past date is refused", () => {
    expect(extensionRequest("", "", NOW)).toEqual({
      ok: false,
      error: "Choose a new due date",
    });
    expect(extensionRequest("not a date", "", NOW).ok).toBe(false);
    const past = toLocalInput("2026-11-04T12:00:00.000Z");
    expect(extensionRequest(past, "", NOW)).toEqual({
      ok: false,
      error: "The new due date must be in the future",
    });
  });

  test("a reason over 500 characters is refused", () => {
    const local = toLocalInput("2026-11-12T17:00:00.000Z");
    expect(extensionRequest(local, "x".repeat(501), NOW).ok).toBe(false);
  });
});

describe("suggestedExtensionInput", () => {
  test("starts from the current extension when there is one", () => {
    expect(
      suggestedExtensionInput("2026-11-20T10:00:00.000Z", null, NOW),
    ).toBe(toLocalInput("2026-11-20T10:00:00.000Z"));
  });

  test("otherwise a day after the due date, or after now when that has passed", () => {
    expect(
      suggestedExtensionInput(null, "2026-11-10T10:00:00.000Z", NOW),
    ).toBe(toLocalInput("2026-11-11T10:00:00.000Z"));
    expect(
      suggestedExtensionInput(null, "2026-11-01T10:00:00.000Z", NOW),
    ).toBe(toLocalInput("2026-11-06T12:00:00.000Z"));
    expect(suggestedExtensionInput(null, null, NOW)).toBe(
      toLocalInput("2026-11-06T12:00:00.000Z"),
    );
  });
});

describe("extendedLabel", () => {
  test("names the new date", () => {
    expect(extendedLabel("2026-11-12T17:00:00.000Z")).toStartWith(
      "Extended to ",
    );
  });
});
