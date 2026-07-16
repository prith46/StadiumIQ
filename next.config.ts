import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

// Pin the Turbopack workspace root to this app directory. Without this, Next
// infers the root by walking up for a lockfile / VCS boundary and can land on
// the parent repo directory (which has no node_modules), breaking dev-server
// module resolution (framer-motion, tailwind.config.ts). Pinning it explicitly
// is the documented fix and removes the "inferred workspace root" ambiguity.
const nextConfig: NextConfig = {
  output: 'standalone',
  turbopack: {
    root: path.dirname(fileURLToPath(import.meta.url)),
  },
};

export default nextConfig;
