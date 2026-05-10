import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["e2b"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
