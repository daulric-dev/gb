import type { NextConfig } from "next";

const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const nextConfig: NextConfig = {
  reactCompiler: true,
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
