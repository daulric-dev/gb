import { describe, expect, test } from "bun:test";
import { AUDIENCE_OPTIONS, audienceOf } from "./announcement-audience";

describe("announcement audience", () => {
  test("missing or unknown values fall back to staff only", () => {
    expect(audienceOf(undefined)).toBe("staff");
    expect(audienceOf("parents")).toBe("staff");
    expect(audienceOf("everyone")).toBe("everyone");
  });

  test("staff only is the first (default) option", () => {
    expect(AUDIENCE_OPTIONS.map((o) => o.value)).toEqual(["staff", "everyone"]);
  });
});
