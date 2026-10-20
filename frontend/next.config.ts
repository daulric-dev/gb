import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

function origin(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

// The browser talks to the API (fetch + chat SSE) and, for resumable uploads,
// straight to Supabase Storage (the endpoint comes from the upload ticket).
const connectSrc = [
  "'self'",
  origin(process.env.NEXT_PUBLIC_API_URL),
  origin(process.env.NEXT_PUBLIC_STORAGE_URL) ?? "https://*.supabase.co",
].filter(Boolean);

// Only enforced in production: local dev reaches the API and Storage on
// arbitrary localhost / LAN ports and Next's dev runtime needs eval.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Avatars and logos come from the public Storage bucket; previews use blob:.
  "img-src 'self' blob: data: https:",
  "font-src 'self'",
  `connect-src ${connectSrc.join(" ")}`,
  // The file viewer frames PDFs and text as blob: URLs.
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  ...(isProd ? [{ key: "Content-Security-Policy", value: csp }] : []),
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(isProd
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  async redirects() {
    return [
      {
        source: "/dashboard/academic-years",
        destination: "/dashboard/academic-calendar",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
