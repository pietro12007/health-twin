"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";

type Stage = "welcome" | "camera" | "countdown" | "review";

type Props = {
  onComplete: (rawDataUrl: string) => void;
  onSkip: () => void;
};

export default function PhotoOnboarding({ onComplete, onSkip }: Props) {
  const [stage, setStage] = useState<Stage>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const countdownTimerRef = useRef<number | null>(null);

  // Cleanup on unmount: stop any active camera stream + pending timers.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (countdownTimerRef.current !== null) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, []);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startCamera() {
    setError(null);
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError(
        "Your browser doesn't expose a camera API. You can upload a photo instead.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setStage("camera");
      // The video element mounts on the next render — attach the stream then.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Camera access denied.";
      setError(
        `We couldn't access your camera (${msg}). You can upload a photo instead.`,
      );
    }
  }

  function captureFromVideo() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mirror the captured frame so the saved photo matches what the user saw
    // in the preview (selfie convention).
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCapturedDataUrl(dataUrl);
    stopCamera();
    setStage("review");
  }

  function startCountdown() {
    setCountdown(3);
    setStage("countdown");

    let count = 3;
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
    }
    countdownTimerRef.current = window.setInterval(() => {
      count -= 1;
      if (count <= 0) {
        if (countdownTimerRef.current !== null) {
          clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = null;
        }
        captureFromVideo();
      } else {
        setCountdown(count);
      }
    }, 1000);
  }

  function handleFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setCapturedDataUrl(result);
        setStage("review");
        setError(null);
      }
    };
    reader.onerror = () => setError("Failed to read that file.");
    reader.readAsDataURL(file);
  }

  function handleRetake() {
    setCapturedDataUrl(null);
    setStage("welcome");
  }

  function handleConfirm() {
    if (capturedDataUrl) onComplete(capturedDataUrl);
  }

  function cancelCamera() {
    stopCamera();
    if (countdownTimerRef.current !== null) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    setStage("welcome");
  }

  // ----- Welcome -----
  if (stage === "welcome") {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-6 py-10">
        <div className="max-w-2xl w-full text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-blue-400 font-semibold">
            My Future Health
          </p>
          <h1 className="mt-4 text-4xl md:text-5xl font-bold leading-tight">
            {"First, let's put a face to your future."}
          </h1>
          <p className="text-gray-400 mt-5 text-lg">
            Your Digital Twin works best with your real face. The photo stays
            on your device — it never leaves the browser.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-10">
            <PhotoOption
              label="Take Selfie"
              description="Use your webcam"
              icon={<CameraIcon />}
              onClick={startCamera}
            />
            <PhotoOption
              label="Upload Photo"
              description="Pick from your device"
              icon={<UploadIcon />}
              onClick={() => fileInputRef.current?.click()}
            />
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleFileUpload}
          />

          <button
            onClick={onSkip}
            className="mt-10 text-sm text-gray-500 hover:text-gray-300 underline-offset-4 hover:underline"
          >
            Skip for now and use the illustrated avatar
          </button>

          {error && (
            <div className="mt-6 bg-red-950/40 border border-red-800 text-red-200 rounded-lg p-3 text-sm">
              {error}
            </div>
          )}

          <p className="mt-10 text-[11px] text-gray-600">
            Stylised illustration only — not a clinical projection.
          </p>
        </div>

        <style jsx>{`
          :global(.option-pulse) {
            animation: cardPulse 2.8s ease-in-out infinite;
          }
          :global(.option-pulse:nth-child(2)) {
            animation-delay: 1.4s;
          }
          @keyframes cardPulse {
            0%,
            100% {
              transform: scale(1);
              box-shadow: 0 0 0 0 rgba(56, 189, 248, 0);
            }
            50% {
              transform: scale(1.015);
              box-shadow: 0 0 32px 0 rgba(56, 189, 248, 0.18);
            }
          }
        `}</style>
      </main>
    );
  }

  // ----- Camera + countdown -----
  if (stage === "camera" || stage === "countdown") {
    return (
      <CameraStage
        videoRef={videoRef}
        stage={stage}
        countdown={countdown}
        onCapture={startCountdown}
        onCancel={cancelCamera}
      />
    );
  }

  // ----- Review -----
  if (stage === "review" && capturedDataUrl) {
    return (
      <main className="min-h-screen bg-gray-950 text-white flex flex-col items-center justify-center px-6 py-10">
        <div className="max-w-md w-full text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-blue-400 font-semibold">
            Looking good
          </p>
          <h2 className="mt-3 text-2xl md:text-3xl font-bold">
            {"Now let's build your twin."}
          </h2>

          <div className="mt-6 mx-auto relative inline-block rounded-2xl overflow-hidden border border-gray-800 shadow-2xl shadow-blue-500/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={capturedDataUrl}
              alt="Captured selfie"
              className="block max-w-full max-h-[60vh]"
            />
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={handleRetake}
              className="px-5 py-3 rounded-lg border border-gray-700 hover:border-gray-500 hover:bg-gray-900 text-gray-200 transition"
            >
              Retake
            </button>
            <button
              onClick={handleConfirm}
              className="px-6 py-3 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-400 hover:to-cyan-400 text-white font-semibold shadow-lg shadow-blue-500/30 transition-all hover:shadow-blue-400/50"
            >
              Continue →
            </button>
          </div>
        </div>
      </main>
    );
  }

  return null;
}

// ----- Camera stage component (shared between live and countdown) -----

function CameraStage({
  videoRef,
  stage,
  countdown,
  onCapture,
  onCancel,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  stage: "camera" | "countdown";
  countdown: number;
  onCapture: () => void;
  onCancel: () => void;
}) {
  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center relative overflow-hidden">
      <div className="relative w-full max-w-3xl aspect-[4/3] bg-black rounded-2xl overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
        <FaceOvalGuide />

        {stage === "countdown" && (
          <div
            key={countdown}
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
          >
            <div className="countdown-number text-white text-[12rem] md:text-[16rem] font-bold drop-shadow-[0_0_30px_rgba(56,189,248,0.7)]">
              {countdown}
            </div>
          </div>
        )}

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 z-10">
          {stage === "camera" ? (
            <>
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded-full bg-black/60 backdrop-blur border border-white/20 text-sm text-white/90 hover:bg-black/80 transition"
              >
                Cancel
              </button>
              <button
                onClick={onCapture}
                aria-label="Take photo"
                className="w-16 h-16 rounded-full bg-white text-gray-900 flex items-center justify-center hover:scale-105 transition shadow-2xl"
              >
                <span className="block w-12 h-12 rounded-full border-2 border-gray-900" />
              </button>
            </>
          ) : (
            <div className="px-4 py-2 rounded-full bg-black/60 backdrop-blur border border-white/20 text-sm text-white/80">
              Hold still…
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-sm text-gray-400 text-center max-w-md px-6">
        Position your face inside the oval and look straight ahead. Good
        lighting helps.
      </p>

      <style jsx>{`
        @keyframes countdownPop {
          0% {
            transform: scale(0.6);
            opacity: 0;
          }
          20% {
            transform: scale(1.1);
            opacity: 1;
          }
          80% {
            transform: scale(1);
            opacity: 1;
          }
          100% {
            transform: scale(1.4);
            opacity: 0;
          }
        }
        :global(.countdown-number) {
          animation: countdownPop 1s ease-out forwards;
        }
      `}</style>
    </main>
  );
}

function FaceOvalGuide() {
  return (
    <svg
      viewBox="0 0 400 300"
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    >
      <defs>
        <mask id="oval-mask">
          <rect width="400" height="300" fill="white" />
          <ellipse cx="200" cy="150" rx="92" ry="125" fill="black" />
        </mask>
      </defs>
      <rect
        width="400"
        height="300"
        fill="rgba(0,0,0,0.45)"
        mask="url(#oval-mask)"
      />
      <ellipse
        cx="200"
        cy="150"
        rx="92"
        ry="125"
        stroke="rgba(56,189,248,0.85)"
        strokeWidth="2"
        fill="none"
        className="oval-pulse"
      />
      <style>{`
        @keyframes ovalPulse {
          0%, 100% {
            opacity: 0.7;
            stroke-width: 2;
          }
          50% {
            opacity: 1;
            stroke-width: 2.5;
          }
        }
        .oval-pulse {
          animation: ovalPulse 2.5s ease-in-out infinite;
        }
      `}</style>
    </svg>
  );
}

// ----- Welcome option card -----

function PhotoOption({
  label,
  description,
  icon,
  onClick,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="option-pulse group rounded-2xl border border-gray-800 hover:border-blue-400/60 bg-gradient-to-br from-gray-900/80 to-gray-900/40 hover:from-blue-500/10 hover:to-cyan-500/5 backdrop-blur p-6 md:p-8 text-left transition-all"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-blue-500/15 border border-blue-400/30 text-blue-300 flex items-center justify-center group-hover:scale-110 group-hover:bg-blue-500/25 transition-all">
          {icon}
        </div>
        <div>
          <div className="text-xl font-semibold">{label}</div>
          <div className="text-sm text-gray-400 mt-0.5">{description}</div>
        </div>
      </div>
    </button>
  );
}

function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-6 h-6"
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-6 h-6"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
