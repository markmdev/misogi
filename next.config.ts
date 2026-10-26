import type { NextConfig } from "next";

// No cacheComponents: with OpenNext 1.20 every request hangs in the Workers runtime.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
