// Stub for @mediapipe/face_detection.
//
// @tensorflow-models/face-detection statically imports `FaceDetection` from
// this package even when the consumer uses the `tfjs` runtime (which we do).
// The real package ships UMD with no ESM exports, so Turbopack/Webpack can't
// resolve it. This stub satisfies the static import; the export is never
// actually invoked because we never call the MediaPipe runtime path.

export class FaceDetection {
  constructor() {
    throw new Error(
      "MediaPipe runtime is not bundled in this build — use runtime: 'tfjs'.",
    );
  }
}
