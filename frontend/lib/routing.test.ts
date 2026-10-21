import { describe, expect, test } from "bun:test";
import { loginPath, safeNextPath } from "@/lib/routing";

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
