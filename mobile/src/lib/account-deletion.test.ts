import { describe, expect, test } from "bun:test";
import {
  ACCOUNT_DELETION_BLOCKED,
  blockerHint,
  blockersFromError,
  isSchoolManaged,
} from "@/lib/account-deletion";

describe("account deletion helpers", () => {
  test("reads the 409 body", () => {
    const b = { code: "ORG_OWNER", message: "m", action: { type: "transfer_organisation_ownership" } };
    const err = { status: 409, message: "m", data: { code: ACCOUNT_DELETION_BLOCKED, blockers: [b, 3] } };
    expect(blockersFromError(err)).toEqual([b]);
    expect(blockersFromError({ status: 409, data: { code: "X" } })).toBeNull();
    expect(blockersFromError(new Error("x"))).toBeNull();
  });

  test("SSO students are school-managed; owners get a web hint", () => {
    expect(isSchoolManaged([{ code: "SSO_STUDENT", message: "m" }])).toBe(true);
    expect(isSchoolManaged([{ code: "SCHOOL_OWNER", message: "m" }])).toBe(false);
    expect(
      blockerHint({ code: "SCHOOL_OWNER", message: "m", action: { type: "transfer_school_ownership" } }),
    ).toContain("School ownership");
    expect(blockerHint({ code: "SSO_STUDENT", message: "m", action: { type: "contact_school" } })).toBeNull();
  });
});
