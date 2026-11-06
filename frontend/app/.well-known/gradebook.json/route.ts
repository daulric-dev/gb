import { NextResponse } from "next/server";

export const dynamic = "force-static";

function publicApiUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) return null;

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("NEXT_PUBLIC_API_URL must be an absolute URL.");
  }

  const localHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      (process.env.NODE_ENV !== "production" &&
        url.hostname.endsWith(".local")));

  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("NEXT_PUBLIC_API_URL must use HTTPS.");
  }

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname.replace(/\/+$/, "") !== "/api")
  ) {
    throw new Error(
      "NEXT_PUBLIC_API_URL must be a public origin with an optional /api path.",
    );
  }

  return url.origin;
}

export function GET() {
  const apiUrl = publicApiUrl();
  if (!apiUrl) {
    return NextResponse.json(
      { error: "instance_not_configured" },
      {
        status: 503,
        headers: { "Cache-Control": "public, max-age=60" },
      },
    );
  }

  return NextResponse.json(
    { apiUrl },
    {
      headers: { "Cache-Control": "public, max-age=300" },
    },
  );
}
