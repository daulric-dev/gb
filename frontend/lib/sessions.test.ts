import { describe, expect, test } from "bun:test";
import { isMobileDevice, lastActiveLabel, methodLabel } from "./sessions";

describe("signed-in devices", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();

  test("this device is active now; others show when they were last used", () => {
    expect(lastActiveLabel({ current: true, lastSeenAt: ago(9e9) }, now)).toBe("Active now");
    expect(lastActiveLabel({ current: false, lastSeenAt: ago(30_000) }, now)).toBe("Last active just now");
    expect(lastActiveLabel({ current: false, lastSeenAt: ago(5 * 60_000) }, now)).toBe("Last active 5 min ago");
    expect(lastActiveLabel({ current: false, lastSeenAt: ago(3 * 3_600_000) }, now)).toBe("Last active 3 h ago");
    expect(lastActiveLabel({ current: false, lastSeenAt: ago(86_400_000) }, now)).toBe("Last active 1 day ago");
    expect(lastActiveLabel({ current: false, lastSeenAt: ago(2 * 86_400_000) }, now)).toBe("Last active 2 days ago");
    expect(lastActiveLabel({ current: false, lastSeenAt: "nope" }, now)).toBe("");
  });

  test("phones and the app get the phone icon", () => {
    expect(isMobileDevice("GradeBook app on iPhone 15 (iOS 19.0)")).toBe(true);
    expect(isMobileDevice("Chrome on Android")).toBe(true);
    expect(isMobileDevice("Chrome on macOS")).toBe(false);
  });

  test("sign-in methods read as words", () => {
    expect(methodLabel("email-code")).toBe("Email code");
    expect(methodLabel("google")).toBe("Google sign-in");
  });
});
