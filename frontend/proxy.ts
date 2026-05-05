import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const GUEST_ONLY = ["/login", "/login/verify"];
const PUBLIC_PATHS = ["/", "/privacy", "/terms", ...GUEST_ONLY];
const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

function isGuestOnly(pathname: string): boolean {
  return GUEST_ONLY.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

function hasSessionCookie(request: NextRequest): boolean {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-") && cookie.name.includes("auth-token")) {
      return true;
    }
  }
  return false;
}

function applySetCookies(response: NextResponse, from: Response) {
  for (const cookie of from.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const publicPath = isPublic(pathname);

  // No cookie → can short-circuit without hitting the backend.
  if (!hasSessionCookie(request)) {
    if (publicPath) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Cookie present → validate against the backend. /auth/me triggers any
  // necessary refresh inside the SSR client and writes rotated cookies via
  // Set-Cookie.
  const res = await fetch(`${BACKEND}/api/auth/me`, {
    headers: {
      cookie: request.headers.get("cookie") || "",
      "X-API-Version": "1",
    },
  });

  const isLoggedIn = res.ok;

  if (isLoggedIn) {
    if (isGuestOnly(pathname)) {
      const redirect = NextResponse.redirect(new URL("/dashboard", request.url));
      applySetCookies(redirect, res);
      return redirect;
    }
    const next = NextResponse.next();
    applySetCookies(next, res);
    return next;
  }

  // Not logged in (cookie was stale/invalid). Forward any cookie-clearing
  // headers so the browser drops them, then route based on path type.
  if (publicPath) {
    const next = NextResponse.next();
    applySetCookies(next, res);
    return next;
  }

  const redirect = NextResponse.redirect(new URL("/login", request.url));
  applySetCookies(redirect, res);
  return redirect;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|.*\\..*).*)"],
};
