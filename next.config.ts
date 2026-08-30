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
  experimental: {
    // Uploads into the notes vault go through a Server Action, and an action
    // request is capped at 1 MB by default — which every scanned PDF exceeds.
    // The vault's own per-file cap is 60 MB; this leaves room for one of those
    // plus the multipart boundaries and part headers wrapped around it.
    serverActions: { bodySizeLimit: "64mb" },
  },
};

export default nextConfig;
