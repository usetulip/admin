import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/auth/:path*",
        destination: `${apiUrl}/api/admin-auth/:path*`,
      },
      {
        source: "/api/admin/projects/:path*",
        destination: `${apiUrl}/api/admin/projects/:path*`,
      },
      {
        source: "/api/admin/projects",
        destination: `${apiUrl}/api/admin/projects`,
      },
    ];
  },
};

export default nextConfig;
