const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

async function proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = `${BACKEND}${url.pathname}${url.search}`;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key !== "host") {
      headers[key] = value;
    }
  });

  const res = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer(),
    redirect: "manual",
  });

  const responseHeaders = new Headers();
  res.headers.forEach((value, key) => {
    if (key === "transfer-encoding" || key === "set-cookie") return;
    responseHeaders.append(key, value);
  });

  // Forward Set-Cookie headers individually
  if (typeof res.headers.getSetCookie === "function") {
    for (const cookie of res.headers.getSetCookie()) {
      responseHeaders.append("set-cookie", cookie);
    }
  } else {
    // Fallback: raw header access
    const raw = res.headers.get("set-cookie");
    if (raw) {
      responseHeaders.append("set-cookie", raw);
    }
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
