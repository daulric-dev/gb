import { describe, expect, test } from "bun:test";
import { effectivePushText, fromChoice, pushContentPath, toChoice, unsetLabel } from "./push-content";

describe("push content", () => {
  test("paths and choices", () => {
    expect(pushContentPath("school")).toBe("/notifications/push-content");
    expect(pushContentPath("organisation")).toBe("/notifications/organisation/push-content");
    expect(toChoice(null)).toBe("unset");
    expect(toChoice("generic")).toBe("generic");
    expect(fromChoice("unset")).toBeNull();
    expect(fromChoice("full")).toBe("full");
  });

  test("what applies: own value, the organisation's, or the default", () => {
    expect(effectivePushText({ value: "generic" }, "school")).toContain("Generic");
    expect(effectivePushText({ value: null, organisation: "full" }, "school")).toContain("Follows the organisation");
    expect(effectivePushText({ value: null, organisation: null }, "school")).toContain("Default");
    expect(effectivePushText({ value: null }, "organisation")).toContain("children");
    expect(unsetLabel({ value: null, organisation: "generic" }, "school")).toContain("generic");
  });
});
