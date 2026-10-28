import type { NextConfig } from "next";
import { storageOrigin } from "./lib/csp";

const isProd = process.env.NODE_ENV === "production";

if (isProd && !storageOrigin) {
  console.warn(
    "NEXT_PUBLIC_STORAGE_URL is not set: the CSP will block direct uploads to object storage.",
  );
}

// The Content-Security-Policy is not set here: it carries a per-request nonce,
// so proxy.ts builds it (lib/csp.ts).
const securityHeaders = [
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
