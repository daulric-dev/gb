import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { loginPath, NEXT_PARAM, safeNextPath } from "@/lib/routing";

const GUEST_ONLY = ["/login", "/login/verify"];
// /scan is where the attendance QR lands; it works signed out (see app/scan).
const PUBLIC_PATHS = ["/", "/privacy", "/terms", "/scan", ...GUEST_ONLY];
/**
 * Our session cookie, set by the API on /auth/otp/verify and the SSO
 * callback/handoff. It is HttpOnly and opaque (a random token only the API can
 * validate), so the proxy treats its presence as "signed in" and nothing more.
 * A stale or revoked cookie gets through here, the first API call answers 401,
 * and `lib/api.ts`'s unauthorized handler sends the visitor to /login.
 *
 * The proxy only sees the cookie if it is sent to the frontend's host: in
 * production the API sets it with `Domain=AUTH_COOKIE_DOMAIN`, a parent domain
 * shared by the app and the API (e.g. `.example.com` for app.example.com and
 * api.example.com). In development both run on localhost, where cookies ignore
 * the port.
 */
export const SESSION_COOKIE = "gb_session";

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

function hasSession(request: NextRequest): boolean {
  return !!request.cookies.get(SESSION_COOKIE)?.value;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // A signed-in visitor on /login goes back where a sign-in prompt sent them
  // (same-origin paths only), otherwise to the app.
  const toDashboard = () => {
    const next = isGuestOnly(pathname)
      ? safeNextPath(request.nextUrl.searchParams.get(NEXT_PARAM))
      : null;
    return NextResponse.redirect(new URL(next ?? "/dashboard", request.url));
  };
  // Remember the page being asked for, so signing in lands back on it (a
  // scanned attendance QR, a shared link).
  const toLogin = () =>
    NextResponse.redirect(
      new URL(loginPath(`${pathname}${request.nextUrl.search}`), request.url),
    );

  if (!hasSession(request)) {
    return isPublic(pathname) ? NextResponse.next() : toLogin();
  }
  return isGuestOnly(pathname) ? toDashboard() : NextResponse.next();
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|_next/data|favicon\\.ico|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
        { type: "header", key: "rsc" },
      ],
    },
  ],
};
