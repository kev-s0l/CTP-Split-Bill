import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM; let Node load it directly instead of bundling.
  serverExternalPackages: ["@electric-sql/pglite", "pglite-prisma-adapter"],
  outputFileTracingIncludes: {
    "/api/receipts/*/parse": [
      "../../pnpm-workspace.yaml", "../../packages/services/src/ocr-worker.cjs",
      "../../packages/services/node_modules/tesseract.js/**/*",
      "../../node_modules/.pnpm/tesseract.js*/**/*",
      "../../node_modules/.pnpm/tesseract.js-core*/**/*",
    ],
  },
};

export default nextConfig;
