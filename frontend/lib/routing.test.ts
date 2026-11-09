import { describe, expect, test } from "bun:test";
import {
  homePathFor,
  loginPath,
  ORGANISATION_PATH,
  safeNextPath,
  SETUP_PATH,
  setupRedirectPath,
} from "@/lib/routing";
import type { UserProfile } from "@/providers/AuthProvider";

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "u1",
    email: "a@example.com",
    first_name: "Ada",
    last_name: "Lovelace",
    role: "teacher",
    account_type: "staff",
    avatar_url: null,
    school_management: null,
    school: { id: "s1", name: "North High" },
    is_org_admin: false,
    organisation: { name: "Northside Trust" },
    ...overrides,
  };
}

describe("safeNextPath", () => {
  test("keeps same-origin paths with query and hash", () => {
    expect(safeNextPath("/portal")).toBe("/portal");
    expect(safeNextPath("/portal/attendance/scan?s=abc&t=x_Y-z")).toBe(
      "/portal/attendance/scan?s=abc&t=x_Y-z",
    );
    expect(safeNextPath("/dashboard#top")).toBe("/dashboard#top");
  });

  test("rejects empty and non-strings", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });

  test("rejects absolute and protocol-relative URLs", () => {
    expect(safeNextPath("https://evil.example/portal")).toBeNull();
    expect(safeNextPath("//evil.example/portal")).toBeNull();
    expect(safeNextPath("javascript:alert(1)")).toBeNull();
    expect(safeNextPath("portal")).toBeNull();
  });

  test("rejects backslash and control-character tricks", () => {
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("/\\/evil.example")).toBeNull();
    expect(safeNextPath("/\t/evil.example")).toBeNull();
    expect(safeNextPath("/\n/evil.example")).toBeNull();
    expect(safeNextPath("/ /evil.example")).toBeNull();
  });

  test("normalises dot segments without leaving the origin", () => {
    expect(safeNextPath("/a/../portal")).toBe("/portal");
    expect(safeNextPath("/..//evil.example")).toBeNull();
  });

  test("never returns to the login pages", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/login/verify?email=a")).toBeNull();
    expect(safeNextPath("/loginx")).toBe("/loginx");
  });

  test("rejects very long values", () => {
    expect(safeNextPath(`/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("loginPath", () => {
  test("plain /login without a useful target", () => {
    expect(loginPath()).toBe("/login");
    expect(loginPath("/")).toBe("/login");
    expect(loginPath("https://evil.example")).toBe("/login");
  });

  test("encodes a safe target", () => {
    const path = loginPath("/portal/attendance/scan?s=1&t=2");
    expect(path).toBe(
      "/login?next=%2Fportal%2Fattendance%2Fscan%3Fs%3D1%26t%3D2",
    );
    const next = new URL(path, "http://x").searchParams.get("next");
    expect(safeNextPath(next)).toBe("/portal/attendance/scan?s=1&t=2");
  });
});

describe("homePathFor", () => {
  test("signed out goes to login", () => {
    expect(homePathFor(null)).toBe("/login");
  });

  test("parents go to the parent portal, school or not", () => {
    expect(homePathFor(profile({ account_type: "parent", school: null, role: null }))).toBe("/parent");
    expect(homePathFor(profile({ account_type: "parent" }))).toBe("/parent");
  });

  test("staff and students with a school go to their app", () => {
    expect(homePathFor(profile())).toBe("/dashboard");
    expect(homePathFor(profile({ account_type: "student" }))).toBe("/portal");
  });

  test("unnamed users onboard; named school-less users pick a school", () => {
    expect(homePathFor(profile({ first_name: null, school: null }))).toBe("/onboard");
    expect(homePathFor(profile({ school: null }))).toBe("/schools");
  });

  test("an organisation admin without a school goes to the console", () => {
    expect(homePathFor(profile({ is_org_admin: true, school: null }))).toBe(
      ORGANISATION_PATH,
    );
    // Even before onboarding: they need not pick staff or student.
    expect(
      homePathFor(
        profile({ is_org_admin: true, school: null, first_name: null, account_type: null }),
      ),
    ).toBe(ORGANISATION_PATH);
  });

  test("an organisation admin who belongs to a school keeps their school home", () => {
    expect(homePathFor(profile({ is_org_admin: true }))).toBe("/dashboard");
  });

  test("a profile without the organisation fields routes as before", () => {
    const legacy = profile({ school: null });
    delete legacy.is_org_admin;
    delete legacy.organisation;
    expect(homePathFor(legacy)).toBe("/schools");
  });
});

describe("setupRedirectPath", () => {
  test("sends a user who may set up to setup from every entry point", () => {
    expect(setupRedirectPath(true, "/dashboard")).toBe(SETUP_PATH);
    expect(setupRedirectPath(true, "/schools")).toBe(SETUP_PATH);
    expect(setupRedirectPath(true, "/onboard")).toBe(SETUP_PATH);
  });

  test("stays put for users who may not set up, or while unknown", () => {
    expect(setupRedirectPath(false, "/dashboard")).toBeNull();
    expect(setupRedirectPath(null, "/dashboard")).toBeNull();
  });

  test("never redirects the setup page to itself", () => {
    expect(setupRedirectPath(true, SETUP_PATH)).toBeNull();
  });
});
