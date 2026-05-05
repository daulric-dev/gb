import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const GUEST_ONLY = ["/login", "/login/verify"];
const PUBLIC_PATHS = ["/", "/privacy", "/terms", ...GUEST_ONLY];
const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Refresh ~1 minute before the access token actually expires so we never
// serve a request with an already-expired token.
const REFRESH_BUFFER_MS = 60_000;

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

type SessionState =
  | { kind: "missing" }
  | { kind: "fresh" }
  | { kind: "stale" }
  | { kind: "invalid" };

function readSessionState(request: NextRequest): SessionState {
  const chunks: { idx: number; value: string }[] = [];
  let baseValue: string | null = null;

  for (const cookie of request.cookies.getAll()) {
    if (!cookie.name.startsWith("sb-") || !cookie.name.includes("auth-token")) {
      continue;
    }
    const dot = cookie.name.lastIndexOf(".");
    if (dot > -1 && /^\d+$/.test(cookie.name.slice(dot + 1))) {
      chunks.push({ idx: Number(cookie.name.slice(dot + 1)), value: cookie.value });
    } else {
      baseValue = cookie.value;
    }
  }

  let raw = baseValue;
  if (!raw && chunks.length > 0) {
    raw = chunks
      .sort((a, b) => a.idx - b.idx)
      .map((c) => c.value)
      .join("");
  }
  if (!raw) return { kind: "missing" };

  try {
    let payload = raw;
    if (payload.startsWith("base64-")) {
      const b64 = payload.slice("base64-".length);
      const padded = b64
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(b64.length + ((4 - (b64.length % 4)) % 4), "=");
      payload = atob(padded);
    }
    const session = JSON.parse(payload);
    const expiresAt = Number(session?.expires_at);
    if (!expiresAt || !session?.refresh_token) return { kind: "invalid" };

    const expiresAtMs = expiresAt * 1000;
    if (expiresAtMs - Date.now() > REFRESH_BUFFER_MS) {
      return { kind: "fresh" };
    }
    return { kind: "stale" };
  } catch {
    return { kind: "invalid" };
  }
}

function applySetCookies(response: NextResponse, from: Response) {
  for (const cookie of from.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }
}

async function validateOnBackend(request: NextRequest): Promise<Response> {
  return fetch(`${BACKEND}/api/auth/me`, {
    headers: {
      cookie: request.headers.get("cookie") || "",
      "X-API-Version": "1",
    },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const publicPath = isPublic(pathname);
  const guestOnly = isGuestOnly(pathname);
  const state = readSessionState(request);

  // Fast path: no cookie at all.
  if (state.kind === "missing") {
    if (publicPath) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Fast path: token still has plenty of life left. Trust the cookie locally,
  // skip the /auth/me round-trip. The backend will validate on the actual
  // request the user is making.
  if (state.kind === "fresh") {
    if (guestOnly) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // Slow path: token is near expiry or the cookie is malformed. Hit the
  // backend to trigger a refresh (or definitively reject the session).
  const res = await validateOnBackend(request);
  const isLoggedIn = res.ok;

  if (isLoggedIn) {
    const target = guestOnly
      ? NextResponse.redirect(new URL("/dashboard", request.url))
      : NextResponse.next();
    applySetCookies(target, res);
    return target;
  }

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
  matcher: [
    // Skip RSC payload requests (Next.js refetches), API, static assets, and
    // anything with a file extension. The middleware only runs for actual
    // page navigations.
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
