import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Keep QA builds isolated from a user's running development server.
  distDir: process.env.NEXT_BUILD_DIR || '.next',
};
export default nextConfig;
