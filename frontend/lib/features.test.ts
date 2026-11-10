import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  applyFeatureToggle,
  changedFeatures,
  FALLBACK_FEATURES,
  featureForPath,
  groupFeatures,
  hasFeature,
  isFeatureDisabledError,
  missingRequirements,
  resolveFeatures,
} from "@/lib/features";

describe("resolveFeatures", () => {
  test("missing object falls back to all on except student messaging and channels", () => {
    const f = resolveFeatures(undefined);
    expect(f).toEqual(FALLBACK_FEATURES);
    expect(f.messaging).toBe(true);
    expect(f.student_messaging).toBe(false);
    expect(f.chat_channels).toBe(false);
    expect(resolveFeatures(null)).toEqual(FALLBACK_FEATURES);
  });

  test("uses the server's values and fills missing keys", () => {
    const f = resolveFeatures({ files: false, student_messaging: true });
    expect(f.files).toBe(false);
    expect(f.student_messaging).toBe(true);
    expect(f.announcements).toBe(true);
  });

  test("ignores non-boolean values", () => {
    const f = resolveFeatures({ files: "no" as unknown as boolean });
    expect(f.files).toBe(true);
  });

  test("a dependent feature is off when its requirement is", () => {
    const f = resolveFeatures({
      messaging: false,
      student_messaging: true,
      chat_channels: true,
    });
    expect(f.student_messaging).toBe(false);
    expect(f.chat_channels).toBe(false);
  });

  test("hasFeature reads one key", () => {
    expect(hasFeature({ calendar: false }, "calendar")).toBe(false);
    expect(hasFeature(undefined, "calendar")).toBe(true);
  });
});

describe("featureForPath", () => {
  test.each([
    ["/dashboard/chat", "messaging"],
    ["/dashboard/announcements", "announcements"],
    ["/dashboard/files/abc", "files"],
    ["/dashboard/calendar", "calendar"],
    ["/portal/messages", "student_messaging"],
    ["/portal/announcements", "announcements"],
    ["/portal/calendar/", "calendar"],
    ["/portal/attendance/scan", "attendance"],
    ["/scan", "attendance"],
    ["/dashboard/courses/c1/attendance", "attendance"],
    ["/dashboard/courses/c1/discussions/t1", "discussions"],
    ["/portal/courses/c1/announcements", "announcements"],
    ["/dashboard/timetable", "timetable"],
    ["/dashboard/settings/timetable", "timetable"],
    ["/dashboard/courses/c1/timetable", "timetable"],
    ["/portal/timetable", "timetable"],
    ["/dashboard/attendance/students/s1", "attendance_alerts"],
  ])("%s → %s", (path, key) => {
    expect(featureForPath(path)).toBe(key as never);
  });

  test.each([
    "/dashboard",
    "/dashboard/academic-calendar",
    "/dashboard/courses/c1",
    "/dashboard/courses/c1/modules",
    "/portal/courses",
    "/dashboard/chatter",
  ])("%s is always available", (path) => {
    expect(featureForPath(path)).toBeNull();
  });
});

describe("isFeatureDisabledError", () => {
  test("recognises the API's FEATURE_DISABLED body", () => {
    const err = new ApiError(403, "Messaging is turned off", {
      code: "FEATURE_DISABLED",
      feature: "messaging",
      message: "Messaging is turned off",
    });
    expect(isFeatureDisabledError(err)).toBe(true);
    expect(err.code).toBe("FEATURE_DISABLED");
    expect(err.feature).toBe("messaging");
  });

  test("other errors are not", () => {
    expect(isFeatureDisabledError(new ApiError(403, "Forbidden"))).toBe(false);
    expect(isFeatureDisabledError(new Error("x"))).toBe(false);
    expect(new ApiError(403, "x").feature).toBeUndefined();
  });
});

describe("feature toggles", () => {
  const list = [
    { key: "messaging", requires: [] },
    { key: "student_messaging", requires: ["messaging"] },
    { key: "chat_channels", requires: ["messaging"] },
    { key: "files", requires: [] },
  ];

  test("switching a requirement off switches its dependents off", () => {
    const draft = { messaging: true, student_messaging: true, chat_channels: true, files: true };
    const next = applyFeatureToggle(draft, list, "messaging", false);
    expect(next).toEqual({
      messaging: false,
      student_messaging: false,
      chat_channels: false,
      files: true,
    });
    expect(draft.messaging).toBe(true);
  });

  test("switching on touches only that key", () => {
    const next = applyFeatureToggle({ messaging: false, student_messaging: false }, list, "messaging", true);
    expect(next).toEqual({ messaging: true, student_messaging: false });
  });

  test("missingRequirements lists requirements that are off", () => {
    expect(missingRequirements({ requires: ["messaging"] }, { messaging: false })).toEqual(["messaging"]);
    expect(missingRequirements({ requires: ["messaging"] }, { messaging: true })).toEqual([]);
  });

  test("changedFeatures keeps only differences", () => {
    expect(changedFeatures({ a: true, b: false }, { a: true, b: true })).toEqual({ b: true });
  });
});

describe("groupFeatures", () => {
  test("groups known keys in order and puts unknown keys last", () => {
    const groups = groupFeatures([
      { key: "files" },
      { key: "messaging" },
      { key: "brand_new" },
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Communication", "Content", "Other"]);
    expect(groups[2].items).toEqual([{ key: "brand_new" }]);
  });
});
