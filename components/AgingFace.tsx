"use client";

import { useMemo, useState } from "react";
import { deriveMetrics } from "@/lib/health-metrics";
import type { HealthData } from "@/lib/health-types";

type Props = {
  healthData: HealthData;
  /** Latest streamed assistant text — drives keyword-triggered overlays. */
  latestAssistantText?: string;
  /** Optional override for the displayed-age label when the AI mentions a year. */
  className?: string;
};

type Overlays = {
  smoking: boolean;
  sleepDep: boolean;
  stress: boolean;
  exerciseBoost: boolean;
  aging: boolean;
};

const EMPTY_OVERLAYS: Overlays = {
  smoking: false,
  sleepDep: false,
  stress: false,
  exerciseBoost: false,
  aging: false,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export default function AgingFace({
  healthData,
  latestAssistantText,
  className,
}: Props) {
  const metrics = useMemo(() => deriveMetrics(healthData), [healthData]);
  const [mode, setMode] = useState<"current" | "future">("current");

  // Keyword-derived overlays + target age — derived directly from the streamed
  // assistant text. No effect needed; React recomputes on each text update.
  const { overlays, yearsAhead } = useMemo<{
    overlays: Overlays;
    yearsAhead: number | null;
  }>(() => {
    if (!latestAssistantText) {
      return { overlays: EMPTY_OVERLAYS, yearsAhead: null };
    }
    const text = latestAssistantText.toLowerCase();
    const o: Overlays = {
      smoking: /\b(smoking|cigarette|cigarettes|tobacco|nicotine)\b/.test(
        text,
      ),
      sleepDep: /\b(sleep|insomnia|fatigue|tired|exhaust)\b/.test(text),
      stress: /\b(stress|anxiety|cortisol|tension|burnout)\b/.test(text),
      exerciseBoost:
        /\b(exercise|fitness|active|cardio|aerobic|movement|training)\b/.test(
          text,
        ),
      aging:
        /\b(years|decade|future|aging|trajectory|projection|by\s+\d{2})\b/.test(
          text,
        ),
    };

    let ya: number | null = null;
    const ageAtMatch = text.match(/(?:at|by)\s+(\d{2})\b/);
    if (ageAtMatch) {
      const age = parseInt(ageAtMatch[1], 10);
      if (age >= 18 && age <= 100) {
        ya = Math.max(0, age - metrics.age);
      }
    } else {
      const yearsMatch = text.match(/in\s+(\d{1,2})\s+years?/);
      if (yearsMatch) {
        const ys = parseInt(yearsMatch[1], 10);
        if (ys > 0 && ys <= 60) {
          ya = ys;
        }
      }
    }
    return { overlays: o, yearsAhead: ya };
  }, [latestAssistantText, metrics.age]);

  // Compute aging intensities from baseline behaviours, future-mode multiplier,
  // and any keyword overlays from the live assistant text.
  const isFuture = mode === "future";
  const futureMul = isFuture ? 1.6 : 1;

  const smokingI = clamp01(
    (metrics.smokerStatus === "smoker"
      ? 0.85
      : metrics.smokerStatus === "former"
        ? 0.3
        : 0) *
      futureMul +
      (overlays.smoking ? 0.2 : 0),
  );
  const sleepI = clamp01(
    (metrics.sleep < 6 ? 0.7 : metrics.sleep < 7 ? 0.4 : 0) * futureMul +
      (overlays.sleepDep ? 0.2 : 0),
  );
  const stressI = clamp01(
    (metrics.stress > 7 ? 0.7 : metrics.stress > 5 ? 0.4 : 0) * futureMul +
      (overlays.stress ? 0.2 : 0),
  );
  const sedentaryI = clamp01(
    (metrics.exercise < 2 ? 0.55 : metrics.exercise < 3 ? 0.25 : 0) * futureMul,
  );
  const exerciseBoost = clamp01(
    (metrics.exercise >= 5 ? 0.6 : metrics.exercise >= 3 ? 0.3 : 0) +
      (overlays.exerciseBoost ? 0.2 : 0),
  );
  const grayI = clamp01(
    Math.max(0, (metrics.age - 35) / 50) +
      (isFuture ? 0.45 : 0) +
      smokingI * 0.25,
  );

  // CSS filter string — animatable through `transition: filter ...`.
  const sepia = (smokingI * 0.3).toFixed(2);
  const desat = (sleepI * 0.25 + smokingI * 0.1).toFixed(2);
  const saturate = (1 + exerciseBoost * 0.2 - parseFloat(desat)).toFixed(2);
  const brightness = (1 + exerciseBoost * 0.08 - sleepI * 0.08).toFixed(2);
  const contrast = (1 + stressI * 0.05).toFixed(2);
  const filterStr = `sepia(${sepia}) saturate(${saturate}) brightness(${brightness}) contrast(${contrast})`;

  // Display-age label
  const baseAge = Math.round(metrics.age);
  const projectedAge =
    yearsAhead != null
      ? Math.round(metrics.age + yearsAhead)
      : isFuture
        ? Math.round(metrics.age + 20)
        : baseAge;
  const ageLabel = `You at ${projectedAge}`;

  return (
    <div className={`flex flex-col items-center ${className ?? ""}`}>
      <div className="relative">
        <div
          className="absolute inset-0 -m-6 rounded-full blur-3xl pointer-events-none"
          style={{
            background:
              "radial-gradient(closest-side, rgba(56,189,248,0.18), transparent 70%)",
          }}
        />
        <div className="face-breathe">
          <FaceSVG
            smokingI={smokingI}
            sleepI={sleepI}
            stressI={stressI}
            sedentaryI={sedentaryI}
            exerciseBoost={exerciseBoost}
            grayI={grayI}
            filterStr={filterStr}
          />
        </div>
      </div>

      <div className="mt-4 text-center">
        <div className="text-xs uppercase tracking-[0.25em] text-blue-400 font-semibold">
          Your Digital Twin
        </div>
        <div className="text-xl font-semibold mt-1">{ageLabel}</div>
      </div>

      <button
        type="button"
        onClick={() => setMode((m) => (m === "current" ? "future" : "current"))}
        className="mt-3 px-4 py-2 rounded-full text-sm font-semibold border border-gray-700 bg-gray-900/60 hover:bg-gray-800 hover:border-gray-600 transition"
        aria-pressed={isFuture}
      >
        {isFuture ? "← Back to today" : "See yourself in 20 years →"}
      </button>

      <style jsx>{`
        :global(.face-breathe) {
          animation: breathe 4.5s ease-in-out infinite;
          transform-origin: center 80%;
        }
        @keyframes breathe {
          0%,
          100% {
            transform: translateY(0) scale(1);
          }
          50% {
            transform: translateY(-1.5px) scale(1.008);
          }
        }
      `}</style>
    </div>
  );
}

function FaceSVG({
  smokingI,
  sleepI,
  stressI,
  sedentaryI,
  exerciseBoost,
  grayI,
  filterStr,
}: {
  smokingI: number;
  sleepI: number;
  stressI: number;
  sedentaryI: number;
  exerciseBoost: number;
  grayI: number;
  filterStr: string;
}) {
  // Width modulator — sedentary slightly fills the face; exercise tightens it.
  const widthMod = 1 + sedentaryI * 0.06 - exerciseBoost * 0.02;
  const skinHue = `hsl(28, ${Math.round(38 - sleepI * 12)}%, ${Math.round(
    72 - smokingI * 4 - stressI * 3,
  )}%)`;
  const hairBase = "#3b2f25";
  const grayMix = `rgba(170, 170, 170, ${(grayI * 0.85).toFixed(2)})`;

  return (
    <svg
      width={232}
      height={272}
      viewBox="0 0 232 272"
      className="select-none"
      style={{
        filter: filterStr,
        transition: "filter 1.6s ease",
      }}
      role="img"
      aria-label="Stylised illustration of your face, animated to reflect your health profile"
    >
      <defs>
        <radialGradient id="aura" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="rgba(56,189,248,0.15)" />
          <stop offset="100%" stopColor="rgba(56,189,248,0)" />
        </radialGradient>
        <linearGradient id="skin-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={skinHue} />
          <stop offset="100%" stopColor={skinHue} stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id="cheek-flush" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e57373" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#e57373" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* aura */}
      <circle cx="116" cy="130" r="120" fill="url(#aura)" />

      {/* hair (back) */}
      <path
        d="M 50 75 Q 116 18 182 75 L 178 120 Q 116 92 54 120 Z"
        fill={hairBase}
        style={{ transition: "fill 1.6s ease" }}
      />
      {/* gray streaks (overlay) */}
      <path
        d="M 60 78 Q 90 50 116 60 Q 150 50 178 80 L 176 110 Q 130 90 64 110 Z"
        fill={grayMix}
        style={{ transition: "fill 1.6s ease, opacity 1.6s ease" }}
        opacity={Math.min(1, grayI)}
      />

      {/* face */}
      <ellipse
        cx="116"
        cy="140"
        rx={58 * widthMod}
        ry={72}
        fill="url(#skin-grad)"
        style={{ transition: "rx 1.6s ease" }}
      />

      {/* hair (front) */}
      <path
        d="M 56 95 Q 92 60 116 76 Q 142 60 176 95 L 170 108 Q 116 88 62 108 Z"
        fill={hairBase}
      />

      {/* cheek flush — exercise boost */}
      <g
        style={{ transition: "opacity 1.6s ease" }}
        opacity={exerciseBoost * 0.85}
      >
        <ellipse cx="86" cy="158" rx="13" ry="7" fill="url(#cheek-flush)" />
        <ellipse cx="146" cy="158" rx="13" ry="7" fill="url(#cheek-flush)" />
      </g>

      {/* under-eye dark circles — sleep deprivation */}
      <g
        style={{ transition: "opacity 1.6s ease" }}
        opacity={sleepI * 0.85}
      >
        <ellipse
          cx="94"
          cy="138"
          rx="11"
          ry="3.5"
          fill="rgba(70, 50, 60, 0.55)"
        />
        <ellipse
          cx="138"
          cy="138"
          rx="11"
          ry="3.5"
          fill="rgba(70, 50, 60, 0.55)"
        />
      </g>

      {/* eyebrows — stress raises the inner brow slightly */}
      <path
        d={`M 82 ${118 - stressI * 1.5} Q 94 ${112 - stressI * 1.2} 105 ${
          116 + stressI * 0.5
        }`}
        stroke={hairBase}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        style={{ transition: "d 1.6s ease" }}
      />
      <path
        d={`M 127 ${116 + stressI * 0.5} Q 138 ${112 - stressI * 1.2} 150 ${
          118 - stressI * 1.5
        }`}
        stroke={hairBase}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        style={{ transition: "d 1.6s ease" }}
      />

      {/* eyes (sclera) */}
      <ellipse cx="94" cy="130" rx="7" ry={4.2 - sleepI * 1} fill="#f4f1ec" />
      <ellipse cx="138" cy="130" rx="7" ry={4.2 - sleepI * 1} fill="#f4f1ec" />
      {/* iris */}
      <circle cx="94" cy="130" r="2.6" fill="#3a5b78" />
      <circle cx="138" cy="130" r="2.6" fill="#3a5b78" />
      {/* catchlights — dim under sleep deprivation */}
      <circle
        cx="93"
        cy="129"
        r="0.8"
        fill="white"
        opacity={1 - sleepI * 0.6}
      />
      <circle
        cx="137"
        cy="129"
        r="0.8"
        fill="white"
        opacity={1 - sleepI * 0.6}
      />

      {/* blinking eyelids */}
      <g className="eyelids" fill={skinHue}>
        <ellipse cx="94" cy="130" rx="7.4" ry="4.6" />
        <ellipse cx="138" cy="130" rx="7.4" ry="4.6" />
      </g>

      {/* nose */}
      <path
        d="M 116 142 Q 110 162 116 170 Q 122 162 116 142"
        stroke="rgba(120, 85, 60, 0.6)"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />

      {/* mouth — corners drop with stress */}
      <path
        d={`M 100 ${190 + stressI * 3} Q 116 ${198 - exerciseBoost * 4 + stressI * 4} 132 ${
          190 + stressI * 3
        }`}
        stroke="rgba(140, 60, 60, 0.85)"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
        style={{ transition: "d 1.6s ease" }}
      />

      {/* crow's feet — smoking */}
      <g
        stroke="rgba(120, 85, 60, 0.65)"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
        style={{ transition: "opacity 1.6s ease" }}
        opacity={smokingI * 0.85}
      >
        <path d="M 80 128 L 75 126" />
        <path d="M 80 132 L 75 134" />
        <path d="M 80 136 L 75 140" />
        <path d="M 152 128 L 157 126" />
        <path d="M 152 132 L 157 134" />
        <path d="M 152 136 L 157 140" />
      </g>

      {/* perioral lines — smoking */}
      <g
        stroke="rgba(120, 85, 60, 0.55)"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
        style={{ transition: "opacity 1.6s ease" }}
        opacity={smokingI * 0.75}
      >
        <path d="M 100 184 L 96 178" />
        <path d="M 105 188 L 102 180" />
        <path d="M 132 184 L 136 178" />
        <path d="M 127 188 L 130 180" />
      </g>

      {/* nasolabial folds — sedentary + smoking */}
      <g
        stroke="rgba(120, 85, 60, 0.45)"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        style={{ transition: "opacity 1.6s ease" }}
        opacity={Math.min(1, smokingI * 0.6 + sedentaryI * 0.5)}
      >
        <path d="M 102 168 Q 99 180 102 192" />
        <path d="M 130 168 Q 133 180 130 192" />
      </g>

      {/* forehead lines — stress */}
      <g
        stroke="rgba(120, 85, 60, 0.55)"
        strokeWidth="1.1"
        fill="none"
        strokeLinecap="round"
        style={{ transition: "opacity 1.6s ease" }}
        opacity={stressI * 0.85}
      >
        <path d="M 84 102 Q 116 96 148 102" />
        <path d="M 86 110 Q 116 105 146 110" />
        <path d="M 110 96 L 110 90" />
        <path d="M 122 96 L 122 90" />
      </g>

      <style>{`
        @keyframes blink {
          0%, 92%, 100% { transform: scaleY(0); }
          94%, 96% { transform: scaleY(1); }
        }
        .eyelids ellipse {
          transform-origin: center;
          transform: scaleY(0);
          animation: blink 4.2s infinite;
        }
        .eyelids ellipse:nth-child(2) {
          animation-delay: 0.04s;
        }
      `}</style>
    </svg>
  );
}
