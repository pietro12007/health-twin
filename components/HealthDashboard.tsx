"use client";

import { useEffect, useState } from "react";
import {
  computeHealthScore,
  computeRisks,
  deriveMetrics,
  projectTrajectory,
  riskColor,
  RISK_LABELS,
  scoreBand,
  type DiseaseRisks,
  type RiskKey,
  type TrajectoryPoint,
  type BestChange,
} from "@/lib/health-metrics";
import type { HealthData } from "@/lib/health-types";

type Props = {
  healthData: HealthData;
  onContinue: () => void;
};

export default function HealthDashboard({ healthData, onContinue }: Props) {
  const metrics = deriveMetrics(healthData);
  const score = computeHealthScore(metrics);
  const risks = computeRisks(metrics);
  const { points, bestChange } = projectTrajectory(metrics);
  const band = scoreBand(score);

  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-6 py-10 md:py-14">
        <Header score={score} band={band} />

        <div className="grid lg:grid-cols-[auto_1fr] gap-8 lg:gap-12 items-start mt-8">
          <div className="reveal" style={{ animationDelay: "200ms" }}>
            <ScoreRing score={score} band={band} />
          </div>

          <div className="reveal" style={{ animationDelay: "500ms" }}>
            <RiskPanel risks={risks} />
          </div>
        </div>

        <div className="reveal mt-10" style={{ animationDelay: "900ms" }}>
          <TrajectoryChart points={points} bestChange={bestChange} />
        </div>

        <div className="reveal mt-8" style={{ animationDelay: "1200ms" }}>
          <ImpactPanel bestChange={bestChange} />
        </div>

        <div
          className="reveal mt-10 flex flex-col items-center gap-3"
          style={{ animationDelay: "1500ms" }}
        >
          <button
            onClick={onContinue}
            className="px-8 py-4 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-400 hover:to-cyan-400 text-white font-semibold text-lg shadow-lg shadow-blue-500/30 transition-all hover:shadow-blue-400/50 hover:scale-[1.02]"
          >
            Talk to your Digital Twin →
          </button>
          <p className="text-xs text-gray-500 text-center max-w-xl">
            Illustrative model for demonstration — not a clinically validated
            risk calculator. Numbers are derived from your inputs and a
            simplified evidence-informed scoring rubric, not from a peer-reviewed
            instrument such as ACC/AHA, Framingham, QRISK3, SCORE2, or FINDRISC.
          </p>
        </div>
      </div>

      <style jsx>{`
        :global(.reveal) {
          opacity: 0;
          transform: translateY(16px);
          animation: reveal 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        @keyframes reveal {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </main>
  );
}

function Header({
  score,
  band,
}: {
  score: number;
  band: ReturnType<typeof scoreBand>;
}) {
  return (
    <div className="reveal" style={{ animationDelay: "0ms" }}>
      <p className="text-xs uppercase tracking-[0.2em] text-blue-400 font-semibold">
        Your Digital Twin
      </p>
      <h1 className="text-3xl md:text-4xl font-bold mt-2">
        Health Snapshot
        <span className="text-gray-500 font-normal">
          {" · "}
          <span style={{ color: band.color }}>{band.label}</span>
        </span>
      </h1>
      <p className="text-gray-400 mt-2 max-w-2xl">
        A composite read of where you stand today across sleep, movement,
        stress, cardiac load, and tobacco exposure — and where each lever can
        take you.
      </p>
      <span className="sr-only">Computed score: {score}</span>
    </div>
  );
}

function ScoreRing({
  score,
  band,
}: {
  score: number;
  band: ReturnType<typeof scoreBand>;
}) {
  const radius = 92;
  const stroke = 14;
  const circ = 2 * Math.PI * radius;

  // Animate the ring fill on mount
  const [ringValue, setRingValue] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setRingValue(score), 60);

    let raf = 0;
    const start = performance.now();
    const dur = 1500;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayScore(Math.round(eased * score));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [score]);

  const offset = circ * (1 - ringValue / 100);
  const size = 232;
  const center = size / 2;

  return (
    <div className="relative w-[232px] h-[232px] flex items-center justify-center">
      <div
        className="absolute inset-0 rounded-full blur-3xl opacity-60"
        style={{ background: `radial-gradient(closest-side, ${band.color}33, transparent 70%)` }}
      />
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="relative">
        <defs>
          <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={band.color} stopOpacity="0.55" />
            <stop offset="100%" stopColor={band.color} />
          </linearGradient>
          <filter id="ring-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="#1f2937"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="url(#ring-gradient)"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{
            transition:
              "stroke-dashoffset 1.5s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          filter="url(#ring-glow)"
        />
      </svg>
      <div className="absolute flex flex-col items-center pointer-events-none">
        <div className="text-7xl font-bold tabular-nums leading-none">
          {displayScore}
        </div>
        <div className="text-[11px] tracking-[0.25em] uppercase text-gray-400 mt-2">
          Health Score
        </div>
        <div
          className="mt-3 px-3 py-1 rounded-full text-xs font-semibold"
          style={{
            color: band.color,
            backgroundColor: `${band.color}1a`,
            border: `1px solid ${band.color}33`,
          }}
        >
          {band.label}
        </div>
      </div>
    </div>
  );
}

function RiskPanel({ risks }: { risks: DiseaseRisks }) {
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 700);
    return () => clearTimeout(t);
  }, []);

  const order: RiskKey[] = [
    "cardiovascular",
    "diabetes",
    "alzheimers",
    "metabolicSyndrome",
    "stroke",
  ];

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 backdrop-blur p-6 shadow-xl shadow-blue-500/5">
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="text-lg font-semibold">Disease risk indicators</h2>
        <span className="text-xs text-gray-500">{"Today's profile"}</span>
      </div>
      <div className="space-y-4">
        {order.map((k, i) => (
          <RiskBar
            key={k}
            label={RISK_LABELS[k]}
            value={risks[k]}
            animated={animated}
            delay={i * 120}
          />
        ))}
      </div>
    </div>
  );
}

function RiskBar({
  label,
  value,
  animated,
  delay,
}: {
  label: string;
  value: number;
  animated: boolean;
  delay: number;
}) {
  const color = riskColor(value);
  const [displayVal, setDisplayVal] = useState(0);

  useEffect(() => {
    if (!animated) return;
    let raf = 0;
    const start = performance.now() + delay;
    const dur = 1200;
    const tick = (now: number) => {
      if (now < start) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayVal(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animated, value, delay]);

  const fillWidth = animated ? `${value}%` : "0%";

  return (
    <div>
      <div className="flex justify-between mb-1.5">
        <span className="text-sm text-gray-300">{label}</span>
        <span
          className="text-sm font-semibold tabular-nums"
          style={{ color }}
        >
          {displayVal}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: fillWidth,
            background: `linear-gradient(90deg, ${color}66, ${color})`,
            transition: `width 1.4s cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
            boxShadow: `0 0 12px ${color}80`,
          }}
        />
      </div>
    </div>
  );
}

function TrajectoryChart({
  points,
  bestChange,
}: {
  points: TrajectoryPoint[];
  bestChange: BestChange;
}) {
  const W = 720;
  const H = 260;
  const padX = 56;
  const padTop = 24;
  const padBottom = 56;
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;

  const xFor = (years: number) => padX + (years / 20) * innerW;
  const yFor = (s: number) => padTop + (1 - s / 100) * innerH;

  const currentPath = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xFor(p.yearsFromNow).toFixed(2)} ${yFor(
          p.current,
        ).toFixed(2)}`,
    )
    .join(" ");
  const optPath = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${xFor(p.yearsFromNow).toFixed(2)} ${yFor(
          p.optimized,
        ).toFixed(2)}`,
    )
    .join(" ");

  // Filled area between optimized (top) and current (bottom) — the "potential gain"
  const gainArea = `${optPath} ${[...points]
    .reverse()
    .map((p) => `L ${xFor(p.yearsFromNow).toFixed(2)} ${yFor(p.current).toFixed(2)}`)
    .join(" ")} Z`;

  const lastIdx = points.length - 1;
  const last = points[lastIdx];
  const gap20y = Math.max(0, last.optimized - last.current);
  const showGain = gap20y > 1 && bestChange.key !== "none";

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 backdrop-blur p-6 shadow-xl shadow-blue-500/5">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-semibold">20-year trajectory</h2>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-amber-400" />
            <span className="text-gray-300">Current trajectory</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-[2px] bg-emerald-400" />
            <span className="text-gray-300">Optimised trajectory</span>
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="gain-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
          </linearGradient>
          <filter id="line-glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* gridlines */}
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line
              x1={padX}
              y1={yFor(g)}
              x2={W - padX}
              y2={yFor(g)}
              stroke="#1f2937"
              strokeDasharray="3 4"
            />
            <text
              x={padX - 10}
              y={yFor(g) + 4}
              textAnchor="end"
              className="fill-gray-500"
              fontSize="11"
            >
              {g}
            </text>
          </g>
        ))}

        {showGain && <path d={gainArea} fill="url(#gain-fill)" />}

        {/* Lines */}
        <path
          d={currentPath}
          stroke="#f59e0b"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#line-glow)"
          className="trajectory-line current"
        />
        <path
          d={optPath}
          stroke="#22c55e"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#line-glow)"
          className="trajectory-line optimised"
        />

        {/* Points */}
        {points.map((p) => (
          <g key={p.yearsFromNow}>
            <circle
              cx={xFor(p.yearsFromNow)}
              cy={yFor(p.current)}
              r="4"
              fill="#f59e0b"
              stroke="#0a0a0a"
              strokeWidth="2"
            />
            <circle
              cx={xFor(p.yearsFromNow)}
              cy={yFor(p.optimized)}
              r="4"
              fill="#22c55e"
              stroke="#0a0a0a"
              strokeWidth="2"
            />
            <text
              x={xFor(p.yearsFromNow)}
              y={H - padBottom + 22}
              textAnchor="middle"
              fontSize="12"
              className="fill-gray-300 font-semibold"
            >
              {p.yearsFromNow === 0 ? "Today" : `+${p.yearsFromNow}y`}
            </text>
            <text
              x={xFor(p.yearsFromNow)}
              y={H - padBottom + 38}
              textAnchor="middle"
              fontSize="10"
              className="fill-gray-500"
            >
              age {p.ageAtTime}
            </text>
          </g>
        ))}

        {/* Potential-gain annotation */}
        {showGain && (
          <g>
            <line
              x1={xFor(last.yearsFromNow) - 18}
              y1={yFor(last.optimized)}
              x2={xFor(last.yearsFromNow) - 18}
              y2={yFor(last.current)}
              stroke="#22c55e"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
            <text
              x={xFor(last.yearsFromNow) - 28}
              y={(yFor(last.optimized) + yFor(last.current)) / 2}
              textAnchor="end"
              fontSize="11"
              className="fill-emerald-300 font-semibold"
            >
              +{Math.round(gap20y)} pts
            </text>
            <text
              x={xFor(last.yearsFromNow) - 28}
              y={(yFor(last.optimized) + yFor(last.current)) / 2 + 13}
              textAnchor="end"
              fontSize="10"
              className="fill-emerald-400/70"
            >
              your potential gain
            </text>
          </g>
        )}
      </svg>

      <style jsx>{`
        :global(.trajectory-line) {
          stroke-dasharray: 1500;
          stroke-dashoffset: 1500;
          animation: draw 1.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        :global(.trajectory-line.optimised) {
          animation-delay: 0.4s;
        }
        @keyframes draw {
          to {
            stroke-dashoffset: 0;
          }
        }
      `}</style>
    </div>
  );
}

function ImpactPanel({ bestChange }: { bestChange: BestChange }) {
  if (bestChange.key === "none") {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-transparent p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-400 font-semibold">
          Single biggest lever
        </p>
        <h3 className="text-2xl font-bold mt-2">
          {"You're already in great shape — keep it up."}
        </h3>
        <p className="text-gray-400 mt-2">
          {
            "Your habits across sleep, movement, stress, cardiac load, and tobacco look strong. Maintain the routine and we'll keep an eye on drift."
          }
        </p>
      </div>
    );
  }

  const reduction = bestChange.beforePct - bestChange.afterPct;
  return (
    <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-cyan-500/5 to-transparent p-6 md:p-8 shadow-xl shadow-blue-500/10">
      <p className="text-xs uppercase tracking-[0.2em] text-blue-400 font-semibold">
        Your single biggest lever
      </p>
      <h3 className="text-2xl md:text-3xl font-bold mt-2 leading-tight">
        If you {bestChange.actionLabel}, {bestChange.diseaseLabel} could fall
        from{" "}
        <span className="text-amber-400 tabular-nums">
          {bestChange.beforePct}%
        </span>{" "}
        to{" "}
        <span className="text-emerald-400 tabular-nums">
          {bestChange.afterPct}%
        </span>{" "}
        over five years.
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <BeforeAfterStat
          label="Today's risk"
          value={`${bestChange.beforePct}%`}
          color="#f59e0b"
        />
        <ArrowDelta delta={reduction} />
        <BeforeAfterStat
          label="With this change"
          value={`${bestChange.afterPct}%`}
          color="#22c55e"
        />
      </div>

      <p className="text-sm text-gray-400 mt-6">
        Your overall health score would lift from{" "}
        <span className="text-white font-semibold tabular-nums">
          {bestChange.scoreBefore}
        </span>{" "}
        to{" "}
        <span className="text-emerald-400 font-semibold tabular-nums">
          {bestChange.scoreAfter}
        </span>
        .
      </p>
    </div>
  );
}

function BeforeAfterStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">
        {label}
      </div>
      <div
        className="text-3xl md:text-4xl font-bold tabular-nums mt-1"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}

function ArrowDelta({ delta }: { delta: number }) {
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex flex-col items-center justify-center">
      <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-400">
        Reduction
      </div>
      <div className="flex items-center gap-2 mt-1">
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 text-emerald-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="13 6 19 12 13 18" />
        </svg>
        <span className="text-2xl md:text-3xl font-bold text-emerald-400 tabular-nums">
          −{delta} pts
        </span>
      </div>
    </div>
  );
}
