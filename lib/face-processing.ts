// Face detection + cropping using @tensorflow-models/face-detection.
// Both TF.js and the detection model are dynamically imported so they don't
// touch the initial JS bundle — they only load when processPhoto() is called.

export type FaceKeypoint = {
  name: string;
  x: number;
  y: number;
};

export type ProcessedPhoto = {
  /** 300x300 cropped image around the face (or center-cropped fallback). */
  croppedDataUrl: string;
  /** Original full-resolution image, kept in case we want to re-process. */
  originalDataUrl: string;
  /** Face bounding box in cropped coords, or null if no face detected. */
  faceBox: { x: number; y: number; width: number; height: number } | null;
  /** Anatomical keypoints in cropped coords, or null if no face detected. */
  keypoints: FaceKeypoint[] | null;
  /** True if the face detector ran successfully and found a face. */
  detected: boolean;
};

export const CROP_SIZE = 300;

type DetectorLike = {
  estimateFaces: (img: HTMLImageElement) => Promise<RawFace[]>;
};

type RawFace = {
  box: {
    xMin: number;
    yMin: number;
    xMax: number;
    yMax: number;
    width: number;
    height: number;
  };
  keypoints: { x: number; y: number; name?: string }[];
};

let detectorPromise: Promise<DetectorLike | null> | null = null;

async function getDetector(): Promise<DetectorLike | null> {
  if (typeof window === "undefined") return null;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const tf = await import("@tensorflow/tfjs");
        const faceDetection = await import("@tensorflow-models/face-detection");
        await tf.ready();
        const detector = await faceDetection.createDetector(
          faceDetection.SupportedModels.MediaPipeFaceDetector,
          { runtime: "tfjs", modelType: "short" },
        );
        return detector as unknown as DetectorLike;
      } catch (err) {
        console.warn("Face detector failed to initialise:", err);
        return null;
      }
    })();
  }
  return detectorPromise;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

export async function processPhoto(
  rawDataUrl: string,
): Promise<ProcessedPhoto> {
  const img = await loadImage(rawDataUrl);

  let face: RawFace | null = null;
  try {
    const detector = await getDetector();
    if (detector) {
      const faces = await detector.estimateFaces(img);
      face = faces[0] ?? null;
    }
  } catch (err) {
    console.warn("Face detection threw:", err);
    face = null;
  }

  // Compute the source crop region.
  let cropX: number, cropY: number, cropW: number;
  if (face) {
    const padding = 0.55; // 55% of face size on each side
    const fSize = Math.max(face.box.width, face.box.height) * (1 + padding);
    const fCx = face.box.xMin + face.box.width / 2;
    const fCy = face.box.yMin + face.box.height / 2;
    cropX = fCx - fSize / 2;
    cropY = fCy - fSize / 2;
    cropW = fSize;
  } else {
    const sz = Math.min(img.naturalWidth, img.naturalHeight);
    cropX = (img.naturalWidth - sz) / 2;
    cropY = (img.naturalHeight - sz) / 2;
    cropW = sz;
  }

  // Clamp to image bounds.
  const maxW = Math.min(img.naturalWidth, img.naturalHeight);
  cropW = Math.min(cropW, maxW);
  cropX = Math.max(0, Math.min(img.naturalWidth - cropW, cropX));
  cropY = Math.max(0, Math.min(img.naturalHeight - cropW, cropY));

  // Render a 300x300 crop.
  const canvas = document.createElement("canvas");
  canvas.width = CROP_SIZE;
  canvas.height = CROP_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, cropX, cropY, cropW, cropW, 0, 0, CROP_SIZE, CROP_SIZE);
  const croppedDataUrl = canvas.toDataURL("image/jpeg", 0.92);

  // Translate face data into cropped coords.
  let faceBox: ProcessedPhoto["faceBox"] = null;
  let keypoints: FaceKeypoint[] | null = null;
  if (face) {
    const scale = CROP_SIZE / cropW;
    faceBox = {
      x: (face.box.xMin - cropX) * scale,
      y: (face.box.yMin - cropY) * scale,
      width: face.box.width * scale,
      height: face.box.height * scale,
    };
    keypoints = face.keypoints
      .filter((k): k is { x: number; y: number; name: string } =>
        Boolean(k.name),
      )
      .map((k) => ({
        name: k.name,
        x: (k.x - cropX) * scale,
        y: (k.y - cropY) * scale,
      }));
  }

  return {
    croppedDataUrl,
    originalDataUrl: rawDataUrl,
    faceBox,
    keypoints,
    detected: face !== null,
  };
}

/**
 * Look up a keypoint by name and return synthesised fallback coords from the
 * face box if the named keypoint isn't present (or detection failed entirely).
 */
export function getKeypoint(
  photo: ProcessedPhoto,
  name:
    | "rightEye"
    | "leftEye"
    | "noseTip"
    | "mouthCenter"
    | "rightEarTragion"
    | "leftEarTragion",
): { x: number; y: number } {
  const found = photo.keypoints?.find((k) => k.name === name);
  if (found) return { x: found.x, y: found.y };

  // Fallback: anatomical proportions relative to a centred face box.
  const box = photo.faceBox ?? {
    x: CROP_SIZE * 0.18,
    y: CROP_SIZE * 0.18,
    width: CROP_SIZE * 0.64,
    height: CROP_SIZE * 0.74,
  };
  const cx = box.x + box.width / 2;
  const eyeY = box.y + box.height * 0.4;
  const noseY = box.y + box.height * 0.62;
  const mouthY = box.y + box.height * 0.78;
  const eyeOffsetX = box.width * 0.2;
  const earOffsetX = box.width * 0.5;

  switch (name) {
    case "rightEye":
      return { x: cx - eyeOffsetX, y: eyeY };
    case "leftEye":
      return { x: cx + eyeOffsetX, y: eyeY };
    case "noseTip":
      return { x: cx, y: noseY };
    case "mouthCenter":
      return { x: cx, y: mouthY };
    case "rightEarTragion":
      return { x: cx - earOffsetX, y: eyeY + box.height * 0.08 };
    case "leftEarTragion":
      return { x: cx + earOffsetX, y: eyeY + box.height * 0.08 };
  }
}
