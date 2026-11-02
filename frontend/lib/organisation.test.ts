import { describe, expect, test } from "bun:test";
import {
  CURRENT_SCHOOL_API,
  organisationSchoolApi,
  organisationSchoolPath,
  schoolsFilters,
  appointedMessage,
  invitesFilters,
  inviteExpired,
  inviteExpiryLabel,
} from "@/lib/organisation";

describe("school settings API bases", () => {
  test("the default is the active school's routes", () => {
    expect(CURRENT_SCHOOL_API).toBe("/schools/current");
    expect(`${CURRENT_SCHOOL_API}/upload-limit`).toBe("/schools/current/upload-limit");
  });

  test("one school's routes as an organisation admin", () => {
    const id = "6f1c2c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
    expect(organisationSchoolApi(id)).toBe(`/organisation/schools/${id}`);
    expect(`${organisationSchoolApi(id)}/features`).toBe(
      `/organisation/schools/${id}/features`,
    );
  });

  test("ids are encoded, so a bad one cannot escape the path", () => {
    expect(organisationSchoolApi("a/b?c")).toBe("/organisation/schools/a%2Fb%3Fc");
  });
});

describe("organisationSchoolPath", () => {
  test("the console page for one school", () => {
    expect(organisationSchoolPath("s-1")).toBe("/organisation/schools/s-1");
    expect(organisationSchoolPath("a/b")).toBe("/organisation/schools/a%2Fb");
  });
});

describe("schoolsFilters", () => {
  test("leaves out empty parts", () => {
    expect(schoolsFilters("  ", "all")).toEqual({});
    expect(schoolsFilters(" north ", "inactive")).toEqual({
      search: "north",
      status: "inactive",
    });
  });
});

describe("invites", () => {
  const now = Date.parse("2026-11-01T10:00:00Z");

  test("the list filters, optionally of one kind", () => {
    expect(invitesFilters()).toEqual({});
    expect(invitesFilters("organisation_admin")).toEqual({ kind: "organisation_admin" });
  });

  test("expired once expiresAt has passed", () => {
    expect(inviteExpired({ expiresAt: "2026-11-15T10:00:00Z" }, now)).toBe(false);
    expect(inviteExpired({ expiresAt: "2026-11-01T10:00:00Z" }, now)).toBe(true);
    expect(inviteExpiryLabel({ expiresAt: "2026-11-15T10:00:00Z" }, now)).toStartWith("expires ");
    expect(inviteExpiryLabel({ expiresAt: "2026-10-31T10:00:00Z" }, now)).toStartWith("expired ");
  });

  test("invited vs appointed toast copy", () => {
    expect(
      appointedMessage(
        { invited: { id: "i", email: "x@y.org", expiresAt: "2026-11-15T10:00:00Z" } },
        "X@y.org",
        "admin",
      ),
    ).toBe("Invited x@y.org — they'll become admin when they first sign in");
    expect(appointedMessage({ invited: null }, "x@y.org", "admin")).toBe(
      "Appointed x@y.org as admin",
    );
    expect(appointedMessage(null, "x@y.org", "admin")).toBe("Appointed x@y.org as admin");
  });
});
