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

function hasRefreshToken(request: NextRequest): boolean {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.includes("refresh_token") && cookie.value) {
      return true;
    }
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) {
    if (isGuestOnly(pathname) && hasSessionCookie(request)) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  if (!hasSessionCookie(request) && !hasRefreshToken(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const res = await fetch(`${BACKEND}/api/auth/me`, {
    headers: {
      cookie: request.headers.get("cookie") || "",
      "X-API-Version": "1",
    },
  });

  if (!res.ok) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const response = NextResponse.next();
  for (const cookie of res.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon\\.ico|.*\\..*).*)"],
};
