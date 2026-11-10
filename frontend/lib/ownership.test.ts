import { describe, expect, test } from "bun:test";
import type { OrganisationAdmin } from "@/lib/organisation";
import {
  canTransferOrganisation,
  organisationTransferTargets,
  ownerLabel,
  schoolTransferPath,
  schoolTransferredMessage,
} from "@/lib/ownership";

const admin = (userId: string, extra: Partial<OrganisationAdmin> = {}): OrganisationAdmin => ({
  userId,
  email: `${userId}@x.org`,
  name: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  fromEnv: false,
  isOwner: false,
  stored: true,
  ...extra,
});

describe("organisationTransferTargets", () => {
  test("stored admins other than the owner", () => {
    const list = [
      admin("owner", { isOwner: true }),
      admin("a"),
      admin("env-only", { fromEnv: true, stored: false }),
      admin("both", { fromEnv: true, stored: true }),
    ];
    expect(organisationTransferTargets(list, "owner").map((a) => a.userId)).toEqual(["a", "both"]);
  });
});

describe("canTransferOrganisation", () => {
  test("only the owner, or any organisation admin while there is none", () => {
    expect(canTransferOrganisation("me", "me", true)).toBe(true);
    expect(canTransferOrganisation("someone", "me", true)).toBe(false);
    expect(canTransferOrganisation(null, "me", true)).toBe(true);
    expect(canTransferOrganisation(null, "me", false)).toBe(false);
    expect(canTransferOrganisation("me", undefined, true)).toBe(false);
  });
});

describe("labels and paths", () => {
  test("ownerLabel", () => {
    expect(ownerLabel({ name: "Ada", email: "ada@x.org" })).toBe("Ada (ada@x.org)");
    expect(ownerLabel({ name: " ", email: "ada@x.org" })).toBe("ada@x.org");
  });

  test("schoolTransferPath encodes the id", () => {
    expect(schoolTransferPath("a/b")).toBe("/schools/a%2Fb/transfer-ownership");
  });

  test("schoolTransferredMessage", () => {
    expect(schoolTransferredMessage("Hill", { name: "Tara", email: "t@x.org" })).toBe(
      "Tara now owns Hill and is its administrator. The previous administrator stays on as a teacher.",
    );
  });
});
