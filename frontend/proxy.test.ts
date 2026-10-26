import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { proxy, SESSION_COOKIE } from "./proxy";

const ORIGIN = "http://app.test";

function run(path: string, cookie?: string) {
  const request = new NextRequest(new URL(path, ORIGIN));
  // Set through the cookie jar: the test DOM's Headers drops a "cookie" header.
  if (cookie) {
    const eq = cookie.indexOf("=");
    request.cookies.set(cookie.slice(0, eq), cookie.slice(eq + 1));
  }
  return proxy(request);
}

/** Where the response redirects to (path + query), or null when it passes. */
function redirectedTo(res: Response): string | null {
  const location = res.headers.get("location");
  if (!location) return null;
  const url = new URL(location);
  return `${url.pathname}${url.search}`;
}

const SIGNED_IN = `${SESSION_COOKIE}=opaque-token`;

describe("proxy - signed out", () => {
  test("public and guest-only pages pass", () => {
    for (const path of ["/", "/privacy", "/terms", "/scan", "/scan/x", "/login", "/login/verify"]) {
      expect(redirectedTo(run(path))).toBeNull();
    }
  });

  test("protected pages go to /login, remembering where they were", () => {
    expect(redirectedTo(run("/dashboard"))).toBe("/login?next=%2Fdashboard");
    expect(redirectedTo(run("/portal/attendance/scan?s=1&t=2"))).toBe(
      `/login?next=${encodeURIComponent("/portal/attendance/scan?s=1&t=2")}`,
    );
  });

  test("old sb-* cookies no longer count as a session", () => {
    expect(redirectedTo(run("/dashboard", "sb-abc-auth-token=base64-eyJ9"))).toBe(
      "/login?next=%2Fdashboard",
    );
  });

  test("an empty session cookie counts as signed out", () => {
    expect(redirectedTo(run("/dashboard", `${SESSION_COOKIE}=`))).toBe(
      "/login?next=%2Fdashboard",
    );
  });
});

describe("proxy - signed in", () => {
  test("protected and public pages pass", () => {
    for (const path of ["/dashboard", "/portal", "/", "/scan"]) {
      expect(redirectedTo(run(path, SIGNED_IN))).toBeNull();
    }
  });

  test("guest-only pages go to the app", () => {
    expect(redirectedTo(run("/login", SIGNED_IN))).toBe("/dashboard");
    expect(redirectedTo(run("/login/verify", SIGNED_IN))).toBe("/dashboard");
  });

  test("guest-only pages honour a safe ?next=", () => {
    expect(redirectedTo(run("/login?next=%2Fportal%2Fgrades", SIGNED_IN))).toBe(
      "/portal/grades",
    );
  });

  test("an unsafe ?next= falls back to the app", () => {
    for (const next of ["//evil.test", "https://evil.test", "/\\evil.test", "/login"]) {
      const path = `/login?next=${encodeURIComponent(next)}`;
      expect(redirectedTo(run(path, SIGNED_IN))).toBe("/dashboard");
    }
  });
});

describe("proxy - CSP", () => {
  test("production responses carry a fresh nonce CSP without unsafe-inline scripts", () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const a = run("/").headers.get("content-security-policy") ?? "";
      const b = run("/").headers.get("content-security-policy") ?? "";
      const script = a.split("; ").find((d) => d.startsWith("script-src")) ?? "";
      expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
      expect(script).not.toContain("unsafe-inline");
      expect(a).not.toBe(b);
    } finally {
      env.NODE_ENV = prev;
    }
  });

  test("img-src allows only this site and the origins we host images on", () => {
    const env = process.env as Record<string, string | undefined>;
    const keys = ["NODE_ENV", "NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_IMAGES_URL"];
    const prev = keys.map((k) => env[k]);
    env.NODE_ENV = "production";
    env.NEXT_PUBLIC_API_URL = "https://api.example.com";
    env.NEXT_PUBLIC_IMAGES_URL = "https://cdn.example.com/images";
    try {
      const csp = run("/").headers.get("content-security-policy") ?? "";
      const img = csp.split("; ").find((d) => d.startsWith("img-src")) ?? "";
      expect(img.split(" ")).not.toContain("https:");
      expect(img).toContain("'self' blob: data:");
      expect(img).toContain("https://api.example.com");
      expect(img).toContain("https://cdn.example.com");
    } finally {
      keys.forEach((k, i) => (env[k] = prev[i]));
    }
  });
});
