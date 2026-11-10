import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  ACCOUNT_DELETION_BLOCKED,
  blockerLink,
  blockersFromError,
  isSchoolManaged,
  type DeletionBlocker,
} from "@/lib/account-deletion";

const SCHOOL = "6f1c2c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const orgOwner: DeletionBlocker = {
  code: "ORG_OWNER",
  message: "Transfer ownership of the organisation before deleting your account",
  action: { type: "transfer_organisation_ownership" },
};
const schoolOwner: DeletionBlocker = {
  code: "SCHOOL_OWNER",
  message: "Transfer ownership of Hill before deleting your account",
  action: { type: "transfer_school_ownership", schoolId: SCHOOL, schoolName: "Hill" },
};
const ssoStudent: DeletionBlocker = {
  code: "SSO_STUDENT",
  message: "Your account is managed by your school through Google. Ask your school to remove it.",
  action: { type: "contact_school" },
};

describe("blockerLink", () => {
  const staff = { isOrgAdmin: false, activeSchoolId: null };

  test("the organisation owner goes to the organisation's transfer form", () => {
    expect(blockerLink(orgOwner, staff)).toEqual({
      href: "/organisation/settings#ownership",
      label: "Transfer organisation",
    });
  });

  test("the last organisation admin is sent to add another", () => {
    expect(
      blockerLink({ code: "LAST_ORG_ADMIN", message: "x", action: { type: "add_organisation_admin" } }, staff)
        ?.href,
    ).toBe("/organisation/admins");
  });

  test("a school owner: the console for organisation admins, else the school's settings", () => {
    expect(blockerLink(schoolOwner, { isOrgAdmin: true, activeSchoolId: null })?.href).toBe(
      `/organisation/schools/${SCHOOL}#ownership`,
    );
    expect(blockerLink(schoolOwner, { isOrgAdmin: false, activeSchoolId: SCHOOL })?.href).toBe(
      "/dashboard/settings#ownership",
    );
    expect(blockerLink(schoolOwner, { isOrgAdmin: false, activeSchoolId: "other" })).toEqual({
      href: "/schools",
      label: "Switch to Hill",
    });
  });

  test("nothing to link for a school-managed account or a blocker without an action", () => {
    expect(blockerLink(ssoStudent, staff)).toBeNull();
    expect(blockerLink({ code: "X", message: "m" }, staff)).toBeNull();
  });
});

describe("isSchoolManaged", () => {
  test("only the SSO student blocker hides deletion", () => {
    expect(isSchoolManaged([ssoStudent])).toBe(true);
    expect(isSchoolManaged([orgOwner, schoolOwner])).toBe(false);
    expect(isSchoolManaged([])).toBe(false);
  });
});

describe("blockersFromError", () => {
  test("reads the 409 ACCOUNT_DELETION_BLOCKED body", () => {
    const err = new ApiError(409, orgOwner.message, {
      statusCode: 409,
      code: ACCOUNT_DELETION_BLOCKED,
      message: orgOwner.message,
      blockers: [orgOwner, { junk: true }],
    });
    expect(blockersFromError(err)).toEqual([orgOwner]);
  });

  test("anything else is not a deletion refusal", () => {
    expect(blockersFromError(new ApiError(409, "x", { code: "OTHER", blockers: [] }))).toBeNull();
    expect(blockersFromError(new ApiError(400, "x", { code: ACCOUNT_DELETION_BLOCKED }))).toBeNull();
    expect(blockersFromError(new Error("x"))).toBeNull();
  });
});
