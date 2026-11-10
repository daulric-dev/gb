import { describe, expect, test } from "bun:test";
import {
  changeFilters,
  countAction,
  diffValue,
  fieldLabel,
  progressPercent,
  runApi,
  runIsBusy,
  sourceApi,
  unmappedOrgs,
} from "./rostering";
import { FALLBACK_FEATURES, FEATURE_KEYS } from "./features";

describe("rostering helpers", () => {
  test("routes", () => {
    expect(sourceApi("s1")).toBe("/organisation/rostering/sources/s1");
    expect(runApi("s1", "r1")).toBe("/organisation/rostering/sources/s1/runs/r1");
  });

  test("diff values and labels", () => {
    expect(diffValue(null)).toBe("—");
    expect(diffValue("")).toBe("—");
    expect(diffValue(true)).toBe("Yes");
    expect(diffValue(false)).toBe("No");
    expect(diffValue("Rivera")).toBe("Rivera");
    expect(fieldLabel("studentNumber")).toBe("Student number");
    expect(fieldLabel("unknownField")).toBe("unknownField");
  });

  test("busy statuses are polled", () => {
    expect(runIsBusy("planning")).toBe(true);
    expect(runIsBusy("applying")).toBe(true);
    expect(runIsBusy("planned")).toBe(false);
    expect(runIsBusy("applied")).toBe(false);
  });

  test("counts and progress", () => {
    const summary = { counts: { student: { create: 2, disable: 1 }, course: { create: 1, update: 3 } } };
    expect(countAction(summary, "create")).toBe(3);
    expect(countAction(summary, "disable")).toBe(1);
    expect(countAction({}, "error")).toBe(0);
    expect(progressPercent({ progress: { done: 1, failed: 1, total: 4 } })).toBe(50);
    expect(progressPercent({ progress: { done: 0, failed: 0, total: 0 } })).toBe(0);
  });

  test("orgs not yet mapped (ignored ones count as mapped)", () => {
    const orgs = [
      { sourcedId: "a", name: "A", type: null },
      { sourcedId: "b", name: "B", type: null },
      { sourcedId: "c", name: "C", type: null },
    ];
    expect(unmappedOrgs(orgs, { a: "school-1", b: null }).map((o) => o.sourcedId)).toEqual(["c"]);
    expect(unmappedOrgs(undefined, {})).toEqual([]);
  });

  test("the QUERY body carries only the filters that are set", () => {
    expect(changeFilters({})).toEqual({});
    expect(changeFilters({ entity: "student", search: "  ", offset: 0, limit: 100 })).toEqual({ entity: "student", limit: 100 });
    expect(changeFilters({ action: "disable", search: " Riv " })).toEqual({ action: "disable", search: "Riv" });
  });

  test("rostering is a known feature, off on older servers", () => {
    expect(FEATURE_KEYS).toContain("rostering");
    expect(FALLBACK_FEATURES.rostering).toBe(false);
  });
});
