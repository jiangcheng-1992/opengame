import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["e2b"],
  images: {
    domains: ["opengame-production.up.railway.app", "localhost", "127.0.0.1"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "opengame-production.up.railway.app",
      },
      {
        protocol: "http",
        hostname: "localhost",
        port: "3000",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
        port: "3000",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
