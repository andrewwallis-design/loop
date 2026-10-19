import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loop is an authenticated admin app plus a public form: every page is dynamic,
  // so component caching is off. Keeps the Netlify adapter happy too.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
