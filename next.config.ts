import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Without this, Turbopack walks up looking for a lockfile and finds the one
  // in the home directory, so the inferred workspace root is ~ rather than the
  // project. Pin it to this folder.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
