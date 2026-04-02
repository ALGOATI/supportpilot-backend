import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Constrain Turbopack's file watching to the dashboard directory only,
    // preventing it from watching the entire parent repo (backend + node_modules).
    // @ts-expect-error turbo config is valid at runtime but not yet in NextConfig types
    turbo: {
      root: ".",
    },
  },
};

export default nextConfig;
