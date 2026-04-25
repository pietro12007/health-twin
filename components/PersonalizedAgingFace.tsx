"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CROP_SIZE,
  getKeypoint,
  type ProcessedPhoto,
} from "@/lib/face-processing";
import { deriveMetrics, type Metrics } from "@/lib/health-metrics";
import type { HealthData } from "@/lib/health-types";

// -------------------------------------------------------------------
// Types & defaults
// -------------------------------------------------------------------

type Intensities = {
  smoking: number;
  sleepDeprivation: number;
  stress: number;
  sedentary: number;
  positive: number;
};

type FlashState = "idle" | "forward" | "rejuv";

type Props = {
  healthData: HealthData;
  photo: ProcessedPhoto;
  /** Latest streamed assistant text. Drives keyword-based effect adjustments. */
  latestAssistantText?: string;
  /**
   * Monotonically increasing index of the current assistant message.
   * Used to gate "flash forward" / "rejuvenation" moments to one per message.
   */
  messageKey?: number;
  /** Allow the user to retake their photo from the dashboard. */
  onRetakePhoto?: () => void;
};

const ZERO: Intensities = {
  smoking: 0,
  sleepDeprivation: 0,
  stress: 0,
  sedentary: 0,
  positive: 0,
};

// -------------------------------------------------------------------
// AgeFilter — declarative effect engine.
//
// Each method takes an intensity 0..1 and contributes to a composed render
// config: a CSS filter string for the wrapper image and a set of opacity
// values for SVG overlay layers (wrinkles, dark circles, etc.).
//
// We deliberately favour CSS transitions over per-frame canvas redraws —
// the browser composites filter and opacity on the GPU thread which is much
// smoother than re-painting a canvas at 60Hz.
// -------------------------------------------------------------------

type EffectContribution = {
  cssFilter: Partial<{
    sepia: number;
    saturate: number;
    brightness: number;
    contrast: number;
    blur: number; // px
  }>;
  overlay: Partial<OverlayMap>;
  /** Width scale applied to the photo container (e.g. sedentary slight puff). */
  scaleX?: number;
  /** Skin tint overlay (RGBA color + opacity), composited on top of the image. */
  skinTint?: { color: string; opacity: number };
};

type OverlayMap = {
  crowsFeet: number;
  underEyeCircles: number;
  underEyeFineLines: number;
  perioralLines: number;
  nasolabialFolds: number;
  foreheadLines: number;
  jawShadow: number;
  grayHair: number;
  healthyGlow: number;
  cheekFlush: number;
};

const ZERO_OVERLAYS: OverlayMap = {
  crowsFeet: 0,
  underEyeCircles: 0,
  underEyeFineLines: 0,
  perioralLines: 0,
  nasolabialFolds: 0,
  foreheadLines: 0,
  jawShadow: 0,
  grayHair: 0,
  healthyGlow: 0,
  cheekFlush: 0,
};

class AgeFilter {
  static smokingEffect(i: number): EffectContribution {
    return {
      cssFilter: {
        sepia: i * 0.5,
        contrast: i * 0.3,
        brightness: -i * 0.2,
      },
      overlay: {
        crowsFeet: i,
        perioralLines: i * 0.95,
        nasolabialFolds: i * 0.6,
        grayHair: i * 0.45,
      },
      // Slight skin yellowing — RGB shift via colored overlay (cheaper than
      // a per-pixel canvas pass and equivalent visually).
      skinTint: { color: "rgba(190, 160, 90, 1)", opacity: i * 0.12 },
    };
  }

  static sleepDeprivationEffect(i: number): EffectContribution {
    return {
      cssFilter: {
        brightness: -i * 0.25,
        saturate: -i * 0.3,
      },
      overlay: {
        underEyeCircles: i,
        underEyeFineLines: i * 0.7,
      },
    };
  }

  static stressEffect(i: number): EffectContribution {
    return {
      cssFilter: {
        contrast: i * 0.2,
      },
      overlay: {
        foreheadLines: i,
        nasolabialFolds: i * 0.4,
        jawShadow: i * 0.5,
      },
    };
  }

  static sedentaryEffect(i: number): EffectContribution {
    return {
      cssFilter: {
        saturate: -i * 0.15,
        blur: i * 0.4,
      },
      overlay: {
        nasolabialFolds: i * 0.7,
        jawShadow: i * 0.4,
      },
      scaleX: 1 + i * 0.04,
    };
  }

  static positiveEffect(i: number): EffectContribution {
    return {
      cssFilter: {
        brightness: i * 0.15,
        saturate: i * 0.2,
        blur: i * 0.5, // very subtle skin softening
        contrast: i * 0.05,
      },
      overlay: {
        healthyGlow: i,
        cheekFlush: i * 0.8,
      },
    };
  }

  static compose(intensities: Intensities): {
    cssFilter: string;
    overlays: OverlayMap;
    scaleX: number;
    skinTints: { color: string; opacity: number }[];
  } {
    const contributions = [
      AgeFilter.smokingEffect(intensities.smoking),
      AgeFilter.sleepDeprivationEffect(intensities.sleepDeprivation),
      AgeFilter.stressEffect(intensities.stress),
      AgeFilter.sedentaryEffect(intensities.sedentary),
      AgeFilter.positiveEffect(intensities.positive),
    ];

    let sepia = 0;
    let saturate = 1;
    let brightness = 1;
    let contrast = 1;
    let blur = 0;
    const overlays: OverlayMap = { ...ZERO_OVERLAYS };
    let scaleX = 1;
    const skinTints: { color: string; opacity: number }[] = [];

    for (const c of contributions) {
      if (c.cssFilter.sepia) sepia += c.cssFilter.sepia;
      if (c.cssFilter.saturate) saturate += c.cssFilter.saturate;
      if (c.cssFilter.brightness) brightness += c.cssFilter.brightness;
      if (c.cssFilter.contrast) contrast += c.cssFilter.contrast;
      if (c.cssFilter.blur) blur += c.cssFilter.blur;
      for (const k of Object.keys(c.overlay) as (keyof OverlayMap)[]) {
        overlays[k] = Math.max(overlays[k], c.overlay[k] ?? 0);
      }
      if (c.scaleX !== undefined) scaleX *= c.scaleX;
      if (c.skinTint && c.skinTint.opacity > 0) skinTints.push(c.skinTint);
    }

    sepia = clamp01(sepia);
    saturate = Math.max(0, saturate);
    brightness = Math.max(0.4, brightness);
    contrast = Math.max(0.4, contrast);
    blur = Math.max(0, blur);
    for (const k of Object.keys(overlays) as (keyof OverlayMap)[]) {
      overlays[k] = clamp01(overlays[k]);
    }

    const cssFilter = `sepia(${sepia.toFixed(3)}) saturate(${saturate.toFixed(
      3,
    )}) brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(
      3,
    )}) blur(${blur.toFixed(2)}px)`;

    return { cssFilter, overlays, scaleX, skinTints };
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// -------------------------------------------------------------------
// Baseline + keyword-driven intensity calculation.
// -------------------------------------------------------------------

function baselineIntensities(m: Metrics): Intensities {
  return {
    smoking:
      m.smokerStatus === "smoker"
        ? 0.7
        : m.smokerStatus === "former"
          ? 0.25
          : 0,
    sleepDeprivation: m.sleep < 6 ? 0.6 : m.sleep < 7 ? 0.3 : 0,
    stress: m.stress > 7 ? 0.6 : m.stress > 5 ? 0.3 : 0,
    sedentary: m.exercise < 2 ? 0.5 : m.exercise < 3 ? 0.2 : 0,
    positive: clamp01(
      (m.exercise >= 5 ? 0.5 : m.exercise >= 3 ? 0.25 : 0) +
        (m.sleep >= 7 && m.sleep <= 9 ? 0.2 : 0) +
        (m.stress <= 3 ? 0.2 : 0),
    ),
  };
}

type KeywordAdjustments = {
  smokingDelta: number;
  sleepDelta: number;
  stressDelta: number;
  sedentaryDelta: number;
  positiveOverride: number | null;
  yearsAhead: number | null;
};

function detectKeywords(text: string | undefined): KeywordAdjustments {
  if (!text)
    return {
      smokingDelta: 0,
      sleepDelta: 0,
      stressDelta: 0,
      sedentaryDelta: 0,
      positiveOverride: null,
      yearsAhead: null,
    };

  const lower = text.toLowerCase();

  // Negative-direction keywords
  const smokeAdd = /\b(smoking|cigarette|cigarettes|tobacco|nicotine)\b/.test(
    lower,
  );
  const sleepAdd =
    /\b(sleep deprivation|poor sleep|insomnia|sleep deprived)\b/.test(lower);
  const stressAdd = /\b(stress|anxiety|cortisol|burnout)\b/.test(lower);
  const sedentaryAdd = /\b(sedentary|inactive|no exercise|don't exercise)\b/.test(
    lower,
  );

  // Positive-direction keywords
  const smokeQuit = /\b(quit smoking|stopped smoking|quit tobacco)\b/.test(
    lower,
  );
  const sleepImprove =
    /\b(better sleep|sleep 8 hours|improving sleep|good sleep|7 hours of sleep|seven hours of sleep)\b/.test(
      lower,
    );
  const positive = /\b(exercise|active|fitness|working out|workout|cardio)\b/.test(
    lower,
  );

  // Time-frame keywords amplify the negative side.
  const has5y = /\b5 years?\b/.test(lower) || /\bfive years?\b/.test(lower);
  const has10y = /\b(10 years?|decade|ten years?)\b/.test(lower);
  const has20y = /\b(20 years?|twenty years?)\b/.test(lower);
  const timeMul = has20y ? 1.6 : has10y ? 1.3 : has5y ? 1.15 : 1;

  let yearsAhead: number | null = null;
  if (has20y) yearsAhead = 20;
  else if (has10y) yearsAhead = 10;
  else if (has5y) yearsAhead = 5;
  // Also pick up "at 45" / "by 60"
  const ageAtMatch = lower.match(/\b(?:at|by)\s+(\d{2})\b/);
  if (ageAtMatch && yearsAhead === null) {
    const target = parseInt(ageAtMatch[1], 10);
    if (target >= 18 && target <= 100) yearsAhead = target; // resolved later
  }

  const smokingDelta =
    (smokeQuit ? -0.4 : 0) + (smokeAdd && !smokeQuit ? 0.3 : 0);
  const sleepDelta =
    (sleepImprove ? -0.3 : 0) + (sleepAdd && !sleepImprove ? 0.3 : 0);
  const stressDelta = stressAdd ? 0.3 : 0;
  const sedentaryDelta = sedentaryAdd ? 0.2 : 0;
  const positiveOverride = positive ? 0.4 : null;

  return {
    smokingDelta: smokingDelta * timeMul,
    sleepDelta: sleepDelta * timeMul,
    stressDelta: stressDelta * timeMul,
    sedentaryDelta: sedentaryDelta * timeMul,
    positiveOverride,
    yearsAhead,
  };
}

function applyAdjustments(
  base: Intensities,
  adj: KeywordAdjustments,
): Intensities {
  return {
    smoking: clamp01(base.smoking + adj.smokingDelta),
    sleepDeprivation: clamp01(base.sleepDeprivation + adj.sleepDelta),
    stress: clamp01(base.stress + adj.stressDelta),
    sedentary: clamp01(base.sedentary + adj.sedentaryDelta),
    positive:
      adj.positiveOverride !== null
        ? clamp01(Math.max(base.positive, adj.positiveOverride))
        : base.positive,
  };
}

// "Future" intensities — what the user looks like at +20y if nothing changes.
function futureIntensities(base: Intensities): Intensities {
  return {
    smoking: clamp01(base.smoking * 1.5),
    sleepDeprivation: clamp01(base.sleepDeprivation * 1.5),
    stress: clamp01(base.stress * 1.4),
    sedentary: clamp01(base.sedentary * 1.4),
    // Future under unchanged habits doesn't get a free positive bump.
    positive: clamp01(base.positive * 0.6),
  };
}

// -------------------------------------------------------------------
// Flash trigger detection.
// -------------------------------------------------------------------

const BAD_OUTCOME_RX =
  /\b(heart attack|stroke|dementia|alzheimer|early death|premature death|life-threatening|cardiac event|kidney failure|metabolic syndrome diagnosis)\b/i;
const GOOD_OUTCOME_RX =
  /\b(could prevent|would cut|would reduce|much healthier|reverse|add years|live longer|strongly improves?|substantially lower)\b/i;

// -------------------------------------------------------------------
// Component
// -------------------------------------------------------------------

export default function PersonalizedAgingFace({
  healthData,
  photo,
  latestAssistantText,
  messageKey,
  onRetakePhoto,
}: Props) {
  const metrics = useMemo(() => deriveMetrics(healthData), [healthData]);
  const baseline = useMemo(() => baselineIntensities(metrics), [metrics]);
  const futureBaseline = useMemo(
    () => futureIntensities(baseline),
    [baseline],
  );

  // Keyword analysis of the live assistant text.
  const adjustments = useMemo(
    () => detectKeywords(latestAssistantText),
    [latestAssistantText],
  );

  // Derived "future" target intensities (right side of the divider).
  const futureTarget = useMemo(
    () => applyAdjustments(futureBaseline, adjustments),
    [futureBaseline, adjustments],
  );

  // Years ahead label — drives the "You in N years" tag.
  const yearsAhead = useMemo(() => {
    if (adjustments.yearsAhead == null) return 20;
    // If the AI mentioned an absolute age (e.g. "at 45"), translate to years
    // ahead from the user's current age.
    if (adjustments.yearsAhead >= 18) {
      return Math.max(0, adjustments.yearsAhead - Math.round(metrics.age));
    }
    return adjustments.yearsAhead;
  }, [adjustments.yearsAhead, metrics.age]);

  // Flash-forward / rejuvenation moments — gated to one trigger per message.
  const [flash, setFlash] = useState<FlashState>("idle");
  const flashedForKeyRef = useRef<number | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);

  const triggerFlash = useCallback((kind: FlashState) => {
    setFlash(kind);
    if (flashTimeoutRef.current !== null) {
      clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = window.setTimeout(() => {
      setFlash("idle");
      flashTimeoutRef.current = null;
    }, 3200);
  }, []);

  useEffect(() => {
    if (!latestAssistantText) return;
    if (
      messageKey == null ||
      flashedForKeyRef.current === messageKey ||
      // Only fire once we have a meaningful chunk of text.
      latestAssistantText.length < 60
    ) {
      return;
    }
    // Synchronising a UI side-effect (3.2s flash overlay) to an external
    // input (streamed text). Setting state from this effect is intentional.
    if (BAD_OUTCOME_RX.test(latestAssistantText)) {
      flashedForKeyRef.current = messageKey;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      triggerFlash("forward");
    } else if (GOOD_OUTCOME_RX.test(latestAssistantText)) {
      flashedForKeyRef.current = messageKey;
      triggerFlash("rejuv");
    }
  }, [latestAssistantText, messageKey, triggerFlash]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current !== null) {
        clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  // Compute the actual rendered intensities for each side (current vs future).
  // Flash temporarily slams the future side to maximum effect (or maximum positive).
  const flashFutureOverride: Intensities | null =
    flash === "forward"
      ? {
          smoking: 1,
          sleepDeprivation: 1,
          stress: 1,
          sedentary: 1,
          positive: 0,
        }
      : flash === "rejuv"
        ? {
            smoking: 0,
            sleepDeprivation: 0,
            stress: 0,
            sedentary: 0,
            positive: 1,
          }
        : null;

  const renderedFuture = flashFutureOverride ?? futureTarget;

  const futureComposed = useMemo(
    () => AgeFilter.compose(renderedFuture),
    [renderedFuture],
  );
  // Today's side: minimal effects but still respect baseline (don't whitewash).
  const todayComposed = useMemo(
    () =>
      AgeFilter.compose(
        flash === "rejuv"
          ? { ...ZERO, positive: 0.6 }
          : { ...ZERO, positive: baseline.positive * 0.5 },
      ),
    [baseline.positive, flash],
  );

  // ----- Divider position + drag -----
  const [divider, setDivider] = useState(100); // 100 = today only; 0 = future only
  const dragRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initial dramatic reveal: 100 → 50 over ~1.4s.
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 1400;
    const from = 100;
    const to = 50;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDivider(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [photo.croppedDataUrl]);

  const updateDividerFromEvent = useCallback((e: React.PointerEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setDivider(Math.max(0, Math.min(100, pct)));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = true;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      updateDividerFromEvent(e);
    },
    [updateDividerFromEvent],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      updateDividerFromEvent(e);
    },
    [updateDividerFromEvent],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = false;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  // ----- Sound (opt-in) -----
  const [soundOn, setSoundOn] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const flashSoundedForKeyRef = useRef<number | null>(null);

  useEffect(() => {
    if (!soundOn || flash === "idle" || messageKey == null) return;
    if (flashSoundedForKeyRef.current === messageKey) return;
    flashSoundedForKeyRef.current = messageKey;
    playWhoosh(audioCtxRef);
  }, [flash, soundOn, messageKey]);

  // ----- Render -----
  const todayAge = Math.round(metrics.age);
  const futureAge = todayAge + yearsAhead;
  const futureLabel = `You in ${yearsAhead} year${yearsAhead === 1 ? "" : "s"}`;
  const todayLabel = `You today — age ${todayAge}`;
  const futureAgeText = `Age ${futureAge}`;

  return (
    <div className="flex flex-col items-center w-full">
      <div
        ref={containerRef}
        className="relative aspect-square w-[280px] sm:w-[320px] md:w-[360px] rounded-3xl overflow-hidden border border-gray-800 shadow-2xl shadow-blue-500/20 select-none"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* aura */}
        <div
          className="absolute inset-0 -m-12 rounded-full blur-3xl pointer-events-none"
          style={{
            background:
              flash === "forward"
                ? "radial-gradient(closest-side, rgba(244,63,94,0.25), transparent 70%)"
                : flash === "rejuv"
                  ? "radial-gradient(closest-side, rgba(34,197,94,0.3), transparent 70%)"
                  : "radial-gradient(closest-side, rgba(56,189,248,0.18), transparent 70%)",
            transition: "background 1s ease",
          }}
        />

        {/* TODAY — bottom layer (full image always rendered) */}
        <FaceImageLayer
          photo={photo}
          composed={todayComposed}
          ariaLabel="Photo of you today"
        />

        {/* FUTURE — top layer, clipped from `divider%` rightward. */}
        <div
          className="absolute inset-0"
          style={{
            clipPath: `inset(0 0 0 ${divider}%)`,
          }}
        >
          <FaceImageLayer
            photo={photo}
            composed={futureComposed}
            ariaLabel="Aged version of you"
          />
        </div>

        {/* Labels at top corners — fade based on divider position */}
        <Label
          text={todayLabel}
          side="left"
          opacity={divider / 100}
          accent="text-blue-300"
        />
        <Label
          text={futureAgeText}
          side="right"
          opacity={1 - divider / 100}
          accent="text-amber-300"
        />

        {/* Flash overlay text */}
        {flash !== "idle" && (
          <div
            key={flash}
            className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none px-4"
          >
            <div
              className={`flash-text px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur ${
                flash === "forward"
                  ? "bg-rose-950/70 border border-rose-500/40 text-rose-200"
                  : "bg-emerald-950/70 border border-emerald-500/40 text-emerald-200"
              }`}
            >
              {flash === "forward"
                ? "This could be you in 20 years if nothing changes"
                : "This is what's possible"}
            </div>
          </div>
        )}

        {/* Divider line + handle */}
        <div
          className="absolute top-0 bottom-0 w-px bg-white/80 pointer-events-none"
          style={{ left: `${divider}%`, transform: "translateX(-0.5px)" }}
        >
          <div className="divider-shimmer absolute inset-0" />
        </div>
        <div
          className="absolute top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-2xl border border-white flex items-center justify-center cursor-ew-resize"
          style={{
            left: `${divider}%`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="#0a0a0a"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-5 h-5"
            aria-hidden="true"
          >
            <polyline points="9 6 3 12 9 18" />
            <polyline points="15 6 21 12 15 18" />
          </svg>
        </div>
      </div>

      {/* Caption + controls */}
      <div className="mt-5 text-center">
        <div className="text-xs uppercase tracking-[0.25em] text-blue-400 font-semibold">
          Your Digital Twin
        </div>
        <div className="text-xl font-semibold mt-1">
          {todayLabel}{" "}
          <span className="text-gray-500">·</span>{" "}
          <span className="text-amber-300">{futureLabel}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap justify-center">
        {!photo.detected && (
          <span className="text-[11px] text-amber-400/80 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20">
            No face detected — aging is applied to the full photo
          </span>
        )}
        <button
          type="button"
          onClick={() => setSoundOn((s) => !s)}
          className="text-xs px-3 py-1.5 rounded-full border border-gray-700 bg-gray-900/60 hover:bg-gray-800 hover:border-gray-600 transition flex items-center gap-1.5"
          aria-pressed={soundOn}
          title={soundOn ? "Turn off effect sounds" : "Turn on effect sounds"}
        >
          {soundOn ? <SoundOnIcon /> : <SoundOffIcon />}
          {soundOn ? "Sound on" : "Sound off"}
        </button>
        {onRetakePhoto && (
          <button
            type="button"
            onClick={onRetakePhoto}
            className="text-xs px-3 py-1.5 rounded-full border border-gray-700 bg-gray-900/60 hover:bg-gray-800 hover:border-gray-600 transition"
          >
            Retake photo
          </button>
        )}
      </div>

      <p className="mt-3 text-[10px] text-gray-600 max-w-xs text-center">
        Stylised illustration only — not a clinical projection of how you will
        actually age.
      </p>

      <style jsx>{`
        @keyframes shimmer {
          0% {
            background-position: 0% 0%;
          }
          100% {
            background-position: 0% 200%;
          }
        }
        :global(.divider-shimmer) {
          background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0) 0%,
            rgba(255, 255, 255, 0.7) 50%,
            rgba(255, 255, 255, 0) 100%
          );
          background-size: 100% 200%;
          animation: shimmer 2.6s linear infinite;
        }
        @keyframes flashIn {
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          15%,
          85% {
            opacity: 1;
            transform: translateY(0);
          }
          100% {
            opacity: 0;
            transform: translateY(-4px);
          }
        }
        :global(.flash-text) {
          animation: flashIn 3.2s ease-out forwards;
        }
      `}</style>
    </div>
  );
}

// -------------------------------------------------------------------
// One side of the divider — image + overlays + skin tints.
// -------------------------------------------------------------------

function FaceImageLayer({
  photo,
  composed,
  ariaLabel,
}: {
  photo: ProcessedPhoto;
  composed: ReturnType<typeof AgeFilter.compose>;
  ariaLabel: string;
}) {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        transform: `scaleX(${composed.scaleX.toFixed(3)})`,
        transition: "transform 1.6s ease",
        transformOrigin: "center center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.croppedDataUrl}
        alt={ariaLabel}
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
        style={{
          filter: composed.cssFilter,
          transition: "filter 1.6s ease",
        }}
      />
      {composed.skinTints.map((tint, i) => (
        <div
          key={i}
          className="absolute inset-0 mix-blend-multiply pointer-events-none"
          style={{
            backgroundColor: tint.color,
            opacity: tint.opacity,
            transition: "opacity 1.6s ease",
          }}
        />
      ))}
      <FaceOverlays photo={photo} overlays={composed.overlays} />
    </div>
  );
}

// -------------------------------------------------------------------
// SVG overlays anchored to face-detection keypoints.
// Each group's opacity is bound to the corresponding intensity, and
// transitions smoothly via CSS.
// -------------------------------------------------------------------

function FaceOverlays({
  photo,
  overlays,
}: {
  photo: ProcessedPhoto;
  overlays: OverlayMap;
}) {
  const rEye = getKeypoint(photo, "rightEye");
  const lEye = getKeypoint(photo, "leftEye");
  const nose = getKeypoint(photo, "noseTip");
  const mouth = getKeypoint(photo, "mouthCenter");
  const rEar = getKeypoint(photo, "rightEarTragion");
  const lEar = getKeypoint(photo, "leftEarTragion");

  // Approx face width via ear distance (more reliable than the bbox).
  const faceWidth = Math.max(80, Math.abs(lEar.x - rEar.x));
  const eyeSpacing = Math.abs(lEye.x - rEye.x) || faceWidth * 0.35;

  // Approx mouth corners — mouth keypoint is the centre.
  const mouthCornerOffset = eyeSpacing * 0.45;
  const lMouthCorner = { x: mouth.x + mouthCornerOffset, y: mouth.y + 2 };
  const rMouthCorner = { x: mouth.x - mouthCornerOffset, y: mouth.y + 2 };

  // Forehead band ~halfway between eyes and top of face box.
  const foreheadY =
    (photo.faceBox?.y ?? CROP_SIZE * 0.18) +
    (photo.faceBox?.height ?? CROP_SIZE * 0.74) * 0.18;

  const stroke = (color: string, w = 1) => ({
    stroke: color,
    strokeWidth: w,
    fill: "none",
    strokeLinecap: "round" as const,
  });

  const wrinkleColor = "rgba(80, 50, 35, 0.65)";
  const darkCircleColor = "rgba(60, 40, 55, 0.55)";

  return (
    <svg
      viewBox={`0 0 ${CROP_SIZE} ${CROP_SIZE}`}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    >
      {/* Healthy glow — radial light over the face */}
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="60%" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <radialGradient id="cheek" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(229, 110, 100, 0.55)" />
          <stop offset="100%" stopColor="rgba(229, 110, 100, 0)" />
        </radialGradient>
      </defs>
      <rect
        width={CROP_SIZE}
        height={CROP_SIZE}
        fill="url(#glow)"
        opacity={overlays.healthyGlow * 0.55}
        style={{ transition: "opacity 1.6s ease" }}
      />

      {/* Cheek flush */}
      <g
        opacity={overlays.cheekFlush * 0.85}
        style={{ transition: "opacity 1.6s ease" }}
      >
        <ellipse
          cx={rEye.x - eyeSpacing * 0.15}
          cy={(rEye.y + mouth.y) / 2 + 6}
          rx={eyeSpacing * 0.32}
          ry={eyeSpacing * 0.18}
          fill="url(#cheek)"
        />
        <ellipse
          cx={lEye.x + eyeSpacing * 0.15}
          cy={(lEye.y + mouth.y) / 2 + 6}
          rx={eyeSpacing * 0.32}
          ry={eyeSpacing * 0.18}
          fill="url(#cheek)"
        />
      </g>

      {/* Under-eye dark circles */}
      <g
        opacity={overlays.underEyeCircles * 0.9}
        style={{ transition: "opacity 1.6s ease" }}
      >
        <ellipse
          cx={rEye.x}
          cy={rEye.y + 8}
          rx={eyeSpacing * 0.22}
          ry={4.5}
          fill={darkCircleColor}
        />
        <ellipse
          cx={lEye.x}
          cy={lEye.y + 8}
          rx={eyeSpacing * 0.22}
          ry={4.5}
          fill={darkCircleColor}
        />
      </g>

      {/* Under-eye fine lines */}
      <g
        {...stroke("rgba(80, 50, 35, 0.5)", 0.8)}
        opacity={overlays.underEyeFineLines}
        style={{ transition: "opacity 1.6s ease" }}
      >
        <path
          d={`M ${rEye.x - eyeSpacing * 0.18} ${rEye.y + 13} Q ${rEye.x} ${
            rEye.y + 11
          } ${rEye.x + eyeSpacing * 0.18} ${rEye.y + 13}`}
        />
        <path
          d={`M ${lEye.x - eyeSpacing * 0.18} ${lEye.y + 13} Q ${lEye.x} ${
            lEye.y + 11
          } ${lEye.x + eyeSpacing * 0.18} ${lEye.y + 13}`}
        />
      </g>

      {/* Crow's feet — outside corners of eyes */}
      <g
        {...stroke(wrinkleColor, 1)}
        opacity={overlays.crowsFeet * 0.85}
        style={{ transition: "opacity 1.6s ease" }}
      >
        <path
          d={`M ${rEye.x - eyeSpacing * 0.32} ${rEye.y - 3} l -7 -3`}
        />
        <path
          d={`M ${rEye.x - eyeSpacing * 0.32} ${rEye.y + 1} l -8 0`}
        />
        <path
          d={`M ${rEye.x - eyeSpacing * 0.32} ${rEye.y + 5} l -7 4`}
        />
        <path
          d={`M ${lEye.x + eyeSpacing * 0.32} ${lEye.y - 3} l 7 -3`}
        />
        <path
          d={`M ${lEye.x + eyeSpacing * 0.32} ${lEye.y + 1} l 8 0`}
        />
        <path
          d={`M ${lEye.x + eyeSpacing * 0.32} ${lEye.y + 5} l 7 4`}
        />
      </g>

      {/* Perioral lines — bezier curves around the mouth */}
      <g
        {...stroke(wrinkleColor, 1)}
        opacity={overlays.perioralLines * 0.85}
        style={{ transition: "opacity 1.6s ease" }}
      >
        <path
          d={`M ${rMouthCorner.x - 6} ${rMouthCorner.y - 2} Q ${
            rMouthCorner.x - 3
          } ${rMouthCorner.y - 8} ${rMouthCorner.x + 1} ${
            rMouthCorner.y - 14
          }`}
        />
        <path
          d={`M ${rMouthCorner.x - 12} ${rMouthCorner.y - 2} Q ${
            rMouthCorner.x - 9
          } ${rMouthCorner.y - 6} ${rMouthCorner.x - 5} ${
            rMouthCorner.y - 11
          }`}
        />
        <path
          d={`M ${lMouthCorner.x + 6} ${lMouthCorner.y - 2} Q ${
            lMouthCorner.x + 3
          } ${lMouthCorner.y - 8} ${lMouthCorner.x - 1} ${
            lMouthCorner.y - 14
          }`}
        />
        <path
          d={`M ${lMouthCorner.x + 12} ${lMouthCorner.y - 2} Q ${
            lMouthCorner.x + 9
          } ${lMouthCorner.y - 6} ${lMouthCorner.x + 5} ${
            lMouthCorner.y - 11
          }`}
        />
      </g>

      {/* Nasolabial folds — nose to mouth corners */}
      <g
        {...stroke("rgba(80, 50, 35, 0.6)", 1.4)}
        opacity={overlays.nasolabialFolds * 0.8}
        style={{ transition: "opacity 1.6s ease" }}
      >
        <path
          d={`M ${nose.x - eyeSpacing * 0.14} ${nose.y + 4} Q ${
            rMouthCorner.x + 2
          } ${(nose.y + mouth.y) / 2} ${rMouthCorner.x - 2} ${mouth.y + 4}`}
        />
        <path
          d={`M ${nose.x + eyeSpacing * 0.14} ${nose.y + 4} Q ${
            lMouthCorner.x - 2
          } ${(nose.y + mouth.y) / 2} ${lMouthCorner.x + 2} ${mouth.y + 4}`}
        />
      </g>

      {/* Forehead lines — horizontal */}
      <g
        {...stroke("rgba(80, 50, 35, 0.55)", 1)}
        opacity={overlays.foreheadLines * 0.85}
        style={{ transition: "opacity 1.6s ease" }}
      >
        <path
          d={`M ${rEye.x - 4} ${foreheadY} Q ${(rEye.x + lEye.x) / 2} ${
            foreheadY - 4
          } ${lEye.x + 4} ${foreheadY}`}
        />
        <path
          d={`M ${rEye.x + 6} ${foreheadY + 8} Q ${
            (rEye.x + lEye.x) / 2
          } ${foreheadY + 4} ${lEye.x - 6} ${foreheadY + 8}`}
        />
        {/* Vertical glabella ("11" lines) */}
        <path d={`M ${nose.x - 5} ${foreheadY + 16} l 0 -10`} />
        <path d={`M ${nose.x + 5} ${foreheadY + 16} l 0 -10`} />
      </g>

      {/* Jaw shadow */}
      <g
        opacity={overlays.jawShadow * 0.5}
        style={{ transition: "opacity 1.6s ease" }}
      >
        <ellipse
          cx={(rEye.x + lEye.x) / 2}
          cy={CROP_SIZE * 0.92}
          rx={CROP_SIZE * 0.34}
          ry={CROP_SIZE * 0.07}
          fill="rgba(20, 20, 30, 0.55)"
        />
      </g>

      {/* Gray hair — top band */}
      <g
        opacity={overlays.grayHair * 0.65}
        style={{ transition: "opacity 1.6s ease" }}
      >
        <rect
          x={0}
          y={0}
          width={CROP_SIZE}
          height={(photo.faceBox?.y ?? CROP_SIZE * 0.18) + 18}
          fill="rgba(180, 180, 180, 0.6)"
          style={{ mixBlendMode: "lighten" }}
        />
      </g>
    </svg>
  );
}

// -------------------------------------------------------------------
// Misc UI
// -------------------------------------------------------------------

function Label({
  text,
  side,
  opacity,
  accent,
}: {
  text: string;
  side: "left" | "right";
  opacity: number;
  accent: string;
}) {
  return (
    <div
      className={`absolute top-3 ${
        side === "left" ? "left-3" : "right-3"
      } px-2.5 py-1 rounded-full bg-black/60 backdrop-blur text-[11px] font-semibold ${accent} pointer-events-none`}
      style={{
        opacity: Math.max(0, Math.min(1, opacity)),
        transition: "opacity 0.3s ease",
      }}
    >
      {text}
    </div>
  );
}

function SoundOnIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
}

function SoundOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
      aria-hidden="true"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

// -------------------------------------------------------------------
// WebAudio "whoosh" — band-passed white noise envelope. No assets needed.
// -------------------------------------------------------------------

function playWhoosh(ctxRef: { current: AudioContext | null }) {
  if (typeof window === "undefined") return;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return;
  if (!ctxRef.current) {
    try {
      ctxRef.current = new Ctx();
    } catch {
      return;
    }
  }
  const ctx = ctxRef.current;
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }

  const dur = 0.6;
  const noise = ctx.createBufferSource();
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  noise.buffer = buf;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(400, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + dur);
  filter.Q.value = 0.7;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start();
  noise.stop(ctx.currentTime + dur);
}
