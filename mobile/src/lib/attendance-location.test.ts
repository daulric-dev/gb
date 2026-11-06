import { describe, expect, test } from "bun:test";
import {
  describeLocationFlags,
  distanceMeters,
  formatAgo,
  LIVE_LOCATION_INTERVAL_MS,
  LIVE_LOCATION_MIN_GAP_MS,
  shouldSendLocation,
} from "./attendance-location";

const here = { latitude: 51.5, longitude: -0.12 };
/** ~0.0001 deg latitude is ~11 m; 0.0003 is ~33 m. */
const near = { latitude: 51.5001, longitude: -0.12, accuracy: 10 };
const moved = { latitude: 51.5003, longitude: -0.12, accuracy: 10 };
const T = 1_800_000_000_000;

describe("shouldSendLocation", () => {
  test("the first usable fix is sent", () => {
    expect(shouldSendLocation(null, near, T)).toBe(true);
  });

  test("a fix worse than 100 m is never sent", () => {
    expect(shouldSendLocation(null, { ...near, accuracy: 150 }, T)).toBe(false);
    expect(shouldSendLocation(null, { ...near, accuracy: 100 }, T)).toBe(true);
  });

  test("standing still: once every 30 s", () => {
    const last = { ...here, at: T };
    expect(shouldSendLocation(last, near, T + 10_000)).toBe(false);
    expect(shouldSendLocation(last, near, T + LIVE_LOCATION_INTERVAL_MS)).toBe(true);
  });

  test("moving more than 20 m sends early, but not inside the throttle gap", () => {
    const last = { ...here, at: T };
    expect(shouldSendLocation(last, moved, T + LIVE_LOCATION_MIN_GAP_MS - 1)).toBe(false);
    expect(shouldSendLocation(last, moved, T + LIVE_LOCATION_MIN_GAP_MS)).toBe(true);
    expect(shouldSendLocation(last, near, T + LIVE_LOCATION_MIN_GAP_MS)).toBe(false);
  });
});

describe("distanceMeters", () => {
  test("about 33 m for 0.0003 deg of latitude", () => {
    const d = distanceMeters(here, moved);
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(36);
  });
});

describe("formatAgo", () => {
  test("seconds, minutes, hours", () => {
    const iso = new Date(T).toISOString();
    expect(formatAgo(iso, T + 2_000)).toBe("just now");
    expect(formatAgo(iso, T + 12_000)).toBe("12s ago");
    expect(formatAgo(iso, T + 180_000)).toBe("3m ago");
    expect(formatAgo(iso, T + 2 * 3_600_000)).toBe("2h ago");
    expect(formatAgo(null, T)).toBe("never");
  });
});

describe("describeLocationFlags", () => {
  test("readable reasons plus the distance; unknown flags dropped", () => {
    expect(describeLocationFlags(["zero_accuracy", "mystery"], 42.4)).toEqual([
      "Phone reported no GPS accuracy",
      "42 m from the check-in point",
    ]);
    expect(describeLocationFlags([], null)).toEqual([]);
  });
});
