import { describe, expect, test } from "bun:test";
import { AUDIENCE_BADGES, AUDIENCE_LABELS, audienceOf } from "./announcement-audience";

describe("announcement audience", () => {
  test("missing or unknown values fall back to staff only", () => {
    expect(audienceOf(undefined)).toBe("staff");
    expect(audienceOf("parents")).toBe("staff");
    expect(audienceOf("everyone")).toBe("everyone");
  });

  test("labels name who sees the post", () => {
    expect(AUDIENCE_LABELS.staff).toBe("Staff only");
    expect(AUDIENCE_LABELS.everyone).toContain("students and parents");
    expect(AUDIENCE_BADGES.everyone).toBe("Everyone");
  });
});
