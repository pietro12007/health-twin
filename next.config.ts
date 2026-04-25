import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // @tensorflow-models/face-detection has a top-level static import of
      // @mediapipe/face_detection, which is a UMD/global-only package with no
      // ESM exports. We use the 'tfjs' runtime, so the MediaPipe path is
      // never executed — alias it to a stub that satisfies the static import.
      "@mediapipe/face_detection": "./stubs/mediapipe-face-detection.js",
    },
  },
};

export default nextConfig;
