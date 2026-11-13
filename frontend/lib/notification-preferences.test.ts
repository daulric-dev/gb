import { describe, expect, test } from "bun:test";
import { isOn, preferenceRows, withPreference, type NotificationPreferences } from "./notification-preferences";

describe("notification preferences", () => {
  const prefs: NotificationPreferences = { push: { grades: false }, email: {} };

  test("missing categories are on; rows fall back to the known list", () => {
    expect(isOn(prefs, "push", "grades")).toBe(false);
    expect(isOn(prefs, "email", "grades")).toBe(true);
    expect(preferenceRows(prefs)).toHaveLength(6);
    expect(preferenceRows({ ...prefs, categories: [{ key: "chat", label: "Messages" }] })).toEqual([
      { key: "chat", label: "Messages" },
    ]);
  });

  test("switching one category leaves the others alone", () => {
    const next = withPreference(prefs, "email", "chat", false);
    expect(next.email).toEqual({ chat: false });
    expect(next.push).toEqual({ grades: false });
  });
});
