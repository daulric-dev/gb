import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

function origin(url: string | undefined): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

// Object storage (S3-compatible): uploads PUT straight to it with presigned
// URLs from the API, so its origin must be allowed for fetch/XHR.
const storageOrigin = origin(process.env.NEXT_PUBLIC_STORAGE_URL);

if (isProd && !storageOrigin) {
  console.warn(
    "NEXT_PUBLIC_STORAGE_URL is not set: the CSP will block direct uploads to object storage.",
  );
}

// The browser talks to the API (fetch + chat SSE) and the storage endpoint.
const connectSrc = [
  "'self'",
  origin(process.env.NEXT_PUBLIC_API_URL),
  storageOrigin,
].filter(Boolean);

const imgSrc = ["'self'", "blob:", "data:", "https:", storageOrigin].filter(
  Boolean,
);

// Only enforced in production: local dev reaches the API and Storage on
// arbitrary localhost / LAN ports and Next's dev runtime needs eval.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Avatars and logos may be served from object storage; previews use blob:.
  `img-src ${imgSrc.join(" ")}`,
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
  // geolocation=(self): attendance can ask for a location check, and only
  // this origin may request it - never an embedded third-party frame.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
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
      // Classes and subjects were replaced by courses.
      {
        source: "/dashboard/classes/:path*",
        destination: "/dashboard/courses",
        permanent: false,
      },
      {
        source: "/dashboard/subjects/:path*",
        destination: "/dashboard/courses",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
