import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // App pages may only frame our own spaces, so a generated page can't navigate its frame elsewhere.
        source: "/((?!s/|api/).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-src 'self'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        // Art and the film keep their names when they're redrawn, so a browser keeps them an hour, then shows its copy
        // while it checks for a new one in the background.
        source: "/:dir(art|film)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=31536000" }],
      },
    ];
  },
};

export default nextConfig;
