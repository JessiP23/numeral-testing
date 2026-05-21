import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the IDE browser-preview proxy + LAN to hit the dev server.
  allowedDevOrigins: ["127.0.0.1", "192.168.1.222"],
};

export default nextConfig;
