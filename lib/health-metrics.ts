import type { HealthData } from "./health-types";

// -------------------------------------------------------------------
// IMPORTANT: The numeric coefficients below are *illustrative* values
// for demo purposes. They are NOT a validated clinical risk model.
// Real cardiovascular / diabetes / dementia risk should use peer-reviewed
// instruments such as ACC/AHA Pooled Cohort Equations, Framingham, QRISK3,
// SCORE2, and FINDRISC.
// -------------------------------------------------------------------

export type SmokerStatus = "smoker" | "former" | "non-smoker" | "unknown";

export type Metrics = {
  age: number;
  heartRate: number;
  sleep: number;
  exercise: number;
  stress: number;
  smokerStatus: SmokerStatus;
};

function clampNumber(
  v: number,
  lo: number,
  hi: number,
  fallback: number,
): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

export function deriveMetrics(d: HealthData): Metrics {
  const age = clampNumber(parseFloat(d.age), 5, 120, 35);
  const heartRate = clampNumber(parseFloat(d.heartRate), 30, 220, 70);
  const sleep = clampNumber(parseFloat(d.sleep), 0, 24, 7);
  const exercise = clampNumber(parseFloat(d.exercise), 0, 7, 3);
  const stress = clampNumber(parseFloat(d.stress), 1, 10, 5);

  const s = (d.smoker || "").toLowerCase().trim();
  let smokerStatus: SmokerStatus = "unknown";
  if (s.includes("former")) smokerStatus = "former";
  else if (
    s === "yes" ||
    s.startsWith("yes") ||
    (s.includes("smoker") && !s.includes("non") && !s.includes("former"))
  )
    smokerStatus = "smoker";
  else if (s === "no" || s.startsWith("no") || s.includes("non"))
    smokerStatus = "non-smoker";

  return { age, heartRate, sleep, exercise, stress, smokerStatus };
}

// -------------------------------------------------------------------
// Health score (0–100). Five factors, max 20 points each.
// -------------------------------------------------------------------

export function computeHealthScore(m: Metrics): number {
  let score = 0;

  if (m.sleep >= 7 && m.sleep <= 9) score += 20;
  else if (m.sleep >= 6 && m.sleep < 7) score += 12;

  if (m.exercise >= 5) score += 20;
  else if (m.exercise >= 3) score += 14;
  else if (m.exercise >= 1) score += 7;

  if (m.stress >= 1 && m.stress <= 3) score += 20;
  else if (m.stress >= 4 && m.stress <= 6) score += 12;
  else if (m.stress >= 7 && m.stress <= 8) score += 5;

  if (m.heartRate >= 55 && m.heartRate <= 70) score += 20;
  else if (m.heartRate >= 71 && m.heartRate <= 80) score += 14;
  else if (m.heartRate >= 81 && m.heartRate <= 90) score += 7;

  if (m.smokerStatus === "non-smoker") score += 20;
  else if (m.smokerStatus === "former") score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreBand(score: number): {
  label: string;
  color: string;
  band: "critical" | "attention" | "good" | "optimal";
} {
  if (score <= 40)
    return { label: "Critical Risk", color: "#ef4444", band: "critical" };
  if (score <= 70)
    return { label: "Needs Attention", color: "#f59e0b", band: "attention" };
  if (score <= 89)
    return { label: "Good Health", color: "#22c55e", band: "good" };
  return { label: "Optimal", color: "#22c55e", band: "optimal" };
}

// -------------------------------------------------------------------
// Disease-risk indicators (0–95% per disease).
// Coefficients per the demo spec — illustrative only.
// -------------------------------------------------------------------

export type RiskKey =
  | "cardiovascular"
  | "diabetes"
  | "alzheimers"
  | "metabolicSyndrome";

export type DiseaseRisks = Record<RiskKey, number>;

export const RISK_LABELS: Record<RiskKey, string> = {
  cardiovascular: "Cardiovascular Disease",
  diabetes: "Type 2 Diabetes",
  alzheimers: "Alzheimer's Disease",
  metabolicSyndrome: "Metabolic Syndrome",
};

export function computeRisks(m: Metrics): DiseaseRisks {
  const cap = (n: number, lo = 0, hi = 95) => Math.max(lo, Math.min(hi, n));

  let cv = (m.age / 100) * 15;
  if (m.smokerStatus === "smoker") cv += 40;
  if (m.stress > 7) cv += 20;
  if (m.heartRate > 85) cv += 15;
  if (m.exercise > 4) cv -= 15;

  let dm = (m.age / 100) * 10;
  if (m.sleep < 6) dm += 37;
  if (m.exercise < 2) dm += 25;
  if (m.stress > 7) dm += 20;
  if (m.exercise > 4) dm -= 20;

  let alz = (m.age / 100) * 8;
  if (m.exercise > 4) alz -= 45;
  if (m.sleep < 6) alz += 30;
  if (m.stress > 7) alz += 20;

  let ms = (m.age / 100) * 12;
  if (m.exercise < 2) ms += 30;
  if (m.stress > 7) ms += 25;
  if (m.smokerStatus === "smoker") ms += 20;
  if (m.exercise > 4) ms -= 25;

  return {
    cardiovascular: Math.round(cap(cv)),
    diabetes: Math.round(cap(dm)),
    alzheimers: Math.round(cap(alz, 2)),
    metabolicSyndrome: Math.round(cap(ms)),
  };
}

export function riskColor(value: number): string {
  if (value < 30) return "#22c55e";
  if (value < 60) return "#f59e0b";
  return "#ef4444";
}

// -------------------------------------------------------------------
// Trajectory projection over 0 / 5 / 10 / 20 years.
//
// Annual decline rate is composed from current habits. The "optimised"
// trajectory swaps the single highest-impact negative behaviour for a
// healthy default and re-projects.
// -------------------------------------------------------------------

export type TrajectoryPoint = {
  yearsFromNow: number;
  ageAtTime: number;
  current: number;
  optimized: number;
};

function annualDecline(m: Metrics): number {
  let d = 0.4; // baseline biological aging
  if (m.smokerStatus === "smoker") d += 1.5;
  if (m.sleep < 6) d += 0.8;
  if (m.stress > 7) d += 0.6;
  if (m.exercise < 2) d += 0.5;
  if (m.heartRate > 85) d += 0.4;
  if (m.exercise >= 5) d -= 0.5;
  if (m.sleep >= 7 && m.sleep <= 9) d -= 0.3;
  if (m.stress <= 3) d -= 0.3;
  return Math.max(0, d);
}

// -------------------------------------------------------------------
// Single-best-change identification.
// -------------------------------------------------------------------

export type ChangeKey =
  | "quit-smoking"
  | "more-exercise"
  | "more-sleep"
  | "reduce-stress"
  | "lower-hr"
  | "none";

export type BestChange = {
  key: ChangeKey;
  actionLabel: string; // "quit smoking", "increase exercise to 5+ days/week", …
  diseaseLabel: string; // "your cardiovascular disease risk"
  beforePct: number;
  afterPct: number;
  scoreBefore: number;
  scoreAfter: number;
};

function applyChange(m: Metrics, key: ChangeKey): Metrics {
  switch (key) {
    case "quit-smoking":
      return { ...m, smokerStatus: "former" };
    case "more-exercise":
      return { ...m, exercise: 5 };
    case "more-sleep":
      return { ...m, sleep: 7.5 };
    case "reduce-stress":
      return { ...m, stress: 4 };
    case "lower-hr":
      return { ...m, heartRate: 68 };
    case "none":
      return m;
  }
}

export function identifyBestChange(m: Metrics): BestChange {
  const baselineRisks = computeRisks(m);
  const baselineScore = computeHealthScore(m);

  const candidates: { key: ChangeKey; label: string }[] = [];
  if (m.smokerStatus === "smoker") {
    candidates.push({ key: "quit-smoking", label: "quit smoking" });
  }
  if (m.exercise < 5) {
    candidates.push({
      key: "more-exercise",
      label: "increase exercise to 5+ days a week",
    });
  }
  if (m.sleep < 7) {
    candidates.push({
      key: "more-sleep",
      label: "get a consistent 7+ hours of sleep",
    });
  }
  if (m.stress > 6) {
    candidates.push({
      key: "reduce-stress",
      label: "bring your stress down to a 4",
    });
  }
  if (m.heartRate > 80) {
    candidates.push({
      key: "lower-hr",
      label: "lower your resting heart rate through aerobic conditioning",
    });
  }

  if (candidates.length === 0) {
    return {
      key: "none",
      actionLabel: "keep doing what you're doing",
      diseaseLabel: "your overall risk profile",
      beforePct: 0,
      afterPct: 0,
      scoreBefore: baselineScore,
      scoreAfter: baselineScore,
    };
  }

  let best: {
    key: ChangeKey;
    label: string;
    disease: RiskKey;
    before: number;
    after: number;
    reduction: number;
    scoreAfter: number;
  } | null = null;

  for (const c of candidates) {
    const newMetrics = applyChange(m, c.key);
    const newRisks = computeRisks(newMetrics);
    const newScore = computeHealthScore(newMetrics);
    for (const k of Object.keys(baselineRisks) as RiskKey[]) {
      const reduction = baselineRisks[k] - newRisks[k];
      if (!best || reduction > best.reduction) {
        best = {
          key: c.key,
          label: c.label,
          disease: k,
          before: baselineRisks[k],
          after: newRisks[k],
          reduction,
          scoreAfter: newScore,
        };
      }
    }
  }

  if (!best) {
    const c = candidates[0];
    const newMetrics = applyChange(m, c.key);
    return {
      key: c.key,
      actionLabel: c.label,
      diseaseLabel: "your cardiovascular disease risk",
      beforePct: baselineRisks.cardiovascular,
      afterPct: computeRisks(newMetrics).cardiovascular,
      scoreBefore: baselineScore,
      scoreAfter: computeHealthScore(newMetrics),
    };
  }

  const diseaseLabelMap: Record<RiskKey, string> = {
    cardiovascular: "your cardiovascular disease risk",
    diabetes: "your type 2 diabetes risk",
    alzheimers: "your Alzheimer's risk",
    metabolicSyndrome: "your metabolic syndrome risk",
  };

  return {
    key: best.key,
    actionLabel: best.label,
    diseaseLabel: diseaseLabelMap[best.disease],
    beforePct: best.before,
    afterPct: best.after,
    scoreBefore: baselineScore,
    scoreAfter: best.scoreAfter,
  };
}

export function projectTrajectory(m: Metrics): {
  points: TrajectoryPoint[];
  bestChange: BestChange;
} {
  const todayScore = computeHealthScore(m);
  const change = identifyBestChange(m);
  const optimisedMetrics =
    change.key === "none" ? m : applyChange(m, change.key);
  const optimisedToday = computeHealthScore(optimisedMetrics);

  const dCurrent = annualDecline(m);
  const dOptimised = annualDecline(optimisedMetrics);

  const yearsList = [0, 5, 10, 20];
  const points = yearsList.map((years) => ({
    yearsFromNow: years,
    ageAtTime: Math.round(m.age + years),
    current: Math.max(0, Math.round(todayScore - dCurrent * years)),
    optimized: Math.max(
      0,
      Math.min(100, Math.round(optimisedToday - dOptimised * years)),
    ),
  }));

  return { points, bestChange: change };
}
