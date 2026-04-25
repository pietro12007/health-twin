"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Send,
  TrendingUp,
  TrendingDown,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  computeHealthScore,
  computeRisks,
  type Metrics,
} from "@/lib/health-metrics";

// Local simulator state shape — numeric on the inside; the boundary adapter
// in page.tsx converts our string-keyed HealthData into this.
export interface SimulatorHealthData {
  age: number;
  heartRate: number;
  sleep: number;
  exercise: number;
  stress: number;
  smoker: string;
}

interface BehaviorSimulatorProps {
  healthData: SimulatorHealthData;
  onSendMessage: (message: string) => void;
}

// ─── Utility helpers ────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function getRiskColor(val: number): string {
  if (val < 20) return "#22c55e";
  if (val < 40) return "#84cc16";
  if (val < 60) return "#f59e0b";
  if (val < 75) return "#f97316";
  return "#ef4444";
}

function getRiskLabel(val: number): string {
  if (val < 20) return "Low";
  if (val < 40) return "Moderate";
  if (val < 60) return "Elevated";
  if (val < 75) return "High";
  return "Critical";
}

function getScoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 65) return "#84cc16";
  if (score >= 50) return "#f59e0b";
  if (score >= 35) return "#f97316";
  return "#ef4444";
}

function getScoreLabel(score: number): string {
  if (score >= 85) return "Optimal";
  if (score >= 70) return "Good";
  if (score >= 55) return "Fair";
  if (score >= 40) return "At Risk";
  return "Critical";
}

// Local → shared Metrics adapter (runs on every change for live recompute).
function toMetrics(d: SimulatorHealthData): Metrics {
  let smokerStatus: Metrics["smokerStatus"] = "unknown";
  if (d.smoker === "Yes") smokerStatus = "smoker";
  else if (d.smoker === "Former smoker") smokerStatus = "former";
  else if (d.smoker === "No") smokerStatus = "non-smoker";
  return {
    age: d.age,
    heartRate: d.heartRate,
    sleep: d.sleep,
    exercise: d.exercise,
    stress: d.stress,
    smokerStatus,
  };
}

// ─── Animated counter ────────────────────────────────────────────────────────

function useAnimatedValue(target: number, duration = 450) {
  const [value, setValue] = useState(target);
  const rafRef = useRef<number>(0);
  const prevRef = useRef(target);

  useEffect(() => {
    const start = prevRef.current;
    const end = target;
    const startTime = performance.now();

    cancelAnimationFrame(rafRef.current);

    const step = (now: number) => {
      const t = clamp((now - startTime) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setValue(lerp(start, end, eased));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else prevRef.current = end;
    };

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
}: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  const animated = useAnimatedValue(value);
  return (
    <>
      {animated.toFixed(decimals)}
      {suffix}
    </>
  );
}

// ─── Healthy-years stat (simulator-local — distinct from health score) ─────

function calculateYearsDelta(d: SimulatorHealthData): number {
  let years = 0;
  if (d.sleep >= 7 && d.sleep <= 9) years += 2.5;
  else if (d.sleep < 6) years -= 2.5;
  else if (d.sleep > 9) years -= 1;
  if (d.exercise >= 5) years += 3;
  else if (d.exercise >= 3) years += 1.5;
  else if (d.exercise < 1) years -= 2;
  if (d.stress <= 3) years += 2;
  else if (d.stress > 7) years -= 2;
  if (d.smoker === "Yes") years -= 5;
  else if (d.smoker === "Former smoker") years -= 1;
  else years += 1.5;
  if (d.heartRate < 65) years += 1;
  else if (d.heartRate > 85) years -= 1;
  return parseFloat(years.toFixed(1));
}

// ─── Slider component ────────────────────────────────────────────────────────

interface SliderProps {
  label: string;
  icon: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  color: string;
  tooltip: string;
  research: string;
  onChange: (val: number) => void;
}

function Slider({
  label,
  icon,
  value,
  min,
  max,
  step,
  display,
  color,
  tooltip,
  research,
  onChange,
}: SliderProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="text-sm font-semibold text-white">{label}</span>
          <button
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            className="text-white/20 hover:text-white/60 transition-colors"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4M12 8h.01" />
            </svg>
          </button>
        </div>
        <span
          className="text-xs font-bold px-3 py-1 rounded-full transition-all duration-300"
          style={{ background: color + "22", color }}
        >
          {display}
        </span>
      </div>

      {showTooltip && (
        <div
          className="mb-2 p-3 rounded-xl text-xs text-white/70 leading-relaxed"
          style={{
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.2)",
          }}
        >
          {tooltip}
        </div>
      )}

      <div className="relative py-2">
        <div
          className="w-full h-2 rounded-full overflow-hidden"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-150"
            style={{
              width: `${pct}%`,
              background: `linear-gradient(to right, ${color}88, ${color})`,
            }}
          />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
          style={{ margin: 0 }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border-2 border-white shadow-lg transition-all duration-150 pointer-events-none"
          style={{
            left: `calc(${pct}% - 10px)`,
            background: color,
            boxShadow: `0 0 12px ${color}88`,
          }}
        />
      </div>

      <div className="flex justify-between text-xs text-white/20 mt-1 px-1">
        <span>{min}</span>
        <span className="text-white/30 text-center flex-1 px-2 truncate">
          {research}
        </span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ─── Risk bar ────────────────────────────────────────────────────────────────

function RiskBar({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: number;
  tooltip: string;
}) {
  const animated = useAnimatedValue(value);
  const color = getRiskColor(value);
  const riskLabel = getRiskLabel(value);

  return (
    <div className="group/risk">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-white/70">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-xs px-2 py-0.5 rounded-full font-bold"
            style={{ background: color + "22", color }}
          >
            {riskLabel}
          </span>
          <span
            className="text-xs font-bold tabular-nums"
            style={{ color, minWidth: 42, textAlign: "right" }}
          >
            <AnimatedNumber value={value} decimals={1} suffix="%" />
          </span>
        </div>
      </div>
      <div
        className="w-full h-2 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.06)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${animated}%`,
            background: `linear-gradient(to right, ${color}88, ${color})`,
            transition: "width 0.5s ease",
          }}
        />
      </div>
      <p className="text-xs text-white/20 mt-1 group-hover/risk:text-white/40 transition-colors">
        {tooltip}
      </p>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function BehaviorSimulator({
  healthData,
  onSendMessage,
}: BehaviorSimulatorProps) {
  const [data, setData] = useState<SimulatorHealthData>(healthData);
  const [sent, setSent] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [compareData, setCompareData] = useState<SimulatorHealthData | null>(
    null,
  );

  // Resync local state when the parent's healthData prop changes (e.g. on
  // restart). The user mutates `data` locally via the sliders; parent updates
  // are an external input that needs to overwrite that local state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(healthData);
  }, [healthData]);

  const metrics = useMemo(() => toMetrics(data), [data]);
  const risks = useMemo(() => computeRisks(metrics), [metrics]);
  const score = useMemo(() => computeHealthScore(metrics), [metrics]);
  const yearsDelta = useMemo(() => calculateYearsDelta(data), [data]);
  const scoreLabel = getScoreLabel(score);

  const compareMetrics = useMemo(
    () => (compareData ? toMetrics(compareData) : null),
    [compareData],
  );
  const compareScore = useMemo(
    () => (compareMetrics ? computeHealthScore(compareMetrics) : null),
    [compareMetrics],
  );

  const animatedScore = useAnimatedValue(score);
  const scoreColor = getScoreColor(score);
  const circumference = 2 * Math.PI * 54;
  const strokeDashoffset = circumference - (animatedScore / 100) * circumference;

  const opportunities = useMemo(() => {
    const ops: { action: string; gain: string; priority: number }[] = [];
    if (data.smoker === "Yes")
      ops.push({
        action: "Quit smoking",
        gain: "+10 years, -42% cardiovascular risk",
        priority: 5,
      });
    if (data.sleep < 6.5)
      ops.push({
        action: `Sleep ${(data.sleep + 1).toFixed(1)}+ hours`,
        gain: "-20% diabetes risk, -18% Alzheimer's risk",
        priority: 4,
      });
    if (data.exercise < 3)
      ops.push({
        action: `Exercise ${(data.exercise + 2).toFixed(1)} days/week`,
        gain: "-28% Alzheimer's risk, -22% diabetes risk",
        priority: 4,
      });
    if (data.stress > 6)
      ops.push({
        action: `Reduce stress to ${(data.stress - 2).toFixed(1)}/10`,
        gain: "-20% cardiovascular risk, -18% Alzheimer's risk",
        priority: 3,
      });
    if (data.heartRate > 80)
      ops.push({
        action: `Lower resting HR to ${data.heartRate - 10} bpm`,
        gain: "-14% stroke risk",
        priority: 2,
      });
    return ops.sort((a, b) => b.priority - a.priority).slice(0, 2);
  }, [data]);

  const handleSet = useCallback(
    (key: keyof SimulatorHealthData, val: number | string) => {
      setData((prev) => ({ ...prev, [key]: val }));
    },
    [],
  );

  const handleSend = () => {
    const msg = `Simulate my future health with these exact parameters: sleep ${data.sleep.toFixed(
      1,
    )} hours/night, exercise ${data.exercise.toFixed(
      1,
    )} days/week, stress ${data.stress.toFixed(1)}/10, smoking: ${
      data.smoker
    }, resting heart rate: ${data.heartRate} bpm. Give me a deeply detailed, evidence-based projection at 5, 10, and 20 years. Include specific risks, what I will physically feel, cognitive changes, cardiovascular markers, and what one further change would most improve my trajectory. Speak as my future self.`;
    onSendMessage(msg);
    setSent(true);
    if (!compareData) setCompareData(data);
    setTimeout(() => setSent(false), 3000);
  };

  const sliders: SliderProps[] = [
    {
      label: "Sleep",
      icon: "🌙",
      value: data.sleep,
      min: 4,
      max: 10,
      step: 0.5,
      display: `${data.sleep.toFixed(1)}h/night`,
      color:
        data.sleep >= 7 && data.sleep <= 9
          ? "#22c55e"
          : data.sleep >= 6
            ? "#f59e0b"
            : "#ef4444",
      tooltip: "Hover to see research. Optimal window is 7–9 hours.",
      research: "<6h → +37% diabetes risk (Harvard)",
      onChange: (v) => handleSet("sleep", v),
    },
    {
      label: "Exercise",
      icon: "⚡",
      value: data.exercise,
      min: 0,
      max: 7,
      step: 0.5,
      display: `${data.exercise.toFixed(1)} days/wk`,
      color:
        data.exercise >= 4
          ? "#22c55e"
          : data.exercise >= 2
            ? "#f59e0b"
            : "#ef4444",
      tooltip:
        "150 min/week reduces heart disease by 35% (WHO). 300 min/week reduces Alzheimer's risk by 45% (Lancet).",
      research: "4+ days → -45% Alzheimer's (Lancet)",
      onChange: (v) => handleSet("exercise", v),
    },
    {
      label: "Stress Level",
      icon: "🧠",
      value: data.stress,
      min: 1,
      max: 10,
      step: 0.5,
      display: `${data.stress.toFixed(1)}/10`,
      color:
        data.stress <= 3
          ? "#22c55e"
          : data.stress <= 6
            ? "#f59e0b"
            : "#ef4444",
      tooltip:
        "Chronic stress above 7 increases heart disease risk by 40% (AIS). 10min daily meditation reduces cortisol by 23% (Johns Hopkins).",
      research: ">7 stress → +40% heart disease (AIS)",
      onChange: (v) => handleSet("stress", v),
    },
    {
      label: "Resting Heart Rate",
      icon: "❤️",
      value: data.heartRate,
      min: 50,
      max: 100,
      step: 1,
      display: `${Math.round(data.heartRate)} bpm`,
      color:
        data.heartRate <= 65
          ? "#22c55e"
          : data.heartRate <= 80
            ? "#f59e0b"
            : "#ef4444",
      tooltip:
        "Every 10 bpm above 60 increases cardiovascular mortality by 18% (European Heart Journal). Athletes average 40–60 bpm.",
      research: "Every +10bpm → +18% CV mortality (EHJ)",
      onChange: (v) => handleSet("heartRate", v),
    },
  ];

  const riskItems = [
    {
      label: "Cardiovascular Disease",
      value: risks.cardiovascular,
      tooltip:
        "AHA 2023: Smoking 2–4x risk. Exercise -35%. Mediterranean diet -30%.",
    },
    {
      label: "Type 2 Diabetes",
      value: risks.diabetes,
      tooltip:
        "Harvard: <6h sleep +37%. Strength training -34% (Harvard T.H. Chan).",
    },
    {
      label: "Alzheimer's Disease",
      value: risks.alzheimers,
      tooltip:
        "Lancet Commission: Exercise -45%. Poor sleep 5x amyloid buildup (NIH).",
    },
    {
      label: "Metabolic Syndrome",
      value: risks.metabolicSyndrome,
      tooltip: "WHO: Sedentary lifestyle +30% all-cause mortality.",
    },
    {
      label: "Stroke Risk",
      value: risks.stroke,
      tooltip:
        "AHA/ASA: Smoking +30% stroke risk. Exercise -20% with 150 min/wk.",
    },
  ];

  return (
    <div
      className="w-full mt-8 rounded-3xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.03)",
        backdropFilter: "blur(24px)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Header */}
      <div className="px-8 pt-8 pb-5 border-b border-white/5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-3">
              <span>Behavior Simulator</span>
              <span
                className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{
                  background: "rgba(59,130,246,0.15)",
                  color: "#60a5fa",
                  border: "1px solid rgba(59,130,246,0.25)",
                }}
              >
                LIVE
              </span>
            </h2>
            <p className="text-sm text-white/35 mt-1">
              Drag sliders to see your future health change in real time.
              Powered by clinical research.
            </p>
          </div>
          {compareData && (
            <button
              onClick={() => setShowComparison(!showComparison)}
              className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl transition-all"
              style={{
                background: "rgba(59,130,246,0.1)",
                color: "#60a5fa",
                border: "1px solid rgba(59,130,246,0.2)",
              }}
            >
              Compare{" "}
              {showComparison ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* LEFT — Sliders */}
        <div className="p-8 space-y-8 border-r border-white/5">
          {sliders.map((s) => (
            <Slider key={s.label} {...s} />
          ))}

          {/* Smoking toggle */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🚬</span>
              <span className="text-sm font-semibold text-white">Smoking</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["No", "Former smoker", "Yes"] as const).map((opt) => {
                const colors: Record<string, string> = {
                  No: "#22c55e",
                  "Former smoker": "#f59e0b",
                  Yes: "#ef4444",
                };
                const active = data.smoker === opt;
                return (
                  <button
                    key={opt}
                    onClick={() => handleSet("smoker", opt)}
                    className="py-3 rounded-2xl text-xs font-bold transition-all duration-200"
                    style={{
                      background: active
                        ? colors[opt] + "25"
                        : "rgba(255,255,255,0.04)",
                      border: `1.5px solid ${
                        active ? colors[opt] : "rgba(255,255,255,0.08)"
                      }`,
                      color: active ? colors[opt] : "rgba(255,255,255,0.3)",
                      transform: active ? "scale(1.03)" : "scale(1)",
                    }}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-white/20 mt-2">
              Smoking increases cardiovascular risk by 2–4x and reduces life
              expectancy by up to 10 years (AHA 2023)
            </p>
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            className="w-full py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-300 active:scale-95"
            style={{
              background: sent ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.7)",
              border: `1.5px solid ${sent ? "#22c55e" : "rgba(59,130,246,0.4)"}`,
              color: "white",
              boxShadow: sent
                ? "0 0 20px rgba(34,197,94,0.2)"
                : "0 0 20px rgba(59,130,246,0.2)",
            }}
          >
            {sent ? (
              <>
                <span>✓</span> Sent to your Twin!
              </>
            ) : (
              <>
                <Send size={15} /> Ask my Twin about these changes
              </>
            )}
          </button>
        </div>

        {/* RIGHT — Live metrics */}
        <div className="p-8 flex flex-col gap-8">
          {/* Score ring */}
          <div className="flex items-center gap-6">
            <div className="relative shrink-0 w-32 h-32">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="11"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="54"
                  fill="none"
                  stroke={scoreColor}
                  strokeWidth="11"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  style={{
                    transition:
                      "stroke-dashoffset 0.55s cubic-bezier(.4,0,.2,1), stroke 0.55s ease",
                  }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-4xl font-black text-white tabular-nums">
                  <AnimatedNumber value={score} />
                </span>
                <span className="text-xs text-white/30">/100</span>
              </div>
            </div>

            <div className="flex-1">
              <p className="text-2xl font-bold" style={{ color: scoreColor }}>
                {scoreLabel}
              </p>
              <p className="text-sm text-white/40 mt-1">Overall health score</p>
              <div className="mt-3 flex items-center gap-2">
                {yearsDelta >= 0 ? (
                  <TrendingUp size={14} style={{ color: "#22c55e" }} />
                ) : (
                  <TrendingDown size={14} style={{ color: "#ef4444" }} />
                )}
                <span
                  className="text-sm font-bold"
                  style={{ color: yearsDelta >= 0 ? "#22c55e" : "#ef4444" }}
                >
                  {yearsDelta >= 0 ? "+" : ""}
                  {yearsDelta} healthy years
                </span>
              </div>
              <p className="text-xs text-white/25 mt-1">
                vs. population average
              </p>
            </div>
          </div>

          {/* Comparison panel */}
          {showComparison && compareScore !== null && (
            <div
              className="rounded-2xl p-4 space-y-2"
              style={{
                background: "rgba(59,130,246,0.06)",
                border: "1px solid rgba(59,130,246,0.15)",
              }}
            >
              <p className="text-xs font-bold text-blue-400 mb-3">
                Score Comparison
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/50">Before changes</span>
                <span
                  className="text-sm font-bold"
                  style={{ color: getScoreColor(compareScore) }}
                >
                  {compareScore}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/50">After changes</span>
                <span className="text-sm font-bold" style={{ color: scoreColor }}>
                  {score}
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <span className="text-xs font-bold text-white/70">
                  Difference
                </span>
                <span
                  className="text-sm font-black"
                  style={{
                    color: score >= compareScore ? "#22c55e" : "#ef4444",
                  }}
                >
                  {score >= compareScore ? "+" : ""}
                  {score - compareScore} points
                </span>
              </div>
            </div>
          )}

          {/* Risk bars */}
          <div className="space-y-5">
            <p className="text-xs font-bold text-white/30 uppercase tracking-widest">
              Disease Risk Indicators
            </p>
            {riskItems.map(({ label, value, tooltip }) => (
              <RiskBar
                key={label}
                label={label}
                value={value}
                tooltip={tooltip}
              />
            ))}
          </div>

          {/* Opportunities */}
          {opportunities.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-bold text-white/30 uppercase tracking-widest">
                Top Opportunities
              </p>
              {opportunities.map((op, i) => (
                <div
                  key={i}
                  className="rounded-2xl p-4"
                  style={{
                    background:
                      i === 0
                        ? "rgba(59,130,246,0.08)"
                        : "rgba(255,255,255,0.03)",
                    border: `1px solid ${
                      i === 0
                        ? "rgba(59,130,246,0.2)"
                        : "rgba(255,255,255,0.06)"
                    }`,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <Sparkles
                      size={14}
                      className="mt-0.5 shrink-0"
                      style={{ color: i === 0 ? "#60a5fa" : "#a3a3a3" }}
                    />
                    <div>
                      <p className="text-xs font-bold text-white">{op.action}</p>
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: i === 0 ? "#93c5fd" : "#737373" }}
                      >
                        {op.gain}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
