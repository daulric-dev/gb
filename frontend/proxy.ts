import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/login/verify", "/privacy", "/terms"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLoggedIn = request.cookies.get("gb_logged_in")?.value === "1";

  if (pathname.startsWith("/dashboard") && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/onboard") && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (PUBLIC_PATHS.includes(pathname) && isLoggedIn) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboard/:path*", "/login", "/login/verify"],
};